# Project rules

## Formatting

All code must be formatted with Prettier using the project's default configuration. After writing or editing any source file, run `npx prettier --write <file>` on the changed files before considering the task complete.

# Architecture

## What this is

An MCP (Model Context Protocol) server that lets an LLM create, configure, test, and manage **AI Agents on the NiCE Cognigy platform** over the Cognigy REST API v2.0. Marketed as the "NiCE Cognigy MCP Connector".

This repo (`cognigy-plugin`) is a detached fork of `cognigy-mcp`, repackaged **plugin-first**: the primary, recommended, and primary-maintained distribution is the **Claude Code plugin** (`plugin/` + `.claude-plugin/marketplace.json`). The same server is still distributed standalone — published to npm as `@cognigy/mcp-server` (the `npx`/CLI + manual-config path) and packaged as an `.mcpb` bundle (`manifest.json` is the marketplace entry) for a no-Node quick-install/test build. All three ship the identical server.

## Tech stack

- TypeScript, **ESM** (`"type": "module"` — import paths use `.js` extensions even for `.ts` sources).
- `@modelcontextprotocol/sdk` (stdio transport), `axios`, `zod`, `form-data`. No other runtime deps.
- Entry: `src/index.ts` — wires `Server` + `StdioServerTransport`, registers `ListTools`/`CallTool`/`ListResources`/`ReadResource` handlers, instantiates `CognigyApiClient` and `ToolHandlers`.

## Tool design — few tools, many operations

~16 tools, each often a multi-operation dispatcher (e.g. `manage_flow_nodes { operation: list|create|update|delete }`, `manage_knowledge`, `manage_packages`). Prefer extending an existing tool's operations over adding a new tool. Each tool spans a fixed set of files:

