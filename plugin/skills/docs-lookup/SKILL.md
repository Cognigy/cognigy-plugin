---
name: docs-lookup
description: "Use when the user asks how a Cognigy.AI feature, node, endpoint, setting, or concept works, asks for Cognigy documentation, best practices, or release/version behavior, or when you are unsure of platform behavior or valid configuration values and need to consult the official docs before answering or building."
---

# Cognigy Docs Lookup

The plugin bundles the official Cognigy documentation MCP server (docs.cognigy.com). Use it as the source of truth for platform questions — the platform changes faster than model training data. Prefer documented answers over prior knowledge, and link the doc page you used.

**Default to the filesystem tool, not search.** Cognigy's docs pages are very large (`parameter-details.mdx` alone is 62 KB) and `search_cognigy_documentation` returns matched pages _whole_ rather than as excerpts, so its payload scales with page size instead of relevance. Measured: a Voice Gateway barge-in query returned 90 KB via search vs ~4 KB via `rg`; a conceptual "which tool does the AI Agent call" query returned 280 KB via search — exceeding the tool-result limit and yielding nothing usable — vs ~3 KB via `rg`.

## Tools

- `query_docs_filesystem_cognigy_documentation` — **the primary tool.** Read-only shell-like queries (`rg`, `grep`, `cat`, `head`, `tail`, `tree`, `ls`, `jq`) over a virtual filesystem of every docs page (`.mdx`) plus OpenAPI specs. These run inside the MCP tool's virtual filesystem — NEVER in the local shell. Each call is stateless: the working directory resets to `/`, so use absolute paths or chain with `&&`.
- `search_cognigy_documentation` — semantic search. Takes only a `query` string: no result limit, no relevance floor, no filters. Fall back to it only when you cannot guess the docs' vocabulary at all. Expect a very large result; when it overflows into a file, triage by extracting the `Title:`/`Page:` lines, then read the best one or two pages with the filesystem tool — never read the dump whole.
- `submit_feedback` — report incorrect, outdated, or confusing docs to the Cognigy docs team. Offer this when you and the user hit a genuine documentation gap.

## Workflow

1. **Orient** (only when unsure where a topic lives): `tree / -L 2`. Top-level sections are `ai/`, `voice-gateway/`, `webchat/`, `api-reference/`, `api-reference-simulator/`, `insights/`, `live-agent/`, `agent-copilot/`, `ops-center/`, `xApps/`, `click-to-call/`, `release-notes/`, `openapi/`, `help/`.
2. **Locate — cast wide.** `rg -l -i "term1|term2|term3" /<section>/` lists candidate files. Use a _deliberately broad_ alternation of synonyms and phrasings: `rg` is lexical, so a too-narrow pattern silently returns nothing. Match the docs' own title-case UI labels ("Tool Choice", "Barge In", "Set Session Config"), not the user's phrasing.
3. **Extract — narrow.** `rg -n -i -A3 "<best term>" /<path>.mdx` pulls the exact rows with context. Prefer this over `cat` on a large page; use `head -200 /<path>.mdx` when you need the page's structure, and `wc -c` first if you're unsure of its size.
4. **Answer** from what the docs say and cite the page link (`https://docs.cognigy.com/<path>`). If docs and observed API behavior conflict, say so explicitly — the plugin's own skills (flow-nodes, troubleshooting) capture hard-won API gotchas the public docs may not cover.

### Worked example — "how does the AI Agent Node decide which tool to call?"

```
rg -l -i "tool.?selection|which tool|selects a tool|tool choice" /ai/
  → /ai/agents/develop/node-reference/ai/ai-agent.mdx  (+3 others)

rg -n -i -A3 "tool choice" /ai/agents/develop/node-reference/ai/ai-agent.mdx
  → the Tool Choice parameter table (Auto / Required / None) and the
    "Avoiding Infinite Loops when Tool Choice is Required" section
```

Two calls, ~3 KB, complete answer. Note the wide alternation in step 1: narrowing it to `"tool.?selection|which tool"` matches nothing, because the docs call the setting **Tool Choice**.

## When NOT to use

- Plugin/tool mechanics (which MCP tool to call, tool arguments) — that is this plugin's own skills, not the public docs.
- Live project state (what agents/flows exist) — use `list_resources` / `get_resource`.
