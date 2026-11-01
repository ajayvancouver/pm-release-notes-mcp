import { describe, expect, it } from "vitest";
import { categorize, cleanTitle } from "../src/categorize.js";
import type { WorkItem } from "../src/types.js";

const item = (overrides: Partial<WorkItem>): WorkItem => ({
  id: "#1",
  title: "Something",
  labels: [],
  source: "manual",
  ...overrides,
});

describe("cleanTitle", () => {
  it("strips conventional-commit prefixes and capitalises", () => {
    expect(cleanTitle("feat(billing): add proration preview")).toBe("Add proration preview");
    expect(cleanTitle("fix!: drop legacy webhook format")).toBe("Drop legacy webhook format");
  });

  it("leaves ordinary titles alone apart from capitalisation", () => {
    expect(cleanTitle("export invoices as CSV")).toBe("Export invoices as CSV");
  });
});

describe("categorize", () => {
  it("treats a ! prefix as breaking even when labels say otherwise", () => {
    const result = categorize(item({ title: "feat!: new auth flow", labels: ["enhancement"] }));
    expect(result.category).toBe("breaking");
    expect(result.reason).toContain("feat!:");
  });

  it("prefers explicit labels over issue type", () => {
    const result = categorize(item({ type: "Story", labels: ["bug"] }));
    expect(result.category).toBe("fix");
    expect(result.reason).toBe('label "bug"');
  });

  it("routes chores and refactors to internal", () => {
    expect(categorize(item({ title: "chore: bump deps" })).category).toBe("internal");
    expect(categorize(item({ labels: ["tech-debt"] })).category).toBe("internal");
    expect(categorize(item({ labels: ["skip-changelog"] })).category).toBe("internal");
  });

  it("uses Jira issue types when there are no labels or prefixes", () => {
    expect(categorize(item({ type: "Bug" })).category).toBe("fix");
    expect(categorize(item({ type: "Story" })).category).toBe("feature");
    expect(categorize(item({ type: "Sub-task" })).category).toBe("internal");
  });

  it("flags security work", () => {
    expect(categorize(item({ labels: ["Security"] })).category).toBe("security");
    expect(categorize(item({ title: "security: rotate signing keys" })).category).toBe("security");
  });

  it("falls back to other and says why", () => {
    const result = categorize(item({ title: "Update pricing page copy" }));
    expect(result.category).toBe("other");
    expect(result.reason).toMatch(/no matching/);
  });
});
