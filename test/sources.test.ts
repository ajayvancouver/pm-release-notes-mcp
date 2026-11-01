import { describe, expect, it } from "vitest";
import { fetchWorkItems, SourceError, type FetchLike } from "../src/sources/index.js";
import { adfToText, buildJql } from "../src/sources/jira.js";
import { buildLinearFilter } from "../src/sources/linear.js";

interface Call {
  url: string;
  init?: RequestInit;
}

function mockFetch(responses: unknown[], status = 200): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const body = queue.shift() ?? [];
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  return { fetchImpl, calls };
}

describe("GitHub source", () => {
  const issues = [
    { number: 10, title: "feat: SSO for admins", html_url: "https://github.com/a/b/pull/10", closed_at: "2026-10-20T10:00:00Z", labels: [], pull_request: { merged_at: "2026-10-20T10:00:00Z" } },
    { number: 11, title: "Experiment we abandoned", html_url: "https://github.com/a/b/pull/11", closed_at: "2026-10-21T10:00:00Z", labels: [], pull_request: { merged_at: null } },
    { number: 12, title: "Crash on empty invoice", html_url: "https://github.com/a/b/issues/12", closed_at: "2026-10-22T10:00:00Z", state_reason: "completed", labels: [{ name: "bug" }] },
    { number: 13, title: "Duplicate of #12", html_url: "https://github.com/a/b/issues/13", closed_at: "2026-10-22T11:00:00Z", state_reason: "duplicate", labels: [] },
    { number: 14, title: "Old fix", html_url: "https://github.com/a/b/issues/14", closed_at: "2026-09-01T10:00:00Z", state_reason: "completed", labels: [] },
  ];

  it("keeps merged PRs and completed issues inside the date range", async () => {
    const { fetchImpl, calls } = mockFetch([issues]);
    const items = await fetchWorkItems(
      { source: "github", repo: "a/b", since: "2026-10-01", until: "2026-10-31" },
      { env: { GITHUB_TOKEN: "t" }, fetchImpl },
    );
    expect(items.map((i) => i.id)).toEqual(["#10", "#12"]);
    expect(items[1]?.labels).toEqual(["bug"]);
    expect(calls[0]?.url).toContain("/repos/a/b/issues?");
    expect(calls[0]?.url).toContain("since=2026-10-01T00%3A00%3A00.000Z");
    expect((calls[0]?.init?.headers as Record<string, string>).Authorization).toBe("Bearer t");
  });

  it("rejects a malformed repo name", async () => {
    const { fetchImpl } = mockFetch([]);
    await expect(fetchWorkItems({ source: "github", repo: "not a repo" }, { env: {}, fetchImpl })).rejects.toThrow(SourceError);
  });

  it("explains authentication failures", async () => {
    const { fetchImpl } = mockFetch([{ message: "Bad credentials" }], 401);
    await expect(fetchWorkItems({ source: "github", repo: "a/b" }, { env: {}, fetchImpl })).rejects.toThrow(/HTTP 401.*credentials/);
  });
});

describe("Jira source", () => {
  const env = { JIRA_BASE_URL: "https://acme.atlassian.net/", JIRA_EMAIL: "pm@acme.com", JIRA_API_TOKEN: "x" };

  it("builds JQL from project, fix version and dates", () => {
    expect(buildJql({ source: "jira", project: "PAY", fixVersion: "2.4.0", since: "2026-10-01", until: "2026-10-31" })).toBe(
      'project = "PAY" AND statusCategory = Done AND fixVersion = "2.4.0" AND resolved >= "2026-10-01" AND resolved < "2026-11-01" ORDER BY resolved DESC',
    );
  });

  it("passes custom JQL through untouched", () => {
    expect(buildJql({ source: "jira", jql: "labels = launch" })).toBe("labels = launch");
  });

  it("flattens Atlassian Document Format descriptions", () => {
    const adf = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Fixes" }, { type: "text", text: "rounding." }] }] };
    expect(adfToText(adf)).toBe("Fixes rounding.");
  });

  it("follows nextPageToken and maps fields", async () => {
    const page1 = {
      issues: [{ key: "PAY-1", fields: { summary: "Proration preview", issuetype: { name: "Story" }, labels: ["billing"], resolutiondate: "2026-10-10T00:00:00.000+0000" } }],
      nextPageToken: "abc",
      isLast: false,
    };
    const page2 = { issues: [{ key: "PAY-2", fields: { summary: "Tax total wrong", issuetype: { name: "Bug" }, labels: [] } }], isLast: true };
    const { fetchImpl, calls } = mockFetch([page1, page2]);

    const items = await fetchWorkItems({ source: "jira", project: "PAY" }, { env, fetchImpl });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: "PAY-1", type: "Story", url: "https://acme.atlassian.net/browse/PAY-1" });
    expect(calls[0]?.url).toBe("https://acme.atlassian.net/rest/api/3/search/jql");
    expect(JSON.parse(String(calls[1]?.init?.body)).nextPageToken).toBe("abc");
  });

  it("asks for credentials when they are missing", async () => {
    const { fetchImpl } = mockFetch([]);
    await expect(fetchWorkItems({ source: "jira", project: "PAY" }, { env: {}, fetchImpl })).rejects.toThrow(/JIRA_BASE_URL/);
  });
});

describe("Linear source", () => {
  it("filters on completed state, team and completion date", () => {
    expect(buildLinearFilter({ source: "linear", team: "ENG", since: "2026-10-01", until: "2026-10-31" })).toEqual({
      state: { type: { eq: "completed" } },
      team: { key: { eq: "ENG" } },
      completedAt: { gte: "2026-10-01T00:00:00.000Z", lte: "2026-10-31T23:59:59.999Z" },
    });
  });

  it("pages through results and maps labels", async () => {
    const node = (id: string) => ({ identifier: id, title: `Issue ${id}`, url: `https://linear.app/x/issue/${id}`, completedAt: "2026-10-10T00:00:00Z", labels: { nodes: [{ name: "Feature" }] } });
    const { fetchImpl, calls } = mockFetch([
      { data: { issues: { nodes: [node("ENG-1")], pageInfo: { hasNextPage: true, endCursor: "c1" } } } },
      { data: { issues: { nodes: [node("ENG-2")], pageInfo: { hasNextPage: false } } } },
    ]);

    const items = await fetchWorkItems({ source: "linear", team: "ENG" }, { env: { LINEAR_API_KEY: "lin_x" }, fetchImpl });

    expect(items.map((i) => i.id)).toEqual(["ENG-1", "ENG-2"]);
    expect(items[0]?.labels).toEqual(["Feature"]);
    expect(JSON.parse(String(calls[1]?.init?.body)).variables.after).toBe("c1");
    expect((calls[0]?.init?.headers as Record<string, string>).Authorization).toBe("lin_x");
  });

  it("surfaces GraphQL errors", async () => {
    const { fetchImpl } = mockFetch([{ errors: [{ message: "Team not found" }] }]);
    await expect(fetchWorkItems({ source: "linear", team: "NOPE" }, { env: { LINEAR_API_KEY: "k" }, fetchImpl })).rejects.toThrow(/Team not found/);
  });
});
