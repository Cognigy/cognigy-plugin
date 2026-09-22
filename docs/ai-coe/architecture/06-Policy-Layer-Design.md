# Design: The AI COE Policy Layer

_Design of record for how the fork declares and enforces AI COE standards on top of the NiCE Cognigy Plugin. Written 2026-09-21. Supersedes the proposal sketched in `BRIEF-Policy-Layer-Architecture.md` §4._

**Repo:** `C:\Users\jamiea\sandbox\ai-coe-plugin\cognigy-plugin`
**Upstream at time of writing:** `v1.20.0`, released 2026-09-21 09:02 UTC
**Fork branch:** `fix/code-node-development-best-practices`, one commit (`030e9c6`) on a `v1.15.0` base

---

## 0. How to read this

Sections 1 and 2 restate the problem after re-measuring it, because several of the brief's facts moved between 2026-09-16 and today. Section 3 is the design. Section 4 is the decision register - every open question from the brief, the call made, and the alternative rejected. Sections 5 through 8 are test strategy, build sequence, risks, and the acceptance check.

An implementer can start at section 3 and use section 6 as the running order. Section 1 exists so nobody re-derives the corrections.

Every factual claim here was measured against the repo on 2026-09-21, and the document was then put through an independent adversarial review against the same repo, which found six factual errors and two unresolved design holes. All are corrected in place. Where a claim rests on something that could plausibly change under the reader, the verification method is stated inline so it can be re-run rather than trusted.

---

## 1. What changed since the brief

The brief was written on 2026-09-16 against upstream `v1.18.0`. Five of its load-bearing facts are now different. All were re-measured on 2026-09-21.

### 1.1 Upstream shipped its competing Code Node implementation

`src/tools/codeNodeHints.ts` was merged as PR #45 and released in **v1.19.0**. The brief had it as an unmerged branch (`origin/fix/code-node-platform-constraints`) and called it "the imminent case". It has landed.

It covers four rules that overlap the fork's POC:

| Upstream rule                      | Fork POC equivalent      | Upstream severity |
| ---------------------------------- | ------------------------ | ----------------- |
| `api.httpRequest()`                | `checkNoHttpOrModules`   | hint              |
| `fetch()` / `XMLHttpRequest`       | `checkBannedBrowserApis` | hint              |
| `require()` / `import`             | `checkNoHttpOrModules`   | hint              |
| `api.setState/getState/resetState` | `checkApiAllowlist`      | hint              |

Upstream's implementation is better than the fork's in one specific, important way: `executableOnly()` blanks comments and string/template literal contents before pattern matching. The fork's `codeNodeValidation.ts` matches against raw source, so a rule name appearing inside a string or a comment produces a false positive. Upstream fixed a bug the fork still has.

Upstream also wired it at the **handler** layer, not the schema layer. That is independent corroboration of the dispatch decision in §3.4.

### 1.2 Conflict cost roughly tripled, then became irrelevant

Rebase probe re-run against both tags (scratch clone, `030e9c6` onto target):

| Target    | Conflicted files                                                                                         | Blocks |
| --------- | -------------------------------------------------------------------------------------------------------- | ------ |
| `v1.18.0` | `schemas/tools.ts` (4), `definitions.ts` (1)                                                             | **5**  |
| `v1.20.0` | `schemas/tools.ts` (4), `definitions.ts` (5), `handlers.ts` (5), `plugin/skills/flow-nodes/SKILL.md` (1) | **15** |

The brief's 5-block measurement was correct for v1.18.0. The jump to 15 is caused by upstream building the same feature in the same places, not by any new structural mistake in the fork.

This is now largely moot: the POC commit is being dropped (§2), which removes the conflicts with it. It is recorded because it is the clearest available evidence for the thesis the design rests on, and because it quantifies what the fork pays when it puts enforcement inside upstream constructs.

### 1.3 The dispatcher is the most stable surface in the repo

`handleToolCall`'s body is **byte-identical** between the fork's `v1.15.0` base and upstream `v1.20.0`, verified by diff. Over the same span `handlers.ts` grew from 6,539 to 7,769 lines.

Locate it by symbol, never by line. The brief's `handlers.ts:6517-6604` is the **fork HEAD** range, not v1.15.0 - `030e9c6` adds 71 lines to `handlers.ts` above it. The `Main dispatcher` marker sits at line 6446 at v1.15.0, 6515 at fork HEAD, and 7676 at v1.20.0. Note also that `handleToolCall` is a **method of the `ToolHandlers` class**, not a top-level export, so `grep -n "^export async function handleToolCall"` finds nothing. Search for `Main dispatcher` or `backup_not_offered`.

### 1.4 `NODE_REGISTRY` has exactly one consumer

`NODE_REGISTRY` is referenced nowhere outside `src/tools/nodeRegistry.ts`. Its only readers are two exported helpers in that same file:

```ts
export function getNodeEntry(nodeType: string): NodeRegistryEntry | null;
export function supportedNodeTypes(): string[];
```

and those are imported by exactly one file:

```ts
// src/tools/handlers.ts:27
import { getNodeEntry, supportedNodeTypes } from "./nodeRegistry.js";
```

This single chokepoint is what makes §3.7 possible without touching `nodeRegistry.ts` at all. The brief proposed a spread into the `NODE_REGISTRY` literal; that turns out to be the worse option, for the reason given in §3.7.

### 1.5 The line-ending problem is already fixed

The brief warned that ~126 files differed only by CRLF and that a rebase could not start from that tree. A `.gitattributes` was added on 2026-09-17 and `git diff --numstat` is now empty. That warning is stale.

What _is_ true, and matters for the build sequence: **ten files are staged but uncommitted**, including all of `docs/ai-coe/`. A rebase cannot start from this index. See §6 step 0.

### 1.6 Bonus finding: the installed plugin is far behind, and its two halves disagree

