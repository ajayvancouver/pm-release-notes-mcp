import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, type ServerOptions } from "../src/server.js";

type TextBlock = { type: "text"; text: string };

const clients: Client[] = [];

async function connect(options: ServerOptions = {}): Promise<Client> {
  const server = createServer({ env: {}, ...options });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  clients.push(client);
  return client;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

describe("MCP server", () => {
  it("exposes two read-only tools and a prompt", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["draft_release_notes", "fetch_work_items"]);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);

    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(["polish_release_notes"]);
  });

  it("drafts notes from items passed in directly", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "draft_release_notes",
      arguments: {
        version: "v1.2.0",
        items: [
          { id: "1", title: "feat: bulk export", labels: [] },
          { id: "2", title: "chore: tidy CI", labels: [] },
          { id: "3", title: "Refresh onboarding copy", labels: [] },
        ],
      },
    });
    const [notes, review] = result.content as TextBlock[];
    expect(notes?.text).toContain("### New features\n\n- Bulk export");
    expect(notes?.text).not.toContain("tidy CI");
    expect(review?.text).toContain("Needs a decision");
    expect(review?.text).toContain("3 Refresh onboarding copy");
    expect(review?.text).toContain("2 chore: tidy CI");
  });

  it("fetches from a tracker when given a source", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify([
          { number: 7, title: "fix: double charge on retry", html_url: "https://github.com/a/b/pull/7", closed_at: "2026-10-05T00:00:00Z", labels: [], pull_request: { merged_at: "2026-10-05T00:00:00Z" } },
        ]),
        { status: 200 },
      );
    const client = await connect({ fetchImpl });
    const result = await client.callTool({
      name: "draft_release_notes",
      arguments: { source: "github", repo: "a/b", audience: "internal" },
    });
    const [notes] = result.content as TextBlock[];
    expect(notes?.text).toContain("### Bug fixes\n\n- Double charge on retry ([#7](https://github.com/a/b/pull/7))");
  });

  it("returns a tool error rather than throwing when config is missing", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "fetch_work_items", arguments: { source: "jira", project: "PAY" } });
    expect(result.isError).toBe(true);
    expect((result.content as TextBlock[])[0]?.text).toMatch(/JIRA_BASE_URL/);
  });

  it("asks for a source or items when given neither", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "draft_release_notes", arguments: {} });
    expect(result.isError).toBe(true);
  });

  it("builds a polishing prompt that forbids invented changes", async () => {
    const client = await connect();
    const prompt = await client.getPrompt({ name: "polish_release_notes", arguments: { draft: "## v1\n\n- Thing" } });
    const text = (prompt.messages[0]?.content as TextBlock).text;
    expect(text).toContain("Do not add, merge away or invent changes");
    expect(text).toContain("## v1\n\n- Thing");
  });
});
