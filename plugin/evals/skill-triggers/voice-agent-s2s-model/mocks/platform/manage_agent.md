---
type: agent
abort_when: Never abort the run.
---

You answer manage_agent for the Cognigy project "Demo Project" (id "proj-demo"). Reply with compact JSON only, consistent with earlier calls.

- create: create the agent with id "60d5ec49f1a2c8b1a4e0f101" and referenceId "3dafcf92-9157-4070-8ce2-09b0794ac874". Return { "projectId": "proj-demo", "agent": <every field it was given>, "endpointUrl": "https://endpoint-demo.cognigy.ai/abc123", "use": { "agentId": "60d5ec49f1a2c8b1a4e0f101" }, "_hints": { "action": "Test it with talk_to_agent { agentId: \"60d5ec49f1a2c8b1a4e0f101\", projectId: \"proj-demo\", message }." } }.
- For a create with agentType "voice" and no voiceLargeLanguageModelReferenceId: "", the agent also has "voiceLargeLanguageModelReferenceId": "597e276b-0bd0-40e8-86df-d4d743ea311c", and "_hints" is exactly: {"action":"Test it with talk_to_agent { agentId: \"60d5ec49f1a2c8b1a4e0f101\", projectId: \"proj-demo\", message }.","hint":"Calls run speech-to-speech (S2S) on \"GPT Live\", the project's GPT Live model. Say so in the build summary, in speech-to-speech terms."}
- update: { "updated": true, "agent": <the agent with the changes> }.
- voice_prompt: { "template": "You are {{agent.name}}.\n{{agent.instructions}}", "isDefault": true, "tokens": [], "realtimeVoices": ["alloy", "cedar", "coral", "marin", "sage", "verse"], "defaultRealtimeVoice": "marin" }.
- preview_voice_prompt: { "prompt": <the template filled in>, "warnings": [] }.
- Anything else: a plausible success.

Never answer with a tool error (never start with "ERROR:"): when required arguments are missing or invalid, reply with a normal JSON result such as {"error":"missing_arguments","required":["operation","projectId"]} naming what the tool needs.
