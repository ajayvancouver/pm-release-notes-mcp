import type { WorkItem } from "../types.js";
import { inRange, parseBound, requestJson, resolveLimit, SourceError, type SourceContext, type SourceQuery } from "./common.js";

interface GitHubIssue {
  number: number;
  title: string;
  html_url: string;
  body?: string | null;
  state_reason?: string | null;
  closed_at: string | null;
  labels: Array<string | { name?: string }>;
  pull_request?: { merged_at: string | null };
}

const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;
const MAX_PAGES = 10;

/**
 * Closed issues completed as planned, plus merged pull requests.
 * Issues closed as "not planned" or "duplicate" and unmerged PRs never shipped,
 * so they are left out.
 */
export async function fetchGitHub(query: SourceQuery, ctx: SourceContext): Promise<WorkItem[]> {
  if (!query.repo || !REPO_PATTERN.test(query.repo)) {
    throw new SourceError('GitHub needs "repo" in the form "owner/name".');
  }
  const limit = resolveLimit(query.limit);
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "pm-release-notes-mcp",
  };
  const token = ctx.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const start = parseBound(query.since, "start");
  const items: WorkItem[] = [];
  for (let page = 1; page <= MAX_PAGES && items.length < limit; page++) {
    const params = new URLSearchParams({
      state: "closed",
      sort: "updated",
      direction: "desc",
      per_page: "100",
      page: String(page),
    });
    // `since` filters on last update, which is always >= close time, so it is a
    // safe pre-filter; the exact close-date check happens below.
    if (start !== undefined) params.set("since", new Date(start).toISOString());

    const batch = await requestJson<GitHubIssue[]>(
      ctx.fetchImpl,
      `https://api.github.com/repos/${query.repo}/issues?${params}`,
      { headers },
      "GitHub",
    );

    for (const issue of batch) {
      const closedAt = issue.pull_request ? issue.pull_request.merged_at : issue.closed_at;
      if (!closedAt) continue;
      if (!issue.pull_request && (issue.state_reason === "not_planned" || issue.state_reason === "duplicate")) continue;
      if (!inRange(closedAt, query.since, query.until)) continue;
      items.push({
        id: `#${issue.number}`,
        title: issue.title,
        url: issue.html_url,
        labels: issue.labels
          .map((l) => (typeof l === "string" ? l : l.name ?? ""))
          .filter(Boolean),
        closedAt,
        description: issue.body?.slice(0, 500) ?? undefined,
        source: "github",
      });
      if (items.length >= limit) break;
    }
    if (batch.length < 100) break;
  }
  return items;
}
