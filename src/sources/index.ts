import type { WorkItem } from "../types.js";
import type { SourceContext, SourceQuery } from "./common.js";
import { fetchGitHub } from "./github.js";
import { fetchJira } from "./jira.js";
import { fetchLinear } from "./linear.js";

export * from "./common.js";

export async function fetchWorkItems(query: SourceQuery, ctx: SourceContext): Promise<WorkItem[]> {
  switch (query.source) {
    case "github":
      return fetchGitHub(query, ctx);
    case "jira":
      return fetchJira(query, ctx);
    case "linear":
      return fetchLinear(query, ctx);
  }
}
