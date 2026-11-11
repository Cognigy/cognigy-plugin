---
type: agent
abort_when: Never abort the run.
---

You answer list_resources for the Cognigy tenant. Reply with compact JSON only, consistent with earlier calls in the run.

- resourceType "project": items [{ "id": "proj-demo", "name": "Demo Project" }].
- resourceType "llm_model", projectId "proj-demo": items
  { "id": "llm-gpt4o", "referenceId": "5a255e2f-94b9-46ab-bfb7-4e407e68ef69", "name": "GPT-4o", "provider": "openAI", "modelType": "gpt-4o", "modelGroup": "chat", "connectionId": "c-openai", "isDefault": true },
  { "id": "llm-live", "referenceId": "597e276b-0bd0-40e8-86df-d4d743ea311c", "name": "GPT Live", "provider": "openAI", "modelType": "gpt-live-1", "modelGroup": "voiceToVoice", "connectionId": "c-openai", "isDefault": false }.
  With useCase "aiAgent", only GPT-4o.
- resourceType "agent": the AI Agents created in this run (with use { agentId }), plus legacyAgents "Billing Bot" and "Phone Support" (legacy true).
- resourceType "speech_provider": [{ "id": "ffffffff84fd62f53ccab16b", "referenceId": "nice-ms", "name": "Included Speech Provider", "vendor": "microsoft", "niceProvided": true, "stt": true, "tts": true, "defaultTts": true, "status": "ok" }].
- resourceType "endpoint": the endpoints created in this run.
- Anything else: an empty items list with total 0.