| File                        | Role                                                                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/tools/definitions.ts`  | Tool metadata: `name`, `description`, `annotations`, `inputSchema` (JSON Schema). The LLM-facing contract.                                                             |
| `src/schemas/tools.ts`      | Zod schemas — one per tool (or discriminated union per multi-op tool). Validate `args` at the top of each handler.                                                     |
| `src/tools/handlers.ts`     | `ToolHandlers` class — one `handleXxx(args)` per tool + a `case` in `handleToolCall()` (the dispatch switch). Large file.                                              |
| `src/tools/nodeRegistry.ts` | Flow-node type registry (type, extension, category, placement `flow`/`child`, config keys). `supportedNodeTypes()` / `getNodeEntry()` gate `manage_flow_nodes create`. |
| `src/tools/filters.ts`      | `filterResponse(kind, obj)` — strips internal fields from API responses before returning to the LLM.                                                                   |
| `manifest.json`             | Marketplace `tools` array entry `{ name, description }`. Keep tool count in `README.md` in sync.                                                                       |

Helpers: `withHints(result, {warning, action, resource})` attaches `_hints` guidance; `resolveFlowForAgent(apiClient, aiAgentId)` maps an agent → its flow.

## Guides / resources

Markdown guides in `src/resources/*.md`, surfaced as MCP resources `cognigy://guide/<id>` and via the `read_guide` tool. Registered in `src/guides.ts` (`GUIDE_IDS`, `GUIDE_DEFINITIONS` with `{ guideId, uri, name, description, skillTrigger, file }`). Build copies `src/resources` → `dist/resources`.

## Plugin skills & agents — one source, three consumers

The repo ships a Claude Code plugin (`plugin/`). Each guide is **also** a plugin skill, so the same content feeds three consumers: the `read_guide` tool + `cognigy://guide/<id>` resources (all MCP clients), the generated skill `plugin/skills/<id>/SKILL.md` (Claude Code, auto-loads on intent), and `src/instructions.ts` (which points at guides by id instead of inlining steps).

**Skills are GENERATED — never edit `plugin/skills/` by hand.** `scripts/generate-skills.mjs` (run by `npm run build` / `npm run generate:skills`) writes `SKILL.md` from `GUIDE_DEFINITIONS` + `src/resources/<file>`; the `skillTrigger` field becomes the skill's `description` (what Claude matches to auto-load). The generated files are committed (marketplace ships repo files as-is). To work with skills:

- **Edit content** → edit `src/resources/<id>.md`, regenerate, commit guide + regenerated `SKILL.md`.
- **Change trigger** → edit that guide's `skillTrigger` in `src/guides.ts`, regenerate.
- **Add** → new `src/resources/<id>.md` + add to `GUIDE_IDS` and `GUIDE_DEFINITIONS`, regenerate. (Now also a `read_guide` guide + resource for free.)
- **Remove** → delete its `GUIDE_IDS` member + `GUIDE_DEFINITIONS` entry, regenerate (the script wipes/rebuilds `plugin/skills/`).
- Before commit: `npm run build && git diff --exit-code plugin/skills` must be clean. Enforced two ways — a husky **pre-commit** hook (`.husky/pre-commit`) regenerates and blocks the commit on drift when a guide/skill path is staged, and CI re-checks it (`.github/workflows/pr.yml`). `plugin/skills/**` is also marked `linguist-generated` (`.gitattributes`).
- **Plugin version:** `version` in `plugin/.claude-plugin/plugin.json` is the plugin's own version (host/marketplace-agnostic — it's what Claude Code compares to detect an update; no marketplace-specific logic lives in this repo). Any PR that changes anything under `plugin/` must bump it, or CI fails (the "Require plugin version bump" step in `pr.yml`).

**Agents** (`plugin/agents/*.md`) are hand-authored (NOT generated): `cognigy-agent-builder`, `cognigy-voice-go-live`. Edit/add/remove these files directly. See the header JSDoc in `scripts/generate-skills.mjs` for the full process.

## API client & config

- `src/config.ts` — `loadConfig()` reads env: `COGNIGY_API_BASE_URL` (required), `COGNIGY_API_KEY` (required). `normalizeApiBaseUrl` rewrites `*.cognigy.ai` → `api-*.cognigy.ai`. Derives endpoint/webchat/static-file base URLs (override via `COGNIGY_*_BASE_URL`).
- `src/api/client.ts` — `CognigyApiClient` wraps axios. `get/post/patch/delete` return `response.data` (HAL body — keeps top-level fields). Retries on 429 / 5xx. Errors reformatted with `detail` + `traceId`.
- Base URL has **no `/new` prefix**, but the server mounts the modern `api_new` router at both `/new` and root, so `/v2.0/...` and `/new/v2.0/...` hit the same handlers.

## Cognigy flow-chart model — gotchas (hard-won)

The flow editor's chart is the trickiest surface. Endpoints under `/v2.0/flows/{flowId}/chart`:

- **Node ordering is a `next` chain, not children.** Top-level nodes link `start → aiAgentJob → …` via `relations[].next`. `children` is only for nesting (tool branches, if/else, switch cases). The true root is a separate `start` node.
- **To insert a node before a top-level node, use `mode: "prepend"`** (rewires the `next` chain via the target's predecessor). `insertBefore` searches `children`, finds nothing for a top-level target, and throws **"Error while reading ChartData"**. Guards: can't `prepend` on the `start` node, can't `append` on the `end` node.
- **`isEntryPoint` is a per-descriptor flag, NOT "the first node".** `aiAgentJob` descriptor has `behavior.entrypoint: true`, so **every** AI Agent node reports `isEntryPoint: true` while `setSessionConfig` reports `false`. To find the real first node, walk `relations[].next` from the `start` node — do not use `isEntryPoint`.
- **`GET /chart/nodes` (index) returns NO `config` and NO ordering** — only `id/type/label/preview/isEntryPoint/parentId`. `GET /chart` returns node **excerpts (still no config) + relations** (the `next` chain). Full node `config` only comes from the **per-node read** `GET /chart/nodes/{nodeId}`.
- **Node `preview` (e.g. AI Agent avatar) is server-computed, never stored from the request.** Create discards a sent `preview` and recomputes from `config.aiAgent` → `readAiAgent` → agent `image`. On update, a config PATCH that omits `aiAgent` makes the backend recompute `preview` as a bare string (the node name), wiping the avatar. **Rule: never hand-craft `preview`; always re-send `config.aiAgent` in any aiAgentJob config PATCH.**

## Commands

- Typecheck: `npx tsc -p tsconfig.json --noEmit`
- Test: `npm test` (Jest, ESM via `--experimental-vm-modules`; tests in `src/__tests__/**`). Single-process: `npm test -- --runInBand`.
- Build: `npm run build` (clean `dist`, `tsc`, copy `resources`/`assets`). Dev: `npm run dev` (tsx watch).
- Lint: `npm run lint`. Format: `npx prettier --write <file>`.

## Conventions

- Commits follow **Conventional Commits** (`fix:`, `feat:`, `chore:`, scopes like `fix(manifest):`).
- Tests mock the api client; mocks may not match real API field projections — verify against the actual REST response shape before trusting a test (see chart gotchas above).
- Dev skill: `.claude/skills/add-tool/SKILL.md` documents the add/extend-a-tool workflow and has file templates.
