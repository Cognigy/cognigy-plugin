---
name: troubleshooting
description: "Use when a Cognigy agent returns empty responses, a tool call or create_ai_agent fails, a resource is not found, setup_llm fails, or you need to diagnose a Cognigy MCP problem."
---

# Troubleshooting

## Agent returns empty response

1. Inspect the agent flow and tools first:
   - list_resources { resourceType: "tool", aiAgentId }
   - duplicate `toolId` values can cause failed tool execution and empty responses — this is a flow issue, not an LLM or connection issue; remove the duplicate rather than reconfiguring the LLM
2. Check LLM exists: list_resources { resourceType: "llm_model", projectId }
   If none: run setup_llm
3. Check agent description is not empty: get_resource { resourceType: "agent", id }
4. Check endpoint is connected: get_resource { resourceType: "endpoint", id }
   Verify flowId is set and URLToken exists

## create_ai_agent failed

- The tool auto-rolls back created resources on failure. Safe to retry.
- "Could not find entry node": transient issue, retry immediately
- Endpoint step error: check project exists and is accessible

## "Resource not found" errors

- All IDs are 24-char hex strings (e.g., 507f1f77bcf86cd799439011)
- UUIDs (36-char with dashes) are referenceIds — most tools need \_id, not referenceId
- Use list_resources to find valid IDs

## 401 / 403 errors, or "who changed this?"

- get_resource { resourceType: "user", id: "me" } returns the account the API key
  belongs to, plus its `roles`. Check `roles` before blaming the API for a 403.
- `createdBy` / `lastChangedBy` on any resource are opaque user ids. Never assume
  one is the current user — compare it to the `id` from `user`/`me`. List
  responses omit them; read them with get_resource { ..., raw: true }.
- Audit events answer "what did the plugin change?" / "who changed what?":
  list_resources { resourceType: "audit_event", actor: ["mcp-plugin"], sort: "timestamp:desc" }
  lists this plugin's changes; `actor: ["human"]` the ones people made by hand. It is
  organisation-scoped (no projectId) and needs Cognigy 2026.17.0+ plus an API key with
  Admin Center access. `performedBy` is set only for non-human actors — an event without
  it was performed by a person. On older platforms the `actor` / `eventType` filters are
  applied to the fetched page only (the result says so, and `total` then counts that page).
  get_resource { resourceType: "audit_event", id } returns one event with its attribution.

## Finding the most recently touched resource

- Sort server-side instead of paging through everything and comparing by hand:
  list_resources { resourceType: "project", sort: "lastChanged:desc", limit: 5 }
- `sort` takes `field:direction` and works on any field the resource returns.

## setup_llm fails

- See the llm-providers skill for valid provider and model strings
- Verify API key has access to the specified model

## delete_resource fails

- Verify the resource ID is a 24-char hex string (not a referenceId UUID)
- Use list_resources to confirm the resource exists before deleting
- Flows, projects and agents are never hard-deleted — delete_resource renames them with a DELETE_ prefix (markedForDeletion: true) so they can be deleted manually in the Cognigy UI. Agent/flow deletion deactivates referencing endpoints (reversible); a renamed project's contents stay live.
- Marking is idempotent: an already-renamed resource returns alreadyMarked: true. Agent deletion defaults to cascade: true (deactivate endpoints, rename the companion flow, then the agent); cascade: false renames only the agent. Because the renamed agent still exists, re-running create_ai_agent with the original name creates a NEW agent.
- endpoint, llm_model, knowledge_store, function and tool are permanently deleted — no undo. For `tool`, pass aiAgentId; the handler resolves and deletes the underlying flow node.
