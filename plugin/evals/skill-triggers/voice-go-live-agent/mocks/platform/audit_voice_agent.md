---
type: agent
abort_when: Never abort the run.
---

You answer audit_voice_agent for the Cognigy AI Agent "Clinic Desk". Reply with compact JSON only.

- With agentId "60d5ec49f1a2c8b1a4e0f101" and projectId "proj-demo", apply absent or false: return
  {"agentId":"60d5ec49f1a2c8b1a4e0f101","mode":"dry-run","summary":{"pass":5,"fail":2,"warn":2,"na":0,"total":9,"fixable":2},"checks":[
  {"id":"agent.speech-resolves","section":"3.3 Speech Services","status":"pass","detail":"TTS: none set; calls use microsoft (Included Speech Provider, NiCE-provided). STT: none set; calls use nice (Included Speech Provider, NiCE-provided).","autoFixable":false},
  {"id":"agent.barge-in","section":"3.1 Flow Configuration","status":"fail","detail":"bargeInOnSpeech true, minWordsToInterrupt 1, bargeInOnDtmf false.","autoFixable":true,"proposedFix":{"kind":"voiceSettings","config":{"bargeInOnSpeech":true,"minWordsToInterrupt":2,"bargeInOnDtmf":false}}},
  {"id":"agent.continuous-asr","section":"3.1 Flow Configuration","status":"pass","detail":"continuousAsr false.","autoFixable":false},
  {"id":"agent.hangup-tool","section":"3.5 Transactions","status":"fail","detail":"No voice-hangup tool: the agent cannot end a call itself.","autoFixable":true,"proposedFix":{"kind":"addTool","builtinSlug":"voice-hangup"}},
  {"id":"agent.transfer-tool","section":"3.5 Transactions","status":"warn","detail":"No voice-transfer tool.","autoFixable":false},
  {"id":"agent.latency","section":"3.2 Error Handling & Latency","status":"warn","detail":"reasoningEffort is not set.","autoFixable":false},
  {"id":"agent.text-llm","section":"3.2 Error Handling & Latency","status":"pass","detail":"\"GPT-4o\" (gpt-4o).","autoFixable":false},
  {"id":"agent.v2v","section":"3.4 Prompting","status":"na","detail":"No voice model.","autoFixable":false},
  {"id":"endpoint.agent-target","section":"3.7 Deployment","status":"pass","detail":"Endpoint \"Clinic Desk Voice\".","autoFixable":false}],
  "_note":"Dry-run: no changes made. After the user has reviewed the report, re-run with apply: true to apply the auto-fixable fixes (the checks with a proposedFix). Use only: [ids] to apply a subset."}
- With aiAgentId "60d5ec49f1a2c8b1a4e0f101": return {"error":"Resource does not exist — If this is an AI Agent without legacy: true in list_resources { resourceType: 'agent', projectId }, the legacy tools cannot edit it — change it with manage_agent and manage_agent_components, test it with talk_to_agent { agentId, projectId } and audit its voice with audit_voice_agent { agentId, projectId }."}
- apply true: return {"error":"backup_not_offered","changed":false}.
