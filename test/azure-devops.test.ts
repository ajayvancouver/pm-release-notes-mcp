import { describe, expect, it } from "vitest";
import { categorize } from "../src/categorize.js";
import { fetchWorkItems, type FetchLike } from "../src/sources/index.js";
import { buildWiql, organizationUrl, parseTags } from "../src/sources/azure-devops.js";

const env = { AZURE_DEVOPS_ORG: "acme", AZURE_DEVOPS_PAT: "pat123" };

function mockFetch(responses: unknown[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const queue = [...responses];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(queue.shift() ?? {}), { status: 200 });
  };
  return { fetchImpl, calls };
}

describe("Azure DevOps source", () => {
  it("builds WIQL for completed work in a project, iteration and date range", () => {
    expect(
      buildWiql({ source: "azure-devops", project: "Payments", iteration: "Payments\\Sprint 42", since: "2026-10-01", until: "2026-10-31" }),
    ).toBe(
      "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = 'Payments' AND [System.State] IN ('Done', 'Closed') " +
        "AND [System.IterationPath] UNDER 'Payments\\Sprint 42' AND [Microsoft.VSTS.Common.ClosedDate] >= '2026-10-01' " +
        "AND [Microsoft.VSTS.Common.ClosedDate] < '2026-11-01' ORDER BY [Microsoft.VSTS.Common.ClosedDate] DESC",
    );
  });

  it("escapes quotes and passes custom WIQL through", () => {
    expect(buildWiql({ source: "azure-devops", project: "Bob's Team" })).toContain("'Bob''s Team'");
    expect(buildWiql({ source: "azure-devops", wiql: "SELECT [System.Id] FROM WorkItems" })).toBe("SELECT [System.Id] FROM WorkItems");
    expect(() => buildWiql({ source: "azure-devops" })).toThrow(/wiql.*project/);
  });

  it("accepts an organisation name or URL", () => {
    expect(organizationUrl("acme")).toBe("https://dev.azure.com/acme");
    expect(organizationUrl("https://acme.visualstudio.com/")).toBe("https://acme.visualstudio.com");
  });

  it("splits semicolon-separated tags", () => {
    expect(parseTags("billing; Security ;")).toEqual(["billing", "Security"]);
    expect(parseTags(undefined)).toEqual([]);
  });

  it("queries IDs with WIQL, then fetches fields in a batch", async () => {
    const { fetchImpl, calls } = mockFetch([
      { workItems: [{ id: 101 }, { id: 102 }] },
      {
        value: [
          {
            id: 101,
            fields: {
              "System.Title": "Proration preview on plan change",
              "System.WorkItemType": "Product Backlog Item",
              "System.TeamProject": "Payments",
              "System.Tags": "billing; customer-facing",
              "System.Description": "<div>Shows the <b>prorated</b> amount&nbsp;first.</div>",
              "Microsoft.VSTS.Common.ClosedDate": "2026-10-12T09:00:00Z",
            },
          },
          { id: 102, fields: { "System.Title": "Tax total wrong on invoice", "System.WorkItemType": "Bug", "System.TeamProject": "Payments" } },
        ],
      },
    ]);

    const items = await fetchWorkItems({ source: "azure-devops", project: "Payments", limit: 50 }, { env, fetchImpl });

    expect(items[0]).toMatchObject({
      id: "#101",
      url: "https://dev.azure.com/acme/Payments/_workitems/edit/101",
      type: "Product Backlog Item",
      labels: ["billing", "customer-facing"],
      description: "Shows the prorated amount first.",
      source: "azure-devops",
    });
    expect(calls[0]?.url).toBe("https://dev.azure.com/acme/_apis/wit/wiql?$top=50&api-version=7.1");
    expect(JSON.parse(String(calls[1]?.init?.body)).ids).toEqual([101, 102]);
    const auth = (calls[0]?.init?.headers as Record<string, string>).Authorization ?? "";
    expect(Buffer.from(auth.replace("Basic ", ""), "base64").toString()).toBe(":pat123");

    expect(items.map((i) => categorize(i).category)).toEqual(["feature", "fix"]);
  });

  it("asks for credentials when they are missing", async () => {
    const { fetchImpl } = mockFetch([]);
    await expect(fetchWorkItems({ source: "azure-devops", project: "Payments" }, { env: {}, fetchImpl })).rejects.toThrow(
      /AZURE_DEVOPS_ORG and AZURE_DEVOPS_PAT/,
    );
  });
});
