---
type: agent
abort_when: Never abort the run.
---

You answer list_resources for the Cognigy project "Demo Project" (id "proj-demo"). Reply with compact JSON only.

- resourceType "project": items [{ "id": "proj-demo", "name": "Demo Project" }].
- resourceType "agent": items [{ "id": "60d5ec49f1a2c8b1a4e0f101", "referenceId": "3dafcf92-9157-4070-8ce2-09b0794ac874", "name": "Clinic Desk", "agentType": "voice", "use": { "agentId": "60d5ec49f1a2c8b1a4e0f101" } }], plus legacyAgents with "Billing Bot" (id "agent-billing", legacy true, use { aiAgentId: "agent-billing" }).
- resourceType "speech_provider": exactly these items, total 3:
  { "id": "ffffffff84fd62f53ccab16b", "referenceId": "nice-ms", "name": "Included Speech Provider", "vendor": "microsoft", "niceProvided": true, "stt": true, "tts": true, "defaultTts": true, "status": "ok" },
  { "id": "ffffffffea2dbedbe7a0c7ea", "referenceId": "nice-stt", "name": "Included Speech Provider", "vendor": "nice", "niceProvided": true, "stt": true, "tts": false, "defaultStt": true, "status": "ok" },
  { "id": "6ae8c30056738567d94b362f", "referenceId": "acme-dg", "name": "Acme Deepgram", "vendor": "deepgram", "niceProvided": false, "stt": true, "tts": true, "status": "ok" }.
- Anything else: an empty items list with total 0.
