import type { CategorizedItem, Category, WorkItem } from "./types.js";

/**
 * Categorisation is deliberately rule-based rather than left to the model.
 * Release notes are a commitment to customers: the same set of tickets should
 * always produce the same sections, and every placement should be explainable.
 * The LLM's job comes afterwards: wording, not classification.
 */

const CONVENTIONAL_PREFIX =
  /^(feat|feature|fix|bugfix|hotfix|perf|refactor|chore|ci|build|test|tests|docs|style|security|sec)(\([^)]*\))?(!)?:\s*/i;

const INTERNAL_PREFIXES = new Set(["refactor", "chore", "ci", "build", "test", "tests", "style"]);

const LABEL_RULES: Array<{ category: Category; pattern: RegExp }> = [
  { category: "breaking", pattern: /^(breaking|breaking[- ]change|semver[:-]major)$/i },
  { category: "security", pattern: /^(security|cve|vulnerability|sec)$/i },
  {
    category: "internal",
    pattern:
      /^(internal|chore|refactor|ci|build|tests?|tech[- ]debt|dependencies|deps|infra|docs[- ]internal|no[- ]release[- ]notes?|skip[- ]changelog)$/i,
  },
  { category: "fix", pattern: /^(bug|bugfix|fix|defect|regression|hotfix)$/i },
  { category: "feature", pattern: /^(feature|new[- ]feature|feat)$/i },
  { category: "improvement", pattern: /^(enhancement|improvement|perf|performance|ux|ui|polish)$/i },
];

const TYPE_RULES: Array<{ category: Category; pattern: RegExp }> = [
  { category: "fix", pattern: /^(bug|defect|incident|problem)$/i },
  { category: "feature", pattern: /^(story|feature|new feature|epic|user story|product backlog item|requirement)$/i },
  { category: "improvement", pattern: /^(improvement|enhancement)$/i },
  { category: "internal", pattern: /^(sub-?task|technical task|spike|tech debt|chore|test case|test plan|test suite)$/i },
];

export function cleanTitle(title: string): string {
  const stripped = title.replace(CONVENTIONAL_PREFIX, "").trim();
  if (!stripped) return title.trim();
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

export function categorize(item: WorkItem): CategorizedItem {
  const displayTitle = cleanTitle(item.title);
  const result = (category: Category, reason: string): CategorizedItem => ({
    ...item,
    category,
    displayTitle,
    reason,
  });

  const prefix = CONVENTIONAL_PREFIX.exec(item.title);
  const prefixType = prefix?.[1]?.toLowerCase();
  const prefixBreaking = prefix?.[3] === "!";

  // 1. Breaking changes win over everything: missing one is the costliest error.
  if (prefixBreaking) return result("breaking", `title prefix "${prefix?.[0].trim()}"`);
  if (/\bBREAKING( CHANGE)?\b/.test(item.title)) return result("breaking", 'title contains "BREAKING"');
  const breakingLabel = item.labels.find((l) => /^(breaking|breaking[- ]change|semver[:-]major)$/i.test(l));
  if (breakingLabel) return result("breaking", `label "${breakingLabel}"`);

  // 2. Explicit labels are the team's own intent, so they beat issue type.
  for (const rule of LABEL_RULES) {
    if (rule.category === "breaking") continue;
    const label = item.labels.find((l) => rule.pattern.test(l.trim()));
    if (label) return result(rule.category, `label "${label}"`);
  }

  // 3. Conventional-commit style titles (common on PRs).
  if (prefixType) {
    if (INTERNAL_PREFIXES.has(prefixType)) return result("internal", `title prefix "${prefixType}:"`);
    if (prefixType === "docs") return result("other", 'title prefix "docs:"');
    if (prefixType === "perf") return result("improvement", 'title prefix "perf:"');
    if (prefixType === "security" || prefixType === "sec") return result("security", `title prefix "${prefixType}:"`);
    if (["fix", "bugfix", "hotfix"].includes(prefixType)) return result("fix", `title prefix "${prefixType}:"`);
    if (prefixType === "feat" || prefixType === "feature") return result("feature", `title prefix "${prefixType}:"`);
  }

  // 4. Tracker issue type (Jira and friends).
  if (item.type) {
    const typeRule = TYPE_RULES.find((r) => r.pattern.test(item.type!.trim()));
    if (typeRule) return result(typeRule.category, `issue type "${item.type}"`);
  }

  return result("other", "no matching label, prefix or issue type");
}

export function categorizeAll(items: WorkItem[]): CategorizedItem[] {
  return items.map(categorize);
}
