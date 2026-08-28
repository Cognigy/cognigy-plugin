# Project rules

## Formatting

Format all code with Prettier (project default). Run `npx prettier --write <file>` on changed files before considering a task done.

# Architecture

## What this is

The **NiCE Cognigy Plugin** lets an LLM create, configure, test, and manage **AI Agents on the NiCE Cognigy platform** over the Cognigy REST API v2.0.

**Plugin-first for Claude Code** (`plugin/` + `.claude-plugin/marketplace.json`) — a generic plugin supported by Claude Code, Claude Desktop, ChatGPT + Codex (one app since the July 2026 merger, plus the Codex CLI/IDE), and Gemini CLI (as an extension), more clients later. The MCP server is published to npm as **`@cognigy/plugin-engine`** (scoped, cognigy org). For Claude Code the plugin's MCP server command runs the engine via `npx -y -p cognigy-engine@npm:@cognigy/plugin-engine@<version> cognigy-mcp` — the `-p` form is required because the npm package ships two bins (`cognigy-setup`, and `cognigy-mcp` → `dist/index.js`), and the alias spec (`cognigy-engine@npm:...`) is required so npm never resolves the pin to this repo's own package when a session is rooted here (see Commands). **The plugin version and the engine npm version are the same number**, kept in lockstep by semantic-release (`scripts/sync-plugin-version.mjs` rewrites both the plugin `version` and the npx engine pin), so there's one version to reason about and no `@latest` float; npx caches by version, so repeat boots are fast/offline once fetched. **We deliberately do NOT ship a launcher script in the plugin:** Claude Desktop syncs marketplaces server-side and security-scans plugin files, so a committed script that runs `npm install` + spawns a process (the former `plugin/bin/launch.mjs`) fails the _entire_ Desktop marketplace add — a manifest `npx` command is not a scanned file, so sync passes and skills load. On Desktop the `platform` connector is still credential-less (a no-op); MCP tools come from the installer-wired connector, and the plugin is wanted there only for skills.

