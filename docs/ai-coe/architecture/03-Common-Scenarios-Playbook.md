# 03 - Common Scenarios Playbook

_Worked answers to the planning questions the team has actually asked. Read operationally, not start to finish. File/line references are to the local branch described in `00-Overview.md`._

---

## The one real cost data point: the Code Node PR

Before any estimate below, anchor on the one change this team has actually shipped. Commit `030e9c6` ("enforce Cognigy Code Node best practices and standards at write time") against upstream 1.15.0:

| File                                                                    | Lines changed            | Why it had to change                                                           |
| ----------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------ |
| `src/tools/codeNodeValidation.ts`                                       | +268 (new)               | the rules themselves                                                           |
| `src/schemas/tools.ts`                                                  | 172                      | three `superRefine` hooks (create_tool, update_tool, manage_flow_nodes create) |
| `src/tools/handlers.ts`                                                 | 71                       | pre-PATCH check on node update, post-write warning surfacing                   |
| `src/tools/definitions.ts`                                              | 12                       | tell the model the rule exists                                                 |
| `plugin/skills/flow-nodes/SKILL.md`                                     | 59                       | tell the model the rule in prose                                               |
| `src/__tests__/httpTool.test.ts`, `tools.test.ts`, `updateTool.test.ts` | 104                      | make existing fixtures pass the new gate                                       |
| `.claude/settings.json`                                                 | 12                       | local permissions                                                              |
| **Total**                                                               | **9 files, +598 / -100** |                                                                                |

Two lessons for estimating. Roughly 45% of the diff is the rule module itself; the other 55% is _wiring the rule into every place a Code Node can be written_ plus adapting tests. That wiring is what a validation registry (below) would collapse. And the change added **zero** negative-path tests: nothing asserts that bad code is rejected. Any future rule should budget for those, because the maintainer's PR template asks for a test plan.

---

## Scenario: add a new node type (Task, Email Notification, Overwrite Analytics, LLM Prompt, Once)

**What already works.** `manage_flow_nodes create` accepts `nodeType: z.string()` (`schemas/tools.ts:373`), so the Zod layer never needs to change for a new type. The registry header (`nodeRegistry.ts:8-9`) is accurate: "new node types never require schema or tool-definition changes." Adding a registry entry is enough for the node to be _creatable_.

**Minimum change, one file:** a new entry in `NODE_REGISTRY` (`nodeRegistry.ts:34-304`) with `type`, `extension`, `category`, `summary`, `configKeys`, `requiredConfigKeys`. Copy `sleep` (`:137-145`) as the smallest template.

**Realistic change, three to five files:**

1. `src/tools/nodeRegistry.ts` - the entry.
2. `src/tools/handlers.ts` `transformConfigForApi` (`:253-424`) - only if the friendly config shape differs from what Cognigy stores. `say`, `question`, `if`, `switch`, `goTo`, `httpRequest` all needed a case; xApp nodes did not.
3. `plugin/skills/flow-nodes/SKILL.md` - document config keys and placement (the registry comment at `:6` says this is required).
4. `src/instructions.ts:37` and `definitions.ts:871` - both list "common types" and are already stale (they omit xApp and `setSessionConfig`); decide once whether to keep maintaining these lists or point at the skill.
5. `src/__tests__/tools.test.ts` - copy the xApp block at `:2379-2519`: mock `api.post` once, call `handleToolCall("manage_flow_nodes", {operation: "create", nodeType, config})`, assert `type`, extension, config passthrough.

**What you must find out first, per node type (not verifiable from the repo):** the exact Cognigy `type` string and `extension` for `task`, `emailNotification`, `overwriteAnalytics`, `llmPrompt`, `once`; their stored config key names; and whether any of them carry server-computed fields (the `preview` gotcha in `.claude/CLAUDE.md:77-85`). The fastest way to get ground truth is the roadmap's reference-corpus step: export a Pass-grade build as a package, or `manage_flow_nodes get` an existing node of that type in a real project, and read the config off the wire. The Email Notification field names the roadmap already has (`recipient`/`cc`/`bcc`/`subject`/`message`) came from exactly that kind of observation.

**Cost:** for a node with a pass-through config, half a day including a test. For a node that also needs an _enforced content rule_ (the `Topic - Category - Outcome` naming rule for Task nodes, null-out handling for chained Overwrite Analytics), see the next scenario, because the registry only checks required keys exist, not what they contain.

---

## Scenario: add an enforced content rule (the validation registry proposal)

