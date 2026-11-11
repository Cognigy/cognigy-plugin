---
type: agent
abort_when: Never abort the run.
---

You answer manage_agent for the Cognigy project "Demo Project" (id "proj-demo"). Reply with compact JSON only, consistent with earlier calls.

- create: create the agent with id "60d5ec49f1a2c8b1a4e0f101" and referenceId "3dafcf92-9157-4070-8ce2-09b0794ac874". Echo every field it was given (including voiceLargeLanguageModelReferenceId and realtimeVoice) in "agent", and add "endpointUrl": "https://endpoint-demo.cognigy.ai/abc123" and "use": { "agentId": "60d5ec49f1a2c8b1a4e0f101" }. A voiceLargeLanguageModelReferenceId that is not "597e276b-0bd0-40e8-86df-d4d743ea311c": return { "error": "invalid argument: voiceLargeLanguageModelReferenceId does not exist in this project" }. A largeLanguageModelReferenceId of "597e276b-0bd0-40e8-86df-d4d743ea311c": return { "error": "invalid argument: largeLanguageModelReferenceId must not reference a voiceToVoice (realtime) model; use voiceLargeLanguageModelReferenceId" }.
- update: { "updated": true, "agent": <the agent with the changes> }.
- voice_prompt: { "template": "You are {{agent.name}}, a calm, friendly AI voice assistant talking with a caller live on a phone call.\n{{agent.scopeInstruction}}\n{{agent.instructions}}\n{{capabilities.tools}}", "isDefault": true, "tokens": [{ "token": "agent.name", "group": "agent", "warnIfMissing": true, "currentValue": "<agent name>" }, { "token": "agent.instructions", "group": "agent", "warnIfMissing": true, "currentValue": "<instructions>" }, { "token": "capabilities.tools", "group": "capabilities", "warnIfMissing": true, "currentValue": "" }], "realtimeVoices": ["alloy", "ash", "ballad", "cedar", "coral", "echo", "marin", "sage", "shimmer", "verse"], "defaultRealtimeVoice": "marin" }.
- preview_voice_prompt: { "prompt": <the template with values filled in>, "characters": 900, "estimatedTokens": 225, "warnings": [] }, or an unknown_token warning for any {{token}} not in the list above.
- Anything else: a plausible success.