**Agent Plugins spec 1.0.0** (agent-plugins.org) — the plugin also ships the vendor-neutral spec's two root files, `plugin/plugin.json` and `plugin/mcp.json` (no leading dot). These are read only by spec-conformant clients: Claude Code reads `.claude-plugin/plugin.json` + `.mcp.json` (with dot) and Codex reads `.codex-plugin/`, so the root files are inert there — three independent copies, all kept in lockstep by `sync-plugin-version.mjs` and guarded by `check-plugin-manifest.mjs`. The spec's `plugin.json` schema is CLOSED (no `userConfig`/`mcpServers` fields) and its `mcp.json` requires a `type` per server (`stdio`/`streamable-http`/`sse` — not Claude's `http`) and expands only `${PLUGIN_ROOT}`/`${PLUGIN_DATA}`, so the spec `platform` entry carries NO `env`: credentials come from the engine's `~/.cognigy-plugin/config.json` fallback in `loadConfig()`.

**Cursor** — Cursor is a spec client and loads the plugin from the root spec files WITHOUT any Cursor-specific files. `plugin/.cursor-plugin/plugin.json` + the repo-root `.cursor-plugin/marketplace.json` (multi-plugin repo pointer, `source: "plugin"`) exist ONLY for what the closed spec schema can't express: (1) the branded Cursor Marketplace listing (`logo`/`displayName`/`category` — submit at cursor.com/marketplace/publish, manually reviewed), (2) the `agents/` components, which spec v1 doesn't define, and (3) `variables` — Cursor's dashboard-managed user config (Plugins → Configure), referenced as `${VAR}` in the server `env`, restoring the credentialed setup that the spec `mcp.json` must ship without. When Cursor loads the Cursor manifest, its explicit `skills`/`mcpServers` fields REPLACE folder auto-discovery, so the credential-less spec `mcp.json` is not double-loaded. Schemas: `cursor/plugins` repo `schemas/*.schema.json`.

The same npm package also exposes two bins: **`cognigy-setup`** — the one-command installer (`npx @cognigy/plugin-engine@latest cognigy-setup`) that wires credentials + installs into Claude Code (via the `claude` plugin CLI, key→keychain; creds-file fallback) and/or the **standalone Claude Desktop app** (merges an `mcpServers.cognigy` entry into `claude_desktop_config.json`); and **`cognigy-mcp`** — the MCP server bin (`dist/index.js`), which the plugin's `mcpServers` command launches via `npx`. Installer/Desktop code lives in `src/install/*`. The Desktop entry points at an auto-updating launcher (`src/install/desktopLauncher.ts` → `~/.cognigy-plugin/desktop-launch.mjs`) that pulls the latest engine from npm on every Desktop boot (offline-safe). Still **no `.mcpb` / `manifest.json`** — Desktop is configured via its MCP config file, not a Desktop Extension.

**Antigravity (IDE + `agy` CLI) — `src/install/antigravity.ts`.** Antigravity has a first-class plugin format that our assets fit almost verbatim, so unlike Desktop we ship a **real plugin** rather than scattering files. The installer stages it under `~/.cognigy-plugin/antigravity-plugin`, then installs it itself into `~/.gemini/config/plugins/cognigy-plugin/` — a tree shared by the IDE, the CLI and the SDK, so one install serves all three.

**We deliberately do NOT shell out to `agy plugin install`.** That would make the install depend on a CLI the user may not have (the IDE ships without it), add a Windows `agy.cmd` spawn hazard, and — worse — `agy plugin install` MERGES into an existing plugin dir instead of replacing it, so files a previous version shipped survive an upgrade (observed live: a renamed agent counted twice, 4 agents for 2 files). Since `agy plugin install` does nothing but copy the dir and record the plugin, `registerPlugin` reproduces both halves: `clearInstalledPlugin()` then copy, plus BOTH registries Antigravity reads — the `import_manifest.json` entry (`agy plugin list` reads this; note `imports` is `null`, not `[]`, when empty, and `importedAt` is seconds-precision UTC) and `plugins.<name>.enabled` in `config.json` (how the bundled plugins are registered). Verified equivalent on a real install: uninstall → direct install produced a byte-identical 23-file tree and `agy plugin list` reported it exactly as its own. `agy plugin validate <dir>` remains the dev-time conformance check. Layout (verified with `agy plugin validate`, which reports `skills / agents / commands / mcpServers / hooks` counts — use it to check any change here): `plugin.json`, `mcp_config.json`, `skills/<id>/SKILL.md`, `agents/<id>.md`.

Plugin location has moved between versions — CLI v1.0.2 relocated installs to `~/.gemini/config/plugins`, older builds used `~/.gemini/antigravity-cli/plugins` — so `PLUGIN_ROOTS` lists both: we WRITE to the former but must LOOK in both, or status/uninstall would miss a plugin an older `agy` staged elsewhere.

Hard-won details: the plugin's **`mcp_config.json` is read in place** — the global `~/.gemini/config/mcp_config.json` is NOT merged into, so install/uninstall can't disturb the user's own servers (`removeLegacyGlobalServer` only _cleans_ a stale `cognigy` entry an earlier/hand-rolled setup may have left, so two engines don't boot). Remote servers use **`serverUrl`**, not `url`. Agents ship as flat `agents/<name>.md` — both that and `agents/<name>/agent.md` validate, and flat is what other multi-client plugins use, so our Claude files need no conversion. Their `name`/`description` frontmatter is already the expected format. Skills are **not** prefixed — they're plugin-scoped, exactly as Antigravity's bundled plugins do it (`chrome-devtools-plugin` ships a bare `troubleshooting` skill too). Note `gemini-extension.json` (legacy Gemini-CLI extension format) also carries `mcpServers`, but `agy plugin validate` ignores it — use `mcp_config.json`. Fallback when `agy` is missing: copy into `plugins/` ourselves and set `plugins.<name>.enabled` in `config.json`, matching the bundled plugins.

