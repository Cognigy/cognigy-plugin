---
name: add-tool
description: Add a new MCP tool (or extend an existing one) in the cognigy-mcp server
---

Add a new MCP tool (or extend an existing one) in the cognigy-mcp server. The user will describe the tool's purpose, operations, and Cognigy API endpoints it should call.

## Context

This is a TypeScript MCP server. Tools follow a strict pattern across these files:

| File | Role |
|------|------|
| `src/tools/definitions.ts` | Tool metadata: name, description, annotations, inputSchema (JSON Schema) |
| `src/schemas/tools.ts` | Zod validation schemas — one per tool or discriminated union per multi-op tool |
| `src/tools/handlers.ts` | `ToolHandlers` class — one `handleXxx(args)` method per tool + a case in `handleToolCall()` |
| `plugin/skills/<name>/SKILL.md` | Hand-authored plugin skill for the tool (auto-loads on intent in supporting clients, e.g. Claude Code) |
| `src/__tests__/schemas.test.ts` | Schema validation tests |
| `src/__tests__/tools.test.ts` | Handler tests with mocked `CognigyApiClient` |

## Design philosophy: few tools, many operations

This server deliberately uses few tools (~16) to cover many Cognigy API endpoints (~115). Each tool groups related endpoints under a single `operation` parameter that acts as a router.

**Example: `manage_knowledge`** — one tool covers ~8 endpoints:
- `create_store` → `POST /v2.0/knowledgestores`
- `create_source` → `POST /v2.0/knowledgestores/{id}/sources`
- `list_sources` → `GET /v2.0/knowledgestores/{id}/sources`
- `ingest_source` → `POST /v2.0/knowledgestores/{id}/sources/{id}/ingest`
- `list_chunks` → `GET /v2.0/knowledgestores/{id}/chunks`
- etc.

**Why this pattern:**
- **Fewer tools for the LLM to choose from** — 16 tools is much easier for Claude to reason about than 115 separate ones. Less confusion, better tool selection.
- **Grouped by domain** — each tool maps to a Cognigy domain concept (knowledge, packages, webchat, flow nodes), making it intuitive.
- **Shared context** — operations within a tool share parameters (like `projectId`) and the description explains the full workflow across operations in one place.

**When to create a new tool vs. add an operation to an existing tool:**
- If the new functionality belongs to an existing domain (e.g. a new knowledge operation), add it as an operation to the existing tool.
- If it represents a new domain concept, create a new tool.
- Aim for each tool to average ~5-10 operations.

## Templates

Reference templates are bundled with this skill. Use them as starting points:

- **`${CLAUDE_SKILL_DIR}/templates/definition.ts`** — Tool definition entry for `src/tools/definitions.ts`
- **`${CLAUDE_SKILL_DIR}/templates/schema.ts`** — Zod schema for `src/schemas/tools.ts`
- **`${CLAUDE_SKILL_DIR}/templates/handler.ts`** — Handler method for `src/tools/handlers.ts`

Read these templates before writing code to match the exact conventions.

## Steps

### 1. Gather requirements

Before writing code, confirm with the user:
- Tool name (snake_case, e.g. `manage_packages`)
- Operations (if multi-operation tool) and their required/optional params
- Which Cognigy REST API endpoints each operation calls (method + path)
- Whether a plugin skill is needed for the tool's workflow
- Read existing tools in `src/tools/definitions.ts` and `src/schemas/tools.ts` to match conventions

### 2. Add the tool definition (`src/tools/definitions.ts`)

Read `${CLAUDE_SKILL_DIR}/templates/definition.ts` for the template.

Add an entry to the `tools` array. Conventions:
- Use 24-char hex IDs for all Cognigy resource IDs
- Keep descriptions actionable — tell the AI what the tool does and when to use it

### 3. Add Zod schema (`src/schemas/tools.ts`)

Read `${CLAUDE_SKILL_DIR}/templates/schema.ts` for the template.

- Single-operation tools use a plain `z.object()`
- Multi-operation tools use `z.discriminatedUnion("operation", [...])`
- The shared `idSchema` is already defined: `z.string().regex(/^[a-f0-9]{24}$/)`

### 4. Implement the handler (`src/tools/handlers.ts`)

Read `${CLAUDE_SKILL_DIR}/templates/handler.ts` for the template.

Add a method to the `ToolHandlers` class, then add the dispatch case in `handleToolCall()`.

Key patterns:
- Always parse args with the Zod schema first
- Use `this.apiClient.get/post/patch/delete/put/uploadFile` for API calls
- Use `filterResponse(resourceType, result)` to return summary views
- Use `withHints(data, { action: "helpful suggestion" })` for actionable errors
- Complex logic (preview generation, conflict resolution) goes in a separate file under `src/tools/` (e.g. `packageImport.ts`)

### 5. Add a plugin skill (if needed)

Create `plugin/skills/<tool-name>/SKILL.md` with `name`/`description` frontmatter (the `description` is the skill's auto-load trigger) followed by the workflow body. That's it — there is no registry step; the skill auto-loads on intent in supporting clients (e.g. Claude Code).

### 6. Add tests

**Schema tests** in `src/__tests__/schemas.test.ts`:
- Valid input passes parsing
- Missing required fields throw
- Invalid IDs throw
- Each operation variant is tested

**Handler tests** in `src/__tests__/tools.test.ts`:
- Mock `CognigyApiClient` methods (`jest.fn()`)
- Test each operation calls correct API endpoints
- Test error cases and edge cases
- Follow existing test structure with `describe`/`it` blocks

### 7. Verify

Run in order:
1. `npx tsc -p tsconfig.json --noEmit` — type check
2. `npm test -- --runInBand` — all tests pass
3. `npx prettier --write <changed-files>` — format only the files you created or modified

## Guidelines

- Match the style and conventions of existing tools exactly
- Do NOT add unnecessary complexity — keep operations focused
- Every Cognigy ID parameter should validate with `idSchema` (24-char hex)
- Multi-operation tools should use discriminated unions (both in JSON Schema and Zod)
- Handler methods should be named `handle<PascalCaseName>` (e.g. `handleManagePackages`)
- If a tool needs file uploads, use `this.apiClient.uploadFile()` — see `manage_packages` handler for the pattern
- Update `README.md` tool count and table if adding a brand new tool
