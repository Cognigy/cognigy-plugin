# 05 - Fork Roadmap Snapshot

\*A plan in motion, kept separate from the fixed findings in 04. Source: `NA-PS-Cognigy-Plugin-Fork-Phased-Roadmap.md` (2026-09-11, working draft) cross-read against the codebase on 2026-09-14. Phase names and order are settled; deliverable detail is WIP per the roadmap itself. **Update this file when the roadmap moves; do not let it go stale.\***

---

## Governing decisions carried through every phase

- **No delete capabilities exposed.** Confirmed as consistent with upstream direction: since 1.13.0 the plugin already soft-deletes agents, flows, and projects (`DELETE_` rename). Note for the team that hard deletes **still exist** for endpoints, LLM models, knowledge stores, functions, tool nodes, flow nodes, and snapshots, and in `create_ai_agent`'s rollback path. "No delete" as a fork policy therefore means _removing or gating_ those remaining paths, not just declining to add more. Cascade-delete preview (Gap Analysis §5) is dropped.
- **"Protect the environment" guardrail** - tentative, Phase 3, hard vs soft undecided. The codebase already has a soft gate (see 03); the decision is really "tighten the existing gate or leave it."
- **Heavy Claude delegation** for drafting; human time for review, live validation, judgment calls. Phases ~1-2 weeks each.

---

## Phase status board

| Phase                          | Theme                                                                                                        | Status (2026-09-14)                                                                                                                                                                                                                               | What this review changes                                                                                                                                                                                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **0** Infrastructure           | understand the tool; maintenance, install, feedback foundations                                              | in progress; Code Node PR complete (`030e9c6`, 9 files, +598/-100; upstream reworked it as `codeNodeHints.ts`, merged 2026-09-15); this knowledge base is the "Mapping Architecture & Features" deliverable                                       | Installation strategy is more urgent than the roadmap implies: fork code runs nowhere until the npm alias pin is changed or a fork package is published. Upstream is now **four** releases ahead (v1.18.0), not one.                                                                                                                       |
| **1** Critical Unblockers      | prompt best practices, deterministic flow tool, `create_flow`, initiation-flow standard                      | **LLM Prompt node delivered upstream** (v1.16.0: `nodeRegistry.ts`, key `llmPrompt`, type `llmPromptV2`, 30 config keys, only `prompt` required, +42 lines) - adopt theirs, delete ours; the rest not started; prompt standard blocked on EU team | `create_flow` is a ~1 day wrapper (03). Once node is a registry entry once config keys are known. The deterministic-flow blocker is the prompt-level "never before the Job node" rule plus no flow-kind detection, not the node tooling. This is the worked example of "adopt theirs, delete ours."                                        |
| **2** Reporting & Architecture | validation registry, drift guard, reference corpus, `task` / `emailNotification` / `overwriteAnalytics`      | not started                                                                                                                                                                                                                                       | Registry design is straightforward: `codeNodeValidation.ts` already has the `ValidatorFn` shape; four call sites to consolidate. Drift guard reuses `check-plugin-manifest.mjs` pattern. Budget negative-path tests, which the Code Node PR lacks. Node config keys are unverifiable from the repo; corpus extraction is the prerequisite. |
| **3** Embedded Best Practices  | base64 download, embed NA PS skill layer, reconcile guidance, platform gotchas, guardrail decision           | not started                                                                                                                                                                                                                                       | Base64 download is ~0.5 day and a good upstream candidate. Reconciliation has a concrete first task: `tools-setup/SKILL.md` examples now fail the Code Node gate. Desktop chat does not load skills, so non-negotiables belong in `instructions.ts`.                                                                                       |
| **4** Tool Inventory Expansion | standalone endpoint creation, multi-tenant creds, scope Handover / Extensions / Playbooks / Locales / Tokens | not started                                                                                                                                                                                                                                       | REST endpoint wrapper is cheap; other channels need payload discovery. Multi-tenant: config is a single flat object; do the "can one key span projects" research before scoping engine changes. None of the five newer surfaces have any route in the code.                                                                                |
| **5** FRD/Design-to-Bot        | generate a mostly-functional, standards-compliant bot from an FRD                                            | not started; depends on 0-4                                                                                                                                                                                                                       | Hard code dependencies are only `create_flow`, the three reporting nodes, LLM Prompt (if used), and the initiation-flow permission. Everything else exists. FRD parsing has no plugin dependency and can start early.                                                                                                                      |
| **Future** Testing Automation  | eval agent, automated test execution                                                                         | research spike, not committed                                                                                                                                                                                                                     | Eval agent is gated on base64 download. No simulation API is visible in the ~45 routes the plugin uses; check the OpenAPI spec.                                                                                                                                                                                                            |

---

