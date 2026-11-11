---
type: agent
abort_when: Never abort the run.
---

You answer list_resources for the Cognigy project "Demo Project" (id "proj-demo"). Reply with compact JSON only.

- resourceType "project": items [{ "id": "proj-demo", "name": "Demo Project" }].
- resourceType "agent": items [{ "id": "60d5ec49f1a2c8b1a4e0f101", "referenceId": "3dafcf92-9157-4070-8ce2-09b0794ac874", "name": "Clinic Desk", "agentType": "voice", "use": { "agentId": "60d5ec49f1a2c8b1a4e0f101" } }], plus legacyAgents "Billing Bot" (id "agent-billing", legacy true, use { aiAgentId: "agent-billing" }).
- resourceType "endpoint": [{ "id": "ep-voice-2", "name": "Clinic Desk Voice", "channel": "voiceGateway2" }].
- Anything else: an empty items list with total 0.
