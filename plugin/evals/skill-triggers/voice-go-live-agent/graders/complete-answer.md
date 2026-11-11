---
type: llm
---

PASS if the final message to the user (a) names the failing checks from the audit (barge-in, no hang-up tool), (b) says which of them can be fixed automatically, and (c) lists manual go-live items outside the audit, such as speech-provider failover, load tests, rollback or consent. FAIL if it says the audit does not apply to this agent, or claims anything was changed.