Fingerprinting a live Cowork session against every tag produced two results that do not reconcile, and the disagreement is itself the finding.

**The skill bundle dates confidently to v1.1.0 - v1.3.1** (released 2026-06-26 to 2026-07-04). The session exposes exactly the 11 skill names those tags carry, and the `flow-nodes` and `llm-providers` descriptions match that window's text verbatim and no other window's.

**The engine's tool surface dates to v1.0.1 - v1.0.3 or earlier.** The session exposes `read_guide`, which exists _only_ at v1.0.1-v1.0.3 and was removed before v1.1.0. It does _not_ expose `audit_voice_agent` (present from v1.1.0) or `manage_snapshots` (present from v1.12.0). But v1.0.1-v1.0.3 ship **no `plugin/skills/` directory at all**, so they cannot be the source of the 11 skills.

These cannot be one install. The most likely explanation is two: an in-app plugin install supplying the skills, and a separately configured MCP server entry supplying the tools, pinned at different versions. **This needs a direct check** - read the installed plugin version and any hand-configured MCP server entry on the machine - before the number is quoted anywhere. What is safe to state without further work is the direction and the order of magnitude: the tooling in daily use is roughly twenty releases behind upstream's v1.20.0, and its components are not even in step with each other.

This resolves the brief's §3.7 question, though not in the way it was framed. Skills _do_ load in the Claude desktop app - Anthropic's plugin documentation states that plugins work in web chat, the Desktop Chat tab, and Cowork, and that "the skills bundled in a plugin work across all three", and this was confirmed directly by 11 Cognigy skills being live in a Cowork session. The brief's inference was correct.

But the practical answer is unchanged, and the reason is stronger than the one the brief anticipated. Skills are not an unreliable _loading_ surface; they are an unreliable _currency_ surface. A standard shipped as skill prose reaches a user only when that user updates, nothing tells them they are stale, and as this install shows, "updated" is not even a single state. See §7 R1.

---

## 2. Scope and premise

### 2.0 Why enforcement is fork-only

Stated here so that a reader arriving fresh does not spend a cycle wondering whether any of this should simply be contributed upstream.

The fork's purpose is to make the plugin **enforce** AI COE and NA PS standards. Upstream's purpose is to make the plugin work for everyone. Those goals diverge at exactly the point where a rule refuses a write, and upstream has been explicit in practice: of the eight checks in the fork's first contribution, two were adopted, **both were downgraded from blocking to advisory, and the blocking mechanism itself was rejected outright**. v1.19.0's `codeNodeHints.ts` is the same pattern at larger scale - four overlapping rules, all shipped as hints that never gate a write (§1.1).

Enforcement is therefore permanently fork-only, and the problem the layer solves is that the codebase has no home for it. Per the project's own architecture review: adding an enforced rule that must run for many tools has no home, because there is no general "validate this node's content" dispatch. The POC demonstrated the cost - one rule, nine files.

This does not mean nothing goes upstream. Rules marked `kind: "platform-fact"` (§3.3) state what the platform cannot do, which is the category upstream demonstrably accepts. Those are PR candidates. Rules marked `house-opinion` encode how the team thinks code should be written, which is the category upstream demonstrably rejects. Those stay.

### 2.1 The reset

Per the decision taken on 2026-09-21: **the fork's Code Node work is a proof of concept, not source of truth.** The sequence is:

1. Rebase the fork onto current upstream.
2. Remove the POC Code Node changes entirely. Adopt upstream's `codeNodeHints.ts` as-is.
3. Build the policy layer on that clean base.
4. Re-author the NA PS Code Node standards as policy rules, on the new framework, in a later session.

This session defines **how the fork enforces its standards going forward**. It is not a migration plan for `030e9c6`.

Two consequences worth stating plainly:

**The fork resets to zero.** `fix/code-node-development-best-practices` is exactly one commit on top of `v1.15.0`. Dropping it leaves the fork byte-identical to upstream. The policy layer is greenfield, on a clean base, with no inherited conflicts. That is the best possible starting position and it will not come around again.

**The standards survive; the implementation does not.** `codeNodeValidation.ts` is deleted. The eight checks it encodes are not ported - they are re-derived from the NA PS `cognigyCodeDev` source when they are re-authored as rules. This matters because at least one of them (the raw-source matching noted in §1.1) is known to be wrong, and porting would carry the bug forward.

### 2.2 What the policy layer is for

One fork-owned place to declare and enforce AI COE standards, such that:

- Adding an enforced rule touches one fork-owned file and zero upstream files.
- Fork code never sits inside an upstream construct that upstream also appends to.
- Enforcement cannot be silently lost by an upstream refactor.
- Rules carry their own provenance, PR-candidacy, and retirement condition.

### 2.3 What it is not

Not a replacement for upstream checks. Not a linter. Not a place for advisory guidance that belongs in prose. Not a per-platform mechanism - the fork ships one universal build, so everything here lands on every host the fork supports.

---

## 3. The design

### 3.1 The headline: two insertions, both in one file

The entire policy layer touches upstream-owned code in exactly two places, both in `src/tools/handlers.ts`:

| #   | Location                              | Change                                                                 | Why it is safe                                     |
| --- | ------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------- |
| 1   | Top of `handleToolCall`'s `try` block | 3 lines: evaluate policy, return if refused                            | Dispatcher body unchanged v1.15.0 → v1.20.0 (§1.3) |
| 2   | Import block (line 35 at v1.20.0)     | 1 line: repoint `getNodeEntry`/`supportedNodeTypes` at the policy shim | Single-line change in a stable import block        |

**Zero** changes to `src/schemas/tools.ts`, `src/tools/definitions.ts`, `src/tools/nodeRegistry.ts`, `src/instructions.ts`, `.github/workflows/pr.yml`, `jest.config.js`, or any upstream skill file.

