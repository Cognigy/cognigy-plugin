# 02 - Feature Map

_Reflects local branch `fix/code-node-development-best-practices` = upstream v1.15.0 + Code Node commit `030e9c6`. Definitions in `src/tools/definitions.ts`, handlers in `src/tools/handlers.ts`._

---

## Feature groups, before the detail

Place a new idea into one of these before reading further.

- **Agent lifecycle** - create, update, converse with, and soft-delete LLM AI Agents. `create_ai_agent`, `update_ai_agent`, `talk_to_agent`, `delete_resource`. Flow creation happens only here, as a side effect.
- **Tool building inside the agent** - add and edit tools under the Job node, and the flow nodes inside a tool branch. `create_tool`, `update_tool`, `manage_flow_nodes`, the node registry, Code Node validation, tool-parameter normalization.
- **Model and knowledge plumbing** - LLM resources, connections, knowledge stores, project settings. `setup_llm`, `manage_knowledge`, `manage_settings`.
- **Channels** - endpoints for REST (implicit), Webchat v3, Voice Gateway. `manage_webchat`, `manage_voice_gateway`, plus the voice go-live audit `audit_voice_agent`.
- **Reading and inspection** - generic paginated list/get across 11-12 resource types, audit events, flow rendering. `list_resources`, `get_resource`, `manage_flow_nodes render`.
- **Portability and safety** - package export/import and snapshot backup/restore with the backup gate. `manage_packages`, `manage_snapshots`.
- **Guidance content** - always-on instructions, 15 skills, 2 subagents. Where best practices live today.
- **Distribution** - installer, six client platforms, four manifest trees, release automation.

---

## Tool inventory (17 tools)

Every action/operation string that exists in the code is listed. "Gate" = held by the backup gate on first mutation of an existing resource per project.

