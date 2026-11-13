---
name: voice-gateway-setup
description: "Use when the user wants to set up a voice agent (cascaded or speech-to-speech, S2S, also called voice-to-voice or V2V), choose its voice or speech provider (TTS/STT, NiCE-provided speech), change its call behaviour (greeting, barge-in, silence), or create a Voice Gateway endpoint with WebRTC for browser-based voice interaction."
---

# Voice Gateway Setup Guide

Deploy an AI Agent as a voice-enabled endpoint with WebRTC support. Users can talk to the agent directly in their browser.

Where `check_capabilities` reports `aiAgents: "available"`, follow **AI Agents** below. The rest of this guide is for legacy AI Agents (built with `create_ai_agent`) and other flows.

## AI Agents

An AI Agent's speech and call behaviour live on the agent itself, in its `voice_settings` (`manage_agent_components { component: "voice_settings" }`). Nothing to set there means the defaults: the call takes its speech from the endpoint, then the project's default speech credential, then NiCE-provided speech.

1. **Check the environment.** `check_capabilities` → `niceSpeech: "available"` means the organisation has NiCE-provided speech: no Connection and no customer key needed. `s2s` says whether speech-to-speech (S2S, GPT Live) is on, and `s2sProviders` which LLM providers can run it.
2. **Speech-to-speech first.** Speech-to-speech (S2S) is the product's name; users may say voice-to-voice or V2V for the same thing. Always call it speech-to-speech yourself, also when the user said V2V or voice-to-voice, and never echo their term. It responds faster and sounds more natural, so a new voice agent gets it whenever possible. Never present speech recognition and synthesis as a fallback or a downgrade. The platform ships no speech-to-speech model: it needs one the user brought.
   - `s2s` is `unavailable`: skip this step and never mention speech-to-speech.
   - The project has a `gpt-live-1` model (`modelGroup: "voiceToVoice"`): nothing to do, `manage_agent create` binds it for a voice agent.
   - Another project has one: you see it in the agent-creation skill's LLM scan (shared step 4), which also runs for a voice agent whose project has no such model. Ask once: "Project X has a speech-to-speech (S2S) model. Copy it here?" The copy carries that model's API key into this project, which may belong to another team. On yes, copy it with packages (shared step 5, the LLM alone; its Connection comes with it) before `manage_agent create`, or set it afterwards with `manage_agent { operation: "update", voiceLargeLanguageModelReferenceId }`. On no, carry on with speech.
   - The user named a speech setup (e.g. "use Deepgram"): pass `voiceLargeLanguageModelReferenceId: ""` on create, and don't offer speech-to-speech.
   - Otherwise the agent uses speech recognition and synthesis (steps 4-6). The create result's `_hints.hint` then carries one line offering speech-to-speech: make it the last paragraph of the build summary, once, word for word, with no label or bullet. That line is the only mention: don't explain why the agent isn't speech-to-speech ("the project has no speech-to-speech model, so…"), and don't use the line when you already asked about a copy.
3. **The agent.** `manage_agent { operation: "create", agentType: "voice", ... }` (agent-creation skill), or an existing one from `list_resources { resourceType: "agent", projectId }`. With a voice model, read the s2s-demo skill for the voice and the voice prompt.
4. **Pick the speech.** A new voice agent without a voice model already has it: `manage_agent create` sets NiCE-provided speech in the project's language when the organisation has it, and returns it as `speech`. With several NiCE-provided vendors, TTS is Deepgram and STT is NiCE; when Deepgram has no voice for the language, the next one with a voice. Mention the speech in the build summary (when the create result carries the speech-to-speech offer line, that line is the mention: keep it whole and add no speech bullet), and only change it when the user asks. To change it: `list_resources { resourceType: "speech_provider", projectId }`, then prefer, in this order:
   - a `niceProvided: true` row, Deepgram for TTS and NiCE for STT, when the user has no preference;
   - the project's own credential (`niceProvided: false`, `status: "ok"`);
   - otherwise ask the user. Never invent a credential, vendor or voice id.
   A row serves TTS only with `tts: true` and STT only with `stt: true` (the `nice` vendor is STT only).
5. **Set the agent's speech.**
   ```json
   {
     "operation": "update",
     "component": "voice_settings",
     "projectId": "<24-char hex>",
     "agentId": "<24-char hex>",
     "config": {
       "ttsCredentialReferenceId": "<speech_provider referenceId>",
       "ttsLanguage": "en-US",
       "sttCredentialReferenceId": "<speech_provider referenceId>",
       "sttLanguage": "en-US"
     }
   }
   ```
   The credential also fills `ttsVendor`/`ttsLabel` (or `sttVendor`/`sttLabel`). Without `ttsVoice` the result lists `voices` for that language: pick one (ask the user when it matters) and update `ttsVoice`. Each block counts only when complete: TTS needs vendor, voice and language; STT needs vendor and language. An incomplete block is ignored on calls, and the result warns about it.
