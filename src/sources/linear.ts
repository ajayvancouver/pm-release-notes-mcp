import type { WorkItem } from "../types.js";
import { parseBound, requestJson, resolveLimit, SourceError, type SourceContext, type SourceQuery } from "./common.js";

const ISSUES_QUERY = `
  query CompletedIssues($filter: IssueFilter, $first: Int!, $after: String) {
    issues(filter: $filter, first: $first, after: $after, orderBy: updatedAt) {
      nodes {
        identifier
        title
        url
        description
        completedAt
        labels { nodes { name } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

interface LinearResponse {
  data?: {
    issues: {
      nodes: Array<{
        identifier: string;
        title: string;
        url: string;
        description?: string | null;
        completedAt?: string | null;
        labels: { nodes: Array<{ name: string }> };
      }>;
      pageInfo: { hasNextPage: boolean; endCursor?: string | null };
    };
  };
  errors?: Array<{ message: string }>;
}

export function buildLinearFilter(query: SourceQuery): Record<string, unknown> {
  const filter: Record<string, unknown> = { state: { type: { eq: "completed" } } };
  if (query.team) filter.team = { key: { eq: query.team } };
  const start = parseBound(query.since, "start");
  const end = parseBound(query.until, "end");
  if (start !== undefined || end !== undefined) {
    filter.completedAt = {
      ...(start !== undefined ? { gte: new Date(start).toISOString() } : {}),
      ...(end !== undefined ? { lte: new Date(end).toISOString() } : {}),
    };
  }
  return filter;
}

export async function fetchLinear(query: SourceQuery, ctx: SourceContext): Promise<WorkItem[]> {
  const apiKey = ctx.env.LINEAR_API_KEY;
  if (!apiKey) throw new SourceError("Set LINEAR_API_KEY to read from Linear.");
  const limit = resolveLimit(query.limit);
  const filter = buildLinearFilter(query);

  const items: WorkItem[] = [];
  let after: string | undefined;
  for (;;) {
    const response = await requestJson<LinearResponse>(
      ctx.fetchImpl,
      "https://api.linear.app/graphql",
      {
        method: "POST",
        headers: { Authorization: apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          query: ISSUES_QUERY,
          variables: { filter, first: Math.min(100, limit - items.length), after },
        }),
      },
      "Linear",
    );
    if (response.errors?.length) {
      throw new SourceError(`Linear: ${response.errors.map((e) => e.message).join("; ")}`);
    }
    const connection = response.data?.issues;
    if (!connection) break;
    for (const node of connection.nodes) {
      items.push({
        id: node.identifier,
        title: node.title,
        url: node.url,
        labels: node.labels.nodes.map((l) => l.name),
        closedAt: node.completedAt ?? undefined,
        description: node.description?.slice(0, 500) ?? undefined,
        source: "linear",
      });
    }
    if (!connection.pageInfo.hasNextPage || !connection.pageInfo.endCursor || items.length >= limit) break;
    after = connection.pageInfo.endCursor;
  }
  return items.slice(0, limit);
}
