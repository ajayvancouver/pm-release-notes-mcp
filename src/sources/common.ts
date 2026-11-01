export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface SourceContext {
  env: Record<string, string | undefined>;
  fetchImpl: FetchLike;
}

export interface SourceQuery {
  source: "github" | "jira" | "linear";
  /** GitHub: "owner/name". */
  repo?: string;
  /** Jira: full JQL. Overrides project/fixVersion/since/until when given. */
  jql?: string;
  /** Jira project key, e.g. "PAY". */
  project?: string;
  /** Jira fix version, e.g. "2.4.0". */
  fixVersion?: string;
  /** Linear team key, e.g. "ENG". */
  team?: string;
  /** Inclusive start, YYYY-MM-DD or ISO timestamp. */
  since?: string;
  /** Inclusive end, YYYY-MM-DD or ISO timestamp. */
  until?: string;
  /** Maximum items to return. */
  limit?: number;
}

export class SourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceError";
  }
}

export const DEFAULT_LIMIT = 200;
export const MAX_LIMIT = 500;

export function resolveLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)));
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Parses a bound; a date-only `until` covers that whole day. */
export function parseBound(value: string | undefined, edge: "start" | "end"): number | undefined {
  if (!value) return undefined;
  const iso = DATE_ONLY.test(value) ? `${value}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}Z` : value;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) throw new SourceError(`"${value}" is not a valid date. Use YYYY-MM-DD.`);
  return time;
}

export function inRange(closedAt: string | undefined, since?: string, until?: string): boolean {
  const start = parseBound(since, "start");
  const end = parseBound(until, "end");
  if (start === undefined && end === undefined) return true;
  if (!closedAt) return false;
  const time = Date.parse(closedAt);
  if (start !== undefined && time < start) return false;
  if (end !== undefined && time > end) return false;
  return true;
}

export async function requestJson<T>(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  label: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    throw new SourceError(`Could not reach ${label}: ${(error as Error).message}`);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const hint =
      response.status === 401 || response.status === 403
        ? " Check the credentials in your MCP client config."
        : "";
    throw new SourceError(`${label} returned HTTP ${response.status}.${hint} ${body.slice(0, 300)}`.trim());
  }
  return (await response.json()) as T;
}