Everything else lives under `src/policy/` and `src/__tests__/policy/`, neither of which exists upstream nor has any reason to.

### 3.2 File layout

```
src/policy/
  index.ts                     evaluatePolicy() - the single entry point
  types.ts                     Rule, RuleTarget, RuleFinding, Severity, PolicySession
  registry.ts                  the rule list; the ONE file a new rule is added to
  session.ts                   per-rule/per-session override state (soft gate)
  response.ts                  builds the policy_violation payload with _hints
  selectors.ts                 shared RuleTarget builders (codeFieldsOf, etc.)
  nodeRegistry.ts              wraps upstream's getNodeEntry/supportedNodeTypes
  nodeRegistry.extensions.ts   fork-owned node entries
  generate-docs.ts             emits the generated standards skill
  rules/
    upstream-code-node-hints.ts    adapter over upstream's codeNodeWarnings()
    <one file per rule or family>

src/__tests__/policy/
  coverage.test.ts             fails if any rule lacks a negative test
  attachment.test.ts           calls through handleToolCall, asserts refusal
  ordering.test.ts             asserts policy runs before the backup gate
  docs-fresh.test.ts           fails if the generated skill is stale
  registry-clash.test.ts       fails if fork and upstream define the same node key
  rules/<rule-id>.test.ts      negative path per rule

plugin/skills/ai-coe-standards/
  SKILL.md                     fully generated; never hand-edited
```

### 3.3 Types

```ts
// src/policy/types.ts

export type Severity = "block" | "warn";

/**
 * Why the rule exists, which decides whether it is a PR candidate.
 * Upstream's observed filter: it accepts rules stating what the platform
 * cannot do, and rejects rules encoding how we think code should be written.
 */
export type RuleKind = "platform-fact" | "house-opinion";

export interface RuleFinding {
  ruleId: string;
  severity: Severity;
  /** Path into the call args, so the message can point at the offending field. */
  path: (string | number)[];
  message: string;
  /** Copy-pasteable remedy, surfaced in _hints.action. */
  fix?: string;
  docs?: string;
}

export interface SelectedValue {
  path: (string | number)[];
  value: unknown;
}

/**
 * Which calls a rule inspects, and how it pulls the values out of them.
 * The selector lives with the rule, NOT in the dispatch - that is what makes
 * "add a rule, touch one file" true.
 */
export interface RuleTarget {
  tool: string;
  /** For multi-operation tools; omit to match every operation. */
  operation?: string | string[];
  select(args: any): SelectedValue[];
}

export interface Rule {
  /** Stable. Cited in errors, in tests, and in the override call. Never renamed. */
  id: string;
  kind: RuleKind;
  /** OUR severity, independent of upstream's. */
  severity: Severity;
  targets: RuleTarget[];
  /**
   * Pure and synchronous. No I/O, no network, no platform calls.
   * Receives one selected value at a time.
   */
  check(
    value: unknown,
    ctx: RuleContext,
  ): Omit<RuleFinding, "ruleId" | "severity">[];
  /** Condition under which this rule is deleted rather than maintained. Required. */
  retireWhen: string;
  docs?: string;
}

export interface RuleContext {
  tool: string;
  operation?: string;
  args: any;
  projectId?: string;
}
```

Four deliberate departures from the brief's sketch:

**`appliesTo` became `targets` with a `select()` function.** The brief's version named a tool and a field. That is not enough: `create_tool` guards `config.preProcessCode` and `config.postProcessCode`, while `manage_flow_nodes` guards `config.code`. Encoding that as data would need a small query language. A selector function is simpler, fully typed, and keeps the knowledge in the rule file.

**The governing constraint on selectors: they key on the shape of the payload, never on server-side state.** This matters because of a real hole the POC papered over. On `manage_flow_nodes` _create_, the node type is in the args, so `nodeType === "code"` is decidable. On _update_ it is not - the existing node's type is only known after the handler fetches it, which is why the POC needed a fourth call site inside `handlers.ts` rather than a schema check. A synchronous, pure, pre-dispatch gate structurally cannot make that call, so a rule that needs it would silently never fire on updates.

The resolution is to stop asking. `config.code` is itself the discriminator: verified against `nodeRegistry.ts`, `code` is the only node type in the registry with a `code` config key. A code rule therefore selects on **the presence of `config.code`**, not on the declared node type, and fires correctly on create and update alike with no fetch:

```ts
// src/policy/selectors.ts
export const codeFieldsOf = (tool: string): RuleTarget => ({
  tool,
  select: (args) =>
    (["code", "preProcessCode", "postProcessCode"] as const)
      .filter((k) => typeof args?.config?.[k] === "string")
      .map((k) => ({ path: ["config", k], value: args.config[k] })),
});
```

If a future rule genuinely cannot be decided from the args - one that needs the node's current server-side state, say - it does not belong in the pre-dispatch gate, and adding a post-fetch hook is a **second** insertion into `handlers.ts` at a call site inside the relevant `handleXxx`. That is the auto-merging pattern, so it is affordable, but it is deferred until a rule actually requires it rather than built speculatively.

**`upstreamWorthy: boolean` became `kind: RuleKind`.** Same information, but it records _why_ rather than just _whether_, which is what makes a monthly PR sweep a batch decision instead of a re-litigation. `upstreamWorthy` is then derived: `kind === "platform-fact"`.

**`message` moved from the rule onto the finding.** One rule can fire for several reasons (three different disallowed APIs, say) and each deserves its own sentence and its own path.

**`retireWhen` is required, not optional.** An optional field for preventing unbounded growth does not prevent unbounded growth. If a rule genuinely never retires, that is a sentence worth being made to write.

### 3.4 The dispatch point

`evaluatePolicy()` is called pre-dispatch in `handleToolCall`, **above** the backup gate:

