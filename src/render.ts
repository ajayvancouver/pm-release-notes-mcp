import type { Audience, CategorizedItem, Category, WorkItem } from "./types.js";
import { categorizeAll } from "./categorize.js";

export interface RenderOptions {
  audience: Audience;
  version?: string;
  /** Release date, YYYY-MM-DD. */
  date?: string;
  productName?: string;
  /** Show ticket keys and links. Defaults to true for internal notes, false for customer notes. */
  includeLinks?: boolean;
}

const SECTION_TITLES: Record<Category, string> = {
  breaking: "Breaking changes",
  security: "Security",
  feature: "New features",
  improvement: "Improvements",
  fix: "Bug fixes",
  other: "Other changes",
  internal: "Internal",
};

// Customers read top-down and stop early, so lead with what can break them,
// then what is new. Internal readers want risk first and everything included.
const SECTION_ORDER: Record<Audience, Category[]> = {
  customer: ["breaking", "feature", "improvement", "fix", "security", "other"],
  internal: ["breaking", "security", "feature", "improvement", "fix", "other", "internal"],
};

export type CategoryCounts = Record<Category, number>;

export interface ReleaseDraft {
  markdown: string;
  counts: CategoryCounts;
  /** Items the rules could not place. A human should decide before publishing. */
  needsReview: Array<Pick<CategorizedItem, "id" | "title" | "url" | "reason">>;
  /** Items left out of customer notes because they were classified as internal. */
  excluded: Array<Pick<CategorizedItem, "id" | "title" | "reason">>;
  items: CategorizedItem[];
}

export function dedupe(items: WorkItem[]): WorkItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.source}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function countByCategory(items: CategorizedItem[]): CategoryCounts {
  const counts = Object.fromEntries(
    (Object.keys(SECTION_TITLES) as Category[]).map((c) => [c, 0]),
  ) as CategoryCounts;
  for (const item of items) counts[item.category] += 1;
  return counts;
}

function formatLine(item: CategorizedItem, includeLinks: boolean): string {
  if (!includeLinks) return `- ${item.displayTitle}`;
  const ref = item.url ? `[${item.id}](${item.url})` : item.id;
  return `- ${item.displayTitle} (${ref})`;
}

export function renderMarkdown(items: CategorizedItem[], options: RenderOptions): string {
  const includeLinks = options.includeLinks ?? options.audience === "internal";
  const heading = [options.productName, options.version ?? "Unreleased"].filter(Boolean).join(" ");
  const lines: string[] = [`## ${heading}`];
  if (options.date) lines.push("", `_Released ${options.date}_`);

  let sectionsWritten = 0;
  for (const category of SECTION_ORDER[options.audience]) {
    const inSection = items
      .filter((i) => i.category === category)
      .sort((a, b) => a.displayTitle.localeCompare(b.displayTitle));
    if (inSection.length === 0) continue;
    sectionsWritten += 1;
    lines.push("", `### ${SECTION_TITLES[category]}`, "");
    for (const item of inSection) lines.push(formatLine(item, includeLinks));
  }

  if (sectionsWritten === 0) {
    lines.push(
      "",
      options.audience === "customer"
        ? "No customer-facing changes in this release."
        : "No completed work items in this range.",
    );
  }

  return lines.join("\n") + "\n";
}

export function draftReleaseNotes(rawItems: WorkItem[], options: RenderOptions): ReleaseDraft {
  const items = categorizeAll(dedupe(rawItems));
  return {
    markdown: renderMarkdown(items, options),
    counts: countByCategory(items),
    needsReview: items
      .filter((i) => i.category === "other")
      .map(({ id, title, url, reason }) => ({ id, title, url, reason })),
    excluded:
      options.audience === "customer"
        ? items
            .filter((i) => i.category === "internal")
            .map(({ id, title, reason }) => ({ id, title, reason }))
        : [],
    items,
  };
}
