---
name: contribute
description: "Use when changing the NiCE Cognigy Plugin itself: adding or editing a plugin skill, an agent, an MCP tool or tool operation, a tool or field description, a _hints action or a server-instructions rule, or when a feature request arrives as a workflow description and it is unclear where it belongs. Not for using the plugin against a Cognigy tenant."
---

# Contribute to the Cognigy plugin

The plugin has two layers. Skills and agents (`plugin/skills`, `plugin/agents`) teach the workflow. The MCP engine (`src/`) executes it. Users reach every capability through a skill, so start from the user's workflow, not from the API endpoint.

`.claude/CLAUDE.md` holds the architecture and the hard-won platform gotchas (flow chart model, environments, audit attribution). Read the parts your change touches.

## 1. Pick the dev skill

| The change | Use |
| --- | --- |
| A plugin skill, agent, tool, tool operation, description, `_hints` action or instructions rule | this skill |
| An eval case, grader, mock or baseline, and the check after any skill, agent, description or behaviour change | `add-eval`, after this skill (section 6) |
| A new AI client or IDE the plugin installs into | `add-client-platform` only. Skills and tools reach every client without changes. |
| Installer, config, proxy or release scripts for existing clients | neither. Follow `.claude/CLAUDE.md` and run the tests. |

## 2. Decide where each piece goes

| What you are writing | Where it goes |
| --- | --- |
| Steps, order, prerequisites, platform gotchas, wording for the user | plugin skill body |
| When the skill should load: the user's words and synonyms | skill `description` |
| What a tool does and does not do, one clause per operation, what it returns, irreversibility | tool `description` in `src/tools/definitions.ts` |
| Meaning, range, default and example of one field | field `description` |
| What to do next after one specific result (offer a backup, poll a task, show a URL, retry) | `withHints(result, { action })` in the handler |
| A rule where a miss can't be undone or misleads the user | `src/instructions.ts`. Rare, and capped at 2,000 chars. |
| A guard that must hold even when no skill is loaded | code: refuse or hold the call |
| A long multi-step job that should run in its own context and return a summary | agent `plugin/agents/<id>.md` |

Order of preference:

1. **Extend an existing skill.** Add a new skill only for a new user intent. There is no one-skill-per-tool rule.
2. **Extend an existing tool.** Add an operation before you add a tool, and add a tool only for a new domain. There are 22 tools, most of them dispatchers with an `operation` field. Fewer tools mean better tool choice.
3. **A next step goes in the hint, not the skill.** A hint fires exactly after the result it belongs to, in every client. The skill names it only when the step needs workflow context the hint can't carry.
4. **Enforce in code what must hold.** The Claude Desktop connector loads no skills, and evals run without `src/instructions.ts`. If a miss is irreversible or leaves broken state, the handler enforces it. Examples: the backup gate holds the first change with `backup_not_offered`, and deleting a brand persona that agents still use is refused with `persona_in_use`.

## 3. Write or change a plugin skill

- **Location:** `plugin/skills/<id>/SKILL.md` with `name` (the folder id) and `description` frontmatter. There is no registry. Claude Code, Codex and Cursor read the folder, and `scripts/copy-assets.mjs` ships it to Antigravity.
- **The description is the trigger, not a summary.** Start with "Use when the user...". Use the user's words and every synonym they use. `s2s-demo` lists "speech-to-speech (S2S, also called voice-to-voice or V2V)". Name what the skill does not cover when a neighbour skill does. Stay under 1,024 chars.
- **The body is the workflow.** Steps in order, the tool and operation per step, preconditions, and the gotchas the model can't infer. Don't restate a tool's contract, the model already sees it. Don't repeat the hard rules from `src/instructions.ts`.
- **Product terms in user-facing text.** "AI Agent", "legacy AI Agent", "speech-to-speech". Old or internal names go into the description as synonyms only.
- **A skill named in a tool description or in `src/instructions.ts` must exist.** `toolSurfaceBudget.test.ts` checks every "`<id>` skill" reference.
- **Agents** (`plugin/agents/<id>.md`): `name`, a `description` that says when to delegate and what comes back, and `skills:` to preload. A subagent can't ask the user. Its body says what to do when something is missing (stop and return), and the main thread names the environment in its prompt.

## 4. Add or change a tool

| File | Role |
| --- | --- |
| `src/tools/definitions.ts` | The LLM-facing contract: name, description, annotations, JSON Schema |
| `src/schemas/tools.ts` | Zod schema, parsed at the top of the handler |
| `src/tools/handlers.ts` | `handle<Name>(args)` plus a `case` in `handleToolCall()` |
| `src/tools/filters.ts` | `filterResponse(kind, obj)` strips internal fields; add a kind for a new resource type |
| `src/__tests__/` | `schemas.test.ts`, `tools.test.ts` or a file per tool, with a mocked `CognigyApiClient` |
| `README.md` | The Tools table, for a new tool only |