```ts
async handleToolCall(toolName: string, args: any): Promise<any> {
  logger.info(`Handling tool call: ${toolName}`, { args: this.sanitizeArgs(args) });

  try {
    // AI COE policy layer (fork-owned, src/policy/). Runs before the backup
    // gate: a refused call is not an impending mutation, so offering a backup
    // for it is noise, and it must not consume the gate's one-shot hold.
    const refusal = evaluatePolicy(toolName, args, this.policySession);
    if (refusal) return refusal;

    // Before anything mutates an existing agent, give the user one chance to
    // take a backup. ...
    if (ToolHandlers.isBackupWorthyCall(toolName, args) && !this.targetsNewResource(args)) {
      ...
    }
```

**Why the handler layer and not the schema layer.** Four reasons, in descending order of weight. `src/schemas/tools.ts` is the measured worst-case conflict surface - 4 of the fork's 5 conflicts at v1.18.0, and they are structural rather than textual, because git cannot merge two tail-appends to one Zod chain. The dispatcher body has not changed in five releases. The backup gate proves the interception shape works and that upstream tolerates it in their own code. And it is one insertion rather than nine.

The honest cost: schema-level validation fails earlier and produces better-shaped errors, because Zod reports issues at a field path. The design recovers most of that by carrying `path` on every finding (§3.3), so the refusal payload can still point at `config.preProcessCode`. What it does not recover is failing before the handler runs at all, which for a pure pre-dispatch gate is a distinction without a practical difference - nothing has been fetched or mutated yet either way.

**Why above the backup gate and not below it.** This follows directly from a comment upstream already wrote. `isBackupWorthyCall` schema-validates the args before the gate runs, and the reason is documented at `handlers.ts:720-723`:

> The gate runs before the handler validates, so without this an INVALID first call would consume the one-shot hold: the caller sees `backup_not_offered` instead of its validation error, fixes the args, retries - and proceeds unprotected, because the hold is spent.

A policy-refused call is in exactly that category. It is a call that cannot run. If the backup gate goes first, a non-compliant call burns the one-shot hold, the user fixes the code, retries, and writes unprotected. Placing policy above the gate is not a preference; it is the same bug upstream already fixed, in a new guise.

Ordering is pinned by a test (§5, `ordering.test.ts`) so a future merge cannot silently swap them.

### 3.5 The override channel (soft gate)

Decision: **soft gate, per rule, per project, per session.** A blocked call returns the findings plus an explicit instruction for how to proceed; one acknowledgement of a given rule unlocks that rule for that project for the rest of the session.

**The channel is a reserved arg, not a new tool.** The override travels as `_policyOverride: string[]` on the call args:

```
manage_flow_nodes { flowId, operation: "create", nodeType: "code",
                    config: {...}, _policyOverride: ["codenode.try-catch"] }
```

This works with zero upstream files, which a new `manage_policy` tool would not - that would need an entry in `definitions.ts` and a case in the dispatcher switch.

**`evaluatePolicy` must delete `_policyOverride` from `args` unconditionally**, on every call, including calls with no matching rules and calls it refuses. Do that and nothing downstream ever sees the key: the policy gate runs above the backup gate (§3.4), so `isBackupWorthyCall` is reached only after the strip, and Zod is reached only after that. The correctness of the channel then rests on the strip, which is fork-owned code covered by a test, rather than on any property of upstream's schemas.

Belt and braces, the schemas tolerate it anyway: the project is on **Zod 3.25.76 with zero `.strict()`, `.passthrough()` or `.catchall()` in `src/`**, and all seven `GATED_TOOL_SCHEMAS` were confirmed by execution to accept an extra `_policyOverride` key and strip it from the output, `.refine`/`.superRefine`/`z.union` wrappers included. That is a second line of defense, not the mechanism.

Refusal payload, following the backup gate's `withHints` convention:

```ts
withHints(
  {
    error: "policy_violation",
    tool: toolName,
    changed: false,
    ...(projectId ? { projectId } : {}),
    findings: blocking.map((f) => ({
      ruleId: f.ruleId,
      path: f.path,
      message: f.message,
      docs: f.docs,
    })),
  },
  {
    warning: `NOTHING WAS CHANGED. ${blocking.length} AI COE standard(s) were not met, so ${toolName} was not run.`,
    action:
      `Fix the flagged content and retry. ${fixes}\n` +
      `If a finding is a false positive, retry the same call with ` +
      `_policyOverride: ["<ruleId>"] and say in one short line which rule you are overriding and why.`,
  },
);
```

Warnings never block. They ride along on the successful result as `_hints.warning`, which is the same shape upstream uses for `codeNodeWarnings`.

**Why a soft gate rather than a hard block.** Three reasons. The backup gate sets the precedent and it works. The fork's own pattern matching is known to produce false positives (§1.1), and a hard block turns a false positive into a delivery stoppage with no way through except editing code the engineer may not own. And an override that is visible in the transcript is a better audit artifact than a config flag set once and forgotten, which is what the config-level alternative degrades into after the first false positive.

**Why per rule and not per session globally.** Overriding `codenode.try-catch` should not also disable `reporting.task-naming`. The backup gate can be coarse because it guards one thing; the policy layer guards many.

### 3.6 Wrapping upstream, never editing it

Upstream's `codeNodeHints.ts` is imported **unmodified** and adapted into a rule. The adapter is fork-owned; upstream's file is never touched, so it rebases free forever.

