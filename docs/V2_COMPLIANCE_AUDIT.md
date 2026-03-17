# V2 Architecture — Compliance Audit

**Date**: 2026-03-06
**Baseline**: [PLAN_V2_ARCHITECTURE.md](./PLAN_V2_ARCHITECTURE.md)
**Scope**: Full implementation review of `src/` against the v2 architecture plan.

---

## Overall Score: ~93% Compliant

The implementation is a faithful execution of the v2 architecture plan. All 9 tools, all 5 MCP resources, the 3-layer context system, response filtering, rollback, file structure, and version bump are implemented. The gaps are minor refinements, not structural deviations.

---

## Fully Implemented

### Tools (Part 2)

| # | Tool | Schema | Annotations | Description URIs |
|---|------|--------|-------------|------------------|
| 1 | `create_ai_agent` | Matches plan (projectId, name, description, knowledgeReferenceId) | All correct | `cognigy://guide/agent-creation` |
| 2 | `update_ai_agent` | Matches plan (aiAgentId, name, description, job, tools) | All correct | — |
| 3 | `setup_llm` | Matches plan (projectId, provider, modelName, apiKey, connectionId, isDefault) | All correct | `cognigy://guide/llm-providers` |
| 4 | `talk_to_agent` | Matches plan (endpointUrl, message, sessionId, userId, data, verbose) | All correct | — |
| 5 | `list_resources` | Matches plan (10-value resourceType enum, pagination, conversation filters) | All correct | — |
| 6 | `get_resource` | Matches plan (10-value resourceType enum including session_state, raw flag) | All correct | — |
| 7 | `delete_resource` | Matches plan (7-value resourceType enum including tool, aiAgentId) | All correct | — |
| 8 | `manage_knowledge` | Matches plan (3 operations, all properties) | All correct | `cognigy://guide/knowledge-setup` |
| 9 | `create_tool` | Matches plan (aiAgentId, toolType enum, name, config object) | All correct | `cognigy://guide/tools-setup` |

- No extra tools beyond the planned 9.
- No missing tools.
- Zod schemas are sometimes stricter than the plan's JSON Schema (e.g., `endpointUrl` uses `z.string().url()`), which is acceptable.

### Handlers (Part 2 + Part 5)

| Handler | Orchestration | Rollback | `_hints` | Response Filtering |
|---------|--------------|----------|----------|-------------------|
| `create_ai_agent` | 6-step chain as planned | Reverse order, each DELETE in own try/catch | llmStatus missing → `agent-creation`, failure → `troubleshooting` | `filterResponse()` applied |
| `update_ai_agent` | `PATCH /v2.0/aiagents/{id}` | N/A | No hints on success (correct) | `filterResponse()` applied |
| `setup_llm` | `POST /v2.0/largelanguagemodels` | N/A | Credential/provider errors → `llm-providers` | `filterResponse()` applied |
| `talk_to_agent` | Static `axios` import (not API client) | N/A | Empty response → `troubleshooting`, HTTP error → `troubleshooting` | Filtered `{agentResponse, sessionId}` default, `verbose: true` escape hatch |
| `list_resources` | Correct API endpoint mapping for all 10 types | N/A | Empty agents → `agent-creation` | `filterList()` applied |
| `get_resource` | Correct mapping including `session_state` | N/A | — | `filterResponse()` applied, `raw: true` escape hatch |
| `delete_resource` | Correct mapping including `tool` type | N/A | — | — |
| `manage_knowledge` | 3 operations as planned | N/A | `create_source` → async ingestion warning, empty `search_chunks` → ingestion delay | `filterResponse()` applied |
| `create_tool` | GET agent → GET nodes → POST node | Deletes created node on failure | No flow → `tools-setup`, creation error → `tools-setup` | Clean `{toolId, name, toolType}` |

### 3-Layer Context System (Part 4)

| Layer | Requirement | Status |
|-------|-------------|--------|
| **Layer 1** — Server instructions | ~200 tokens, BUILD WORKFLOW (6 steps), RULES (6 rules), passed via `instructions` param in Server constructor | Implemented in `src/instructions.ts` |
| **Layer 2** — Tool descriptions | Self-contained, reference `cognigy://` URIs where appropriate | All 9 tools compliant |
| **Layer 3** — Response hints | `_hints` only on errors/warnings, `resource` field points to `cognigy://guide/*` URIs, 0 tokens on happy path | Implemented in handlers with correct trigger-to-URI mapping |

