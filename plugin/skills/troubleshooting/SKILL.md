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

## talk_to_agent fails or reports testModeFallback

talk_to_agent sends through Cognigy Endpoint Test Mode (`/test/<token>`) so test
messages are not billed. Only ONE failure is replayed on the regular endpoint:

- **404 on the test URL** — the `/test/` route does not exist, i.e. the
  platform predates Cognigy 4.27. Nothing was processed, so the message is
  re-sent to the regular endpoint and the response carries `testMode: false`,
  `testModeFallback: { status, detail, testModeUrl }` and a `_hints.warning`.
  That message **was billed** — always tell the user. Pass `testMode: false`
  for the rest of the run to avoid a failed attempt per message.

Every other failure comes back as an `error` with `testMode: true` and is **not**
re-sent. Read `detail` and `_hints` before recommending billable mode; an HTTP
status alone does not identify a test-mode problem, and Cognigy does not
document how the 600-test-messages-per-hour cap is signalled:

- **400** — the platform rejected the request before processing it. Cognigy
  returns 400 for an unknown URL token and for an invalid payload too, so
  verify the endpoint (`get_resource { resourceType: "endpoint", id }`: channel
  `rest`, `URLToken` present) and the payload first. Only a valid endpoint on a
  pre-4.27 platform points at test mode; then `testMode: false` with the user's
  consent.
- **401 / 403** — authorization, IP/WAF block or an endpoint restriction, which
  would hit the regular URL as well. Fix what `detail` names; do not read it as
  "quota exhausted".
- **429** — throttling. May be general rate limiting or the per-organisation
  test budget. Pause and retry the same message in test mode; switch to
  `testMode: false` only if the user explicitly accepts billable messages.
- **5xx / timeout / DNS** — the request may have reached the flow before
  failing, so the agent may already have executed tools or advanced the
  conversation. Do **not** re-send the same message blindly; continue the
  conversation or inspect the agent first. This is not evidence that test mode
  is unsupported.

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

## setup_llm fails

- See the llm-providers skill for valid provider and model strings
- Verify API key has access to the specified model

## delete_resource fails

- Verify the resource ID is a 24-char hex string (not a referenceId UUID)
- Use list_resources to confirm the resource exists before deleting
- Flows, projects and agents are never hard-deleted — delete_resource renames them with a DELETE_ prefix (markedForDeletion: true) so they can be deleted manually in the Cognigy UI. Agent/flow deletion deactivates referencing endpoints (reversible); a renamed project's contents stay live.