| #   | Tool                   | What it does                                                                                                                                                                                             | Actions / discriminators                                                                                                                                                                                                                                                      | Gate                                         | Handler      |
| --- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------ |
| 1   | `create_ai_agent`      | One call creates project (optional), AI Agent, flow (`"<name> Flow"`), Job node with auto-assigned LLM, REST endpoint; deletes backend placeholder tool nodes; rolls back with real `DELETE`s on failure | single operation; params `name`, `projectId?`, `description?`, `knowledgeStoreReferenceId?`                                                                                                                                                                                   | exempt (new)                                 | `:1455-1785` |
| 2   | `update_ai_agent`      | PATCH agent fields and/or Job node `jobConfig`                                                                                                                                                           | single; `aiAgentId`, `name?`, `description?`, `instructions?`, `jobConfig{jobName, jobDescription, jobInstructions, llmProviderReferenceId, temperature, maxTokens}`                                                                                                          | yes                                          | `:1790-1929` |
| 3   | `setup_llm`            | Create LLM resource (+ Connection when `apiKey` given), test it, clean up on failed test                                                                                                                 | `provider`: `openAI`, `azureOpenAI`, `anthropic`, `google`, `mistral`, `openAICompatible`; `apiKey` xor `connectionId`                                                                                                                                                        | no                                           | `:1934-2171` |
| 4   | `talk_to_agent`        | Send a message to a REST endpoint; **auto-creates a REST endpoint if none exists**                                                                                                                       | single; `message`, `endpointUrl` xor `aiAgentId`, `sessionId?`, `userId?`, `data?`, `verbose?`                                                                                                                                                                                | exempt                                       | `:2176-2374` |
| 5   | `list_resources`       | Paginated lists with server-side sort                                                                                                                                                                    | `resourceType`: `project`, `agent`, `flow`, `endpoint`, `llm_model`, `knowledge_store`, `conversation`, `extension`, `function`, `tool`, `audit_event`; filters `sort`, `limit`, `skip`, `useCase`, `actor[]`, `eventType[]`, `user`, `startDate`, `endDate`, `channel`       | read                                         | `:2379-2645` |
| 6   | `get_resource`         | Single resource, `raw` bypasses filtering                                                                                                                                                                | `resourceType`: `agent`, `flow`, `endpoint`, `project`, `conversation`, `session_state`, `llm_model`, `knowledge_store`, `extension`, `function`, `user` (`me`), `audit_event`                                                                                                | read                                         | `:2667-2711` |
| 7   | `delete_resource`      | Soft-delete (rename `DELETE_`) for agent/flow/project; hard delete for the rest                                                                                                                          | `resourceType`: `agent` (`cascade` default true), `flow`, `project`, `endpoint`, `llm_model`, `knowledge_store`, `function`, `tool` (needs `aiAgentId`)                                                                                                                       | yes, except `endpoint` and `knowledge_store` | `:2716-3122` |
| 8   | `manage_knowledge`     | Knowledge stores, sources, chunks                                                                                                                                                                        | `operation`: `create_store`, `create_source` (`type`: `url`, `manual`, `file`; 10 MB cap; pdf/txt/text/docx/ctxt/pptx), `list_sources`, `list_chunks`                                                                                                                         | no                                           | `:3127-3388` |
| 9   | `create_tool`          | Add a tool under the Job node with its resolve node; `http` type also creates HTTP Request + optional pre/post Code nodes; duplicate `toolId` reuses                                                     | `toolType`: `tool`, `knowledge`, `send_email`, `mcp`, `http`                                                                                                                                                                                                                  | yes                                          | `:3393-3736` |
| 10  | `update_tool`          | PATCH tool node and HTTP children; provisions missing pre/post Code nodes                                                                                                                                | `toolType` hint (same enum); `toolNodeId`, `httpNodeId?`, `preProcessNodeId?`, `postProcessNodeId?`, `resolveNodeId?`                                                                                                                                                         | yes                                          | `:3741-3992` |
| 11  | `manage_flow_nodes`    | Node CRUD and rendering                                                                                                                                                                                  | `operation`: `list`, `get`, `create`, `update`, `delete`, `render`; `mode`: `append`, `appendChild` (auto-rewritten to `append` under `aiAgentJobTool`/`then`/`else`/`case`/`default`); `format`: `ascii`, `mermaid`, `both`; `writeHtml`, `openInBrowser`, `focus`, `legend` | yes (except `list`, `get`, `render`)         | `:3997-4555` |
| 12  | `manage_packages`      | Export/import/inspect Cognigy packages; **writes archives to local disk**                                                                                                                                | `operation`: `list_exportable`, `upload_and_inspect`, `inspect`, `import`, `export`, `download`, `read_task`                                                                                                                                                                  | no                                           | `:1195-1450` |
| 13  | `manage_webchat`       | Create or update a `webchat3` endpoint; read-merge-write of full settings                                                                                                                                | create when no `endpointId`, else update; `stylePreset`: `classic`, `modern`, `slick`; 14 friendly setting groups                                                                                                                                                             | no                                           | `:4560-4723` |
| 14  | `manage_voice_gateway` | Create or update a `voiceGateway2` endpoint and provision WebRTC client                                                                                                                                  | create/update by `endpointId`; `webrtcWidgetConfig{label, theme: CLEAN_WHITE, DARK_MODE, AI_PURPLE, transcription, demoPage, avatarLogoUrl, tagline}`                                                                                                                         | no                                           | `:4800-5011` |
| 15  | `manage_settings`      | Project-level settings                                                                                                                                                                                   | `operation`: `set_voice_preview` (`provider`: `microsoft`, `google`, `aws`, `deepgram`, `elevenlabs`), `set_knowledge_ai` (`knowledgeSearchModelId`, `answerExtractionModelId`, `contentParser`: `default`, `legacy`, `azure`, `azureDIConnectionId`)                         | yes                                          | `:5025-5217` |
| 16  | `audit_voice_agent`    | Voice Go-Live Checklist dry-run or apply; can prepend a `setSessionConfig` node                                                                                                                          | `apply` bool; `only[]` check ids; `aiAgentId` xor `flowId`; `endpointId?`, `projectId?`                                                                                                                                                                                       | yes when `apply`                             | `:5269-5522` |
| 17  | `manage_snapshots`     | Cognigy Snapshot backup/restore and gate control; **no download, no package from snapshot**                                                                                                              | `operation`: `list`, `create` (`label`, `confirmDeleteOldest`, `waitForCompletion`, `timeoutMs`), `restore` (`confirm`), `delete`, `decline`, `read_task`                                                                                                                     | control                                      | `:6001-6512` |

**Not in this build:** `read_guide` (introduced 1.0.1, since removed without a CHANGELOG entry). The `cognigy` MCP server installed on this machine still exposes it, which means the locally installed plugin is an older engine than the checkout. Hints in `handlers.ts:1770, 2351, 3405, 4059, 4072` still say "Read the ... guide" - leftovers.