```ts
// src/policy/rules/upstream-code-node-hints.ts
import { codeNodeWarnings } from "../../tools/codeNodeHints.js";
import { codeFieldsOf } from "../selectors.js";
import type { Rule } from "../types.js";

export const upstreamCodeNodeRuntimeApis: Rule = {
  id: "codenode.runtime-apis",
  kind: "platform-fact",
  // OUR severity. Upstream ships these as non-blocking hints; the fork blocks.
  severity: "block",
  targets: [
    codeFieldsOf("create_tool"),
    codeFieldsOf("update_tool"),
    codeFieldsOf("manage_flow_nodes"),
  ],
  check: (value) =>
    codeNodeWarnings(String(value ?? "")).map((hint) => ({
      path: [],
      message: hint,
    })),
  docs: "https://docs.cognigy.com/ai/for-developers/code/api-functions",
  retireWhen:
    "upstream makes these blocking, or the team accepts advisory severity for them",
};
```

Three properties worth naming:

**Full adoption plus full retention.** The fork gets upstream's scanner, including the `executableOnly()` comment and string blanking the fork's POC lacked, and keeps its own severity. No hybrid file to re-resolve on each rebase.

**The wiring is compile-time checked for free.** If upstream renames or removes `codeNodeWarnings`, `tsc` fails in CI. That is criterion 4 satisfied for this rule with no test written. Rules that do not wrap upstream still need the attachment test in §5.

**Upstream's caveat becomes the override prompt.** `codeNodeWarnings` appends "If the flagged name is a local helper rather than the runtime API, ignore this." Re-severitied to block, that sentence is precisely the case the soft gate exists for, and it reads naturally next to the `_policyOverride` instruction.

### 3.7 Node registry extensions

Decision: **fork entries win at runtime; a CI test fails loudly on a duplicate key.**

The brief proposed spreading fork entries into the `NODE_REGISTRY` literal. That should not be done. Appending `...FORK_NODE_ENTRIES,` before the literal's closing brace is a **tail-append to an object literal**, and upstream appends there too - `llmPrompt` went in at the tail in v1.16.0. That is structurally the same hazard as two tail-appends to one Zod chain, which is what produced 4 of the fork's 5 conflicts.

Instead, wrap the accessors. Because `NODE_REGISTRY` has exactly one consumer pair and they are imported by exactly one file (§1.4), the whole thing is a one-line change:

```ts
// src/policy/nodeRegistry.ts  (fork-owned)
import {
  getNodeEntry as upstreamGetNodeEntry,
  supportedNodeTypes as upstreamSupportedNodeTypes,
  type NodeRegistryEntry,
} from "../tools/nodeRegistry.js";
import { FORK_NODE_ENTRIES } from "./nodeRegistry.extensions.js";

/** Fork entries win: an upstream entry must never silently loosen a stricter fork one. */
export function getNodeEntry(nodeType: string): NodeRegistryEntry | null {
  return FORK_NODE_ENTRIES[nodeType] ?? upstreamGetNodeEntry(nodeType);
}

export function supportedNodeTypes(): string[] {
  return [
    ...new Set([
      ...upstreamSupportedNodeTypes(),
      ...Object.keys(FORK_NODE_ENTRIES),
    ]),
  ];
}
```

```ts
// src/tools/handlers.ts (line 35 at v1.20.0) - the entire upstream-side change
- import { getNodeEntry, supportedNodeTypes } from "./nodeRegistry.js";
+ import { getNodeEntry, supportedNodeTypes } from "../policy/nodeRegistry.js";
```

`src/tools/nodeRegistry.ts` is never edited. Upstream can add as many entries as it likes, in any position, forever, with no conflict. The fork can add dozens of entries without its footprint in upstream files growing by a single line.

`registry-clash.test.ts` fails the build when `Object.keys(FORK_NODE_ENTRIES)` intersects upstream's key set, naming the duplicate. The failure is the point: it forces a human to decide whether upstream's entry is now sufficient (delete the fork entry) or whether the fork's is deliberately stricter (record why in `retireWhen` and add the key to a reviewed allowlist). Silence in either direction is the failure mode being designed out.

On `requiredConfigKeys` specifically: when the fork wants a stricter required set than upstream's entry, it wins by the same precedence rule, because the fork entry replaces the upstream entry wholesale rather than merging field by field. Wholesale replacement is deliberate - a field-level merge would make it possible to end up with a combination neither side ever tested.

### 3.8 Generated prose

Rules carry their own documentation, and `generate-docs.ts` emits it into a **fork-owned skill**:

```
plugin/skills/ai-coe-standards/SKILL.md
```

Not into `plugin/skills/flow-nodes/SKILL.md` or `tools-setup/SKILL.md`. Those are upstream-owned, upstream edits them (flow-nodes was one of the 15 conflict blocks at v1.20.0), and generating into them means a permanent conflict surface plus a marker-block merge problem. A new skill directory upstream has no reason to create has neither.

This also answers cleanly what happens to hand-written content in the generated files: there is none. The file is generated in full, every time, and is never hand-edited. Hand-written guidance stays where it is, in the upstream skills, untouched.

`docs-fresh.test.ts` regenerates in memory and compares against the file on disk, failing with a diff when they differ. As a Jest test rather than a script plus a CI step, this needs no change to `pr.yml`.

**The drift this prevents is real and currently live.** `plugin/skills/tools-setup/SKILL.md` teaches five Code Node examples with no try/catch - at lines 151, 171, 172 and 285 (`preProcessCode` / `postProcessCode`) and line 241 (`config: { code: ... }`). Every one of them would have been refused by the fork's own POC gate at the `create_tool`, `update_tool` and `manage_flow_nodes` superRefines. The plugin's own guidance produced calls its own engine rejected. Generating the standards prose from the registry makes that class of contradiction impossible.

**Deliberately out of scope for v1: tool descriptions and `instructions.ts`.** Both reach every session on every client regardless of skill loading, which is genuinely attractive. Both are upstream-owned - `definitions.ts` is touched in 6 of 7 releases, and `instructions.ts` grew 41 → 44 lines across the same window. The refusal message already teaches the rule at the exact moment it matters and cites `docs`, so the marginal prevention value is low against a permanent conflict surface in the second-most-touched file. Revisit if the observed block rate is high enough to be an engineer-time problem rather than a nuisance.