**Today.** Content validation exists for exactly one node type (`code`) and one parameter (`parameters` via `toolParameters.ts`), each hand-wired at its own call sites. `requiredConfigKeys` (`handlers.ts:4085-4107`) is the only generic check and it is presence-only. Adding a second content rule the same way as the Code Node PR costs another ~9 files.

**The proposal (roadmap Phase 2).** A `VALIDATION_REGISTRY: Record<nodeType, ValidatorFn>` dispatched once from the two node-write paths in `handlers.ts` (`manage_flow_nodes create` around `:4160-4215`, `update` around `:4280-4385`) and once from the tool pre/post code paths. `codeNodeValidation.ts` already has the right shape for a `ValidatorFn` (returns `{errors[], warnings[]}`), so it becomes the first registry entry rather than being rewritten.

**Checklist for building it:**

1. Define `ValidatorFn = (config, ctx) => { errors: {id, description, message}[]; warnings: ... }` next to `NODE_REGISTRY`.
2. Move the four Code Node call sites (`schemas/tools.ts:311-320, 356-365, 385-395`; `handlers.ts:4291-4303`) behind one `validateNodeConfig(nodeType, config)` helper. Decide whether Zod `superRefine` stays (it blocks before the handler runs, which is good) or whether everything moves into the handler (simpler, one place).
3. Give every check an `{id, description}` so the drift guard can read them.
4. Drift guard: a script in the shape of `scripts/check-plugin-manifest.mjs` that loads the registry metadata and asserts each check id appears in the corresponding `SKILL.md`. Wire into `pre-commit` and `pr.yml` like the manifest check.
5. Negative-path tests: one rejected-input test per check id. The Code Node PR has none; start here.

**Cost:** the refactor itself is contained (four call sites, one new module, tests). The judgment call is whether to propose it upstream first. The maintainer's `add-tool` skill philosophy is "skills come first" (`SKILL.md:8`) and the codebase currently enforces very little, so a registry that makes enforcement cheap is a design conversation with him, not just a PR.

---

## Scenario: expose flow creation as its own tool (`create_flow`)

**What already works.** `POST /v2.0/flows` with `{projectId, name, description}` at `handlers.ts:1491-1495`, inside `handleCreateAiAgent`. Response gives `_id` and `referenceId`. Nothing else about the call is agent-specific.

**Checklist (thin wrapper, roadmap Phase 1):**

1. `definitions.ts` - new tool `create_flow` (or an operation on a new `manage_flows`; the `add-tool` skill prefers extending a tool over adding one, but there is no flow-management tool to extend). Params `projectId`, `name`, `description?`. Annotations: not read-only, not destructive.
2. `schemas/tools.ts` - `createFlowSchema`.
3. `handlers.ts` - `handleCreateFlow` extracting lines 1491-1495; add `case` in `handleToolCall`; return `{flowId: _id, referenceId, name}` through `filterResponse("flow", ...)`. Add to `targetsNewResource` (`:774-788`) so follow-up `manage_flow_nodes` calls on the new flow are not held by the backup gate, mirroring `create_ai_agent`.
4. `snapshotToolSurface.test.ts:59` classifies every tool as gated/read-only/exempt and **will fail** until the new tool is classified. Add to the exempt list.
5. `flow-nodes/SKILL.md` and `instructions.ts` - explain when to use it (the `API - <Topic>` pattern, deterministic flows).
6. `schemas.test.ts`, `tools.test.ts` - one schema test, one handler test.
7. `README.md` tool count and table.

**The unblocked pattern.** Today building an `API - <Topic>` flow means creating a throwaway agent to harvest its flow, then soft-deleting the agent (which renames it `DELETE_...` and deactivates the endpoint but leaves the flow live). `create_flow` removes that. Note that after `create_flow` the flow is empty, and `manage_flow_nodes create` has no path for that case today: `parentNodeId` is mandatory (`handlers.ts:4112-4120`) and the public `mode` enum is only `append` / `appendChild` (`schemas/tools.ts:376`). A `prepend` mode exists internally (`audit_voice_agent` uses it at `:5490` to insert a Set Session Config node at the top) but is not exposed. So `create_flow` should ship together with either an exposed `prepend` mode or a rule that `parentNodeId` may be the flow's `start` node - **pending validation** against a real empty flow, since every existing write path assumes a Job node already exists.

**Cost:** one day including tests and docs. Well under the Code Node PR.

---

## Scenario: deterministic (non-agent) flow building and the LLM Prompt node