### MCP Resources (Part 3)

| URI | File | Content |
|-----|------|---------|
| `cognigy://guide/agent-creation` | `src/resources/agent-creation.md` | Prerequisites, 10 steps, key facts, references to `llm-providers` and `tools-setup` |
| `cognigy://guide/llm-providers` | `src/resources/llm-providers.md` | Provider table, credential resolution, common errors |
| `cognigy://guide/troubleshooting` | `src/resources/troubleshooting.md` | Empty response, create_ai_agent failures, resource not found, setup_llm, delete_resource |
| `cognigy://guide/knowledge-setup` | `src/resources/knowledge-setup.md` | Steps, tips, async ingestion note |
| `cognigy://guide/tools-setup` | `src/resources/tools-setup.md` | Tool types (http_request, code, knowledge_search), config examples, prerequisites |

Resources registered via `RESOURCE_MAP` in `src/index.ts`, loaded with `fs.readFileSync`, copied to `dist/resources` on build.

### Response Filtering (Part 6)

- `RESOURCE_FILTERS` record in `src/tools/filters.ts` with mappers for all required types.
- `rid()` helper: `r._id || r.id`.
- `filterResponse()` and `filterList()` applied in handlers.
- `JSON.stringify(result)` without pretty-printing.
- Escape hatches: `get_resource` → `raw: true`, `talk_to_agent` → `verbose: true`.

### API Client (Part 7)

- Retry interceptor in `src/api/client.ts` for `429` and `5xx`.
- Exponential backoff: `500ms * 2^(retryCount - 1)`, max 3 retries.
- Logs retries at `warn` level.

### File Structure (Part 7)

| Planned File | Status |
|---|---|
| `src/tools/definitions.ts` | Created |
| `src/tools/filters.ts` | Created |
| `src/tools/handlers.ts` | Rewritten for 9 tools |
| `src/instructions.ts` | Created |
| `src/schemas/tools.ts` | Rewritten for 9 tools |
| `src/resources/agent-creation.md` | Created |
| `src/resources/llm-providers.md` | Created |
| `src/resources/troubleshooting.md` | Created |
| `src/resources/knowledge-setup.md` | Created |
| `src/resources/tools-setup.md` | Created |
| `src/index.ts` | Reduced to ~152 lines (target: ~130) |
| `src/api/client.ts` | Retry interceptor added |
| `src/config.ts` | Unchanged (as planned) |
| `src/utils/logger.ts` | Unchanged (as planned) |
| `src/utils/rateLimiter.ts` | Unchanged (as planned) |
| `src/cli/init.ts` | Unchanged (as planned) |

Root-level artifact cleanup: all 7 files (FINAL_SUMMARY.md, FOR_NEW_CHAT.md, HANDOFF.md, INDEX.md, PROJECT_SUMMARY.md, READ_ME_FIRST.txt, START_HERE.md) removed.

Version: `2.0.0` in both `package.json` and `src/config.ts`.

---

## Gaps

### Gap 1: Entry node retry uses linear backoff instead of fixed 500ms

**Plan**: "3 attempts, 500ms backoff"
**Implementation**: `delayMs * (i + 1)` → 500ms, 1000ms, 1500ms (linear, not fixed)

**Severity**: Low
**Impact**: Functionally equivalent. Arguably better for eventual consistency scenarios where the API needs more time on later retries.
**Action**: No change needed unless strict spec adherence is required.

### Gap 2: `create_tool` does not PATCH the AI Agent Job Node to wire in the tool

**Plan**: "optionally PATCH AI Agent Job Node's config to reference the new tool"
**Implementation**: Uses `mode: 'append'` and `target: jobNode._id` on node creation, relying on Cognigy's API to auto-wire.

**Severity**: Low
**Impact**: If Cognigy's `POST /chart/nodes` with `target` auto-wires child nodes to the parent, this is correct and simpler. If it doesn't, tools won't be available to the agent at runtime.
**Action**: Verify against the Cognigy API. If auto-wiring works, document the assumption. If not, add the PATCH step.

