---
type: tool_order
before:
  tool: mcp__plugin_cognigy_platform__audit_voice_agent
  input_match: '"agentId"'
after:
  tool: mcp__plugin_cognigy_platform__audit_voice_agent
  input_match: '"apply"\s*:\s*true'
---
