import type { WorkItem } from "../types.js";
import { requestJson, resolveLimit, SourceError, type SourceContext, type SourceQuery } from "./common.js";

interface JiraSearchResponse {
  issues: Array<{
    key: string;
    fields: {
      summary: string;
      issuetype?: { name?: string };
      labels?: string[];
      resolutiondate?: string | null;
      description?: unknown;
    };
  }>;
  nextPageToken?: string;
  isLast?: boolean;
}

const quote = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const toJqlDate = (value: string) => value.slice(0, 10);

export function buildJql(query: SourceQuery): string {
  if (query.jql) return query.jql;
  if (!query.project) {
    throw new SourceError('Jira needs either "jql" or "project".');
  }
  const clauses = [`project = ${quote(query.project)}`, "statusCategory = Done"];
  if (query.fixVersion) clauses.push(`fixVersion = ${quote(query.fixVersion)}`);
  if (query.since) clauses.push(`resolved >= ${quote(toJqlDate(query.since))}`);
  // JQL date-only bounds mean midnight, so step past the end day to include it.
  if (query.until) {
    const end = new Date(`${toJqlDate(query.until)}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    clauses.push(`resolved < ${quote(end.toISOString().slice(0, 10))}`);
  }
  return `${clauses.join(" AND ")} ORDER BY resolved DESC`;
}

/** Jira Cloud descriptions are Atlassian Document Format; keep just the text. */
export function adfToText(node: unknown): string {
  if (!node || typeof node !== "object") return typeof node === "string" ? node : "";
  const { text, content } = node as { text?: string; content?: unknown[] };
  const own = typeof text === "string" ? text : "";
  const children = Array.isArray(content) ? content.map(adfToText).filter(Boolean).join(" ") : "";
  return [own, children].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export async function fetchJira(query: SourceQuery, ctx: SourceContext): Promise<WorkItem[]> {
  const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN } = ctx.env;
  if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN) {
    throw new SourceError("Set JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN to read from Jira.");
  }
  const baseUrl = JIRA_BASE_URL.replace(/\/+$/, "");
  const jql = buildJql(query);
  const limit = resolveLimit(query.limit);
  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");

  const items: WorkItem[] = [];
  let nextPageToken: string | undefined;
  do {
    const page = await requestJson<JiraSearchResponse>(
      ctx.fetchImpl,
      `${baseUrl}/rest/api/3/search/jql`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jql,
          fields: ["summary", "issuetype", "labels", "resolutiondate", "description"],
          maxResults: Math.min(100, limit - items.length),
          ...(nextPageToken ? { nextPageToken } : {}),
        }),
      },
      "Jira",
    );
    for (const issue of page.issues) {
      const description = adfToText(issue.fields.description);
      items.push({
        id: issue.key,
        title: issue.fields.summary,
        url: `${baseUrl}/browse/${issue.key}`,
        type: issue.fields.issuetype?.name,
        labels: issue.fields.labels ?? [],
        closedAt: issue.fields.resolutiondate ?? undefined,
        description: description ? description.slice(0, 500) : undefined,
        source: "jira",
      });
    }
    nextPageToken = page.isLast ? undefined : page.nextPageToken;
  } while (nextPageToken && items.length < limit);

  return items.slice(0, limit);
}
