---
name: simulator
description: "Use when the user wants to test an AI Agent or Flow with simulated conversations in the Cognigy Simulator: create, edit, clone or delete simulations (test scenarios, test cases, personas with a mission and success criteria), run a simulation or rerun a batch, check whether it passed, read run results, transcripts and success rates, stop a running batch, schedule recurring simulation runs (nightly, daily, weekly regression tests), view the Simulator dashboard, generate personas and missions for a Flow, or create test scenarios from a CSV conversation transcript. Not for chatting with an agent by hand (talk_to_agent) or for auditing a voice agent's settings."
---

# Cognigy Simulator

The Simulator tests an agent with automated conversations. Everything here goes through
`manage_simulations { operation, projectId, ... }`.

- A **simulation** (scenario) is a persona, a mission and success criteria, written for one
  target: a Flow or an AI Agent. It cannot be pointed at the other kind.
- **run** starts a **batch** of one or more simulated conversations (**runs**) and reports a
  success rate: 0.0 means every run failed, 1.0 means every run passed.
- Batch status: `IN_PROGRESS`, `COMPLETED`, `FAILED` or `STOPPED`.

## Ids

- `simulationReference`, `batchReference`, `runReference` and `scheduleReference` are 24-char
  hex ids from earlier results. Never guess one and never use a simulation's UUID.
- Flows and AI Agents have two ids. Targets take the **UUID** `referenceId`
  (`flowReferenceId`, `agentReferenceId`). Persona operations take the Flow's **24-char hex
  id** (`flowId`). Get both from `list_resources { resourceType: 'flow' | 'agent' }`.
- `agentReferenceId` is the `referenceId` of an AI Agent (not a legacy one). A legacy AI
  Agent is tested through its Flow: use that Flow's ids.
- Evaluation profile ids and goal ids (for `goalCompleted` criteria) cannot be looked up
  with this plugin. Use only ids the user gives you.
- Talk about simulations, batches and runs by name. Show an id only when the user asks.

## Find the simulation the user means

1. When the user names one, `list { nameFilter: <what the user said> }` rather than an
   unfiltered list to pick from.
2. No match: say there is no simulation by that name. Don't pick a similar one.
3. Several matches: list them and ask which one.

## Run and read results

1. `run { simulationReference }`. It runs against the scenario's own target and the live
   project with the project's default LLM. Never ask the user for a target, snapshot, LLM,
   entrypoint or timezone. `numberOfExecutions` defaults to 1.
2. Poll `get_batch { simulationReference, batchReference }` until the status is final. Always
   read the latest status before you report results.
3. For runs that did not pass, `get_runs { simulationReference, batchReference }`, then
   `get_runs { ..., runReference }` for one run's transcript and per-criterion results.
4. Summarize: success rate, which criteria failed, and what the transcript shows went wrong.

`rerun_batch` replays a batch's target, snapshot, locale, LLM, evaluation profiles, run
count and stop condition as a new batch. Use it for "run that again". A fresh `run`
uses the scenario's current settings instead. Multivariate batches cannot be rerun.

`list_batches` without `simulationReference` lists every batch in the project.

## Create a simulation

Persona operations analyse a Flow. For an AI Agent target, draft the name, persona,
mission and success criteria with the user (or use `import_transcript`), then
`create { ..., agentReferenceId }`. For a Flow:

1. Find the Flow with `list_resources`: its UUID and its 24-char hex id.
2. `persona_options { flowId }` returns the valid persona types, mission types and suggested
   success criteria. Never invent types.
3. `generate_persona { flowId, selectedMissionType, selectedPersonaType }` with one of each,
   verbatim from step 2. It drafts the name, persona, mission and success criteria; its
   `simulationName` is `name` and its `personaDescription` is `persona` in this tool.
4. Show the draft. To change one field, `regenerate_persona_field` with the whole current
   draft (`name`, `personaName`, `persona`, `mission`, `successCriteria`) and
   `fieldToRegenerate`; add `successCriteriaIndex` for one criterion.
5. `create { name, persona, personaName, mission, successCriteria, flowReferenceId }` (or
   `agentReferenceId` for an AI Agent). Pass `flowId` too, so persona operations keep working.

Persona operations are LLM calls and can take up to a minute. Say so before you start.

`language` takes the language's English name: translate the user's word for it first
("Español" becomes "Spanish", "Deutsch" becomes "German").

Success criteria:

```json
[
  { "type": "text", "params": { "name": "Confirmation", "text": "The user receives a booking confirmation" } },
  { "type": "goalCompleted", "params": { "name": "Booked", "referenceId": "<goal id the user gave you>" } }
]
```

`maxTurns` is 1-30 and defaults to 15. Don't raise it "to be safe": every turn is a model call.

## Create simulations from a transcript

Ask the user for the path of a CSV transcript on their machine, then
`import_transcript { filePath, flowReferenceId? }`. One call uploads the file and returns up to
three scenario drafts. The service rejects a file without the header row
`speaker,message,created_at` or with fewer than 100 words of conversation; if it does, tell the
user what to change rather than editing their file. Show them, and `create` the one the user picks with its target. If the
result is `transcript_import_disabled`, use the persona operations above instead.

## Schedule recurring runs

- `list_schedules { simulationReference }` shows the schedule, if any.
- A simulation has at most one schedule. `upsert_schedule { simulationReference, ... }`
  changes the existing one, or creates it, which needs `name`, `frequency` and `time`.
  `frequency` is daily, every three days, weekly, biweekly or monthly. `numberOfRuns`
  defaults to 10.
- Change or pause: pass only the fields to change (`enableSchedule: false` pauses). Send
  `time` only when the user changes it.
- `time` is 24-hour `HH:mm` in the project's timezone, e.g. `09:00`. Never build an ISO or
  UTC time, and never ask for a timezone: the project's is used.

## Times

Results carry each timestamp a second time as `<field>Local`, already in the project's
timezone, e.g. `nextScheduledRunLocal: "2026-09-16 09:00 (Europe/Berlin)"`. Show that value as
given. A schedule with `scheduleTimezone` fires in that zone, not the project's: say so.
`currentTimeLocal` is the time there now: use it for "today" or "tomorrow". Never
convert a time yourself or name a timezone the result does not contain. If a result has
`timezoneNote`, follow it.

## Before you change things

- `delete` is permanent and also removes the simulation's batches, runs and schedules.
  Without `confirm` it only returns a preflight: show it, and retry with `confirm: true`
  only after the user agrees.
- `stop_batch` ends the remaining runs of a batch. Confirm first.
- Locale selection is not supported: the scenario's own locale or the project's primary one
  is used. If the user asks for a locale, say so.

## Errors

- `simulator_forbidden`: status 401 means the key's user lacks the Simulator right for that
  operation; 403 means no access to the project (not a member, API-key login not allowed, a
  wrong projectId or an id from another project). Tell the user; don't retry.
- `simulator_unavailable` / `transcript_import_unavailable`: not on this environment.
- `simulator_not_found`: the id does not exist (deleted, expired or wrong). List again.
- `simulator_request_rejected`: the service refused the input; its message says why.
- `simulation_has_no_target`: ask which Flow or AI Agent it tests and `update` it.
- `scenario_target_mismatch`: a scenario cannot switch between a Flow and an AI Agent;
  create a new one for the other target.