These are two different gaps that the roadmap lists together.

_Deterministic flows._ Once `create_flow` exists, `manage_flow_nodes` can already build `say`, `question`, `ifThenElse`, `lookup`, `setSessionContext`, `code`, `httpRequest`, `goTo` chains. The blockers are the prompt layer, not the code: `instructions.ts:37` says "never add nodes before the AI Agent Job node" and `flow-nodes/SKILL.md:8-31` says the same, both of which are correct for agent flows and wrong for API flows. Plan for a skill (or a section) that describes the deterministic pattern and tells the model when the rule does not apply, plus a check in `manage_flow_nodes create` that only enforces "tool branch only" when the flow actually contains an `aiAgentJob` node (today nothing enforces it at all).

_LLM Prompt node._ Purely a registry gap (see "add a new node type"). Config keys are not known from the repo. Once it exists, the "expand create support to LLM Prompt Node" item is a registry entry plus skill prose; the "prompt-writing best practices" item is content for `agent-creation/SKILL.md` (and possibly a `superRefine` if any rule is mechanical enough to enforce, such as markdown-over-XML formatting).

---

## Scenario: standalone endpoint creation (Phase 4)

**What already works.** Three channels can be created, each with its own payload shape: `rest` (`handlers.ts:1652`, also auto-created by `talk_to_agent :2275`), `webchat3` (`:4601-4616`), `voiceGateway2` (`:4839-4855`, note the `/new/v2.0/endpoints` router). `manage_webchat` and `manage_voice_gateway` are already "create endpoint" tools for their channel and also handle update.

**The real question** is whether the team needs (a) a REST endpoint on an arbitrary existing flow (today only via `create_ai_agent` or the `talk_to_agent` side effect), or (b) other channels. For (a), a `create_endpoint {projectId, flowId, channel: "rest", name}` extracting `:1652-1657` is a half-day wrapper in the same shape as `create_flow`. For (b), each channel needs its payload discovered from a live endpoint. Recommend deciding (a) now and deferring (b).

---

## Scenario: multi-tenant / multi-environment credentials (Phase 4)

**Today.** `Config` is one flat object (`config.ts:9-27`): one base URL, one key, resolved env-first then `~/.cognigy-plugin/config.json` (`:185-188`). The rate limiter keys on the API-key prefix (`index.ts:54`), the audit `sessionId` is per process, and the backup gate state is per process. Switching environment means restarting the MCP server with different env, which in Claude Code means editing `userConfig` and reloading the plugin.

**Two paths:**

_No engine change._ Run one MCP server instance per environment under different names (Claude Code supports multiple servers; Cursor `variables` are per-installation). Costs the user a manual server switch but zero code. Check first whether Cognigy API keys can be scoped across projects on one tenant, because if a single key already covers every project the team works in, "multi-tenant" may collapse to "one key per Cognigy region," which is rare.

_Engine change._ Profile support means: a `profiles` map in `userConfigFile.ts`, a `profile` selector (env var at boot, or a `select_environment` tool that swaps the axios client at runtime), invalidating the backup-gate and `projectOfResource` state on switch, and installer/skill updates on every platform. Estimate a week with tests, and it touches the one-universal-codebase constraint because `userConfig` schemas differ per platform. Do the research pass the roadmap calls for before committing.

---

## Scenario: base64 / inline package download (Phase 3)

**Today.** `downloadPackageArchive` (`handlers.ts:1011-1051`) streams the zip to `outputPath` or `os.tmpdir()/cognigy-mcp-packages/<uuid>-<name>.zip` and returns `savedTo`, `savedToUri`, `savedDirectory`. There is no inline return. Snapshots deliberately cannot be downloaded at all (`definitions.ts:1785`; `filters.ts:132-134` strips the fields).

**Why it matters.** A hosted or sandboxed reviewing agent (this session, a future eval agent, `cognigy-build-qa-auditor` running in Cowork) does not share a filesystem with the MCP engine process on the user's machine, so `savedTo` is unreachable. Every "QA the build the plugin just produced" workflow is blocked on this.

**Checklist:** add `returnAsBase64?: boolean` to the `export` and `download` operations (`definitions.ts:929-1057`, `schemas/tools.ts` packages union); in `downloadPackageArchive`, buffer instead of `pipeline` to disk when set, return `{archiveBase64, byteLength, fileName}`; guard with a size cap (packages of a few MB are fine; MCP text content has practical limits, so document one, e.g. 10 MB, and fall back to disk above it); tests in `tools.test.ts` packages block. **Cost:** half a day. This is the cheapest high-leverage item in the roadmap and a plausible upstream contribution since it removes a platform limitation rather than encoding a team standard.

