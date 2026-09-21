# Playbook: Contribution and Change Patterns

_How to make a change to the AI COE Cognigy Plugin fork without creating maintenance debt. Destination: `docs/ai-coe/playbooks/Contribution-and-Change-Patterns.md` (committed to the repo)._

\*Written 2026-09-16 from the first contribution's outcome plus measured conflict data. Line numbers are as of upstream v1.15.0 and will have moved - `src/tools/handlers.ts` grew ~1,000 lines by v1.18.0. **Locate code by symbol, not by line number.\***

---

## Why this document exists

The fork's first contribution (`030e9c6`, "enforce Cognigy Code Node best practices at write time") was made without a map of the codebase. It cost 9 files for one rule, put fork logic in the repo's worst merge-conflict file, and 14 days later no longer rebased cleanly. Meanwhile upstream adopted 2 of its 8 checks and downgraded both from blocking to advisory.

None of that was avoidable knowledge at the time. All of it is now. This playbook is the map.

---

## 1. The six layers, and which three can actually stop anything

| Layer             | File                                                       | Runs when                                                                                                                 | Can refuse a write?                   |
| ----------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Always-on prose   | `src/instructions.ts` (43 lines, MCP `instructions` field) | every session, **every client**                                                                                           | No                                    |
| Skill prose       | `plugin/skills/<id>/SKILL.md` (15 skills)                  | when the client's skill loader matches intent. **Does not load in Claude Desktop chat** without the in-app plugin install | No                                    |
| Tool descriptions | `src/tools/definitions.ts`                                 | every session, part of the tool list                                                                                      | No                                    |
| Schema validation | `src/schemas/tools.ts` (Zod)                               | every call, before the handler                                                                                            | **Yes**                               |
| Handler logic     | `src/tools/handlers.ts`                                    | every call                                                                                                                | **Yes**                               |
| Node registry     | `src/tools/nodeRegistry.ts`                                | on `manage_flow_nodes create`                                                                                             | **Yes** (unknown `nodeType` rejected) |

**The rule that follows:** advisory guidance goes in prose; anything you cannot afford to have ignored must be code. Most AI COE standards are non-negotiable, which is why they cannot live in skills.

**The trap:** skills are the _natural_ place to put standards and the _only_ layer that both cannot enforce and does not load everywhere.

### How a call actually flows

```
client CallTool
  → src/index.ts            rate limit (100/60s per API-key prefix), open audit task id
  → handleToolCall          BACKUP GATE decides whether to hold the call
  → switch (toolName)       routes to handleXxx
  → schemas.xxxSchema.parse(args)
  → Cognigy REST API
  → JSON result, optional _hints
```

The backup gate is the precedent worth knowing: a single pre-dispatch interception point in `handleToolCall` that can refuse any mutating call. It is where fork-wide enforcement belongs.

---

## 2. Conflict cost is not uniform - know before you edit

Measured across upstream releases `v1.12.0..v1.18.0`:

| File                                          | Upstream touches                                                                   | Fork's experience                                                                                | Verdict                                                                                      |
| --------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `src/tools/handlers.ts`                       | **9 commits - most-touched file in the repo.** Grew 6,539 → 7,553 lines in 14 days | Fork inserted an import plus 6 small regions at call sites. **Auto-merged cleanly onto v1.18.0** | **Safe to insert into.** Never rewrite a `handleXxx` function                                |
| `src/tools/definitions.ts`                    | 6 of 7 releases                                                                    | 1 conflict, prose                                                                                | Frequent, cheap. Resolve by reading both and writing one                                     |
| `src/schemas/tools.ts`                        | 5 of 7 releases                                                                    | **4 of 5 conflicts**                                                                             | **Avoid.** See below                                                                         |
| `src/__tests__/tools.test.ts`                 | 7 of 7                                                                             | auto-merged                                                                                      | Append-only collisions, keep both                                                            |
| `src/tools/nodeRegistry.ts`                   | 1 in window (+42 in v1.16.0)                                                       | none yet                                                                                         | Independent object keys usually merge. **Check upstream has not already shipped your entry** |
| 6 manifests + `package.json` + `CHANGELOG.md` | every release                                                                      | n/a                                                                                              | **Never hand-resolve.** Take upstream's, re-run our release automation                       |
| `.releaserc.json`, `scripts/`                 | 2-3 in window                                                                      | n/a                                                                                              | Underrated. Upstream changes its own release machinery                                       |
| `.github/`                                    | **0 in window**                                                                    | n/a                                                                                              | Stable                                                                                       |

