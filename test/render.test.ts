import { describe, expect, it } from "vitest";
import { draftReleaseNotes } from "../src/render.js";
import type { WorkItem } from "../src/types.js";

const items: WorkItem[] = [
  { id: "PAY-1", title: "feat: proration preview on plan change", labels: [], source: "jira", url: "https://x.atlassian.net/browse/PAY-1" },
  { id: "PAY-2", title: "Invoice PDF shows wrong tax total", type: "Bug", labels: [], source: "jira" },
  { id: "PAY-3", title: "chore: upgrade Stripe SDK", labels: [], source: "jira" },
  { id: "PAY-4", title: "fix!: remove v1 webhook payloads", labels: [], source: "jira" },
  { id: "PAY-5", title: "Update help-centre links", labels: [], source: "jira" },
  { id: "PAY-1", title: "feat: proration preview on plan change", labels: [], source: "jira" },
];

describe("draftReleaseNotes", () => {
  it("writes customer notes without internal work or ticket keys", () => {
    const draft = draftReleaseNotes(items, { audience: "customer", version: "v2.4.0", date: "2026-11-01" });

    expect(draft.markdown).toContain("## v2.4.0");
    expect(draft.markdown).toContain("_Released 2026-11-01_");
    expect(draft.markdown).toContain("### Breaking changes\n\n- Remove v1 webhook payloads");
    expect(draft.markdown).toContain("### New features\n\n- Proration preview on plan change");
    expect(draft.markdown).toContain("### Bug fixes\n\n- Invoice PDF shows wrong tax total");
    expect(draft.markdown).not.toContain("Stripe SDK");
    expect(draft.markdown).not.toContain("PAY-");
  });

  it("puts breaking changes before features for customers", () => {
    const { markdown } = draftReleaseNotes(items, { audience: "customer" });
    expect(markdown.indexOf("Breaking changes")).toBeLessThan(markdown.indexOf("New features"));
  });

  it("reports what it excluded and what needs a human decision", () => {
    const draft = draftReleaseNotes(items, { audience: "customer" });
    expect(draft.excluded.map((e) => e.id)).toEqual(["PAY-3"]);
    expect(draft.needsReview.map((e) => e.id)).toEqual(["PAY-5"]);
  });

  it("removes duplicate items", () => {
    const draft = draftReleaseNotes(items, { audience: "internal" });
    expect(draft.items).toHaveLength(5);
    expect(draft.counts.feature).toBe(1);
  });

  it("includes internal work and links for internal notes", () => {
    const { markdown } = draftReleaseNotes(items, { audience: "internal", productName: "Billing" });
    expect(markdown).toContain("## Billing Unreleased");
    expect(markdown).toContain("### Internal\n\n- Upgrade Stripe SDK (PAY-3)");
    expect(markdown).toContain("[PAY-1](https://x.atlassian.net/browse/PAY-1)");
  });

  it("says so when there is nothing customer-facing", () => {
    const draft = draftReleaseNotes([items[2]!], { audience: "customer" });
    expect(draft.markdown).toContain("No customer-facing changes in this release.");
  });
});