---

## 4. Decision register

Brief §6 questions plus the ones raised during design. Each records the call and what was rejected.

| #   | Question                                                                                              | Decision                                                                                                                                                                                 | Rejected, and why                                                                                                                                                                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Dispatch point                                                                                        | Handler pre-dispatch only, above the backup gate                                                                                                                                         | Schema-level for a subset. `schemas/tools.ts` is the measured worst conflict surface, and `path` on findings recovers most of the error-shape advantage                                                                                                                             |
| 2   | Registry granularity                                                                                  | One rule per check, grouped into files by family                                                                                                                                         | One rule per family. Granular ids are what `_policyOverride`, `retireWhen` and per-rule tests all key on; a family-level id makes override too blunt                                                                                                                                |
| 3   | Severity model                                                                                        | Two tiers, `block` and `warn`, plus a per-rule soft override                                                                                                                             | A third "block unless overridden" tier. That is what `block` plus the soft gate already is; a third tier would only add a way to express "block, and really mean it", which the override audit trail handles better                                                                 |
| 4   | Escape hatch                                                                                          | Soft gate: per rule, per project, per session, via `_policyOverride`                                                                                                                     | No override (a false positive becomes a delivery stoppage); config-level (degrades to permanently off after the first false positive)                                                                                                                                               |
| 5   | Own the existing `codeNodeValidation.ts` rules?                                                       | No. Greenfield. The POC is deleted, upstream's `codeNodeHints.ts` is adopted, the NA PS standards are re-authored as rules in a later session                                            | Migration. The POC carries a known false-positive bug, and porting would carry it forward. The standards are the asset; that implementation is not                                                                                                                                  |
| 6   | Which skill files are generated                                                                       | One new fork-owned skill, `ai-coe-standards`, generated in full. Upstream skills untouched                                                                                               | Generating into `flow-nodes` / `tools-setup`. Permanent conflict surface plus a marker-block merge problem, for no gain                                                                                                                                                             |
| 7   | Day-one scope                                                                                         | Registry built to carry any rule from day one; rules ship in waves, Code Node first                                                                                                      | Code-Node-only types. The Phase 2 reporting rules (Task naming, Overwrite Analytics null-out) are the same shape, and retrofitting `targets` later would be a breaking change to every rule file                                                                                    |
| 8   | Node registry precedence                                                                              | Fork wins at runtime; CI fails loudly on a duplicate key                                                                                                                                 | Fork wins silently (fork shadows a better upstream entry indefinitely); upstream wins (a permissive upstream entry silently loosens a stricter fork one, which is the exact failure the layer exists to prevent)                                                                    |
| 9   | How much can be prose?                                                                                | Nothing non-negotiable. Skills are advisory only                                                                                                                                         | Relying on skills for enforcement. §1.6: skills load reliably but are 24 releases stale on a real install, and nothing signals staleness                                                                                                                                            |
| 10  | _(new)_ Override channel                                                                              | Reserved `_policyOverride` arg on the existing call                                                                                                                                      | A `manage_policy` tool. Would need `definitions.ts` plus a dispatcher case, breaking the zero-upstream-files property for no user-visible gain                                                                                                                                      |
| 11  | _(new)_ Node registry merge mechanism                                                                 | Wrap the two accessors behind a fork-owned shim; repoint one import                                                                                                                      | Spread into the `NODE_REGISTRY` literal. A tail-append to a construct upstream also tail-appends to - the same hazard that produced 4 of 5 conflicts                                                                                                                                |
| 12  | _(new)_ CI guard mechanism                                                                            | Jest tests in `src/__tests__/policy/`                                                                                                                                                    | A script plus a `pr.yml` step, as `check-plugin-manifest.mjs` does. `testMatch` is already `**/__tests__/**/*.test.ts`, so tests need no config change at all, while a new CI step edits an upstream-owned workflow file                                                            |
| 13  | _(new)_ Gate ordering vs the backup gate                                                              | Policy first                                                                                                                                                                             | Backup first. A policy-refused call would consume the gate's one-shot hold, reproducing the bug upstream documented at `handlers.ts:720-723`                                                                                                                                        |
| 14  | _(new)_ How code rules fire on `manage_flow_nodes` **update**, where the node type is not in the args | Select on the presence of `config.code`, not on declared `nodeType`. `code` is the only registry entry with a `code` config key, so presence is a sound discriminator and needs no fetch | Making `evaluatePolicy` async so a rule can look the node up (adds latency and I/O to every call, and makes rules untestable in isolation); a post-fetch hook inside `handleManageFlowNodes` (a second upstream insertion, deferred until a rule genuinely needs server-side state) |

---

## 5. Test strategy

The dangerous failure is not a merge conflict. It is upstream refactoring around the gate, merging cleanly, and silently disabling enforcement with no test failure. Every layer below is automated, lives in fork-owned files under `src/__tests__/policy/`, and is picked up by the existing `npm test` with **no change to `jest.config.js` or `pr.yml`**. `testMatch` is `["**/__tests__/**/*.test.ts"]`, which globs nested directories; confirmed empirically by `jest --listTests` matching a probe file at `src/__tests__/policy/foo.test.ts`. (Every existing test sits flat in `src/__tests__/`, and the one subdirectory, `fixtures/`, holds a single JSON file and no tests - so this is worth confirming rather than assuming, which is why it was.)

**1. Negative path, per rule.** `rules/<rule-id>.test.ts`. Asserts the rule produces a finding for non-compliant input and none for compliant input.

To be precise about what is missing today, because the brief overstated it: the suite does assert rejection in general - `src/__tests__/schemas.test.ts` alone carries 57 `success).toBe(false)` or `toThrow` assertions. What does not exist is a test asserting that a **standards rule** refuses a write, end to end, through the dispatcher. The POC's own checks shipped with none; its test-file changes adapted existing fixtures to satisfy the new gate rather than proving the gate fired. That is the specific gap the coverage guard closes.