### Why `schemas/tools.ts` is the trap

The conflict there was structural, not textual. Upstream's v1.16.0 LLM Prompt work appended `.refine()` chains to `updateToolSchema` for `aiAgentId`/`flowId` addressing. The fork appended a `.superRefine()` to the same chain for code validation. Both attach to the tail of one zod object. **Git cannot merge two tail-appends to the same chain.**

Resolution is mechanical (keep both refines, re-read the combined chain, run that schema's tests) but it recurs every time upstream touches the same schema. Enable `git config rerere.enabled true` so you resolve it once, and `git config merge.conflictStyle zdiff3` so you can see the common ancestor.

---

## 3. The five change types

### 3.1 Add an enforced rule (the common case, and the one that went wrong)

**Do not** hand-wire it. Once the policy layer exists (see the Policy Layer Architecture brief), a rule is one file in `src/policy/rules/` and zero upstream files.

**Until then, if you must:** new logic in a new file under `src/tools/`, wired only at call sites in `handlers.ts`. Never in `schemas/tools.ts`.

Evidence this works: `codeNodeValidation.ts` (new file, 268 lines) and its `handlers.ts` call sites both survived a 14-day rebase untouched. Only the `schemas/tools.ts` half conflicted.

### 3.2 Add a tool

Three insertions into upstream files are unavoidable - that is how dispatch works:

1. one object in `src/tools/definitions.ts`
2. one schema export in `src/schemas/tools.ts` (a **new export**, not an edit to an existing chain - this is safe)
3. one `case` in the `handleToolCall` switch

Everything else goes in a fork-owned module under `src/tools/`, following upstream's own extracted-module pattern (`packageManagement.ts`, `snapshotManagement.ts`, `voiceChecklist.ts`, `webchatSettings.ts`).

Also required: a skill or skill section, tests, and `snapshotToolSurface.test.ts` classification.

Upstream documents their canonical path in `.claude/skills/add-tool/SKILL.md`. Follow it - it makes the diff look like their work, which matters if the tool is ever PR'd.

**Record every fork-added tool in the decisions ledger.** It is permanent divergence in three upstream files and the next maintainer needs to know it is ours.

### 3.3 Add a node type

One entry in `src/tools/nodeRegistry.ts`. Config keys must be known first - they are not derivable from the repo, so get them from `manage_flow_nodes get` on a real node or from a package export.

**Check upstream first.** v1.16.0 shipped an `llmPrompt` entry (type `llmPromptV2`, 30 config keys, only `prompt` required) - a fork roadmap item delivered upstream. Two entries for the same node merge cleanly into broken code, and a generic upstream entry will silently loosen a stricter fork one.

### 3.4 Change guidance only

Skill prose, `instructions.ts`, or a tool description. Cheap, but remember: it cannot enforce, and skill prose does not reach Claude Desktop chat.

Once skill prose about enforced rules is generated from the policy registry, **do not hand-edit those sections** - edit the rule and regenerate.

### 3.5 Ingest an upstream release

See the maintenance strategy for the full rebase runbook. The pattern that matters here is in section 4.

---

## 4. The core pattern: wrap upstream, never edit it

When upstream ships its own version of something we already do, **call their code, do not replace or edit it.**

The live case: upstream branch `origin/fix/code-node-platform-constraints` reimplements the fork's Code Node validation as `src/tools/codeNodeHints.ts` - 61 lines instead of 268, non-blocking hints instead of a write-time gate, no `schemas/tools.ts` change, and wired into `create_tool` and `update_tool` pre/post-process code that the fork never covered.

The right ingestion:

- Take `codeNodeHints.ts` **whole and unmodified**, so it never conflicts again.
- Take their wider call-site coverage as a straight gain.
- Have our policy registry **call** their function, register its output as findings, add the six rules they dropped, and set our own severity (block, where they hint).

Result: 100% adoption of upstream plus 100% retention of our behavior, and no hybrid file to re-resolve on every rebase.

**Why this matters generally:** "don't overwrite our work" and "don't drift" are in tension only while our work lives inside their files. Once our work lives in our own files, both are satisfiable at the same time.

**The exception:** upstream _removing_ something we depend on. v1.17.0 dropped Gemini CLI support entirely. That is a legitimate "take the release but not that commit" case. Handle it by exception and record it; do not let it become the default habit, because selective adoption is itself how drift accumulates.

---

## 5. Enforcement collides in both directions

Worth checking on every change, because both have already happened.

**Upstream blocking us.** `nodeRegistry.ts` refuses unknown node types, so a standard requiring a Task or Overwrite Analytics node is simply impossible until the registry entry exists. The handler's `requiredConfigKeys` check behaves the same way. And v1.15.0's "validate and normalize tool parameter schemas" (#39) means upstream now _rewrites_ tool parameters - if a standard specifies a shape their normalizer changes, they win silently.

**The fix is almost always additive:** add the capability (a registry entry), do not loosen their check. If you find yourself wanting to weaken an upstream gate, stop - that means editing their logic and owning that edit forever. Escalate it as a deliberate decision, not a resolution step.

**Us blocking upstream.** `plugin/skills/tools-setup/SKILL.md`'s inline code examples fail the fork's Code Node gate, so the plugin's own shipped guidance produces calls its own engine rejects. Every new gate risks this. Upstream adds 200-600 lines to `tools.test.ts` per release, so new non-compliant fixtures will keep arriving.

**Check on every gate you add:** does any shipped skill example, test fixture, or tool description now describe something this gate refuses?

---

## 6. What upstream will and will not accept

From the first contribution's outcome, 8 checks submitted:

| Check                                                | Fork severity     | Outcome                         |
| ---------------------------------------------------- | ----------------- | ------------------------------- |
| `api.httpRequest` / `require` / `import` unavailable | blocking          | **adopted**, downgraded to hint |
| `fetch` / `XMLHttpRequest` unavailable               | blocking          | **adopted**, downgraded to hint |
| Removed `api.setState/getState/resetState`           | part of allowlist | **adopted** as its own hint     |
| Mandatory try/catch + required error fields          | blocking          | dropped                         |
| Full `api.*` allowlist                               | blocking          | dropped                         |
| `deleteContext` nested path                          | warning           | dropped                         |
| Direct context assignment                            | warning           | dropped                         |
| `var` usage                                          | warning           | dropped                         |
| Size / api-call ceilings                             | warning           | dropped                         |
| Schema-level pre-write rejection                     | the gate          | **rejected outright**           |

**The filter, stated plainly:** upstream kept every rule that states **what the platform cannot do**, and dropped every rule that encodes **how we think code should be written**.

That is rational from his position - he ships one universal build to seven client platforms, and a gate that refuses a write is a support ticket from a user who never asked for our standards.

**So classify at authoring time.** Platform fact → PR candidate, and note that he will likely take it _and widen it_. House opinion → fork-only, do not spend the PR effort. Record the classification on the rule so the monthly upstream sweep has something to sweep and nobody re-decides it.

**And note what he adds.** He does not merely subtract: his version covered call sites ours missed and rewrote tool descriptions to carry the runtime rules inline. Treat an upstream rework as a source of improvements, not just a rejection.

---

## 7. Practical gotchas that cost real time

- **PR titles must be conventional commits.** PRs are squash-merged, so the title becomes the commit on `main` that `semantic-release` reads for the version bump. `pr.yml` lints the title separately from the commits, and re-lints on `edited`.
- **`commitlint`** extends `@commitlint/config-conventional` with `body-max-line-length: 200`. Enforced by `.husky/commit-msg`.
- **Line endings.** There is no `.gitattributes` and `core.autocrlf` is unset. The working tree can show ~125 modified files that differ _only_ LF-versus-CRLF. A rebase cannot start from a dirty tree, and `.husky/pre-commit` runs `prettier --check` on staged files, which CRLF fails. Fix this once with a `.gitattributes`; it is also a good upstream PR.
- **The engine alias pin is load-bearing.** Manifests must use `<alias>@npm:<package>@<version>`, never a bare spec. A bare spec makes `npm exec` treat the repo's own `package.json` as satisfying the pin when a session is rooted in the repo, skip the install, and fail with `cognigy-mcp: command not found` (MCP error `-32000`). `scripts/check-plugin-manifest.mjs` enforces this in pre-commit and CI.
- **Pre-commit only guards two manifests.** `.husky/pre-commit` runs the manifest check only when `plugin/.claude-plugin/` or `plugin/.codex-plugin/` files are staged. The spec and Cursor manifests are unguarded locally; CI catches them.
- **Never hand-edit** `CHANGELOG.md`, `package.json` `version`, or the six versioned manifests. `semantic-release` owns them via `.releaserc.json`.
- **`npm test` is slow.** It did not finish within 175 seconds on the dev machine. Budget for it; measure it properly.
- **Two ID systems.** `_id` is a 24-hex Mongo id; `referenceId` is a UUID used by all cross-resource pointers (`flowId` in endpoints, `llmProviderReferenceId`, `knowledgeStoreReferenceId`, `localeId`). Anything handing ids between tools should return both.

---

## 8. Pre-promotion checks

_Starting point. This graduates to `docs/ai-coe/runbook/Promotion.md` once `npm run preflight` exists and we know what it prints._

Before promoting anything to the fork's release branch:

1. **Working tree clean.** If `git status` shows ~125 files, line endings were never normalized.
2. **`npm run build`** passes (tsc).
3. **`npm test`** passes.
4. **`npm run check:manifest`** passes - version field and every manifest pin agree.
5. **`prettier --check`** passes on changed files, or pre-commit blocks you.
6. **Policy coverage guard** passes - every rule has a negative-path test. _(Does not exist yet; see the Policy Layer brief.)_
7. **Attachment assertion** passes - a call through `handleToolCall` with non-compliant input is actually refused. _(Does not exist yet.)_ This is the check that catches an upstream refactor silently disabling a gate.
8. **Bidirectional collision check** (section 5): does this change block something our standards need, or does any shipped example now violate a gate we added?
9. **Upstream base recorded** and consistent with `HEAD`'s highest upstream ancestor tag.
10. **Ledger updated** - any new fork-owned tool, rule, or declined upstream change, with its reason, its upstream-worthiness classification and its retirement condition.
11. **Upstream-worthiness sweep** - anything classified platform-fact-not-yet-submitted goes on the list for the monthly batched PR.

---

## 9. Related documents

- `docs/ai-coe/architecture/01-Architecture-and-Terminology.md` - the layer table and the "no home for enforced rules" finding
- `docs/ai-coe/architecture/04-Limitations-and-Roadmap-Considerations.md` - Bucket B (no validation dispatch), missing negative-path tests, the `tools-setup/SKILL.md` drift
- `ai-coe-workspace/strategy/` - maintenance strategy (cadence, rebase runbook, conflict measurements) and installation strategy
- `ai-coe-workspace/decisions/` - the ledger
- Policy Layer Architecture brief - the design that makes section 3.1 a one-file change