Templates: `${CLAUDE_SKILL_DIR}/templates/definition.ts`, `schema.ts` and `handler.ts`. Read the closest existing tool too, it beats the template.

1. **Requirements.** Operations, the endpoint per operation (method and path), required and optional fields.
2. **Definition.** The description is a contract: 3 to 6 sentences, at most 1,000 chars, no numbered steps. Field descriptions at most 450 chars. Put enum meaning in the description, the values are already in `enum`. `toolSurfaceBudget.test.ts` enforces the caps. When it fails, move prose to the skill or a hint instead of raising the cap.
3. **Zod schema.** A discriminated union on `operation` for multi-operation tools. Validate IDs in the shape the API uses: `idSchema` for 24-char hex ids, `z.string().uuid()` for AI Agent reference ids. Keep the JSON Schema and Zod in step: same enums, same fields required by every operation, and `null` allowed in both or in neither. A multi-operation JSON Schema stays flat with only the shared fields in `required`. Each Zod branch enforces its own operation's fields, and the field description says which operations need it ("Required for ..."). The model only sees the JSON Schema, and only Zod runs.
4. **Handler.**
   - Call the Cognigy API only through `this.apiClient`. It adds the API key, retries, proxy support and the audit-attribution header. A caller-supplied or external URL (an agent's endpoint, an A2A agent card) uses bare `axios` with `getProxyAxiosOptions(url)` instead, so the Cognigy key never goes to another host. `talk_to_agent` and `checkA2AAgentCard` show the pattern.
   - Return filtered results, and attach the next step with `withHints`.
   - Classify the tool for the backup gate: `BACKUP_WORTHY_TOOLS` in `handlers.ts` if it changes an existing agent or project, otherwise read-only or listed as exempt with a reason. `snapshotToolSurface.test.ts` fails until you decide.
   - Never assume the newest platform. Probe a feature-flagged or release-gated feature (`probeCapabilities` in `src/tools/agentsV2.ts`, reported by `check_capabilities`), or degrade in the handler. On an older platform return a clear result with a hint, never a raw 400 or 404.
   - Mirror what the Cognigy UI requires, not only what the API requires. If the UI can't save a resource without a field, the plugin sets a sensible default (new AI Agents get a brand persona).
5. **Wire it into a skill** (section 3). Usually an existing skill gains a step.
6. **Tests.** Schema: valid input, missing fields, bad ids, every operation. Handler: the right endpoint and payload per operation, the error paths and the hints.

## 5. Check against a real tenant

Unit tests and eval mocks only show what their author assumed. Before the PR, run `npm run plugin:dev`. It points the plugin at your working tree: the engine runs from `src/`, and skills and agents are copied. Without it, Claude Code runs the installed release and you test nothing you changed. Then run the changed workflow once on a real test tenant, interactively or with a headless `claude -p`. `npm run plugin:dev:off` restores the release.

- Response shapes and field projections. `GET /chart/nodes` returns each node type's defaults, not the stored config.
- Paging per endpoint: `skip`, `offset` or `page`/`pageSize` differ.
- Open what the plugin created in the Cognigy UI and save it once.
- Name test resources so they are easy to find and delete afterwards.

## 6. Hand off to add-eval

Follow `add-eval` when you changed a plugin skill, an agent, a tool or field description, or tool behaviour that the mock tenant in `plugin/evals/mocks/platform/_server.md` describes. A new tool always needs it: add it to `tools:` in `_server.md` and run `npm run evals:tools`. Evals make paid model calls, so ask before a full run. Engine changes that leave descriptions and behaviour unchanged need no evals.

## 7. Verify and ship

```bash
npx tsc -p tsconfig.json --noEmit
npm test -- --runInBand
npm run lint
npx prettier --write <changed files>   # .prettierignore skips skills and evals on its own
npm run check:manifest                 # only when a plugin manifest changed
```

- Conventional Commits. `feat`, `fix`, `perf`, `refactor`, `docs` and `revert` cut a release (`.releaserc.json`), `chore`, `test`, `build` and `ci` don't. Anything under `src/` or `plugin/` ships, so it takes a release type, an internal refactor included (`refactor`). Only changes outside the shipped package (dev skills, tests, CI) use `chore`, `test`, `build` or `ci`.
- Never bump a version by hand. semantic-release sets the plugin and engine version together.

## Common mistakes

| Mistake | Fix |
| --- | --- |
| A new tool for something an existing tool's domain covers | Add an operation |
| Workflow steps in a tool description | Move them to the skill |
| "Next step" advice in a skill that only applies after one specific result | A `_hints` action |
| A must-hold rule only in prose | Enforce it in the handler |
| A skill description that summarizes the workflow | List the triggers and synonyms |
| Verified only against mocks | Run it once on a real tenant and open it in the UI |
| A skill or description change without evals | `add-eval` |