### Things that do not exist as tools, stated explicitly

- **No standalone flow creation.** `POST /v2.0/flows` is called exactly once, inside `handleCreateAiAgent` at `handlers.ts:1491-1495`. (The roadmap cites "~line 1229"; that was an earlier upstream version.) `manage_flow_nodes` requires an existing `flowId`.
- **No generic endpoint creation.** Endpoints are created in four places for three channels: `rest` (`create_ai_agent :1652`, `talk_to_agent :2275`), `webchat3` (`manage_webchat :4614`), `voiceGateway2` (`manage_voice_gateway :4853`, via `/new/v2.0/endpoints`). No other channel can be created.
- **No project-only creation** other than as a side effect of `create_ai_agent` without `projectId`.
- **No handover provider, extension install, playbook, locale, or API-token management.** Extensions and functions can only be listed/read.
- **No LLM Prompt node, Task node, Email Notification node, Overwrite Analytics node, Once node, Execute Flow node** in the registry (see next section).
- **No multi-credential / multi-tenant profile.** One `COGNIGY_API_BASE_URL` + `COGNIGY_API_KEY` per process.
- **No inline/base64 return** for packages or snapshots; packages land on the engine's local disk only.

---

## Node registry (15 types) - `src/tools/nodeRegistry.ts:34-304`

| Registry key (used in `create`) | Cognigy `type` (returned by `list`) | Extension                | Required config | Notes                                                                        |
| ------------------------------- | ----------------------------------- | ------------------------ | --------------- | ---------------------------------------------------------------------------- |
| `say`                           | `say`                               | basic-nodes              | `text`          | quickReplies, buttons, gallery, adaptiveCard, etc.                           |
| `question`                      | `question`                          | basic-nodes              | `text`, `type`  | validation, resultLocation                                                   |
| `ifThenElse`                    | `if`                                | basic-nodes              | `condition`     | auto-creates `then`/`else` children                                          |
| `lookup`                        | `switch`                            | basic-nodes              | `type`          | auto-creates `case`/`default`; cases set on parent                           |
| `setSessionContext`             | `addToContext`                      | basic-nodes              | `key`, `value`  | one key/value per node                                                       |
| `code`                          | `code`                              | basic-nodes              | `code`          | validated by `codeNodeValidation.ts`                                         |
| `goTo`                          | `goTo`                              | basic-nodes              | none            | `flowNode`, `absorbContext`, `executionMode`, `injectedText`, `injectedData` |
| `sleep`                         | `sleep`                             | basic-nodes              | `milliseconds`  | alias `delay`                                                                |
| `httpRequest`                   | `httpRequest`                       | basic-nodes              | `url`           | headers, payload, store location                                             |
| `initAppSession`                | `initAppSession`                    | basic-nodes              | none            | 19 xApp styling keys                                                         |
| `showXAppHtml`                  | `setHTMLAppState`                   | basic-nodes              | none            |                                                                              |
| `showXAppAdaptiveCard`          | `setAdaptiveCardAppState`           | basic-nodes              | `card`          |                                                                              |
| `setXAppState`                  | `setAppState`                       | basic-nodes              | `appTemplateId` |                                                                              |
| `getXAppSessionPin`             | `getAppSessionPin`                  | basic-nodes              | none            |                                                                              |
| `setSessionConfig`              | `setSessionConfig`                  | `@cognigy/voicegateway2` | none            | 23 voice keys; the one permitted pre-Job node                                |

Handlers also create node types directly, outside the registry: `aiAgentJob`, `knowledgeTool`, `aiAgentJobTool`, `aiAgentJobMCPTool`, `sendEmailTool`, `aiAgentToolAnswer`, `aiAgentJobCallMCPTool`. Two registry fields are documentation only: `placement` is never read by handlers (every entry says `flow`), and `configKeys` is not enforced (only `requiredConfigKeys` is, `handlers.ts:4085-4107`). The "tool branch only" rule is enforced by prompt, not code.

### Code Node validation (local commit) - `src/tools/codeNodeValidation.ts`