Credentials do **not** go into any `mcp_config.json` (shared, hand-edited, pasted into bug reports); they go to `~/.cognigy-plugin/config.json` (0600), which `loadConfig()` already reads when env vars are absent — so the plugin's server entry carries no `env` at all. The engine runs through the **same launcher as Desktop** (`desktopLauncher.ts` — generic despite the name), because Antigravity is a GUI app whose minimal PATH can't resolve `npx`. Since there's no marketplace to fetch skills from, `scripts/copy-assets.mjs` copies `plugin/skills` + `plugin/agents` into `dist/plugin-assets/` so they ship in the npm package (`files` is `["dist", …]`) — without that the installer would have nothing to install. `cognigy-setup update` re-stages the plugin (the engine itself auto-updates via the launcher).

**Why Desktop gets a directly-wired connector, not the plugin:** Claude Desktop chat _does_ have a plugin system (skills load, agents are Cowork-only), but its plugin/connector config lives in the claude.ai account + IndexedDB — **not a scriptable local file** — and its "Customize" affordance only injects a prompt template, so the plugin's bundled `platform` connector can never be given credentials on Desktop (it stays a no-op). Hence the installer wires a standalone `cognigy` MCP connector directly (tools + always-on `instructions.ts` guidance; no skills). Users who want skills on Desktop install the plugin from the GUI _in addition_ and leave `platform` unconnected. Claude Code has no such limitation — it gets the full plugin.

## Tech stack

- TypeScript, **ESM** (`"type": "module"` — import paths use `.js` even for `.ts` sources).
- Runtime deps: `@modelcontextprotocol/sdk` (stdio transport), `axios`, `zod`, `form-data`. Nothing else.
- Entry `src/index.ts`: wires `Server` + `StdioServerTransport`, registers `ListTools`/`CallTool`, instantiates `CognigyApiClient` + `ToolHandlers`.

## Tools — few tools, many operations

17 tools, each often a multi-operation dispatcher (e.g. `manage_flow_nodes { operation }`, `manage_knowledge`, `manage_packages`). Prefer extending an existing tool over adding one. Each tool spans:

| File                        | Role                                                                            |
| --------------------------- | ------------------------------------------------------------------------------- |
| `src/tools/definitions.ts`  | `name`/`description`/`annotations`/`inputSchema` — the LLM-facing contract.     |
| `src/schemas/tools.ts`      | Zod schemas; validate `args` at the top of each handler.                        |
| `src/tools/handlers.ts`     | `ToolHandlers` — one `handleXxx(args)` + a `case` in `handleToolCall()`.        |
| `src/tools/nodeRegistry.ts` | Flow-node registry; gates `manage_flow_nodes create`.                           |
| `src/tools/filters.ts`      | `filterResponse(kind, obj)` strips internal fields before returning to the LLM. |

Helpers: `withHints(result, { warning, action })` attaches `_hints`; `resolveFlowForAgent(apiClient, aiAgentId)` maps an agent → its flow.

## Skills

Workflow guidance lives only as plugin skills `plugin/skills/<id>/SKILL.md` (hand-authored: `name`/`description` frontmatter + body), which auto-load on intent in clients that support skills (e.g. Claude Code, Antigravity — the latter gets them copied into its plugin dir, see above). `src/instructions.ts` is the always-on baseline — an overview plus genuinely cross-tool hard rules, injected every session — and matters most for clients that don't load skills (e.g. Codex); keep it terse and let the skills own the step-by-step workflow detail. Agents are `plugin/agents/*.md`.

## Versions

**One version.** semantic-release (on merge to `main`) decides the bump from conventional commits, sets that version in **both** `package.json` (`@cognigy/plugin-engine`) and `plugin/.claude-plugin/plugin.json` (via `scripts/sync-plugin-version.mjs`), publishes the engine, and commits both back. **Never hand-bump either** — no per-PR plugin bump, no CI version gate. The launcher pins the engine to the plugin version, so the two are always equal. Use release-triggering commit types (`feat`/`fix`/`docs`/…) for changes that must reach users; `chore`/`ci`/`test` cut no release.

