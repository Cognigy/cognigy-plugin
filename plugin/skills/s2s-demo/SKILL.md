---
name: s2s-demo
description: "Use when the user wants a speech-to-speech (S2S, also called voice-to-voice or V2V) voice agent, or a callable realtime voice demo for a customer from one prompt. Covers the GPT Live voice model, the agent's voice and voice prompt, the click-to-call page, and what to do when speech-to-speech is not enabled. Call it speech-to-speech in every reply, also when the user said V2V or voice-to-voice."
---

# Speech-to-speech (S2S) demo

Speech-to-speech (S2S) is the product's name for this. Users may also say voice-to-voice or V2V: it is the same thing. Call it speech-to-speech in every answer, also when the user said V2V or voice-to-voice: never write "V2V demo", "V2V" or "voice-to-voice" yourself.

A speech-to-speech demo is four things: a `gpt-live-1` voice model (GPT Live), an AI Agent that keeps a normal text LLM and points at the voice model, a Voice Gateway endpoint on that agent, and its click-to-call page. Nothing on the endpoint says "speech-to-speech": a call runs speech-to-speech because the agent has a voice model. GPT Live hands the reasoning to the agent's text LLM, so the agent's role, instructions and tools still do the real work. The agent hears and speaks directly, for faster replies and natural interruptions.

Call it an "AI Agent" toward the user. Speech-to-speech is marked experimental on the platform; say so once in the hand-back.

## Build order

The order matters: the only gated write (step 3) comes before anything that could be left half-built.

1. **Check the environment.** `check_capabilities`.
   - `aiAgents` or `s2s` is `unavailable`: write nothing. Tell the user in one line that speech-to-speech is not enabled on this environment (an admin turns on `FEATURE_ENABLE_V2V`), and offer a cascaded voice demo (voice-gateway-setup skill) or a Webchat demo. Never switch to one of them without the user's yes.
   - `s2s` is `unknown`: carry on; step 3 is the hard gate.
2. **Project and text LLM.** Pick or create the project, then make sure it has a connected text LLM: reuse one, through packages when it lives in another project (agent-creation skill). Do this before step 3: a project's first LLM becomes its default, even when it is GPT Live.
3. **The GPT Live model.**
   - Reuse: `list_resources { resourceType: "llm_model", projectId }`, a row with `modelType: "gpt-live-1"` (`modelGroup: "voiceToVoice"`).
   - Else import one from another project that has it (package-management skill: export the LLM, its Connection comes with it).
   - Else `setup_llm { projectId, provider, modelType: "gpt-live-1", apiKey }` with a provider from `check_capabilities` `s2sProviders` and a key the user gives you. Never invent one; ask, or stop and say a key is needed.
   - `error: "s2s_not_enabled"`: stop as in step 1. Nothing else exists yet.
4. **The agent.** `manage_agent { operation: "create", projectId, agentType: "voice", name, role, description, instructions, largeLanguageModelReferenceId: <text LLM>, voiceLargeLanguageModelReferenceId: <gpt-live-1 referenceId>, realtimeVoice }`, built from the customer brief. Add a brand persona when the brand voice matters, and mock tools with the `http-request` builtin (agent-creation skill). A `_hints.warning` that the voice fields "did not stick" means speech-to-speech is off for AI Agents here: stop and offer the alternatives from step 1.
5. **The voice.** `manage_agent { operation: "voice_prompt", agentId, projectId }` lists `realtimeVoices` (default `marin`). Pick one that fits the brand, or ask when the user cares.
6. **The voice prompt.** Keep the default template and shape the agent through its role, description, instructions, persona and tools. `preview_voice_prompt { template }` must come back without `warnings`. Edit the template (`update { voicePromptTemplate }`) only for a specific need, and keep the `{{group.key}}` tokens `voice_prompt` lists, above all those with `warnIfMissing`. `voicePromptTemplate: null` resets it.
7. **Test the answers.** Two or three `talk_to_agent { agentId, projectId, message }` turns on the customer's main use cases. This tests the text LLM that GPT Live hands work to, not the voice.
8. **The click-to-call page.** The WebRTC page needs the project's voice preview provider: `manage_settings { operation: "set_voice_preview", projectId, provider, isNiceProvided: true }` where `check_capabilities` reports `niceSpeech: "available"` (settings skill), else the provider's Connection. Then `manage_voice_gateway { projectId, agentId, name, webrtcWidgetConfig: { label, avatarLogoUrl, tagline, theme } }` with the customer's name, logo and tagline.
9. **Hand back.** What was built (agent, text LLM, GPT Live model, endpoint) and the test result, then the `webrtcDemoUrl` last. The voice itself is tested by calling that link; say so.

## Changing an existing agent

- Turn speech-to-speech on: `manage_agent { operation: "update", voiceLargeLanguageModelReferenceId }`; off: the same with `""`.
- Change the voice: `realtimeVoice`; `null` resets it to the default.
- Never bind `gpt-live-1` as `largeLanguageModelReferenceId`: the platform rejects it, and a text turn would fail.