## Sequencing observations from the code

The fork intends to **expand `nodeRegistry.ts` extensively** (`task`, `emailNotification`, `overwriteAnalytics`, `once`, and more as API coverage grows). Upstream has also started adding entries there (v1.16.0, +42 lines for `llmPrompt`). That moves `nodeRegistry.ts` from a low-risk to a **high-contact surface**: entries are independent object keys that usually merge cleanly, but duplicate-purpose entries merge into broken code. Needs a design decision (see the maintenance strategy's O-006).

**Dependencies that are real:**

1. Installation strategy (Phase 0) before anything in Phase 1 ships to the team, because nothing runs the fork's engine until the manifests point at it.
2. Reference corpus (Phase 2) before the reporting node types, because the config key names are not in the repo.
3. Validation registry (Phase 2) before Task-node naming or Overwrite Analytics null-out rules, otherwise each costs ~9 files.
4. Base64 download (Phase 3) before any QA-reachability or eval work.
5. `create_flow` (Phase 1) before deterministic flows, API flows, and Phase 5 multi-flow builds.

**Things that can move earlier than planned at low cost:** base64 download (Phase 3 -> could ride along with `create_flow` in Phase 1, both are wrappers and both are upstream-friendly); the `tools-setup` skill fix (should land with the Code Node PR, not wait for Phase 3); the prose fixes in 04 Bucket C.

**Things that are cheaper than the roadmap frames them:** node type _existence_ (registry only). **Things that are more expensive:** node type _content rules_ without the registry; multi-tenant credentials; anything that has to reach Claude Desktop chat users through skills.

---

## Open architectural proposals not yet built

| Proposal                                                                                                    | Where it lives in the plan | Decision needed                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VALIDATION_REGISTRY` + drift guard                                                                         | Phase 2                    | fork-only or propose upstream first (the maintainer's "skills come first" stance suggests a conversation)                                                                                             |
| `create_flow` thin wrapper                                                                                  | Phase 1                    | separate tool vs new `manage_flows`; return both `_id` and `referenceId`; must ship with an exposed `prepend` mode (or `start`-as-parent) on `manage_flow_nodes`, or the new flow cannot be populated |
| Flow-kind detection (agent flow vs deterministic flow) to condition the "no nodes before the Job node" rule | implied by Phase 1         | none yet; not in the roadmap explicitly - add it                                                                                                                                                      |
| `returnAsBase64` on package export/download                                                                 | Phase 3                    | size cap; upstream PR                                                                                                                                                                                 |
| Protect-the-environment guardrail                                                                           | Phase 3                    | hard vs soft vs package-export alternative; snapshot cap of 10 and endpoint exclusion should be in the room                                                                                           |
| Profile-based credentials                                                                                   | Phase 4                    | research outcome first                                                                                                                                                                                |
| Fork distribution (internal npm package, marketplace, per-project)                                          | Phase 0                    | which platforms; who owns publishing                                                                                                                                                                  |

---

## Open decisions (from the roadmap, annotated)

- **Hard vs soft guardrail.** Current code is soft (one `decline` per project per session unlocks everything). See 03 for the four options and their code touchpoints.
- **Which client platforms the team needs.** Every platform is a manifest to keep in lockstep plus installer code. Claude Code + Cursor + Claude Desktop likely covers NA PS; Codex has no agents, Gemini CLI consumer access ended 2026-06-18.
- **Propose Phase 2 architecture upstream?** The signal arrived: upstream merged its own rework of the Code Node PR (`codeNodeHints.ts`, hints-only, 2 of 8 submitted checks adopted and downgraded, 5 dropped, blocking rejected outright) on 2026-09-15. Outcome: do not propose the policy layer upstream as enforcement; the maintainer keeps platform-fact rules and drops opinion rules. Build `src/policy/` fork-side.
- **Does Cognigy have its own Task / Email / Overwrite Analytics node roadmap?** Unknown from the repo; worth asking before Phase 2 engineering starts.
- **Endpoint creation and multi-tenant scope.** Pending the Phase 4 research passes.

---

## Change log for this file

- **2026-09-14** - created from the 2026-09-11 roadmap and the first codebase pass. Added: upstream drift (1.15.1), distribution urgency, the "hard deletes still exist" nuance, flow-kind detection as an unlisted dependency, cost annotations per phase.
- **2026-09-16** - Corrected upstream drift to v1.18.0 (four releases ahead, not one). Marked the LLM Prompt node as delivered upstream (v1.16.0) - the worked example of adopt-theirs-delete-ours. Recorded the Phase 2 upstream-proposal signal's outcome (build fork-side, do not propose enforcement upstream). Added `nodeRegistry.ts` as a rising-risk, high-contact surface given both the fork's and upstream's expansion plans.
