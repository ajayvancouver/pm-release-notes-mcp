import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { draftReleaseNotes } from "./render.js";
import { fetchWorkItems, MAX_LIMIT, SourceError, type FetchLike, type SourceQuery } from "./sources/index.js";
import type { WorkItem } from "./types.js";

export const SERVER_NAME = "pm-release-notes-mcp";
export const SERVER_VERSION = "0.1.0";

export interface ServerOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: FetchLike;
}

const sourceQueryShape = {
  source: z.enum(["github", "jira", "linear"]).describe("Which tracker to read from."),
  repo: z.string().optional().describe('GitHub only: repository as "owner/name".'),
  jql: z.string().optional().describe("Jira only: custom JQL. Overrides project, fixVersion and dates."),
  project: z.string().optional().describe('Jira only: project key, e.g. "PAY".'),
  fixVersion: z.string().optional().describe('Jira only: fix version, e.g. "2.4.0".'),
  team: z.string().optional().describe('Linear only: team key, e.g. "ENG".'),
  since: z.string().optional().describe("Include work closed on or after this date (YYYY-MM-DD)."),
  until: z.string().optional().describe("Include work closed on or before this date (YYYY-MM-DD)."),
  limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe(`Maximum items to fetch (default 200, max ${MAX_LIMIT}).`),
};

const manualItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().optional(),
  type: z.string().optional().describe('Issue type, e.g. "Bug" or "Story".'),
  labels: z.array(z.string()).default([]),
  closedAt: z.string().optional(),
  description: z.string().optional(),
});

const errorResult = (message: string) => ({
  isError: true,
  content: [{ type: "text" as const, text: message }],
});

function toQuery(args: Partial<SourceQuery> & { source?: SourceQuery["source"] }): SourceQuery | undefined {
  if (!args.source) return undefined;
  const { source, repo, jql, project, fixVersion, team, since, until, limit } = args;
  return { source, repo, jql, project, fixVersion, team, since, until, limit };
}

export function createServer(options: ServerOptions = {}): McpServer {
  const ctx = {
    env: options.env ?? process.env,
    fetchImpl: options.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init)),
  };

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "fetch_work_items",
    {
      title: "Fetch shipped work items",
      description:
        "Read completed issues and merged pull requests from GitHub, Jira or Linear for a date range or fix version. Read-only.",
      inputSchema: sourceQueryShape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const items = await fetchWorkItems(toQuery(args)!, ctx);
        return {
          content: [{ type: "text", text: JSON.stringify({ count: items.length, items }, null, 2) }],
        };
      } catch (error) {
        if (error instanceof SourceError) return errorResult(error.message);
        throw error;
      }
    },
  );

  server.registerTool(
    "draft_release_notes",
    {
      title: "Draft release notes",
      description:
        "Categorise shipped work into breaking changes, features, improvements, fixes and internal work, then draft Markdown release notes. " +
        "Pass a tracker query (source plus filters) or a list of items. Returns the draft plus a review list of items it excluded or could not place. " +
        "Nothing is published: the draft is for a human to review.",
      inputSchema: {
        ...sourceQueryShape,
        source: sourceQueryShape.source.optional(),
        items: z.array(manualItemSchema).optional().describe("Work items to use instead of fetching from a tracker."),
        audience: z
          .enum(["customer", "internal"])
          .default("customer")
          .describe("customer: plain language, no internal work or ticket keys. internal: everything, with links."),
        version: z.string().optional().describe('Release name or version, e.g. "v2.4.0".'),
        date: z.string().optional().describe("Release date, YYYY-MM-DD."),
        productName: z.string().optional(),
        includeLinks: z.boolean().optional().describe("Show ticket keys and links. Defaults on for internal, off for customer."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      let items: WorkItem[];
      try {
        if (args.items?.length) {
          items = args.items.map((item) => ({ ...item, source: "manual" as const }));
        } else {
          const query = toQuery(args);
          if (!query) return errorResult('Provide either "items" or a "source" with its filters.');
          items = await fetchWorkItems(query, ctx);
        }
      } catch (error) {
        if (error instanceof SourceError) return errorResult(error.message);
        throw error;
      }

      const draft = draftReleaseNotes(items, {
        audience: args.audience,
        version: args.version,
        date: args.date,
        productName: args.productName,
        includeLinks: args.includeLinks,
      });

      const review: string[] = [`Categorised ${draft.items.length} items: ${JSON.stringify(draft.counts)}.`];
      if (draft.needsReview.length) {
        review.push(
          "",
          "Needs a decision (no label, prefix or issue type matched; currently under \"Other changes\"):",
          ...draft.needsReview.map((i) => `- ${i.id} ${i.title}`),
        );
      }
      if (draft.excluded.length) {
        review.push(
          "",
          "Left out of customer notes as internal work:",
          ...draft.excluded.map((i) => `- ${i.id} ${i.title} (${i.reason})`),
        );
      }

      return {
        content: [
          { type: "text", text: draft.markdown },
          { type: "text", text: review.join("\n") },
        ],
      };
    },
  );

  server.registerPrompt(
    "polish_release_notes",
    {
      title: "Polish release notes for customers",
      description: "Turn a categorised draft into customer-ready release notes without adding anything that did not ship.",
      argsSchema: {
        draft: z.string().describe("Markdown draft from draft_release_notes."),
        tone: z.string().optional().describe('Voice to write in, e.g. "friendly, concise".'),
      },
    },
    ({ draft, tone }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Rewrite these release notes for customers.",
              "",
              "Rules:",
              "- Keep every item and keep it in its section. Do not add, merge away or invent changes.",
              "- Describe each item by what the customer can now do or no longer has to put up with, not by how it was built.",
              "- Keep breaking changes first. For each, add one line saying what the customer needs to do, or write \"[action needed: confirm with engineering]\" if the draft does not say.",
              "- Open with a two-sentence summary of the most important changes.",
              `- Tone: ${tone ?? "clear, friendly and concise"}.`,
              "- Return Markdown only.",
              "",
              "Draft:",
              "",
              draft,
            ].join("\n"),
          },
        },
      ],
    }),
  );

  return server;
}