---

## Scenario: the "protect the environment" guardrail (Phase 3, hard vs soft)

**Today's behavior is already a soft-ish gate; know it before designing another.** `handleToolCall` holds the first mutating call per project (`BACKUP_WORTHY_TOOLS`: `update_ai_agent`, `create_tool`, `update_tool`, `manage_flow_nodes` except list/get/render, `delete_resource` except endpoint/knowledge_store, `audit_voice_agent` apply, `manage_settings`) and returns `error: "backup_not_offered"` with hints telling the model to ask the user and call `manage_snapshots create` or `decline`. The server never creates a snapshot itself. Once a project has a `create` or `decline` recorded (in memory, per process), every later mutation in that project proceeds. Resources created in the same session are exempt. There is **no config knob** to turn it off or make it stricter.

| Option                                                   | What changes in code                                                                                                                                                                                      | Trade-off                                                                                                                                                                                    |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep as-is                                               | nothing                                                                                                                                                                                                   | a `decline` once per session unlocks everything; relies on the model actually asking                                                                                                         |
| **Hard**: refuse update without a recent plugin snapshot | in `backupGateFor` (`:5599-5650`), remove the `backupDeclinedForProject` release path or make `decline` require an env flag; optionally check `listAllSnapshots` for a `[AI Backup]` newer than N minutes | snapshot limit of 10 becomes a daily operational problem; `confirmDeleteOldest` handling gets exercised constantly; restore is irreversible and re-ids everything, so "backup" is not "undo" |
| **Soft/automatic**: gate creates the snapshot itself     | in `backupGateFor`, call the `create` path (`:6117`) instead of returning `backup_not_offered`, then proceed                                                                                              | snapshot creation is async (task polling, `waitForCompletion`); adds seconds to the first write; same limit-of-10 pressure; silently consumes the user's snapshot slots                      |
| **Package export instead of snapshot**                   | new gate branch calling the `export` path (`:1345-1427`) for the affected flow/agent                                                                                                                      | exports include endpoints and Knowledge AI, which snapshots exclude; lands on disk (see base64 scenario); no platform cap; but restoring is an import, not a one-click restore               |

Recommend deciding hard vs soft with the snapshot cap in the room, and noting that snapshots exclude endpoints (so a webchat/voice config change is not protected by any snapshot regardless).

---

## Scenario: embedding NA PS best practices "by default" (Phase 3)

There are four places guidance can go, in increasing order of reach and cost:

1. **A new skill folder** under `plugin/skills/` - loads on intent in Claude Code, Cursor, Codex, Antigravity, Gemini. Not Claude Desktop chat without the in-app plugin. Cost: content only. Risk: drifts from `na-professionalservices` unless one is generated from the other.
2. **Edits to existing skills** (`agent-creation`, `flow-nodes`, `tools-setup`) - same reach, but reconciles overlaps instead of adding a second voice. The Code Node PR did this for `flow-nodes`. Watch `tools-setup`: its own inline code examples now fail the Code Node gate and need updating regardless.
3. **`src/instructions.ts`** - every session, every client, including Codex and Desktop. Currently 43 lines; the MCP `instructions` field has no hard limit but every line is paid on every session. Put only the rules that are cheap to state and expensive to miss (naming, param limits, Resolve Tool Action discipline).
4. **Enforcement** (Zod / handler / registry) - the only layer that survives a model ignoring prose. Use for anything mechanical: unique node names, no emojis in labels, max 5 params per tool (the toolParameters module is the natural home), reporting nodes present before a flow is considered complete.

The roadmap's "reconcile overlapping guidance" item is real: Code Node rules exist in `flow-nodes/SKILL.md`, in the `create_tool` description, in `codeNodeValidation.ts` comments, and in the team's `cognigyCodeDev.md`. Pick one canonical text and generate or check the others (this is what the drift guard is for).

---

## Scenario: tracking upstream (Phase 0 maintenance strategy)

**Facts.** Upstream releases on every merge to `main` via semantic-release; eight minor versions shipped between 2026-07-31 and 2026-09-08. The local branch is one fix behind (1.15.1, proxy support, 20 files including a new `src/utils/proxy.ts`). `handlers.ts` is 6,600 lines and every upstream change touches it, so rebase conflicts will concentrate there.

