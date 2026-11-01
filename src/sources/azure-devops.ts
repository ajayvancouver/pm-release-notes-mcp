import type { WorkItem } from "../types.js";
import { requestJson, resolveLimit, SourceError, type SourceContext, type SourceQuery } from "./common.js";

const FIELDS = [
  "System.Id",
  "System.Title",
  "System.WorkItemType",
  "System.Tags",
  "System.TeamProject",
  "System.Description",
  "Microsoft.VSTS.Common.ClosedDate",
];

// "Done" (Scrum, Basic) and "Closed" (Agile, CMMI) are the completed states in
// the default processes. Teams with custom states can pass their own WIQL.
const COMPLETED_STATES = ["Done", "Closed"];
const BATCH_SIZE = 200;
const API_VERSION = "7.1";

interface WiqlResponse {
  workItems: Array<{ id: number }>;
}

interface BatchResponse {
  value: Array<{ id: number; fields: Record<string, unknown> }>;
}

const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
const toDate = (value: string) => value.slice(0, 10);

export function organizationUrl(org: string): string {
  const trimmed = org.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://dev.azure.com/${encodeURIComponent(trimmed)}`;
}

export function buildWiql(query: SourceQuery): string {
  if (query.wiql) return query.wiql;
  if (!query.project) {
    throw new SourceError('Azure DevOps needs either "wiql" or "project".');
  }
  const clauses = [
    `[System.TeamProject] = ${quote(query.project)}`,
    `[System.State] IN (${COMPLETED_STATES.map(quote).join(", ")})`,
  ];
  if (query.iteration) clauses.push(`[System.IterationPath] UNDER ${quote(query.iteration)}`);
  if (query.since) clauses.push(`[Microsoft.VSTS.Common.ClosedDate] >= ${quote(toDate(query.since))}`);
  if (query.until) {
    // Date-only comparisons start at midnight, so step past the end day to include it.
    const end = new Date(`${toDate(query.until)}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    clauses.push(`[Microsoft.VSTS.Common.ClosedDate] < ${quote(end.toISOString().slice(0, 10))}`);
  }
  return `SELECT [System.Id] FROM WorkItems WHERE ${clauses.join(" AND ")} ORDER BY [Microsoft.VSTS.Common.ClosedDate] DESC`;
}

/** Tags come back as one string: "billing; customer-facing". */
export function parseTags(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return raw.split(";").map((t) => t.trim()).filter(Boolean);
}

function htmlToText(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const text = raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 500) : undefined;
}

export async function fetchAzureDevOps(query: SourceQuery, ctx: SourceContext): Promise<WorkItem[]> {
  const { AZURE_DEVOPS_ORG, AZURE_DEVOPS_PAT } = ctx.env;
  if (!AZURE_DEVOPS_ORG || !AZURE_DEVOPS_PAT) {
    throw new SourceError("Set AZURE_DEVOPS_ORG and AZURE_DEVOPS_PAT to read from Azure DevOps.");
  }
  const baseUrl = organizationUrl(AZURE_DEVOPS_ORG);
  const limit = resolveLimit(query.limit);
  const headers = {
    // Personal access tokens use Basic auth with an empty user name.
    Authorization: `Basic ${Buffer.from(`:${AZURE_DEVOPS_PAT}`).toString("base64")}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const found = await requestJson<WiqlResponse>(
    ctx.fetchImpl,
    `${baseUrl}/_apis/wit/wiql?$top=${limit}&api-version=${API_VERSION}`,
    { method: "POST", headers, body: JSON.stringify({ query: buildWiql(query) }) },
    "Azure DevOps",
  );
  const ids = found.workItems.map((w) => w.id).slice(0, limit);

  const items: WorkItem[] = [];
  for (let start = 0; start < ids.length; start += BATCH_SIZE) {
    const batch = await requestJson<BatchResponse>(
      ctx.fetchImpl,
      `${baseUrl}/_apis/wit/workitemsbatch?api-version=${API_VERSION}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ ids: ids.slice(start, start + BATCH_SIZE), fields: FIELDS, errorPolicy: "omit" }),
      },
      "Azure DevOps",
    );
    for (const workItem of batch.value ?? []) {
      if (!workItem) continue;
      const f = workItem.fields;
      const project = typeof f["System.TeamProject"] === "string" ? f["System.TeamProject"] : query.project;
      items.push({
        id: `#${workItem.id}`,
        title: String(f["System.Title"] ?? ""),
        url: project ? `${baseUrl}/${encodeURIComponent(project)}/_workitems/edit/${workItem.id}` : undefined,
        type: typeof f["System.WorkItemType"] === "string" ? f["System.WorkItemType"] : undefined,
        labels: parseTags(f["System.Tags"]),
        closedAt: typeof f["Microsoft.VSTS.Common.ClosedDate"] === "string" ? f["Microsoft.VSTS.Common.ClosedDate"] : undefined,
        description: htmlToText(f["System.Description"]),
        source: "azure-devops",
      });
    }
  }
  return items;
}
