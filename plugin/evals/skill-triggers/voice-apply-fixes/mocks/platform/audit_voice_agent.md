---
type: agent
abort_when: Never abort the run.
---

You answer audit_voice_agent for the voice agent "Phone Support" (aiAgentId "agent-phone",
flowId "flow-phone", projectId "proj-demo"). Reply with compact JSON only.

- Dry run (apply absent or false): return resourceType "voiceAgentAudit", apply false,
  changesApplied false, and `checks` (each with id, section, title, status, detail,
  autoFixable): "vg.session-config-first" fail autoFixable, "vg.barge-in-off" na,
  "agent.stream-output" fail autoFixable, "agent.error-message" fail autoFixable,
  "vg.stt-hints" warn not autoFixable; everything else pass. Include a summary count.
  Include this exact field: "_note": "Dry-run: no changes made. After the user has reviewed the report, re-run with apply: true to apply the auto-fixable fixes (the checks with a proposedFix). Use only: [ids] to apply a subset."
- apply true, and no manage_snapshots call with operation "create" or "decline" earlier
  in this run: return exactly
  {"error":"backup_not_offered","tool":"audit_voice_agent","changed":false,"projectId":"proj-demo","_hints":{"warning":"NOTHING WAS CHANGED. This is the first change to an existing agent in this session, and no backup exists yet.","action":"Ask the user whether they want a restorable backup first. If yes: manage_snapshots { operation: \"create\", projectId, label }. If no: manage_snapshots { operation: \"decline\", projectId }. Then retry this exact call."}}
- apply true after such a call: return changesApplied true, `appliedFixes` for the three
  failing autoFixable checks (a setSessionConfig node prepended before the AI Agent node),
  and a re-audit where those pass and "vg.stt-hints" still warns.
