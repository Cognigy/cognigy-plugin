# Voice Go-Live Checklist Guide

`audit_voice_agent` checks a voice AI agent against the deterministic subset of the Voice AI guidebook **Go-Live Checklist** (section 3) and can apply safe fixes. It reads the flow chart (and optionally the endpoint and LLM) over the Cognigy REST API, so it only covers what the API can both read and change. Speech-provider status, failover behaviour, and release-readiness items live in the external Voice Gateway app or are runtime/operational — those are **manual** and out of scope.

## Quick start

```
1. Dry-run report (no changes):
   audit_voice_agent { aiAgentId }
   audit_voice_agent { aiAgentId, endpointId, projectId }   // also checks Output Transformer + fallback LLM

2. Apply all safe fixes:
   audit_voice_agent { aiAgentId, apply: true }

3. Apply a subset:
   audit_voice_agent { aiAgentId, apply: true, only: ["vg.barge-in-off", "agent.stream-output"] }
```

- Provide `aiAgentId` (the flow is resolved for you) **or** `flowId` directly.
- `endpointId` enables the Output Transformer check. `projectId` enables the fallback-LLM check.
- **Dry-run is the default.** Nothing changes unless you pass `apply: true`.

## How it resolves things

- **Flow**: from `aiAgentId` (same resolution as the other agent tools) or the `flowId` you pass.
- **Set Session Config node**: the first chart node of type `setSessionConfig`.
- **AI Agent node**: the chart node of type `aiAgentJob`.
- **Endpoint / LLM**: only fetched when `endpointId` / `projectId` are supplied.

## Statuses

| Status | Meaning                                                                                     |
| ------ | ------------------------------------------------------------------------------------------- |
| `pass` | Meets the recommended setting.                                                              |
| `fail` | Deviates from the recommended default. Usually auto-fixable.                                |
| `warn` | Advisory — needs human judgement (e.g. hint content), not auto-fixed.                       |
| `na`   | Not applicable / not enough data (e.g. no Set Session Config node yet, or no `endpointId`). |

Each fixable check carries a `proposedFix` in the dry-run report. `summary` counts pass/fail/warn/na and how many are `fixable`.

## Checks

### Auto-fixable (applied with `apply: true`)

| ID                           | Section | Checks                                                      | Fix                                                                                           |
| ---------------------------- | ------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `vg.session-config-first`    | 3.1     | First node is a Set Session Config node                     | Creates a `setSessionConfig` node with recommended defaults, `insertBefore` the AI Agent node |
| `vg.barge-in-off`            | 3.1     | `bargeInOnSpeech` and `bargeInOnDtmf` off                   | Sets both to `false`                                                                          |
| `vg.continuous-asr-off`      | 3.1     | `asrEnabled` off (for Flux)                                 | Sets `asrEnabled = false`                                                                     |
| `vg.user-input-timeout`      | 3.1     | `userNoInputTimeout` 5000–7000 ms, `userNoInputRetries` ≥ 5 | Sets enable=true, 6000 ms, 5 retries                                                          |
| `vg.flow-input-timeout`      | 3.1     | `flowNoInputTimeoutEnable` on, ~1500 ms, filler phrase set  | Enables, 1500 ms, default filler if missing                                                   |
| `vg.flow-fails-on-error-off` | 3.1     | `flowNoInputFail` off                                       | Sets `flowNoInputFail = false`                                                                |
| `agent.stream-output`        | 3.1     | AI Agent `storeLocation = "stream"`                         | Sets `storeLocation = "stream"`                                                               |
| `agent.fails-on-error-off`   | 3.1     | AI Agent `errorHandling` ≠ `"stop"`                         | Sets `errorHandling = "continue"`                                                             |
| `agent.error-message`        | 3.2     | AI Agent `errorMessage` non-empty                           | Sets a default voice error message                                                            |
| `agent.log-llm-latency`      | 3.2     | AI Agent `debugLogLLMLatency` on                            | Sets `debugLogLLMLatency = true`                                                              |
| `vg.silence-overlay-delay`   | 3.6     | `silenceOverlayDelay = 0` when overlay configured           | Sets delay to 0 (only when overlay is in use)                                                 |

The Set Session Config value checks report `na` until a Set Session Config node exists. Creating it with `vg.session-config-first` seeds recommended defaults that already satisfy them.

### Advisory (reported, never auto-fixed)

| ID                            | Section | Why manual                                                                                            |
| ----------------------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `vg.stt-hints`                | 3.3     | Cannot invent brand/domain terms; flags when `sttHints` is empty.                                     |
| `endpoint.output-transformer` | 3.7     | Confirms the transformer is enabled and non-empty; the markdown-stripping code is not auto-generated. |
| `llm.fallback`                | 3.2     | Adding a fallback requires choosing a specific model.                                                 |

## Not covered (manual / external)

These checklist items are **not** reachable through the Cognigy REST API and must be handled manually:

- **3.3 Speech Services** — provider status (green), credential labels, STT/TTS provider regions, and STT/TTS failover live in the external **Voice Gateway app**.
- **3.4 Prompting**, **3.5 Transactions** — depend on the content/intent of Job Instructions and tool branches (judgement-based).
- **3.7 Deployment** — Click-to-Call testing, Voice Preview, Live Follow, and Voice Gateway Tracing are runtime/manual.
- **3.8 Release Readiness** — load tests, failover drills, latency SLOs, smoke tests, rollback paths, PII/recording/consent policies, cost and success metrics.

## After applying fixes

`apply: true` returns `appliedFixes` plus a fresh re-audit. Always verify the flow in the UI — particularly **node ordering** when a Set Session Config node was created (it is inserted before the AI Agent node via `insertBefore`).
