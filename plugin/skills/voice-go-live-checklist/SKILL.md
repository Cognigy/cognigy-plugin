---
name: voice-go-live-checklist
description: "Use before calling audit_voice_agent, and whenever the user asks if a Cognigy voice agent is ready for production calls, go-live or launch, or wants it audited, validated or made production-ready. The audit covers only the API-checkable part of the Voice Go-Live Checklist; this skill lists the manual items a complete readiness answer needs (speech-provider status, failover, load tests, rollback, consent) and which checks are auto-fixable."
---

# Voice Go-Live Checklist Guide

`audit_voice_agent` checks a voice AI agent against the deterministic subset of the Voice AI guidebook **Go-Live Checklist** (section 3) and can apply safe fixes. It reads the agent's configuration over the Cognigy REST API, so it only covers what the API can both read and change. Speech-provider status, failover behaviour, and release-readiness items live in the external Voice Gateway app or are runtime/operational — those are **manual** and out of scope.

It has two rule sets. **AI Agents** (`list_resources` shows `use: { agentId }`) are audited with `audit_voice_agent { agentId, projectId }`: their call behaviour lives in the agent's voice settings, tools, LLMs and Voice Gateway endpoint (next section). **Legacy AI Agents** (`legacy: true`) are audited with `{ aiAgentId }` or `{ flowId }` against their flow chart (the sections after it). The manual items at the end apply to both.

## Statuses

| Status | Meaning                                                                                     |
| ------ | ------------------------------------------------------------------------------------------- |
| `pass` | Meets the recommended setting.                                                              |
| `fail` | Deviates from the recommended default. Usually auto-fixable.                                |
| `warn` | Advisory — needs human judgement (e.g. hint content), not auto-fixed.                       |
| `na`   | Not applicable / not enough data (e.g. no Set Session Config node yet, or no `endpointId`). |

Each fixable check carries a `proposedFix` in the dry-run report, for both kinds of agent. `summary` counts pass/fail/warn/na and how many are `fixable`.

**Dry-run first, always**, even when the user already asked for the fixes. Nothing changes unless you pass `apply: true`, and only the dry-run report shows the user what fails before anything changes.

## AI Agents

```
1. Dry-run report (no changes):
   audit_voice_agent { agentId, projectId }
   audit_voice_agent { agentId, projectId, endpointId }   // a specific Voice Gateway endpoint

2. Apply all safe fixes (only after the dry-run, also when the user already asked for them):
   audit_voice_agent { agentId, projectId, apply: true }
```

Without `endpointId` the audit finds the Voice Gateway endpoint that targets the agent. Fixes change only the agent's voice settings and attach `voice-hangup`; they pass the backup gate like any other change.

| ID                      | Section | Checks                                                                                                                  | Auto-fix                                         |
| ----------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `agent.speech-resolves` | 3.3     | TTS and STT are complete in the voice settings, or the call falls back to working speech (endpoint, project default, NiCE-provided) | No: the credential is the user's choice      |
| `agent.barge-in`        | 3.1     | Barge-in on speech, at least 2 words to interrupt, keypresses don't interrupt                                          | Yes: minWordsToInterrupt 2, bargeInOnDtmf off    |
| `agent.continuous-asr`  | 3.1     | `continuousAsr` off                                                                                                     | Yes                                              |
| `agent.silence`         | 3.1     | Re-prompt a silent caller after 5-7 s, at least 5 times                                                                 | Yes: 6 s, 5 retries                              |
| `agent.hangup-tool`     | 3.5     | `voice-hangup` attached                                                                                                 | Yes                                              |
| `agent.transfer-tool`   | 3.5     | `voice-transfer` attached                                                                                               | No (warn): it needs a transfer target            |
| `agent.latency`         | 3.2     | `reasoningEffort` none, minimal or low; a thinking sound; at most 3 skills                                              | No (warn)                                        |
| `agent.text-llm`        | 3.2     | A connected text LLM, never a voice-to-voice model                                                                      | No                                               |
| `agent.v2v`             | 3.4     | With GPT live: the voice model is a connected `gpt-live-1` and the voice prompt preview has no warnings (else `na`)     | No                                               |
| `endpoint.agent-target` | 3.7     | An active Voice Gateway endpoint targets the agent                                                                      | No: `manage_voice_gateway { projectId, agentId }` |

