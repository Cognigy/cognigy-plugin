---
name: add-eval
description: Add or edit a plugin eval case under plugin/evals (claude plugin eval) — prompt, graders, MCP mocks — and run, compare and re-baseline the suite. Use when writing a new eval, changing a grader or mock, checking a skill/agent/tool-description change for regressions, or when evals:compare reports a drop.
---

Evals run the plugin in a sandboxed `claude -p` child against a mocked `platform` server and grade the transcript. Reference: https://code.claude.com/docs/en/plugin-evals.md (`claude plugin eval --help` matches it).

## Layout

```text
plugin/evals/
  <group>/<case>/prompt.md        frontmatter (tags, max_turns, timeout_seconds, allowed_tools) + the prompt, sent verbatim
  <group>/<case>/graders/<name>.md  one grader per file
  <group>/<case>/mocks/platform/<tool>.md  per-case override of one tool
  <group>/<case>/mocks/platform/fixtures/  files a fixed mock inserts with {{file:...}}
  <group>/<case>/mocks/.replay/platform/   adopted agent-mock answers for that case's mocks
  mocks/platform/_server.md       judge model plays a demo tenant for the tools without their own file
  mocks/platform/<tool>.md        suite-wide fixed mocks (check_capabilities, manage_settings)
  mocks/platform/_tools.json      real descriptions/schemas — generated, never hand-edit
  mocks/.replay/platform/         adopted answers of _server.md, committed
  baseline.json                   committed per-grader pass rates, see "Run and compare"
  results/                        gitignored run output
```

Groups today: `skill-triggers/`, `tool-choice/`. The demo tenant (Demo Project, Billing Bot, Phone Support, GPT-4o) is defined in `_server.md`; write prompts against it.

## Write a case

1. Copy the closest existing case. The prompt is phrased like a user, never names the skill or tool, and contains everything needed — the run starts in an empty directory and cannot ask follow-ups. Add "I'm not around to answer questions, so pick sensible defaults and go ahead." unless asking IS the behaviour under test (`tool-choice/backup-gate`).
2. Give it one grader on the steps (`tool_used` / `tool_order` / trace `regex`) and one on the outcome: `regex` on `last_message` where a word or snippet proves it (`<script`, `knowledge`), else a short `llm` rubric written as PASS/FAIL conditions. Every case has both. If the outcome is a few facts, check them with a regex (lookaheads for "all of these, any order", as in `agent-voice-speech/reports-outcome`): the Haiku judge failed a correct summary 3/3 there.
3. Set `max_turns` generously (25–40 for build flows; hitting it is a run error) and `timeout_seconds: 600`. The 300 s default killed runs with an agent-mock call in flight; normal runs take 25–70 s. Agent mocks get 4 × `max_turns` calls per run, replayed ones included.
4. List `Agent` in `allowed_tools` when delegating to a plugin subagent is an accepted path (the grader accepts `subagent_type`), as in `build-agent`. The CLI offers `Agent` even when it is not listed, so leaving it out does not stop delegation; it only hides that the case allows it.
5. Smoke it: `npm run evals -- --case <name> --runs 1 --keep-temp`, then read `<kept>/out/trace.jsonl` and `out/mock-calls.jsonl` to confirm the run took the path you meant — a pass can be for the wrong reason.
6. Run it at 3 runs, adopt its replays and re-baseline (below).

MCP tools are named `mcp__plugin_cognigy_platform__<tool>`; plugin skills are invoked as `cognigy:<skill>`.

## Grader rules learned the hard way

- **Accept the subagent path.** The `Agent` tool is available in every run even when `allowed_tools` omits it (list it anyway where delegating is fine, see step 4), and models delegate to `cognigy-agent-builder` / `cognigy-voice-go-live`. A `tool_used: Skill` grader then fails although the plugin did the right thing. Use a trace regex that accepts either path, and make sure the subagent preloads the skill (`skills:` in its frontmatter):
  ```yaml
  type: regex
  target: trace
  pattern: '"skill":"(?:cognigy:)?agent-creation"|"subagent_type":"(?:cognigy:)?cognigy-agent-builder"'
  ```
- **Match call inputs, never bare names.** The trace's first line lists every agent, skill and tool name, so `pattern: cognigy-voice-go-live` always passes. Anchor on `"skill":"`, `"subagent_type":"` or `"name":"mcp__…"`.
- **`tool_used` counts calls made inside subagents** — no special handling needed for MCP calls.
- **"a result in the trace is not one the harness gave … altered" is a harness false positive**, not a hook. The model sometimes calls a deferred MCP tool with `{}` before loading its schema. When an agent mock answers that with a tool error, Claude Code appends "This tool's input schema was not in your prompt…" to it, and the harness no longer recognises the result (add-knowledge `manage_settings` and voice-apply-fixes `manage_snapshots`, 13 Nov 2026). So every agent mock ends with the line telling it to answer bad arguments with a normal JSON `{"error": …}`, never `ERROR:`. Keep that line in new agent mocks. Fixed mocks are not affected (a `{}` call to a fixed `{{file:…{input.x}}}` mock returns a tool error and the run is still graded). Don't turn tool search off to avoid it (`ENABLE_TOOL_SEARCH=false`): with every schema upfront the model skips skills it loads in real sessions (deploy-webchat went 0/3).
- **`turns 1` is normal for a run that delegated.** The subagent starts in the background and the harness waits for it; the trace's last line has `subagent_stats` (`spawned`, `completed`, `failed`). A one-turn run that made no MCP calls means the subagent failed, usually an API error it reports in the final message (13 Nov 2026: Cloudflare 403s). Re-run it; it is not the plugin.
- **`tool_order` compares the FIRST matching call of each side.** It cannot express "the retry after the decline succeeded" when the first attempt is held. Grade the mock's answer instead: `target: mock_calls`, `pattern: '\\?"changesApplied\\?"\s*:\s*true'`, `arm: both`.
- **"Must not happen" graders** (`min: 0, max: 0`) pass for free in the no-plugin arm. Fine for `npm run evals` (single arm); just don't read them as signal there.
- No `(?i)` in patterns — use `flags: i`. `expect:` in mocks takes a restricted regex dialect (no groups/alternation; use a list of literals).

