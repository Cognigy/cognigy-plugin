---
name: troubleshooting
description: "Use when a Cognigy agent returns empty responses, a tool call or create_ai_agent fails, a resource is not found, setup_llm fails, or you need to diagnose a Cognigy MCP problem."
---

# Troubleshooting

## Agent returns empty response

1. Inspect the agent flow and tools first:
   - list_resources { resourceType: "tool", aiAgentId }
   - duplicate `toolId` values can cause failed tool execution and empty responses
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

## Finding the most recently touched resource

- Sort server-side instead of paging through everything and comparing by hand:
  list_resources { resourceType: "project", sort: "lastChanged:desc", limit: 5 }
- `sort` takes `field:direction` and works on any field the resource returns.

## Every tool call fails with the same error, but the tool list works

Suspect the network path, not the platform — listing tools makes no HTTP request,
so a working list plus a uniformly failing call means requests are not reaching
Cognigy.

- On a corporate network, set `HTTPS_PROXY` (and `NO_PROXY` for hosts to reach
  directly) in the MCP server `env` block. GUI clients start the engine with a
  minimal environment and usually do not inherit shell proxy variables.
- If the proxy inspects TLS, also set `NODE_EXTRA_CA_CERTS` to the corporate root
  CA file, then restart the client — Node reads it only at startup. Do not set
  `NODE_TLS_REJECT_UNAUTHORIZED=0`.
- An error quoting an HTML body, or naming a proxy, points at the proxy rather
  than Cognigy; the quoted text is the proxy's own message.
- "Cannot use the configured proxy ..." means the proxy setting itself is
  malformed or unsupported (SOCKS proxies are not supported). Requests fail
  instead of connecting directly, so the API key never leaves the sanctioned
  path; exclude the host with `NO_PROXY` if a direct connection is intended.
- "Timed out ... connecting through the proxy" means the proxy accepted the
  connection but never completed the tunnel. Check the proxy address, or raise
  `COGNIGY_PROXY_CONNECT_TIMEOUT_MS` (default 30000) if it is merely slow.
- `LOG_LEVEL=debug` logs the proxy actually in use at startup.

## setup_llm fails

- See the llm-providers skill for valid provider and model strings
- Verify API key has access to the specified model

## delete_resource fails

- Verify the resource ID is a 24-char hex string (not a referenceId UUID)
- Use list_resources to confirm the resource exists before deleting
- Flows, projects and agents are never hard-deleted — delete_resource renames them with a DELETE_ prefix (markedForDeletion: true) so they can be deleted manually in the Cognigy UI. Agent/flow deletion deactivates referencing endpoints (reversible); a renamed project's contents stay live.
