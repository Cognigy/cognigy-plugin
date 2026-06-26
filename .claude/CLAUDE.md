# Project rules

## Formatting

Format all code with Prettier (project default). Run `npx prettier --write <file>` on changed files before considering a task done.

# Architecture

## What this is

The **Cognigy.AI Plugin** lets an LLM create, configure, test, and manage **AI Agents on the NiCE Cognigy platform** over the Cognigy REST API v2.0.

Distributed **only as a plugin** (`plugin/` + `.claude-plugin/marketplace.json`) — a generic plugin supported by Claude Code and Codex today, more clients later. The MCP server is published to npm as **`@cognigy/plugin-engine`** (scoped, cognigy org) purely as the engine the plugin auto-installs; users never install it directly. The plugin's MCP server command is a launcher (`plugin/bin/launch.mjs`) that installs the engine **pinned to the plugin's own version** into `${CLAUDE_PLUGIN_DATA}` on first boot (guarded: only when the installed version differs), then hands off to it — no install hook, no `@latest` float, no first-run race. **The plugin version and the engine npm version are the same number**, kept in lockstep by semantic-release, so there's one version to reason about. No standalone CLI / `.mcpb` / `manifest.json`.

## Tech stack

- TypeScript, **ESM** (`"type": "module"` — import paths use `.js` even for `.ts` sources).
- Runtime deps: `@modelcontextprotocol/sdk` (stdio transport), `axios`, `zod`, `form-data`. Nothing else.
- Entry `src/index.ts`: wires `Server` + `StdioServerTransport`, registers `ListTools`/`CallTool`, instantiates `CognigyApiClient` + `ToolHandlers`.

## Tools — few tools, many operations

16 tools, each often a multi-operation dispatcher (e.g. `manage_flow_nodes { operation }`, `manage_knowledge`, `manage_packages`). Prefer extending an existing tool over adding one. Each tool spans:

| File                        | Role                                                                            |
| --------------------------- | ------------------------------------------------------------------------------- |
| `src/tools/definitions.ts`  | `name`/`description`/`annotations`/`inputSchema` — the LLM-facing contract.     |
| `src/schemas/tools.ts`      | Zod schemas; validate `args` at the top of each handler.                        |
| `src/tools/handlers.ts`     | `ToolHandlers` — one `handleXxx(args)` + a `case` in `handleToolCall()`.        |
| `src/tools/nodeRegistry.ts` | Flow-node registry; gates `manage_flow_nodes create`.                           |
| `src/tools/filters.ts`      | `filterResponse(kind, obj)` strips internal fields before returning to the LLM. |

Helpers: `withHints(result, { warning, action })` attaches `_hints`; `resolveFlowForAgent(apiClient, aiAgentId)` maps an agent → its flow.

## Skills

Workflow guidance lives only as plugin skills `plugin/skills/<id>/SKILL.md` (hand-authored: `name`/`description` frontmatter + body), which auto-load on intent in clients that support skills (e.g. Claude Code). `src/instructions.ts` is the always-on baseline — an overview plus genuinely cross-tool hard rules, injected every session — and matters most for clients that don't load skills (e.g. Codex); keep it terse and let the skills own the step-by-step workflow detail. Agents are `plugin/agents/*.md`.

## Versions

**One version.** semantic-release (on merge to `main`) decides the bump from conventional commits, sets that version in **both** `package.json` (`@cognigy/plugin-engine`) and `plugin/.claude-plugin/plugin.json` (via `scripts/sync-plugin-version.mjs`), publishes the engine, and commits both back. **Never hand-bump either** — no per-PR plugin bump, no CI version gate. The launcher pins the engine to the plugin version, so the two are always equal. Use release-triggering commit types (`feat`/`fix`/`docs`/…) for changes that must reach users; `chore`/`ci`/`test` cut no release.

## API client & config

- `src/config.ts` `loadConfig()` reads env `COGNIGY_API_BASE_URL` + `COGNIGY_API_KEY` (both required). `normalizeApiBaseUrl` rewrites `*.cognigy.ai` → `api-*.cognigy.ai`.
- `src/api/client.ts` `CognigyApiClient` wraps axios; `get/post/patch/delete` return `response.data` (HAL body). Retries on 429 / 5xx.
- Base URL has no `/new` prefix; the server mounts the modern router at both `/new` and root, so `/v2.0/...` and `/new/v2.0/...` hit the same handlers.

## Flow-chart model — gotchas (hard-won)

Endpoints under `/v2.0/flows/{flowId}/chart`:

- **Ordering is a `next` chain, not children.** Top-level nodes link `start → aiAgentJob → …` via `relations[].next`. `children` is only for nesting (tool branches, if/else, switch). The real root is a separate `start` node.
- **Insert before a top-level node → `mode: "prepend"`** (rewires the `next` chain via the target's predecessor). `insertBefore` searches `children`, finds nothing, and throws "Error while reading ChartData". Can't `prepend` on `start`, can't `append` on `end`.
- **`isEntryPoint` is a per-descriptor flag, NOT "the first node".** `aiAgentJob` has `behavior.entrypoint: true`, so every AI Agent node reports `isEntryPoint: true`. Find the real first node by walking `relations[].next` from `start`.
- **`GET /chart/nodes` returns no `config` and no ordering** (only id/type/label/preview/isEntryPoint/parentId). `GET /chart` returns node excerpts + relations. Full `config` only from the per-node `GET /chart/nodes/{id}`.
- **`preview` is server-computed, never stored.** A config PATCH that omits `aiAgent` makes the backend recompute `preview` as a bare string (the node name), wiping the avatar. **Never hand-craft `preview`; always re-send `config.aiAgent` in any aiAgentJob config PATCH.**

## Commands

- Typecheck: `npx tsc -p tsconfig.json --noEmit`
- Test: `npm test` (Jest, ESM). Single-process: `npm test -- --runInBand`.
- Build: `npm run build` (clean `dist`, `tsc`). Dev: `npm run dev` (tsx watch).
- Lint: `npm run lint`. Format: `npx prettier --write <file>`.

## Conventions

- Conventional Commits (`fix:`, `feat:`, `chore:`, with scopes).
- Tests mock the api client; mocks may not match real API field projections — verify against the real REST shape (see chart gotchas).
- Dev skill `.claude/skills/add-tool/SKILL.md` documents the add/extend-a-tool workflow.