Barge-in differs from the legacy rule on purpose: AI Agents can require several words before an interruption counts, so barge-in stays on. Fix the warnings with `manage_agent_components { component: "voice_settings" }` (voice-gateway-setup skill) and `manage_agent` once the user has decided.

## Legacy AI Agents

### Quick start

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

### How it resolves things

- **Flow**: from `aiAgentId` (same resolution as the other agent tools) or the `flowId` you pass.
- **Set Session Config node**: the first chart node of type `setSessionConfig`.
- **AI Agent node**: the chart node of type `aiAgentJob`.
- **Endpoint / LLM**: only fetched when `endpointId` / `projectId` are supplied.

### Checks

#### Auto-fixable (applied with `apply: true`)

| ID                           | Section | Checks                                                      | Fix                                                                                               |
| ---------------------------- | ------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `vg.session-config-first`    | 3.1     | First node is a Set Session Config node                     | Creates a `setSessionConfig` node with recommended defaults, `prepend`ed before the AI Agent node |
| `vg.barge-in-off`            | 3.1     | `bargeInOnSpeech` and `bargeInOnDtmf` off                   | Sets both to `false`                                                                              |
| `vg.continuous-asr-off`      | 3.1     | `asrEnabled` off (for Flux)                                 | Sets `asrEnabled = false`                                                                         |
| `vg.user-input-timeout`      | 3.1     | `userNoInputTimeout` 5000–7000 ms, `userNoInputRetries` ≥ 5 | Sets enable=true, 6000 ms, 5 retries                                                              |
| `vg.flow-input-timeout`      | 3.1     | `flowNoInputTimeoutEnable` on, ~1500 ms, filler phrase set  | Enables, 1500 ms, default filler if missing                                                       |
| `vg.flow-fails-on-error-off` | 3.1     | `flowNoInputFail` off                                       | Sets `flowNoInputFail = false`                                                                    |
| `agent.stream-output`        | 3.1     | AI Agent `storeLocation = "stream"`                         | Sets `storeLocation = "stream"`                                                                   |
| `agent.fails-on-error-off`   | 3.1     | AI Agent `errorHandling` ≠ `"stop"`                         | Sets `errorHandling = "continue"`                                                                 |
| `agent.error-message`        | 3.2     | AI Agent `errorMessage` non-empty                           | Sets a default voice error message                                                                |
| `agent.log-llm-latency`      | 3.2     | AI Agent `debugLogLLMLatency` on                            | Sets `debugLogLLMLatency = true`                                                                  |
| `vg.silence-overlay-delay`   | 3.6     | `silenceOverlayDelay = 0` when overlay configured           | Sets delay to 0 (only when overlay is in use)                                                     |

The Set Session Config value checks report `na` until a Set Session Config node exists. Creating it with `vg.session-config-first` seeds recommended defaults that already satisfy them.

#### Advisory (reported, never auto-fixed)

| ID                            | Section | Why manual                                                                                            |
| ----------------------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `vg.stt-hints`                | 3.3     | Cannot invent brand/domain terms; flags when `sttHints` is empty.                                     |
| `endpoint.output-transformer` | 3.7     | Confirms the transformer is enabled and non-empty; the markdown-stripping code is not auto-generated. |
| `llm.fallback`                | 3.2     | Adding a fallback requires choosing a specific model.                                                 |

### After applying fixes (legacy)

`apply: true` returns `appliedFixes` plus a fresh re-audit. Always verify the flow in the UI — particularly **node ordering** when a Set Session Config node was created (it is `prepend`ed before the AI Agent node on the flow's `next` chain).

## Not covered (manual / external)

These checklist items are **not** reachable through the Cognigy REST API and must be handled manually:

- **3.3 Speech Services** — provider status (green), credential labels, STT/TTS provider regions, and STT/TTS failover live in the external **Voice Gateway app**.
- **3.4 Prompting**, **3.5 Transactions** — depend on the content/intent of Job Instructions and tool branches (judgement-based).
- **3.7 Deployment** — Click-to-Call testing, Voice Preview, Live Follow, and Voice Gateway Tracing are runtime/manual.
- **3.8 Release Readiness** — load tests, failover drills, latency SLOs, smoke tests, rollback paths, PII/recording/consent policies, cost and success metrics.