### Gap 3: `delete_resource` for tools doesn't unwire from AI Agent Job Node

**Plan**: "(if needed) updates the AI Agent Job Node to unwire it"
**Implementation**: Deletes the tool node only; assumes cascade or auto-unwire.

**Severity**: Low
**Impact**: If the API doesn't auto-unwire, orphaned tool references could remain on the AI Agent Job Node, potentially causing runtime errors.
**Action**: Same as Gap 2 — verify cascade behavior. If not automatic, add a PATCH to remove the tool reference.

### Gap 4: `list_resources` tool filter may include non-tool nodes

**Plan**: "filters to tool nodes (non-entry, non-aiAgentJob)"
**Implementation**: Excludes `isEntryPoint` and `aiAgentJob` only. Any other non-tool node type (e.g., SaySomething, If, etc.) would be included in the results.

**Severity**: Low–Medium
**Impact**: If a flow contains manually-added non-tool nodes, they would appear in `list_resources { resourceType: 'tool' }` results, potentially confusing the LLM.
**Action**: Add a positive filter for known tool node types (`httpRequest`, `code`, `search`) instead of relying only on exclusion.

### Gap 5: Flow response filter omits `description`

**Plan**: Flow filter returns `id, referenceId, name, description, createdAt`
**Implementation**: Flow filter returns `id, referenceId, name, createdAt` — no `description`.

**Severity**: Low
**Impact**: Flow descriptions are still available via `get_resource { resourceType: 'flow', id, raw: true }`. The filtered response is slightly less informative.
**Action**: Add `description: r.description` to the flow mapper in `src/tools/filters.ts`.

### Gap 6: Unused `RESOURCE_FILTERS_GET` in handlers

**Plan**: Not applicable (implementation artifact).
**Implementation**: `handlers.ts` defines `RESOURCE_FILTERS_GET` as an empty object. `get_resource` always delegates to `filterResponse()`.

**Severity**: None (dead code)
**Impact**: No runtime impact.
**Action**: Remove the empty object for cleanliness.

### Gap 7: Validation error `_hints` sometimes omit `resource` field

**Plan**: `_hints` should include `resource` for error steering.
**Implementation**: Input validation errors (e.g., missing `projectId` in `list_resources`, missing `aiAgentId` for `delete_resource` tool type) return `_hints` with `action` only — no `resource` URI.

**Severity**: Low
**Impact**: The LLM gets action text but can't fetch a guide for these specific errors. These are input validation errors where a guide wouldn't add much value anyway.
**Action**: Optional — add `resource` URIs for consistency.

### Gap 8: `knowledge-setup.md` references `update_ai_agent` for knowledge attachment

**Plan**: The guide mentions "update_ai_agent to add knowledge reference to existing agent."
**Implementation**: `update_ai_agent` schema exposes `tools` (array of tool reference IDs) but not a `knowledgeReferenceId` field.

**Severity**: Low
**Impact**: The LLM may attempt to pass `knowledgeReferenceId` to `update_ai_agent` and fail. Knowledge attachment to existing agents may require the Cognigy API directly.
**Action**: Either add `knowledgeReferenceId` support to `update_ai_agent`, or update `knowledge-setup.md` to only reference `create_ai_agent` for knowledge attachment.

---

## Recommendations

Prioritized by impact:

1. **Verify Cognigy API wiring behavior** (Gaps 2, 3) — Confirm whether `POST /chart/nodes` with `target` auto-wires tools, and whether `DELETE /chart/nodes/{id}` auto-unwires. This determines if two gaps are real or not.
2. **Add positive tool node filter** (Gap 4) — Filter `list_resources { resourceType: 'tool' }` by known tool node types instead of only excluding entry/job nodes.
3. **Fix knowledge-setup.md** (Gap 8) — Remove or qualify the `update_ai_agent` reference for knowledge attachment.
4. **Add flow description to filter** (Gap 5) — One-line fix in `src/tools/filters.ts`.
5. **Clean up dead code** (Gap 6) — Remove unused `RESOURCE_FILTERS_GET`.
6. **Optionally add resource URIs to validation hints** (Gap 7) — Low value but improves consistency.
