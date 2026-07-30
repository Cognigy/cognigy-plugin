---
name: docs-lookup
description: "Use when the user asks how a Cognigy.AI feature, node, endpoint, setting, or concept works, asks for Cognigy documentation, best practices, or release/version behavior, or when you are unsure of platform behavior or valid configuration values and need to consult the official docs before answering or building."
---

# Cognigy Docs Lookup

The plugin bundles the official Cognigy documentation MCP server (docs.cognigy.com). Use it as the source of truth for platform questions — the platform changes faster than model training data. Prefer documented answers over prior knowledge, and link the doc page you used.

## Tools

- `search_cognigy_documentation` — semantic search over the full docs site. Returns excerpts with titles and page links. Start here for conceptual questions ("how does handover work", "what is a lexicon"). WARNING: results can be very large (100KB+) and may overflow the tool-result limit — when the result lands in a file, triage it (e.g. extract the `Title:`/`Page:` lines) instead of reading it whole, then read the one or two best pages via the filesystem tool. For narrow questions (a specific config key, node name, error string), skip search and use `rg` on the filesystem tool directly.
- `query_docs_filesystem_cognigy_documentation` — read-only shell-like queries (`rg`, `cat`, `head`, `tree`, `ls`) over a virtual filesystem of every docs page (`.mdx`) plus OpenAPI specs. Use for exact keyword/regex matches, reading a full page (append `.mdx` to the path returned by search), or exploring docs structure.
- `submit_feedback` — report incorrect, outdated, or confusing docs to the Cognigy docs team. Offer this when you and the user hit a genuine documentation gap.

## Workflow

1. Search first: `search_cognigy_documentation { query: "<user's question rephrased as a docs query>" }`.
2. Excerpt not enough → read the page: `query_docs_filesystem_cognigy_documentation { command: "head -200 /<path>.mdx" }`. These commands run inside the MCP tool's virtual docs filesystem — never in the local shell.
3. Exact string hunting (error messages, config keys, node names) → `query_docs_filesystem_cognigy_documentation { command: "rg -il '<term>' /" }` instead of search.
4. Answer from what the docs say, cite the page link. If docs and observed API behavior conflict, say so explicitly — the plugin's own skills (flow-nodes, troubleshooting) capture hard-won API gotchas the public docs may not cover.

## When NOT to use

- Plugin/tool mechanics (which MCP tool to call, tool arguments) — that is this plugin's own skills, not the public docs.
- Live project state (what agents/flows exist) — use `list_resources` / `get_resource`.