## Mocks

Prefer fixed mocks. An agent mock (`type: agent`) is a Haiku call per tool call: its answer varies between runs, it adds latency (the cause of the 300 s timeouts) and it fails when that model call fails (`mock agent responder failed (model_call)`, a run that looks like a plugin bug). Use `type: agent` only where the answer depends on earlier calls in the run.

- **Fixed mock**: the body is the literal tool result (copy real shapes, incl. `_hints`, from `src/tools/handlers.ts`). `{{input.name}}` inserts an input field (`""` when absent; not JSON-escaped, so only use it for plain strings).
- **Branch on input with fixtures**: `{{file:fixtures/list_resources/{input.resourceType}.json}}` picks one file per value (see `voice-go-live-agent`). An absent field or a missing file is a tool error, so only branch on a required field and write a file for every enum value (empty ones are `{"items":[],"total":0}`).
- **Agent mock** for state: `voice-apply-fixes` holds the first `apply: true` until `manage_snapshots decline`, `manage_agent_components` merges settings across calls, list results that include what the run created. An agent mock sees only earlier calls to **agent** mocks, not to fixed ones, so a tool whose call it must notice (here `manage_snapshots`) has to stay an agent mock.
- `_server.md` answers every tool that has no `<tool>.md`. To make one tool behave differently for one case, add `<case>/mocks/platform/<tool>.md` — it overrides only that tool. `evalMocks.test.ts` checks each tool is answered exactly once by `_server.md` or a suite `<tool>.md`.
- After changing `src/tools/definitions.ts`: `npm run evals:tools`. A new tool must also be added to `tools:` in `_server.md` (or get its own fixed mock). `evalMocks.test.ts` fails on either drift.
- Mocks carry no `src/instructions.ts`, so evals measure skills, agents and tool descriptions — not the server instructions.
- `plugin/evals/` is in `.prettierignore` on purpose: Prettier escapes `_` in markdown and corrupts JSON mock bodies. Don't format these files.

### Replays (`.replay/`)

A clean run saves every agent-mock answer to `results/<run>/mock-recordings/`, and `ADOPT.txt` there names the `.replay/platform/` dir beside the mock that produced each one. Committed recordings answer later runs without a model call. The key is a hash of the tool, its input, the mock file's contents, and every earlier agent-mock call of the run with its answer. So a replay only hits while a run makes the same agent-mock calls as the recorded one, call for call: the first calls of a case nearly always, later ones less often. It never answers a different call wrongly, and a miss just falls back to the judge model.

- **Adopt** from a clean full run (no ERRORED), normally the re-baseline run. Keep its terminal output, then let the script check each recording's sha256 against it and copy it into the `.replay/` dir the run named (`ADOPT.txt` lists the same, but sits where the agent under test could write, so the terminal log is what counts):
  ```bash
  npm run evals 2>&1 | tee /tmp/evals.log
  npm run evals:adopt -- /tmp/evals.log
  ```
- **Invalidate after editing a mock** (including `_server.md`): its old recordings can no longer hit, since the key holds the mock's contents. Delete that mock's files (`<tool>-*.json` in its `.replay/platform/`, all of `mocks/.replay/platform/` for `_server.md`), then adopt from the next clean run. Stale files cost nothing at run time, but they pile up toward the 2000-per-dir cap.
- **After a skill, agent or tool-description change** the agent under test makes different calls, so more replays miss; nothing goes wrong. Adopt the new run's recordings when you re-baseline.
- `.replay/` is not part of a case's fingerprint (`eval-compare.mjs` skips it), so adopting recordings does not mark cases `changed`.

## Run and compare

```bash
npm run evals                          # full suite, pinned Sonnet agent + Haiku judge
npm run evals -- --case 'voice-*'      # subset (globs on case name), --tag works too
npm run evals:compare                  # newest run vs plugin/evals/baseline.json; exit 1 on a drop
npm run evals:compare -- --update      # newest run becomes the baseline
npm run evals:adopt -- <terminal log>  # commit that run's agent-mock answers as replays
```

- A drop by one run out of 3 (3/3 → 2/3) prints `FLAKY?` and the `--runs 5` command to re-run, without failing. Compare that 5-run result: a second miss is a regression. Larger drops print `WORSE` and exit 1.
- `changed` means the case's files (or shared mocks) differ from the baseline's fingerprint — expected after editing a case; re-baseline.
- `ERRORED` means a run ended abnormally (timeout, usage or rate limit); errored runs are still graded, so they are never compared — re-run. `--update` refuses a run that errored or skipped any case, so re-baseline from a clean full run, in the PR that intentionally changes behaviour or a case, so the `baseline.json` diff is reviewed. Commit the code first so the baseline records the commit it ran on. If you change the pinned models in `package.json`, re-baseline too.
- Never commit `results/`. Runs make paid model calls on your own credential; `--max-cost-usd` caps a run.
