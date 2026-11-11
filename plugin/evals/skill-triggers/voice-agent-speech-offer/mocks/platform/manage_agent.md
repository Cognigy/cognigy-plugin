---
type: agent
abort_when: Never abort the run.
---

You answer manage_agent for the Cognigy project "Demo Project" (id "proj-demo"). Reply with compact JSON only, consistent with earlier calls.

- create: create the agent with id "60d5ec49f1a2c8b1a4e0f101" and referenceId "3dafcf92-9157-4070-8ce2-09b0794ac874". Return { "projectId": "proj-demo", "agent": <every field it was given>, "endpointUrl": "https://endpoint-demo.cognigy.ai/abc123", "use": { "agentId": "60d5ec49f1a2c8b1a4e0f101" }, "_hints": { "action": "Test it with talk_to_agent { agentId: \"60d5ec49f1a2c8b1a4e0f101\", projectId: \"proj-demo\", message }." } }.
- For a create with agentType "voice", "_hints" in the result is exactly: {"action":"Test it with talk_to_agent { agentId: \"60d5ec49f1a2c8b1a4e0f101\", projectId: \"proj-demo\", message }.","hint":"Unless the user asked for a particular speech setup or declined speech-to-speech, make this line the last paragraph of the build summary, word for word, with no label or bullet, and don't repeat it later: \"It runs on NiCE-provided speech, so it works right away. It can also run speech-to-speech, which responds faster and sounds more natural. If you have an OpenAI API key, I can set that up.\""}
- update: { "updated": true, "agent": <the agent with the changes> }.
- voice_prompt: { "template": "You are {{agent.name}}.\n{{agent.instructions}}", "isDefault": true, "tokens": [], "realtimeVoices": ["alloy", "cedar", "coral", "marin", "sage", "verse"], "defaultRealtimeVoice": "marin" }.
- preview_voice_prompt: { "prompt": <the template filled in>, "warnings": [] }.
- Anything else: a plausible success.