**2. Coverage guard.** `coverage.test.ts` walks the registry and fails naming any rule with no corresponding negative test. This is what makes the system self-defending: a rule cannot be added untested, and cannot be silently lost.

**3. Attachment assertion.** `attachment.test.ts` calls `handlers.handleToolCall(tool, nonCompliantArgs)` and asserts `error === "policy_violation"`. Unit-testing the rule function is insufficient - the failure mode is losing the wiring while the function still passes in isolation.

**4. Ordering assertion.** `ordering.test.ts` issues a non-compliant mutating call against a project with no snapshot and asserts the result is `policy_violation`, not `backup_not_offered`. Pins §3.4's ordering so a merge cannot quietly reverse it.

**5. Registry clash.** `registry-clash.test.ts`, per §3.7.

**6. Docs freshness.** `docs-fresh.test.ts`, per §3.8.

**7. Override round trip.** Asserts that a blocked call retried with the correct `_policyOverride` succeeds, that an unrelated rule id does not unlock it, and that the override does not leak across projects.

**Unmeasured:** the brief noted `npm test` did not complete within 175 seconds locally. A background run during this session was lost when the environment recycled, so the number is still unknown. Time it before building - it determines whether the negative-path loop is runnable locally or effectively CI-only, and that changes how rules get authored.

---

## 6. Build sequence

**Do not rebase the POC branch, and do not drop its commit.** An earlier draft of this sequence said to. That is wrong, for three reasons found on inspection: `fix/code-node-development-best-practices` is **pushed to the `fork` remote at exactly `030e9c6`**, so a rebase makes local and remote diverge and any subsequent force-push destroys the only durable record of the POC (and guts any open PR raised from it); after dropping its single commit the branch would carry no Code Node work at all while still being named for it; and the commit would then survive only in a local reflog that expires.

Branch off instead. The result is the same clean `v1.20.0` base with none of the risk, and every step below is additive.

**Step 0 - get the base branch to v1.20.0.** `origin/main` and tag `v1.20.0` are the same commit (`9783046`), so `main` fast-forwards: `git checkout main && git merge --ff-only origin/main`. Then create the working branch off it, for example `git switch -c feat/ai-coe-policy-layer`. Leave `fix/code-node-development-best-practices` exactly as it is, locally and on the remote.

**Step 1 - carry the uncommitted work across, by hand where needed.** Ten files are staged on the POC branch and must not be lost:

- `docs/ai-coe/**` (8 files) and `.gitattributes` do not exist at `v1.20.0`, so they move across cleanly. Add and commit them on the new branch.
- **`.gitignore` must be re-applied by hand, not carried.** The staged diff was written against the `v1.15.0` file, and upstream changed that file in `v1.17.0` when Gemini CLI support was dropped - the `.gemini-extension/` and `cognigy-gemini-extension.zip` lines that appear as context in the staged diff no longer exist. The intent is two edits: remove the `docs/plans` entry, and add `__References/` under a "Local reference material (not for commit)" comment. Make those two edits directly on the v1.20.0 version of the file.
- `.claude/settings.json` is **created by `030e9c6`** and exists at neither `v1.15.0` nor `v1.20.0`, so it is fork-only and does not come across on its own. It has nothing to do with Code Node enforcement: it is a permissions allowlist pre-approving `npm run *`, `npx tsc *` and `npx eslint *`. Bring just that one file over with `git checkout 030e9c6 -- .claude/settings.json`, or the build session prompts for approval on every build and test command it runs.

Also decide on the untracked `Claude outputs/` directory - gitignore it or remove it.

**Verify:** `git diff v1.20.0 --stat -- src/` must return nothing. The `src/` tree is byte-identical to upstream; the branch as a whole is not, because it now carries the docs, `.gitattributes`, the `.gitignore` edits and `.claude/settings.json`, all intended. Upstream's `codeNodeHints.ts` is the fork's Code Node behavior from here, advisory, and that is the accepted interim state.

**Step 2 - time the suite.** Run `npm test` and record the wall clock. Decide the local loop strategy from the number.

**Step 3 - skeleton, no rules.** `types.ts`, `registry.ts` (empty array), `session.ts`, `response.ts`, `index.ts`. Insert the gate in `handleToolCall` per §3.4. Add `attachment.test.ts` and `ordering.test.ts` against a single throwaway always-fires rule. This proves the wiring before any real rule exists, and is the point at which the design is falsified if it is going to be.

**Step 4 - first real rule.** `upstream-code-node-hints.ts` per §3.6, with its negative test. This is the smallest rule that is genuinely useful and it exercises the wrap-upstream pattern end to end.

**Step 5 - the guards.** `coverage.test.ts`, then the override round-trip test. After this step the system is self-defending and further rules are cheap.

**Step 6 - node registry.** The shim, the extensions file, the import repoint, `registry-clash.test.ts`. Deliberately after the guards, so the first fork node entries land into a tested frame.

**Step 7 - generated prose.** `generate-docs.ts`, the `ai-coe-standards` skill, `docs-fresh.test.ts`.

**Step 8 - hand over.** The Code Node standards re-authoring is a separate session. It should start from the NA PS `cognigyCodeDev` source, not from `030e9c6`.

Steps 3 through 5 are the critical path. If the design is wrong, it is wrong at step 3, and step 3 is small.

---

## 7. Risks

**R1 - Plugin version drift (new; raised 2026-09-21).** The tooling installed on the primary dev machine is roughly twenty releases behind upstream, and its skill bundle and its engine are not even at the same version as each other (§1.6). This has two distinct halves and both need owners.