## API client & config

- `src/config.ts` `loadConfig()` reads env `COGNIGY_API_BASE_URL` + `COGNIGY_API_KEY` (both required). `normalizeApiBaseUrl` rewrites `*.cognigy.ai` → `api-*.cognigy.ai`.
- `src/api/client.ts` `CognigyApiClient` wraps axios; `get/post/patch/delete` return `response.data` (HAL body). Retries on 429 / 5xx.
- Base URL has no `/new` prefix; the server mounts the modern router at both `/new` and root, so `/v2.0/...` and `/new/v2.0/...` hit the same handlers.

## Audit-event attribution (cross-repo contract)

Cognigy.AI 2026.17.0 ([cognigy#13652](https://github.com/Cognigy/cognigy/pull/13652)) records who performed an audited action in `auditEvent.performedBy` = `{ actor, taskId?, sessionId? }` and shows it as the "Performed by" column in Admin Center → Audit Events. `"mcp-plugin"` is a first-class actor value there — enum, Mongo partial indexes, the REST `actor[]` filter and the "MCP Plugin" UI label all ship it — so this plugin declares itself and needs no platform change.

Wire contract, all of it load-bearing (`services/service-api/src/middleware/authentication.ts`): the header is **`X-Ask-AI-Context`**, a JSON object whose actor field is named **`type`**, NOT `actor` (the middleware maps `context.type` onto `performedBy.actor`), and **`taskId` is mandatory and must be a string**. Get any of it wrong — bad JSON, unknown `type`, missing/non-string `taskId` — and service-api silently degrades the request to `actor: "human"`, i.e. the write still succeeds but is recorded as if a person did it. `performedBy` is stored **only** for non-human actors, so a missing field means "a person did this".

Ours lives in `src/utils/actorContext.ts`: an `AsyncLocalStorage` task id (one per MCP tool call, entered in `src/index.ts`'s `CallTool` handler — a mutable field would let concurrent calls interleave) plus a boot-time `sessionId`, injected by the single request interceptor in `src/api/client.ts` so uploads are covered too. `talk_to_agent`'s bare `axios.post(endpointUrl)` deliberately gets no header — endpoint traffic produces conversations, not audit events. `COGNIGY_DISABLE_AUDIT_ATTRIBUTION=1` opts out.

Attribution is self-declared provenance, **not** a security control: service-api trusts this header from any authenticated caller (a gap the PR documents in that file; its PR body's `INTERNAL_SERVICE_TOKEN` claim is stale). Read side: `list_resources` / `get_resource` `resourceType: 'audit_event'` → `GET /v2.0/auditevents` (organisation-scoped, no `projectId`; `actor[]`/`type[]` need 2026.17.0+, hence the 400 hint in the handler).

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
- The manifest's engine pin uses an **npm alias** (`cognigy-engine@npm:@cognigy/plugin-engine@<pin>`) on purpose: a plain spec makes `npm exec` treat this repo's own `package.json` (same name + version) as satisfying the pin in sessions rooted here, skip the install, and fail with `cognigy-mcp: command not found` (MCP `-32000`). The alias name never matches, so npm always installs from the registry. Never "simplify" it back — `npm run check:manifest` enforces the alias form.
- Local plugin testing: `npm run plugin:dev` installs a generated dev marketplace (`.dev-plugin/`, gitignored) serving the working tree — engine runs from `src/` via tsx (no build), skills/agents symlinked; iterate with `/reload-plugins`. `npm run plugin:dev:off` restores the GitHub install. Never edit the tracked `plugin.json` for testing — `npm run check:manifest` guards it in pre-commit and CI.

## Conventions

- Conventional Commits (`fix:`, `feat:`, `chore:`, with scopes).
- Tests mock the api client; mocks may not match real API field projections — verify against the real REST shape (see chart gotchas).
- Dev skill `.claude/skills/add-tool/SKILL.md` documents the add/extend-a-tool workflow.