Blocking errors: missing top-level `try { } catch`, catch body missing any of `error`, `errorMessage`, `errorFlow`, `errorNode`, `errorTime`, `errorSessionId`, `errorUserId`, catch not calling `api.addToContext("codeNode", ...)`, `api.setState/getState/resetState`, any `api.*` outside a 24-method allowlist, any HTTP (`api.httpRequest`, `fetch`, `XMLHttpRequest`, `axios`, `require`, `import`), and `toLocaleString`/`toLocaleDateString`/`toLocaleTimeString`/`Intl.*`. Non-blocking warnings: dotted path in `api.deleteContext`, direct `context.x =` assignment, `var`, more than 100 `api.*` calls or 200,000 lines. Wired at `schemas/tools.ts:311-320` (create_tool), `:356-365` (update_tool), `:385-395` (manage_flow_nodes create) and `handlers.ts:4291-4303` (manage_flow_nodes update). Warnings surface only on `manage_flow_nodes` create/update, never for tool pre/post code. There is no dedicated negative-path test; existing tests were adapted to pass the gate via a `STANDARD_CATCH_BLOCK` helper.

### Tool parameter normalization - `src/tools/toolParameters.ts`

Enforces the JSON Schema contract for tool `parameters`: top-level object with `properties` and `required`, every property has `type` and `description`, allowed types, arrays need `items`, nested objects need their own `required`, `additionalProperties: false` injected at every level, 100,000-char cap. Runs on `create_tool` / `update_tool` (upstream 1.15.0, #39).

### Voice Go-Live checklist - `src/tools/voiceChecklist.ts` (13 checks)

Auto-fixable: `vg.session-config-first` (only when no Set Session Config node exists), `vg.barge-in-off`, `vg.continuous-asr-off`, `vg.user-input-timeout`, `vg.flow-input-timeout`, `vg.flow-fails-on-error-off`, `agent.stream-output`, `agent.fails-on-error-off`, `agent.error-message`, `agent.log-llm-latency`, `vg.silence-overlay-delay`. Advisory only: `vg.stt-hints`, `endpoint.output-transformer` (needs `endpointId`), `llm.fallback` (needs `projectId`). This module is the closest thing in the codebase to an "audit a build against a checklist" pattern, and its structure (check id, status, `autoFixable`, fix payload) is a template for any NA PS QA-reachability work.

---

## Cognigy API surface actually used

About 45 distinct routes across `/v2.0/` and `/new/v2.0/`. Grouped: projects (create, list, get, patch, graph, settings), aiagents (CRUD minus hard delete except rollback, jobs), flows (create, list, get, patch, chart, chart/nodes CRUD), endpoints (create on both routers, list, get, patch, delete), locales (list), largelanguagemodels (CRUD, test, `/new` list with `useCase`), connections (list `/new`, create), knowledgestores (CRUD, sources, upload, chunks), conversations, sessions state, extensions/functions (read; function delete), users (`me`), auditevents, packages (`/new`: create, upload, get, downloadlink, merge), tasks (`/new`), snapshots (`/new`: list, create, get, delete, restore). Full table with line numbers is in the research dump; the planning-relevant point is that **the platform's flow-create, endpoint-create, and project routes are already exercised**, so exposing them as standalone tools is wiring, not discovery.

---

## Guidance content

### Always-on instructions - `src/instructions.ts` (43 lines)

Lists the workflow order (list projects, ensure LLM, create agent, test, refine), the LLM-reuse-before-`setup_llm` rule, default `toolType`, "never add nodes before the Job node", the nine "common" node types (stale: omits xApp and `setSessionConfig`), `toolId` uniqueness, and the endpoint URL distinction. Injected on every client including Codex.

### Skills - `plugin/skills/` (15)

| Skill                                      | Covers                                                                                                        | Planning note                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `agent-creation`                           | end-to-end build; persona vs guardrails vs job fields; LLM reuse via packages                                 | where prompt-writing standards would slot in                                                |
| `llm-providers`                            | provider strings, `openAICompatible`, connection scoping, deprecations                                        |                                                                                             |
| `knowledge-setup`                          | embedding vs search model, settings-before-store, ingestion                                                   |                                                                                             |
| `tools-setup` (308 lines)                  | tool types, param schema contract, HTTP response shape (`input.httprequest.result`), `input.aiAgent.toolArgs` | its inline code examples lack try/catch and **would now be rejected** by the Code Node gate |
| `flow-nodes` (498 lines)                   | node types, placement, branching, render, **full Code Node standard** (updated by the local commit)           | the only skill carrying the enforced Code Node rules                                        |
| `package-management`                       | export/import/upload, UI-parity defaults                                                                      |                                                                                             |
| `settings`                                 | voice preview provider, Knowledge AI                                                                          |                                                                                             |
| `snapshot-backups`                         | gate protocol, restore, limit 10                                                                              | gated-tool list is stale vs code (omits `audit_voice_agent`, `manage_settings`)             |
| `voice-gateway-setup`                      | VG endpoint + WebRTC                                                                                          |                                                                                             |
| `voice-go-live-checklist`                  | the 13 checks, fixable vs manual                                                                              |                                                                                             |
| `webchat-setup` (327 lines)                | presets, full settings reference                                                                              |                                                                                             |
| `agent-red-team` (344 lines + 2 templates) | adversarial testing protocol, findings JSON schema, report template                                           | the only "QA-shaped" workflow in the plugin; main-session, not a subagent                   |
| `xapps` (+ 6 templates)                    | xApp nodes, Init Session rule, data access                                                                    |                                                                                             |
| `docs-lookup`                              | steering to the remote docs MCP server                                                                        | depends on tools not in this repo                                                           |
| `troubleshooting`                          | empty responses, failed creates, 401/403, deletes                                                             |                                                                                             |

### Subagents - `plugin/agents/` (2)

`cognigy-agent-builder` (list projects, ensure LLM, create, test, refine; terse report) and `cognigy-voice-go-live` (dry-run audit, ask about snapshot, apply, re-audit). Claude Code and Cursor only.

### Contributor dev skills - `.claude/skills/` (not shipped)

`add-tool` and `add-client-platform`. Both list the exact files that must change; see 03 for the cost tables derived from them. Both have stale details (`~16` tools, four clients, a nonexistent `ingest_source` op).

---

## Distribution and platform packaging

| Platform                 | Mechanism                                                                                           | Skills             | Agents      | Creds                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------- | ------------------ | ----------- | ------------------------------------------------------- |
| Claude Code              | marketplace `.claude-plugin/marketplace.json` -> `plugin/.claude-plugin/plugin.json` (`userConfig`) | yes                | yes         | `${user_config.*}`                                      |
| Claude Desktop chat      | installer writes connector into `claude_desktop_config.json` behind auto-updating launcher          | in-app plugin only | in-app only | plaintext in config                                     |
| ChatGPT + Codex          | `codex plugin marketplace add` -> `plugin/.codex-plugin/`                                           | yes                | **no**      | creds file                                              |
| Gemini CLI               | release-asset zip built by `scripts/build-gemini-extension.mjs`                                     | yes                | converted   | creds file; consumer Gemini CLI discontinued 2026-06-18 |
| Antigravity              | installer stages `~/.gemini/config/plugins/cognigy-plugin/`                                         | yes                | yes         | creds file                                              |
| Cursor                   | `.cursor-plugin/marketplace.json` -> `plugin/.cursor-plugin/plugin.json` (`variables`)              | yes                | yes         | `${VAR}`                                                |
| Kiro / VS Code + Copilot | Agent Plugins spec `plugin/plugin.json` + `plugin/mcp.json`                                         | yes                | n/a         | creds file                                              |

Every manifest launches the same command: `npx -y -p cognigy-engine@npm:@cognigy/plugin-engine@1.15.0 cognigy-mcp`. **A fork that changes engine code must publish its own npm package (or change every manifest to a local path) before any platform runs the changed code.** This is the single biggest distribution decision for Phase 0 and it is not written down anywhere in the repo.

---

## `scripts/` - release and dev automation, not tests

`sync-plugin-version.mjs` (rewrites version pins in six manifests), `check-plugin-manifest.mjs` (CI + pre-commit guard; the pattern the roadmap wants to reuse for a skill-to-validator drift guard), `copy-assets.mjs` (mermaid.min.js and skills/agents into `dist/`), `build-gemini-extension.mjs`, `dev-plugin.mjs` (`npm run plugin:dev` generates a gitignored `.dev-plugin/` marketplace running `src/index.ts` via tsx; Claude Code only), `render-demo.ts` (dev demo, uses non-real node types). Tests live in `src/__tests__/` (24 files; `integration.test.ts` is permanently `describe.skip`).
