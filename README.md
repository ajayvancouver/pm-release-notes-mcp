# pm-release-notes-mcp

An [MCP](https://modelcontextprotocol.io) server that turns the work your team closed in **GitHub, Jira or Linear** into release notes customers can read, with a review list so nothing ships without a human looking at it.

Ask your AI assistant *"Draft customer release notes for PAY fix version 2.4.0"* and you get back:

```markdown
## Billing v2.4.0

_Released 2026-11-01_

### Breaking changes

- Remove v1 webhook payloads

### New features

- Proration preview on plan change

### Bug fixes

- Invoice PDF shows wrong tax total
```

…plus a note of what was left out as internal work (`chore: upgrade Stripe SDK`) and what the rules couldn't place, so you can decide before publishing.

## Why I built this

Writing release notes is one of the most repetitive parts of a PM's week: export the tickets, delete the internal ones, guess which are features versus fixes, rewrite engineering titles into customer language, and hope nothing breaking slipped through. It's work that has to be done, but not work that needs judgement on every line.

LLMs are good at the rewriting part and risky at the rest. Asked to "write release notes from these tickets", a model will happily merge items, drop one, or describe a feature that didn't ship. So this server splits the job:

| Step | Who does it | Why |
| --- | --- | --- |
| Fetch what shipped | Server (deterministic) | Same query, same tickets, every time |
| Categorise and filter | Server (rule-based, explainable) | Every placement records the rule that made it, so it can be audited |
| Flag uncertain items | Server | Unclassified items are surfaced, not guessed |
| Rewrite for customers | The model, via the `polish_release_notes` prompt | Wording is where LLMs add value; the prompt forbids adding or dropping items |
| Publish | A person | The server is read-only by design |

## Product decisions

- **Read-only.** Both tools are annotated `readOnlyHint`. The server never writes to a tracker or posts anywhere. Release notes are a public commitment, so publishing stays a human action.
- **Rules before AI for classification.** Labels beat conventional-commit prefixes, which beat issue type. That order follows intent: a label is something your team chose deliberately; an issue type is often a default. Breaking changes are checked first because missing one is the most expensive mistake.
- **Two audiences.** Customer notes drop internal work and ticket keys and lead with breaking changes. Internal notes keep everything, with links, for support and sales.
- **"Shipped" means shipped.** GitHub issues closed as *not planned* or *duplicate* and unmerged PRs are excluded.
- **Same model for every tracker.** GitHub, Jira and Linear all map to one `WorkItem` shape, so adding another tracker means writing one adapter, not touching the rules.

## Tools

### `draft_release_notes`

Categorises work and returns a Markdown draft plus a review list.

| Argument | Notes |
| --- | --- |
| `source` | `github`, `jira` or `linear`. Omit if passing `items`. |
| `repo` | GitHub: `owner/name` |
| `project`, `fixVersion`, `jql` | Jira: project key and fix version, or your own JQL |
| `team` | Linear: team key, e.g. `ENG` |
| `since`, `until` | Date range (`YYYY-MM-DD`, inclusive) on when work was closed |
| `items` | Or pass work items directly: `{ id, title, labels, type?, url? }` |
| `audience` | `customer` (default) or `internal` |
| `version`, `date`, `productName` | Used in the heading |
| `includeLinks` | Show ticket keys and links (default: on for internal, off for customer) |

### `fetch_work_items`

Returns the raw shipped work items as JSON, for when you want to inspect or filter them yourself first.

### Prompt: `polish_release_notes`

Takes a draft and asks the model to rewrite each item in terms of customer benefit, keep breaking changes first with an action line for each, and add a short summary, without inventing, merging or dropping changes.

## How items are categorised

Checked in this order; the first match wins and is recorded as the item's `reason`.

1. **Breaking:** `feat!:` / `fix!:` prefixes, `BREAKING` in the title, or a `breaking` label
2. **Labels:** `security`, internal labels (`chore`, `refactor`, `tech-debt`, `skip-changelog`…), `bug`, `feature`, `enhancement`…
3. **Conventional-commit prefixes:** `feat:`, `fix:`, `perf:`, `chore:`, `refactor:`…
4. **Issue type:** Jira `Bug`, `Story`, `Improvement`, `Sub-task`…
5. Otherwise **Other**, and the item is listed for review

## Setup

Requires Node.js 20 or later.

```bash
git clone https://github.com/ajayvancouver/pm-release-notes-mcp.git
cd pm-release-notes-mcp
npm install
npm run build
```

Add it to your MCP client. For Claude Desktop, edit `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "release-notes": {
      "command": "node",
      "args": ["/absolute/path/to/pm-release-notes-mcp/dist/index.js"],
      "env": {
        "GITHUB_TOKEN": "ghp_…",
        "JIRA_BASE_URL": "https://your-company.atlassian.net",
        "JIRA_EMAIL": "you@company.com",
        "JIRA_API_TOKEN": "…",
        "LINEAR_API_KEY": "lin_api_…"
      }
    }
  }
}
```

Only set the variables for the trackers you use. `GITHUB_TOKEN` is optional for public repositories. A read-only token is enough everywhere.

| Tracker | Credential |
| --- | --- |
| GitHub | Fine-grained token with read access to issues and pull requests |
| Jira Cloud | [API token](https://id.atlassian.com/manage-profile/security/api-tokens) plus the email it belongs to |
| Linear | Personal API key from your Linear account settings |

## Example requests

- "Draft customer release notes for everything merged in acme/web since 2026-10-01."
- "Internal release notes for Jira project PAY, fix version 2.4.0, with links."
- "What did the ENG team in Linear complete last sprint? List anything you couldn't categorise."
- "Draft notes for PAY 2.4.0, then use polish_release_notes to make them friendly."

## Development

```bash
npm test          # unit and in-memory MCP tests
npm run typecheck
npm run build
```

Tests cover the categorisation rules, rendering, each tracker adapter (with mocked HTTP) and the MCP tools end to end over an in-memory transport.

## Roadmap

- Group items by Jira epic or Linear project as "themes"
- Read per-team label conventions from a config file
- Optional draft-to-Confluence/Notion, behind an explicit approval step

## Built with

TypeScript, the official [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk), Zod and Vitest. Built with [Claude Code](https://claude.com/claude-code) as a pair programmer.

## License

MIT © Ajay Agrawal
