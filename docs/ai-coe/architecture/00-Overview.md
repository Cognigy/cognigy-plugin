# Cognigy Plugin Fork - Codebase Review Knowledge Base

**Purpose:** translate the actual architecture of the `cognigy-plugin` codebase into the vocabulary and decisions the NA PS fork planning conversations need. This is not a substitute for the repo's own README, `docs/ARCHITECTURE.md`, or the `CLAUDE.md` files, which document the plugin for someone building or maintaining it. These files are for reasoning about roadmap and scope: what exists, what does not, what a proposed change would actually cost, and which internal name maps to which everyday term.

**Source state this knowledge base reflects (as of 2026-09-14):**

| Item                | Value                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local checkout      | `C:\Users\jamiea\sandbox\ai-coe-plugin\cognigy-plugin`, branch `fix/code-node-development-best-practices`                                                          |
| Local base          | upstream `Cognigy/cognigy-plugin` v1.15.0 (commit `160ae03`, released 2026-09-01)                                                                                  |
| Local commit on top | `030e9c6` "feat: enforce Cognigy Code Node best practices and standards at write time" (the Phase 0 Code Node PR case study; 9 files, +598/-100)                   |
| Fork remote         | `jacognigy/cognigy-plugin`, same branch pushed                                                                                                                     |
| Upstream head       | v1.15.1 (`f82ca78`, 2026-09-08) - one fix ahead of local: `fix(api): tunnel Cognigy requests through corporate proxies (#47)`, 20 files, adds `src/utils/proxy.ts` |
| Code Node PR status | not present in upstream `main` as of 1.15.1; merge status on GitHub not checked from this session                                                                  |

Every file/line reference in this knowledge base points at the local branch above. Line numbers in `src/tools/handlers.ts` will shift after the next rebase onto upstream; function names are the stable anchor.

---

## What each file is for

| File                                           | Use it when you need to...                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `01-Architecture-and-Terminology.md`           | Explain how the plugin is put together, name a component correctly, or translate between how the team talks ("the bot", "a reporting node", "QA the build") and what the codebase calls it. Also carries the one external constraint (upstream wants a single universal codebase) that shapes every later conversation.                    |
| `02-Feature-Map.md`                            | Check whether a proposed idea already exists. Complete inventory of all 17 MCP tools and every action string, all 15 registry node types, all 15 skills, both subagents, and the release/dev automation in `scripts/` (which is not tests).                                                                                                |
| `03-Common-Scenarios-Playbook.md`              | Answer a concrete planning question: what does it cost to add a node type, a tool, a validation rule, a client platform; how do we track upstream; how does the backup gate actually behave; where do package exports land and why a sandboxed agent cannot read them. Leads with the one real cost data point we have (the Code Node PR). |
| `04-Limitations-and-Roadmap-Considerations.md` | Prioritize. Findings grouped by confidence and cost to close: "already works, needs exposing", "genuinely missing, needs new code", "content or guidance gap, no code", plus "docs disagree with source" and "unverified from here".                                                                                                       |
| `05-Fork-Roadmap-Snapshot.md`                  | See where the phased plan stands and which findings in this review change it. A plan in motion, kept separate from the fixed facts in 04. Update this file when the roadmap moves.                                                                                                                                                         |

---

## Source material folded in so far

**Pass 1 (2026-09-14).** Full read of the local source tree (excluding `node_modules`, `.git`, and the `__References` folder, which was deliberately left out of scope for this pass): `src/**` including all 24 test files, `plugin/**` (manifests, 15 skills, 2 agents), `.claude/**` (project rules, 2 contributor dev skills), `docs/**`, `scripts/**`, release/CI config, `CHANGELOG.md`, `README.md`. Git history consulted for the Code Node PR diffstat and upstream drift. The team's `NA-PS-Cognigy-Plugin-Fork-Phased-Roadmap.md` (2026-09-11) was read and is the basis of file 05.

**Not yet folded in.** The companion review documents the roadmap cites (`Cognigy-Plugin-Fork-Feasibility-Assessment.md`, `Cognigy-Plugin-vs-NA-PS-Best-Practices-Gap-Analysis.md`, `Cognigy-Plugin_Fork_Planning-Notes.md`), the Cognigy OpenAPI section inventory, and the SME architecture recommendation (T-shaped agent pattern, Once Node placement, naming conventions) all live outside this pass. Where file 04 or 05 references a graded finding from the Gap Analysis, it is quoting the roadmap's summary of it, not the Gap Analysis itself. When those documents are brought in, the sections most likely to change are: 04 section "Genuinely missing" (Gap Analysis severities), 01 terminology table (SME vocabulary), and 05 Phase 4 (OpenAPI surface list).

---

## How to keep this current

When upstream releases, rebase, and re-check: the tool count and action enums in `src/tools/definitions.ts`, the node list in `src/tools/nodeRegistry.ts`, the gated-tool list in `handlers.ts` (`BACKUP_WORTHY_TOOLS`), and the skill folder list. Those four are where 02 goes stale first. When the roadmap changes, edit 05 only, and add a dated line to the history above. Anything marked **pending validation** or **not verifiable from here** in these files should be resolved against a live Cognigy instance before it drives an estimate.

---

## Change log

- **2026-09-21** - Updated local checkout path: `cognigy-plugin` and `ai-coe-plugin-workspace` were moved under a new parent folder, `ai-coe-plugin\`, as siblings. Repo location and git/GitHub remotes unaffected.
