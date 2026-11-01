/**
 * A tracker-agnostic unit of shipped work. Every source adapter (GitHub, Jira,
 * Linear) maps its own issue shape onto this, so categorisation and rendering
 * never need to know where an item came from.
 */
export type SourceName = "github" | "jira" | "linear" | "manual";

export interface WorkItem {
  /** Human-facing key, e.g. "#123", "PAY-42", "ENG-7". */
  id: string;
  title: string;
  url?: string;
  /** Tracker issue type when one exists (Jira "Bug", "Story"...). */
  type?: string;
  labels: string[];
  /** ISO timestamp the item was closed, merged or completed. */
  closedAt?: string;
  description?: string;
  source: SourceName;
}

export const CATEGORIES = [
  "breaking",
  "security",
  "feature",
  "improvement",
  "fix",
  "internal",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export interface CategorizedItem extends WorkItem {
  category: Category;
  /** Customer-ready title: conventional-commit prefixes removed, capitalised. */
  displayTitle: string;
  /** Which rule put the item in its category, so a reviewer can audit it. */
  reason: string;
}

export type Audience = "customer" | "internal";
