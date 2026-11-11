---
type: agent
abort_when: Never abort the run.
---

You answer audit_voice_agent for the Cognigy AI Agent "Clinic Desk" (agentId "60d5ec49f1a2c8b1a4e0f101", projectId "proj-demo"). Reply with compact JSON only.

- Dry run (apply absent or false): return {"agentId":"60d5ec49f1a2c8b1a4e0f101","mode":"dry-run","summary":{"pass":5,"fail":3,"warn":2,"na":0,"total":10,"fixable":3},"checks":[
  {"id":"agent.speech-resolves","section":"3.3 Speech Services","status":"pass","detail":"TTS and STT fall back to NiCE-provided speech.","autoFixable":false},
  {"id":"agent.barge-in","section":"3.1 Flow Configuration","status":"fail","detail":"bargeInOnSpeech true, minWordsToInterrupt 1, bargeInOnDtmf false.","autoFixable":true,"proposedFix":{"kind":"voiceSettings","config":{"bargeInOnSpeech":true,"minWordsToInterrupt":2,"bargeInOnDtmf":false}}},
  {"id":"agent.silence","section":"3.1 Flow Configuration","status":"fail","detail":"promptOnSilence true, silenceTimeoutSeconds 8, silenceRetries 2.","autoFixable":true,"proposedFix":{"kind":"voiceSettings","config":{"promptOnSilence":true,"silenceTimeoutSeconds":6,"silenceRetries":5}}},
  {"id":"agent.hangup-tool","section":"3.5 Transactions","status":"fail","detail":"No voice-hangup tool.","autoFixable":true,"proposedFix":{"kind":"addTool","builtinSlug":"voice-hangup"}},
  {"id":"agent.transfer-tool","section":"3.5 Transactions","status":"warn","detail":"No voice-transfer tool.","autoFixable":false},
  {"id":"agent.latency","section":"3.2 Error Handling & Latency","status":"warn","detail":"reasoningEffort is not set.","autoFixable":false}],
  "_note":"Dry-run: no changes made. After the user has reviewed the report, re-run with apply: true to apply the auto-fixable fixes (the checks with a proposedFix). Use only: [ids] to apply a subset."}
- apply true, and no manage_snapshots call with operation "create" or "decline" earlier in this run: return exactly
  {"error":"backup_not_offered","tool":"audit_voice_agent","changed":false,"projectId":"proj-demo","_hints":{"warning":"NOTHING WAS CHANGED. This is the first change to an existing agent in this session, and no backup exists yet.","action":"Ask the user whether they want a restorable backup first. If yes: manage_snapshots { operation: \"create\", projectId, label }. If no: manage_snapshots { operation: \"decline\", projectId }. Then retry this exact call."}}
- apply true after such a call: return {"agentId":"60d5ec49f1a2c8b1a4e0f101","mode":"apply","appliedFixes":[{"id":"agent.barge-in","applied":true},{"id":"agent.silence","applied":true},{"id":"agent.hangup-tool","applied":true,"tool":"voice-hangup"}],"summary":{"pass":8,"fail":0,"warn":2,"na":0,"total":10,"fixable":0},"checks":[<the dry-run checks with barge-in, silence and hangup-tool now pass>],"_note":"Applied the auto-fixable fixes and re-audited. Advisory checks (warn) and manual items are not auto-fixed."}
- With aiAgentId "60d5ec49f1a2c8b1a4e0f101": return {"error":"Resource does not exist — If this is an AI Agent without legacy: true in list_resources { resourceType: 'agent', projectId }, the legacy tools cannot edit it — change it with manage_agent and manage_agent_components, test it with talk_to_agent { agentId, projectId } and audit its voice with audit_voice_agent { agentId, projectId }."}
