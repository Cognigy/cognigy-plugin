---
name: add-eval
description: Add or edit a plugin eval case under plugin/evals (claude plugin eval) — prompt, graders, MCP mocks — and run, compare and re-baseline the suite. Use when writing a new eval, changing a grader or mock, checking a skill/agent/tool-description change for regressions, or when evals:compare reports a drop.
---

Evals run the plugin in a sandboxed `claude -p` child against a mocked `platform` server and grade the transcript. Reference: https://code.claude.com/docs/en/plugin-evals.md (`claude plugin eval --help` matches it).

## Layout

```text
plugin/evals/
  <group>/<case>/prompt.md        frontmatter (tags, max_turns, allowed_tools) + the prompt, sent verbatim
  <group>/<case>/graders/<name>.md  one grader per file
  <group>/<case>/mocks/platform/<tool>.md  per-case override of one tool
  mocks/platform/_server.md       judge model plays a fixed demo tenant for every tool
  mocks/platform/_tools.json      real descriptions/schemas — generated, never hand-edit
  baseline.json                   committed per-grader pass rates, see "Run and compare"
  results/                        gitignored run output
```

Groups today: `skill-triggers/`, `tool-choice/`. The demo tenant (Demo Project, Billing Bot, Phone Support, GPT-4o) is defined in `_server.md`; write prompts against it.

## Write a case

1. Copy the closest existing case. The prompt is phrased like a user, never names the skill or tool, and contains everything needed — the run starts in an empty directory and cannot ask follow-ups. Add "I'm not around to answer questions, so pick sensible defaults and go ahead." unless asking IS the behaviour under test (`tool-choice/backup-gate`).
2. Give it one grader on the steps (`tool_used` / `tool_order` / trace `regex`) and, where there is a result to judge, one on the outcome (`regex` on `last_message`, or a short `llm` rubric written as PASS/FAIL conditions).
3. Set `max_turns` generously (25–30 for build flows); hitting it is a run error. Judge-played mocks get 4 × `max_turns` calls.
4. Smoke it: `npm run evals -- --case <name> --runs 1 --keep-temp`, then read `<kept>/out/trace.jsonl` and `out/mock-calls.jsonl` to confirm the run took the path you meant — a pass can be for the wrong reason.
5. Run it at 3 runs and re-baseline (below).

MCP tools are named `mcp__plugin_cognigy_platform__<tool>`; plugin skills are invoked as `cognigy:<skill>`.

## Grader rules learned the hard way

- **Accept the subagent path.** The `Agent` tool is available in every run even when `allowed_tools` omits it, and models delegate to `cognigy-agent-builder` / `cognigy-voice-go-live`. A `tool_used: Skill` grader then fails although the plugin did the right thing. Use a trace regex that accepts either path, and make sure the subagent preloads the skill (`skills:` in its frontmatter):
  ```yaml
  type: regex
  target: trace
  pattern: '"skill":"(?:cognigy:)?agent-creation"|"subagent_type":"(?:cognigy:)?cognigy-agent-builder"'
  ```
- **Match call inputs, never bare names.** The trace's first line lists every agent, skill and tool name, so `pattern: cognigy-voice-go-live` always passes. Anchor on `"skill":"`, `"subagent_type":"` or `"name":"mcp__…"`.
- **`tool_used` counts calls made inside subagents** — no special handling needed for MCP calls.
- **`tool_order` compares the FIRST matching call of each side.** It cannot express "the retry after the decline succeeded" when the first attempt is held. Grade the mock's answer instead: `target: mock_calls`, `pattern: '\\?"changesApplied\\?"\s*:\s*true'`, `arm: both`.
- **"Must not happen" graders** (`min: 0, max: 0`) pass for free in the no-plugin arm. Fine for `npm run evals` (single arm); just don't read them as signal there.
- No `(?i)` in patterns — use `flags: i`. `expect:` in mocks takes a restricted regex dialect (no groups/alternation; use a list of literals).

## Mocks

- `_server.md` answers every tool from the tenant description. To make one tool behave differently for one case, add `<case>/mocks/platform/<tool>.md` — it overrides only that tool.
- Fixed mock: body is the literal tool result (copy real shapes, incl. `_hints`, from `src/tools/handlers.ts`). Stateful behaviour: `type: agent` with instructions — agent mocks see earlier calls to every mocked tool, which is how `voice-apply-fixes` holds the first `apply: true` until `manage_snapshots decline`.
- After changing `src/tools/definitions.ts`: `npm run evals:tools`. A new tool must also be added to `tools:` in `_server.md`. `evalMocks.test.ts` fails on either drift.
- Mocks carry no `src/instructions.ts`, so evals measure skills, agents and tool descriptions — not the server instructions.
- `plugin/evals/` is in `.prettierignore` on purpose: Prettier escapes `_` in markdown and corrupts JSON mock bodies. Don't format these files.

## Run and compare

```bash
npm run evals                          # full suite, pinned Sonnet agent + Haiku judge, ~$3 / 3 min
npm run evals -- --case 'voice-*'      # subset (globs on case name), --tag works too
npm run evals:compare                  # newest run vs plugin/evals/baseline.json; exit 1 on a drop
npm run evals:compare -- --update      # newest run becomes the baseline
```

- A drop with 3 runs (3/3 → 2/3) can be one flaky run. Re-run that case with `--runs 5`, and on `main` if still unsure, before calling it a regression.
- `changed` means the case's files (or shared mocks) differ from the baseline's fingerprint — expected after editing a case; re-baseline.
- `ERRORED` means a run ended abnormally (timeout, usage or rate limit); errored runs are still graded, so they are never compared — re-run. `--update` refuses a run that errored or skipped any case, so re-baseline from a clean full run, in the PR that intentionally changes behaviour or a case, so the `baseline.json` diff is reviewed. Commit the code first so the baseline records the commit it ran on. If you change the pinned models in `package.json`, re-baseline too.
- Never commit `results/`. Runs make paid model calls on your own credential; `--max-cost-usd` caps a run.