_The enablement half._ Nothing tells a user their plugin is stale. A teammate can be enforcing July's standards, using tools that no longer exist, and reading skill guidance that has since been rewritten, with no signal - and, as §1.6 shows, can be doing all three at once from two different versions. Team enablement needs a documented update path, a cadence, and a way to see the installed version. This is a process gap, not a code gap, and it is outside the policy layer's scope - but the policy layer is what makes it consequential, because enforcement is only as current as the install. **First action is diagnostic, not remedial:** establish what is actually installed on one machine and by what mechanism, since the two-version split suggests the team may be running a hand-configured MCP entry alongside an in-app plugin without knowing it.

_The design half._ The engine is version-pinned by the same manifest that carries the skills, so `src/policy/` inherits the same staleness. Putting a standard in code buys determinism within a version, not freshness across versions. Proposed mitigation, cheap and fork-owned: `src/policy/` records the upstream version it was built against, and the refusal payload's `_hints` carries a one-line staleness note when the running engine is more than N releases behind the newest known tag. This is a candidate for v2, not a step-3 requirement, and it needs a decision on how the running engine learns what "newest" is without a network call on every tool invocation.

**R2 - Upstream refactors `handleToolCall`.** The dispatcher has been stable for five releases, but stability is not a guarantee. Mitigated by `attachment.test.ts` and `ordering.test.ts`, which fail loudly rather than silently. Accepted.

**R3 - False positives stop a delivery.** Mitigated by the soft gate. Residual risk: an engineer overrides reflexively and enforcement becomes theater. Watch the override rate; a rule overridden often is either wrong or misclassified as `block`.

**R4 - the `_policyOverride` channel depends on nothing validating args before the policy gate.** The unconditional strip in §3.5 means the key never reaches `isBackupWorthyCall` or Zod, so upstream adding `.strict()` to a schema is harmless. The live risk is different and narrower: if upstream ever moves argument validation _earlier_ than `handleToolCall` - into `src/index.ts`'s `CallToolRequestSchema` handler, say - the key would be rejected or stripped before the policy gate ever sees it, and every override would silently stop working. Low likelihood, silent failure mode, so the override round-trip test must assert the full path through `handleToolCall` rather than calling `evaluatePolicy` directly.

**R5 - The registry grows without bound.** `retireWhen` is required, which makes retirement a stated condition rather than an intention. Not sufficient on its own; it needs the monthly sweep the `kind` field exists to make cheap.

---

## 8. Acceptance criteria check

| Criterion (brief §8)                                               | Met by                                                                                                               | Status                                                                                                    |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Adding a rule touches one fork-owned file, zero upstream files     | `registry.ts` plus one file in `rules/`. Selector lives with the rule, so the dispatch never learns about new fields | Met                                                                                                       |
| Clean rebase yields zero conflicts in `src/schemas/tools.ts`       | The fork never touches that file again                                                                               | Met, and stronger: zero conflicts in any upstream file, given a two-line total footprint in `handlers.ts` |
| Every rule has a negative-path test, enforced by CI not discipline | `coverage.test.ts`                                                                                                   | Met                                                                                                       |
| Enforcement survives an upstream refactor, or fails loudly in CI   | `attachment.test.ts`, `ordering.test.ts`; plus `tsc` for wrapped-upstream rules                                      | Met                                                                                                       |
| Skill prose about enforced rules is generated, CI fails when stale | `generate-docs.ts`, `docs-fresh.test.ts`                                                                             | Met                                                                                                       |
| Each rule records PR candidacy and retirement condition            | `kind`, `retireWhen` (required)                                                                                      | Met                                                                                                       |

Against brief §7, "what not to do": no fork logic in `src/schemas/tools.ts`; no tool renames; no hand-edits to `CHANGELOG.md`, `package.json` version, or the six manifests; no rewrite of any `handleXxx` function; no non-negotiable standards in skills. All clear.

---

## 9. What this design does not cover

- **The Code Node standards themselves.** Re-authoring the NA PS rules onto this framework is the next session, starting from the `cognigyCodeDev` source rather than from `030e9c6`.
- **Phase 2 reporting rules.** Task naming and Overwrite Analytics null-out fit the `Rule` shape as-is, but their content is not specified here.
- **The plugin update and enablement process.** R1's first half. Needs an owner outside this design.
- **Runtime staleness detection.** R1's second half. Sketched, deliberately deferred.
- **Whether the fork ever upstreams any of this.** `kind` makes the sweep cheap; the sweep itself is a process decision.

---

## 10. Kickoff for the build session

This document is intended to be sufficient on its own; no companion briefing file is needed. A fresh session with no memory of this one can be started with the following, and nothing else.

> Implement the AI COE policy layer in the NiCE Cognigy plugin fork.
>
> Repo: `C:\Users\jamiea\sandbox\ai-coe-plugin\cognigy-plugin`. Branch `fix/code-node-development-best-practices`, currently one commit (`030e9c6`) on a `v1.15.0` base. Remotes: `origin` = `Cognigy/cognigy-plugin` (upstream, at `v1.20.0`), `fork` = `jacognigy/cognigy-plugin`.
>
> The design of record is `docs/ai-coe/architecture/06-Policy-Layer-Design.md` (this file). Read it in full before touching anything. Work through section 6 in order, starting at step 0. Sections 3 and 5 are the specification; section 4 records why each decision was made, so if you want to depart from one, check what was already rejected and why before you do.
>
> Two things that will mislead you if you skip section 1: several facts in the older `BRIEF-Policy-Layer-Architecture.md` are stale, and all line numbers anywhere in either document are approximate - locate code by symbol.
>
> Do not re-derive the architecture from source. `docs/ai-coe/architecture/` in the repo has it, read in numbered order.

Two prerequisites are worth settling before that session starts rather than inside it: the `npm test` wall-clock time (§5, still unmeasured), and the disposition of the untracked `Claude outputs/` directory (§6 step 0).