**Working rules that fall out of the code:**

- Keep fork-only logic in **new files** under `src/tools/` (as `codeNodeValidation.ts` did) and touch `handlers.ts` only at call sites. Conflicts then stay small.
- Never edit `CHANGELOG.md`, `package.json` version, or the six manifests by hand; semantic-release owns them (`docs/COMMIT_AND_CHANGELOG_GUIDE.md:150-153`). A fork that publishes its own package needs its own release config or must run the sync script manually.
- Run `npm run check:manifest`, `npm test`, `npx tsc --noEmit` after every rebase; `snapshotToolSurface.test.ts` and `packageToolSurface.test.ts` are the tests most likely to catch a tool/definition mismatch after a merge.
- Rebase cadence: weekly is realistic given upstream velocity; monthly means multi-version jumps through `handlers.ts`.
- Anything that removes a platform limitation (base64 download, `create_flow`) is a candidate to send upstream so it stops being fork maintenance. Anything that encodes an NA PS standard (Task node naming rule, reporting-node requirement) probably stays fork-only unless offered as an opt-in.

---

## Scenario: how does a team member run the fork? (Phase 0 installation strategy)

Every manifest launches `npx -y -p cognigy-engine@npm:@cognigy/plugin-engine@1.15.0 cognigy-mcp` - the _published upstream_ engine. The fork's engine code runs nowhere until one of these is chosen:

| Option                                             | How                                                                                                                                                         | Fits                                                                 |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Local dev marketplace                              | `npm run plugin:dev` (Claude Code only, runs `src/index.ts` via tsx from the checkout)                                                                      | developers of the fork, not the team                                 |
| Internal npm package                               | publish `@nice/cognigy-plugin-engine` (or scoped equivalent) to an internal registry; change the alias pin in the six manifests; publish a fork marketplace | the team, all platforms, keeps auto-update story                     |
| GitHub-hosted marketplace pointing at a local path | manifests `command: node`, `args: [<path>/dist/index.js]`; each user clones and builds                                                                      | small pilot, breaks the "no local path" rule the maintainer enforces |
| Per-project MCP registration                       | each user adds an `mcpServers` entry pointing at their clone                                                                                                | zero packaging, no skills/agents, no updates                         |

The roadmap's Phase 0 "Installation Strategy" is this table. Note the installed `cognigy` server on this machine still exposes `read_guide`, so the pilot team's baseline is likely a pre-1.1 engine; measure the upgrade to 1.15.x before measuring the fork.

---

## Scenario: QA reachability and the eval agent (Phase 3 / Future)

The pieces that exist: `manage_packages export` produces the exact zip `cognigy-build-qa-auditor`'s `extract_build.py` consumes; `voiceChecklist.ts` shows the check-id / status / autoFixable / fix-payload shape for an in-plugin audit; `agent-red-team` shows a findings JSON schema and report template pattern. The piece that is missing is transport: the export lands on the engine host's disk. Sequence is therefore base64 download first, then an `audit_build` style tool or skill that runs the QA checks over the archive, then (much later) automated test-case execution, which depends on whether Cognigy exposes a simulation API (not visible in the ~45 routes the plugin uses today).

---

## Scenario: FRD/Design-to-Bot prerequisites (Phase 5)

Reading the plan against the code, the hard dependencies are: `create_flow` (for multi-flow builds), the three reporting node types in the registry, an LLM Prompt node if the design uses it, the initiation-flow pattern documented and permitted by the "no nodes before the Job node" rule, and a compliant Code Node template (exists now). Everything else Phase 5 needs (`create_ai_agent`, `create_tool` with all five types, `manage_webchat`/`manage_voice_gateway`, `setup_llm`, `manage_knowledge`) already exists. The parsing side (FRD in) has no plugin dependency at all and can start any time.

---

## Scenario: testing a change locally

`npm ci && npm run build`; `npm test -- --runInBand` (Jest, ESM via `node --experimental-vm-modules`); `npx tsc -p tsconfig.json --noEmit`; `npx prettier --write` on changed files; `npm run check:manifest` if manifests changed. For a live check in Claude Code: `npm run plugin:dev` swaps the installed plugin for a `.dev-plugin/` marketplace running from source; `npm run plugin:dev:off` swaps back. `integration.test.ts` is `describe.skip` and never runs, so every live-API behavior (node config shapes, `mode: "prepend"` on an empty flow, the snapshot cap) has to be validated by hand against a Cognigy instance.