6. **Call behaviour (optional), same `config`:**
   | Key | Meaning (default) |
   | --- | --- |
   | `greetingMode`, `greetingText` | who speaks first: `agent` (default), `static` speaks `greetingText`, `none` waits |
   | `bargeInOnSpeech`, `minWordsToInterrupt` | caller can interrupt (on); words needed (1; 2-3 stops "uh-huh" from cutting in) |
   | `promptOnSilence`, `silenceTimeoutSeconds`, `silenceRetries` | re-prompt a silent caller (on, 8 s, 2 times) |
   | `thinkingSound`, `backgroundSound` | `typing_loop` while thinking (default), `none`; background `none` or `hold_music` |
   | `maxUtteranceChars` | longest spoken reply (240) |
   `get` shows every key and its value; `delete` resets the agent to the defaults.
7. **Voice preview for the click-to-call page.** The WebRTC client needs the project's voice preview provider, for AI Agents too: `manage_settings { operation: "set_voice_preview", projectId, provider: "microsoft", isNiceProvided: true }` with a vendor that has a `niceProvided` row, else the provider's Connection (settings skill).
8. **The endpoint.** `manage_voice_gateway { projectId, agentId, name, webrtcWidgetConfig }` → show `webrtcDemoUrl`. Don't try to set speech on the endpoint for an AI Agent: the agent's `voice_settings` are the place.
9. **Voice tools.** Let the agent end calls: `manage_agent_components { operation: "create", component: "tool", projectId, agentId, config: { builtinSlug: "voice-hangup", ... } }`; add `voice-transfer` when calls get handed to a person.
10. **Test.** `talk_to_agent { agentId, projectId }` tests the answers as text only. The voice itself is tested by calling `webrtcDemoUrl`; say so to the user.

## Legacy AI Agents and flows

### Prerequisites

1. **A Project** — use `list_resources { resourceType: "project" }` to find one, or let `create_ai_agent` create one automatically.
2. **A Flow** — the conversation logic the voice endpoint connects to. Use `list_resources { resourceType: "flow", projectId }` to find existing flows.
3. **An LLM** — the agent needs an LLM to generate responses. Use `setup_llm` if not configured.

### Quick Start

#### 1. Create a Voice Gateway endpoint

```json
{
  "projectId": "<24-char hex>",
  "flowId": "<flow referenceId>",
  "name": "My Voice Agent"
}
```

This automatically:

- Creates a `voiceGateway2` endpoint
- Provisions a WebRTC client
- Returns a `webrtcDemoUrl` the user can open in a browser

#### 2. Customize the WebRTC widget (optional)

```json
{
  "projectId": "<24-char hex>",
  "flowId": "<flow referenceId>",
  "name": "My Voice Agent",
  "webrtcWidgetConfig": {
    "label": "Support Agent",
    "theme": "AI_PURPLE",
    "transcription": { "enabled": true },
    "tagline": "How can I help you today?",
    "avatarLogoUrl": "https://example.com/avatar.png"
  }
}
```

#### 3. Update an existing endpoint

```json
{
  "endpointId": "<24-char hex>",
  "webrtcWidgetConfig": {
    "theme": "CLEAN_WHITE"
  }
}
```

Create vs update:

- Omit `endpointId` → a new `voiceGateway2` endpoint is always created (`projectId` + `flowId` required). The tool never auto-detects an existing endpoint.
- Pass `endpointId` → that endpoint is updated and the settings you pass are merged into its existing configuration; everything else is preserved. Find it first with `list_resources { resourceType: "endpoint", projectId }`.

## WebRTC Widget Themes

| Theme         | Description               |
| ------------- | ------------------------- |
| `DARK_MODE`   | Dark background (default) |
| `CLEAN_WHITE` | Light/white background    |
| `AI_PURPLE`   | Purple accent theme       |

## URLs in the Response

| Field                           | Purpose                                                              |
| ------------------------------- | -------------------------------------------------------------------- |
| `webrtcDemoUrl`                 | Open in browser to talk to the agent — **always show this to users** |
| `_integration.wsEndpointUrl`    | WebSocket URL for programmatic/embedded use                          |
| `_integration.embeddingSnippet` | HTML code to embed the voice widget on a website                     |

Present `webrtcDemoUrl` as a clickable link after every successful create or update — do not send the user to the Cognigy UI to find it. Mention the `_integration` fields only when the user asks about embedding or deploying to a website.

## Embedding on a Website

Copy the `embeddingSnippet` from the response into your HTML page. It loads the Cognigy WebRTC widget and connects to the voice endpoint automatically.

## Typical Full Workflow (legacy)

1. `create_ai_agent` → get `flowId` and `projectId`
2. `setup_llm` → configure LLM for the project
3. `manage_voice_gateway { projectId, flowId }` → get `webrtcDemoUrl`
4. Share the URL with the user
