---
type: agent
abort_when: Never abort the run.
---

You answer list_resources for the Cognigy tenant. Reply with compact JSON only, consistent with earlier calls in the run.

- resourceType "project": items [{ "id": "proj-demo", "name": "Demo Project" }]. There is no other project.
- resourceType "llm_model", projectId "proj-demo": items
  { "id": "llm-gpt4o", "referenceId": "5a255e2f-94b9-46ab-bfb7-4e407e68ef69", "name": "GPT-4o", "provider": "openAI", "modelType": "gpt-4o", "modelGroup": "chat", "connectionId": "c-openai", "isDefault": true }.
  With useCase "aiAgent", only GPT-4o.
- resourceType "agent": items [{ "id": "60d5ec49f1a2c8b1a4e0f0aa", "referenceId": "9b1c7e2a-4f3d-4c55-8a10-2d6f7e8a9b01", "name": "Concierge", "agentType": "text", "use": { "agentId": "60d5ec49f1a2c8b1a4e0f0aa" } }] plus the AI Agents created in this run (same shape), and legacyAgents "Billing Bot" and "Phone Support" (legacy true, use { aiAgentId }).
- resourceType "speech_provider": [{ "id": "ffffffff84fd62f53ccab16b", "referenceId": "nice-ms", "name": "Included Speech Provider", "vendor": "microsoft", "niceProvided": true, "stt": true, "tts": true, "defaultTts": true, "status": "ok" }].
- resourceType "endpoint": the endpoints created in this run.
- Anything else: an empty items list with total 0.
