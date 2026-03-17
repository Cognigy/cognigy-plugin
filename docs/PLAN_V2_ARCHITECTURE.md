# Cognigy MCP Server v2 — Architecture Plan

## Problem Statement

The current MCP server has 9 multiplex tools with ambiguous schemas, ~600 lines of embedded context that clients rarely fetch, missing LLM resource management (the single biggest blocker to a fully automated agent build), no response filtering, and no MCP tool annotations. This results in poor LLM tool-calling accuracy, wasted context window tokens, and a workflow that still requires the Cognigy UI for a critical step.

This plan restructures the server around **3 principles**:

1. **Minimal tool set organized by user intent** — only tools that serve the create-test-refine loop or help debug it
2. **Resource-driven accuracy** — MCP resources that tool responses actively reference to guide the LLM at the right moment
3. **Zero UI dependency** — `setup_llm` eliminates the last manual step; `create_ai_agent` orchestrates everything else

---

## Part 1: The Creation Loop

The entire server exists to power this cycle:

```
setup_llm (once) → create_ai_agent → talk_to_agent ⇄ update_ai_agent
                                           ↑
                              create_tool ──┘  (add capabilities)
```

**Step 0 (one-time)**: `setup_llm { projectId, provider, modelName, apiKey }` — creates an LLM resource in the project. Without this, agents can't generate responses. Called once per project, then never again.

**Step 1**: `create_ai_agent { projectId, name, description }` — orchestrates 5 API calls internally (agent resource, flow, entry node fetch with retry, AI Agent Job Node, REST endpoint), checks LLM status, and returns an `endpointUrl` ready for testing. On failure at any step, rolls back all created resources automatically.

**Step 2**: `talk_to_agent { endpointUrl, message }` — sends a message to the agent, returns `agentResponse` and `sessionId`. Filtered by default (no raw response bloat). Use `verbose: true` for the full API response when debugging.

**Step 3**: `update_ai_agent { aiAgentId, description }` — PATCH the agent's configuration. The `description` field is the primary lever for changing agent behavior. After updating, return to Step 2.

**Step 3b (as needed)**: `create_tool { aiAgentId, toolType, name, config }` — give the agent capabilities like API calls, code execution, or knowledge search. Internally orchestrates flow node creation (hidden from the calling LLM). After adding tools, return to Step 2.

Everything else in the tool set exists to support this loop: discovering resources, inspecting details, cleaning up, and adding knowledge.

---

## Part 2: Tool Architecture — 9 Tools

### Why 9 tools

<!-- REASONING: The v1 server had 9 multiplex tools covering ~36 operations. The first v2 draft expanded
     to 12 focused tools. 3 of those 12 are not needed for the core creation loop:
     - deploy_ai_agent: a single POST /hire call, rarely used during development. Add later as tool 10.
     - manage_flow: create_ai_agent auto-provisions flows/nodes. Direct node editing is advanced/rare.
     - manage_endpoint: create_ai_agent auto-creates the REST endpoint. Multi-channel is post-MVP.
     - list_conversations: folded into list_resources with optional date/channel filters.
     However, create_tool IS essential: a capable agent needs tools (knowledge_search, custom
     functions, API connectors). Without tool creation, agents are limited to basic conversation.
     This is part of the core build loop, not a nice-to-have.
     IMPORTANT: create_tool is a single-purpose orchestration tool (like create_ai_agent). It
     hides all flow/node plumbing from the calling LLM. Listing and deleting tools are handled
     by the existing generic tools (list_resources, delete_resource) — no duplication needed. -->

| # | Tool | User Intent | Frequency | Annotations |
|---|------|-------------|-----------|-------------|
| 1 | `create_ai_agent` | "Build me an agent" | Once | `destructiveHint: false`, `openWorldHint: true` |
| 2 | `update_ai_agent` | "Make it better" | Many times | `idempotentHint: true`, `openWorldHint: true` |
| 3 | `setup_llm` | "Set up the LLM" | Once per project | `openWorldHint: true` |
| 4 | `talk_to_agent` | "Test the agent" | Many times | `readOnlyHint: false`, `openWorldHint: true` |
| 5 | `list_resources` | "What do I have?" | As needed | `readOnlyHint: true`, `idempotentHint: true` |
| 6 | `get_resource` | "Show me details" | As needed | `readOnlyHint: true`, `idempotentHint: true` |
| 7 | `delete_resource` | "Remove something" | Rarely | `destructiveHint: true`, `idempotentHint: true` |
| 8 | `manage_knowledge` | "Add knowledge" | As needed | `openWorldHint: true` |
| 9 | `create_tool` | "Give agent a capability" | As needed | `destructiveHint: false`, `openWorldHint: true` |

### What was cut and why

<!-- REASONING: Each cut tool is justified against the question "does this help the LLM build, test,
     or fix an agent?" If no, or if it's needed once in 50 sessions, it doesn't earn permanent
     schema tokens in every session. -->

| Cut Tool | Reasoning | How the functionality is still covered |
|----------|-----------|----------------------------------------|
| `deploy_ai_agent` | Deploying/hiring is a single `POST /aiagents/{id}/hire` call. It's a post-development action — users test extensively before deploying. Adding it later as tool 10 is trivial and doesn't break anything. | Not covered yet — intentional. Add when users need production deployment from MCP. |
| `manage_flow` | `create_ai_agent` auto-provisions the flow, AI Agent Job Node, and entry node. Direct flow/node editing is an advanced debugging scenario. The 4 operations (list_nodes, get_node, update_node, create_node) added 7 schema properties that the LLM almost never needs. `create_tool` now handles the specific case of creating tool nodes — the only common reason to edit nodes. | Flow details are inspectable via `get_resource { resourceType: "flow", id }`. Tool-related node creation is handled internally by `create_tool`. Raw node-level debugging can be added as tool 10/11 later if needed. |
| `manage_endpoint` | `create_ai_agent` auto-creates the REST endpoint. The only remaining operations were create (additional channels) and update (settings). Multi-channel deployment (webchat, voice, Teams) is a post-MVP concern. | Endpoints are listable via `list_resources` and inspectable via `get_resource`. |
| `list_conversations` | The original plan separated conversations because their date/channel filters "don't apply to other resource types." But the filters can be optional params on `list_resources` with descriptions saying "(conversations only)". LLMs handle "some params only apply to some enum values" well when descriptions are explicit. This saves a full tool definition (~250 schema tokens). | `list_resources { resourceType: "conversation", projectId, startDate?, endDate?, channel? }` — filter params are optional and described as "conversations only". |

### Key structural decisions

<!-- REASONING: These decisions were validated across 4 prior iterations of this plan. Each one
     addresses a specific failure mode observed in the v1 implementation or earlier v2 drafts. -->

**Three general-purpose CRUD tools** (`list_resources`, `get_resource`, `delete_resource`) are kept as generic dispatchers because they share an identical interface pattern (resourceType + ID + pagination). An LLM already knows "list X, get X by ID, delete X by ID." All delete operations are consolidated in `delete_resource` — no other tool has destructive operations — making it the single gate for `destructiveHint: true`.

**Conversations folded into `list_resources`** — the earlier plan created a separate `list_conversations` tool because date/channel filters "invited hallucinated parameters." The fix is simpler: add `startDate`, `endDate`, `channel` as optional top-level params on `list_resources` with descriptions stating "(conversations only)." This is enough for LLMs to not hallucinate `{ resourceType: "agent", channel: "rest" }`. The trade-off (slightly larger `list_resources` schema) is worth saving a full tool definition.

**`setup_llm` is create-only** — the v1 plan's `configure_llm` multiplexed 5 operations (list, create, update, delete, clone) with `required: []`, forcing the LLM to guess which fields apply. By making `setup_llm` create-only with `required: ["projectId", "provider", "modelName"]`, the schema is unambiguous. Listing, getting, and deleting LLMs are handled by the generic tools.

**All annotations use `Record<string, unknown>`** — not a rigid TypeScript interface. This ensures new MCP spec fields can be added without code changes.

---

### Tool Definitions

#### Tool 1: `create_ai_agent`

<!-- REASONING: This is the #1 action and the most complex handler. Making it standalone with a precise
     3-field schema (vs. the v1 multiplex where "create" shared a schema with "delete", "list", and
     "hire") dramatically improves LLM accuracy. The orchestration chain is hidden from the LLM —
     it just sees "give me projectId and name, get back everything you need." -->

**Purpose**: The primary entry point. Creates a complete, testable AI Agent setup in one call.

**What it does internally (orchestration chain)**:
1. `POST /v2.0/aiagents` — create the agent resource
2. `POST /v2.0/flows` — create a flow for the agent
3. `GET /v2.0/flows/{flowId}/chart/nodes` — find the entry node (**with retry**: up to 3 attempts, 500ms backoff, because the Cognigy API may be eventually consistent after flow creation)
4. `POST /v2.0/flows/{flowId}/chart/nodes` — create AI Agent Job Node (type: `aiAgentJob`, config: `{ aiAgent: agent.referenceId }`)
5. `POST /v2.0/endpoints` — create REST endpoint pointing to the flow
6. `GET /v2.0/largelanguagemodels` — check if an LLM resource exists in the project (non-critical — failure here doesn't trigger rollback)

**Rollback**: On failure at any step, previously created resources are deleted in reverse order (endpoint → flow → agent). Each DELETE is wrapped in its own try/catch so a failed cleanup doesn't prevent subsequent cleanups. See "Rollback" section below.

**Schema**:
```json
{
  "name": "create_ai_agent",
  "description": "Create a complete AI Agent with auto-provisioned flow, AI Agent Job Node, and REST endpoint. Returns everything needed for talk_to_agent.\n\nPrerequisites: A project must exist (use list_resources to find one). An LLM resource should exist in the project (use setup_llm) for the agent to generate responses.\n\nReturns: agent, flow, endpoint objects, endpointUrl, and llmStatus.\nIf llmStatus is 'missing', read cognigy://guide/agent-creation for next steps.",
  "annotations": {
    "title": "Create AI Agent",
    "readOnlyHint": false,
    "destructiveHint": false,
    "idempotentHint": false,
    "openWorldHint": true
  },
  "inputSchema": {
    "type": "object",
    "properties": {
      "projectId": {
        "type": "string",
        "description": "24-char hex project ID. Use list_resources to find projects."
      },
      "name": {
        "type": "string",
        "description": "Agent name (1-200 chars)"
      },
      "description": {
        "type": "string",
        "description": "Agent description — defines the agent's persona and behavior"
      },
      "knowledgeReferenceId": {
        "type": "string",
        "description": "UUID of a knowledge store to attach (optional)"
      }
    },
    "required": ["projectId", "name"]
  }
}
```

**Response — success**:
```json
{
  "agent": { "id": "...", "referenceId": "uuid", "name": "..." },
  "flow": { "id": "...", "referenceId": "uuid", "name": "..." },
  "endpoint": { "id": "...", "URLToken": "...", "channel": "rest" },
  "endpointUrl": "https://endpoint-trial.cognigy.ai/xxxxx",
  "llmStatus": "configured"
}
```

<!-- REASONING: No _hints on full success. Layer 1 instructions already teach "use talk_to_agent next."
     Emitting hints on every success wastes ~100 tokens per call and creates noise. Hints are reserved
     for when the LLM needs redirection it can't infer from context. -->

No `_hints` on full success — Layer 1 instructions already teach the next step.

**Response — success but no LLM**:
```json
{
  "agent": { ... }, "flow": { ... }, "endpoint": { ... },
  "endpointUrl": "...",
  "llmStatus": "missing",
  "_hints": {
    "warning": "No LLM resource in project. Agent won't generate responses.",
    "resource": "cognigy://guide/agent-creation",
    "action": "Run setup_llm before talk_to_agent."
  }
}
```

<!-- REASONING: This is the critical steering moment. The _hints.resource field points the LLM to the
     agent-creation guide, which explains the full workflow including setup_llm. Without this hint,
     the LLM would call talk_to_agent, get an empty response, and start guessing. -->

**Response — failure** (resources rolled back automatically):
```json
{
  "failed": { "step": "node", "error": "Could not find entry node in flow" },
  "_hints": {
    "likely_cause": "Orchestration failed. All created resources were rolled back.",
    "resource": "cognigy://guide/troubleshooting",
    "action": "Read the troubleshooting guide, then retry create_ai_agent."
  }
}
```

---

#### Tool 2: `update_ai_agent`

<!-- REASONING: This is the most-called tool during the improvement loop. It needs an absolutely clean
     schema — every field maps to the same PATCH /v2.0/aiagents/{id} call. No conditional logic, no
     branching behavior. The earlier draft folded "hire: true" into this tool, which created a hidden
     multiplex where one tool had two completely different behaviors. Hiring is a separate concern
     (deploy_ai_agent, deferred to later). -->

**Purpose**: Refine an AI Agent's configuration. The primary iteration tool.

**API endpoint**: `PATCH /v2.0/aiagents/{id}`

**Schema**:
```json
{
  "name": "update_ai_agent",
  "description": "Update an AI Agent's configuration to improve its behavior. Change the description to refine how the agent responds, update the job instructions, add/remove tools, or attach knowledge stores.\n\nRequires: aiAgentId (from create_ai_agent or list_resources { resourceType: 'agent' }).\nAfter updating, use talk_to_agent to test the changes.",
  "annotations": {
    "title": "Update AI Agent",
    "readOnlyHint": false,
    "destructiveHint": false,
    "idempotentHint": true,
    "openWorldHint": true
  },
  "inputSchema": {
    "type": "object",
    "properties": {
      "aiAgentId": {
        "type": "string",
        "description": "24-char hex AI Agent ID (from create_ai_agent response or list_resources)"
      },
      "name": { "type": "string", "description": "New agent name" },
      "description": {
        "type": "string",
        "description": "New agent description — this is the primary way to change agent behavior"
      },
      "job": { "type": "string", "description": "Job description text — detailed instructions for the agent" },
      "tools": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Tool reference IDs available to the agent. Use create_tool to create tools first, then attach them here. Use list_resources { resourceType: 'tool', aiAgentId } to see available tools."
      }
    },
    "required": ["aiAgentId"]
  }
}
```

No `_hints` on success — the LLM knows to test next from Layer 1 instructions.

---

#### Tool 3: `setup_llm`

<!-- REASONING: This tool eliminates the "go to Cognigy UI" blocker — the single biggest gap in v1.
     It is create-only with hard-required fields. The v1 plan's configure_llm multiplexed 5 operations
     (list, create, update, delete, clone) with required: [], forcing the LLM to guess. By making
     this create-only, all three fields are always required and the schema is unambiguous. Listing,
     getting, and deleting LLMs are handled by the generic tools (list_resources, get_resource,
     delete_resource). -->

**Purpose**: Create an LLM resource in a project. This is the tool that eliminates the "go to Cognigy UI" blocker.

**API endpoint**: `POST /v2.0/largelanguagemodels`

**Schema**:
```json
{
  "name": "setup_llm",
  "description": "Create an LLM resource (GPT-4, Claude, etc.) in a project. An LLM resource must exist before an AI Agent can generate responses.\n\nFor valid provider names and model strings, read cognigy://guide/llm-providers.\nTo list existing LLMs: use list_resources { resourceType: 'llm_model', projectId }.\nTo delete: use delete_resource { resourceType: 'llm_model', id }.",
  "annotations": {
    "title": "Setup LLM",
    "readOnlyHint": false,
    "destructiveHint": false,
    "idempotentHint": false,
    "openWorldHint": true
  },
  "inputSchema": {
    "type": "object",
    "properties": {
      "projectId": { "type": "string", "description": "24-char hex project ID" },
      "provider": {
        "type": "string",
        "enum": ["openai", "azure-openai", "anthropic", "google"],
        "description": "LLM provider. See cognigy://guide/llm-providers for details."
      },
      "modelName": { "type": "string", "description": "Model identifier (e.g., 'gpt-4o', 'claude-sonnet-4-20250514')" },
      "apiKey": { "type": "string", "description": "Provider API key (required if no connectionId)" },
      "connectionId": { "type": "string", "description": "Cognigy Connection ID (alternative to apiKey)" },
      "isDefault": { "type": "boolean", "description": "Set as project default (default: true)" }
    },
    "required": ["projectId", "provider", "modelName"]
  }
}
```

**Credential validation**: At least one of `apiKey` or `connectionId` must be provided. JSON Schema cannot express "at least one of X or Y" — this is the one runtime check. The handler returns a clear error if neither is supplied.

**Credential resolution strategy**: The `POST /v2.0/largelanguagemodels` API must be verified against the Cognigy OpenAPI spec **before implementation**. The handler implements exactly one tier (build-time decision):

1. **Tier 1 — Direct `apiKey`**: If the API accepts an inline `apiKey`, use it directly.
2. **Tier 2 — Auto-create Connection**: If only `connectionId` is accepted, the handler first creates a Connection via `POST /v2.0/connections`, then passes the resulting `connectionId`.
3. **Tier 3 — Require existing `connectionId`**: If neither works, remove `apiKey` from the schema and document the UI dependency.

**Error response** — references the LLM provider guide:
```json
{
  "error": "Invalid provider 'chatgpt'. Valid: openai, anthropic, azure-openai, google.",
  "_hints": {
    "resource": "cognigy://guide/llm-providers",
    "action": "Read the provider guide for valid provider names and model strings."
  }
}
```

---

#### Tool 4: `talk_to_agent`

<!-- REASONING: This tool is the core of the iterative loop. Key change from v1: remove rawResponse
     from the default output. The full Cognigy API response can be hundreds of fields and consumes
     massive tokens. Only return agentResponse and sessionId. The verbose: true param provides the
     escape hatch. Also: readOnlyHint is false because sending a message can trigger side effects
     (webhooks, CRM updates, etc.) depending on flow configuration. -->

**Purpose**: Send a message to an AI Agent through its REST endpoint. The core of the iterative improvement loop.

**Schema**:
```json
{
  "name": "talk_to_agent",
  "description": "Send a message to a Cognigy AI Agent and get its response. Use this to test agent behavior during iterative development.\n\nThe endpointUrl comes from create_ai_agent or list_resources { resourceType: 'endpoint' }. Use the same sessionId across calls for multi-turn conversations.\n\nReturns: agentResponse text and sessionId. Add verbose: true for the full raw API response.",
  "annotations": {
    "title": "Talk to Agent",
    "readOnlyHint": false,
    "destructiveHint": false,
    "idempotentHint": false,
    "openWorldHint": true
  },
  "inputSchema": {
    "type": "object",
    "properties": {
      "endpointUrl": { "type": "string", "description": "REST endpoint URL (e.g., https://endpoint-trial.cognigy.ai/xxxxx)" },
      "message": { "type": "string", "description": "Message to send to the agent" },
      "sessionId": { "type": "string", "description": "Session ID for conversation continuity. Omit to start new session." },
      "userId": { "type": "string", "description": "User identifier (defaults to 'mcp-user')" },
      "data": { "type": "object", "description": "Additional data payload to send with the message" },
      "verbose": { "type": "boolean", "description": "If true, include the full raw API response (default: false)" }
    },
    "required": ["endpointUrl", "message"]
  }
}
```

**Response — success** (no `_hints` — the response itself is the useful output):
```json
{
  "agentResponse": "Hello! How can I help you today?",
  "sessionId": "mcp-session-1709..."
}
```

**Response — empty** (LLM gets steered to troubleshooting):
```json
{
  "agentResponse": "",
  "sessionId": "mcp-session-1709...",
  "_hints": {
    "likely_cause": "Agent returned no text. Possible causes: 1) no LLM configured, 2) empty agent description, 3) endpoint not connected to flow.",
    "resource": "cognigy://guide/troubleshooting",
    "action": "Read the troubleshooting guide for diagnostic steps."
  }
}
```

**Response — HTTP error**:
```json
{
  "error": "Request failed with status 404",
  "_hints": {
    "likely_cause": "Endpoint URL invalid or expired.",
    "resource": "cognigy://guide/troubleshooting",
    "action": "Verify endpoint with list_resources { resourceType: 'endpoint' }."
  }
}
```

---

#### Tool 5: `list_resources`

<!-- REASONING: This collapses 8+ separate "list" operations into one tool with a uniform interface.
     Conversations are included here (unlike the earlier plan that separated them) because:
     1. The date/channel filters are optional and explicitly described as "(conversations only)"
     2. This saves a full tool definition (~250 schema tokens)
     3. LLMs handle "some params only apply to some enum values" well with explicit descriptions
     The projectId runtime validation is required because JSON Schema can't express "required if
     resourceType != project." -->

**Purpose**: Unified discovery tool for listing any resource type in a project.

**API endpoints covered**:
- `GET /v2.0/projects` — list projects
- `GET /v2.0/aiagents` — list agents in project
- `GET /v2.0/flows` — list flows in project
- `GET /v2.0/endpoints` or `GET /v2.0/projects/{id}/endpoints` — list endpoints
- `GET /v2.0/knowledgestores` — list knowledge stores
- `GET /v2.0/largelanguagemodels` — list LLM resources
- `GET /v2.0/conversations` — list conversations
- `GET /v2.0/projects/{id}/extensions` — list extensions
- `GET /v2.0/projects/{id}/functions` — list functions

**Schema**:
```json
{
  "name": "list_resources",
  "description": "List resources in a Cognigy project. Use this to discover projects, agents, flows, endpoints, LLM models, knowledge stores, conversations, extensions, functions, or tools.\n\nSet resourceType to 'project' to find projectIds (no projectId needed). 'tool' requires aiAgentId instead of projectId. All other types require projectId.\n\nReturns a paginated list with id, name, and type-specific fields.",
  "annotations": {
    "title": "List Resources",
    "readOnlyHint": true,
    "destructiveHint": false,
    "idempotentHint": true,
    "openWorldHint": true
  },
  "inputSchema": {
    "type": "object",
    "properties": {
      "resourceType": {
        "type": "string",
        "enum": ["project", "agent", "flow", "endpoint", "llm_model", "knowledge_store", "conversation", "extension", "function", "tool"],
        "description": "Type of resource to list"
      },
      "projectId": { "type": "string", "description": "24-char hex project ID. Required for all types except 'project' and 'tool'." },
      "aiAgentId": { "type": "string", "description": "24-char hex AI Agent ID (tools only — lists tools in the agent's flow)" },
      "startDate": { "type": "string", "description": "ISO 8601 date filter (conversations only)" },
      "endDate": { "type": "string", "description": "ISO 8601 date filter (conversations only)" },
      "channel": { "type": "string", "description": "Channel filter, e.g. 'rest', 'webchat3' (conversations only)" },
      "limit": { "type": "number", "description": "Results per page (1-100, default 25)" },
      "skip": { "type": "number", "description": "Number of results to skip (default 0)" }
    },
    "required": ["resourceType"]
  }
}
```

**Runtime `projectId` validation**: If `resourceType` is not `"project"` or `"tool"` and `projectId` is missing, return an error with `_hints` directing the LLM to list projects first. If `resourceType` is `"tool"` and `aiAgentId` is missing, return an error directing the LLM to list agents first.

**Response filtering per type** — only useful fields are returned:

| Resource Type | Fields Returned |
|---|---|
| `project` | id, name, description, createdAt |
| `agent` | id, referenceId, name, description, createdAt |
| `flow` | id, referenceId, name, description, createdAt |
| `endpoint` | id, name, channel, flowId, URLToken, createdAt |
| `llm_model` | id, name, provider, model, isDefault, createdAt |
| `knowledge_store` | id, name, description, sourceCount, createdAt |
| `conversation` | sessionId, channel, startedAt, messageCount |
| `extension` | id, name, version |
| `function` | id, name, description |
| `tool` | toolId, name, toolType |

**Empty result** — steers to creation guide:
```json
{
  "items": [],
  "total": 0,
  "_hints": { "hint": "No agents found.", "resource": "cognigy://guide/agent-creation" }
}
```

---

#### Tool 6: `get_resource`

<!-- REASONING: Shares consistent singular-form resourceType enum with list_resources. Adds
     "session_state" (not listable) and "conversation" (listable via list_resources with
     resourceType: "conversation"). The raw: true param provides an escape hatch for debugging
     without bloating every response. -->

**Purpose**: Fetch full details of a single resource by type and ID.

**Schema**:
```json
{
  "name": "get_resource",
  "description": "Get detailed information about a single Cognigy resource. Use list_resources first to find IDs.\n\nSupports all list_resources types plus 'session_state' for session context data. Set raw: true for unfiltered API response.",
  "annotations": {
    "title": "Get Resource",
    "readOnlyHint": true,
    "destructiveHint": false,
    "idempotentHint": true,
    "openWorldHint": true
  },
  "inputSchema": {
    "type": "object",
    "properties": {
      "resourceType": {
        "type": "string",
        "enum": ["agent", "flow", "endpoint", "project", "conversation", "session_state", "llm_model", "knowledge_store", "extension", "function"],
        "description": "Type of resource to retrieve"
      },
      "id": { "type": "string", "description": "Resource ID (24-char hex or session ID for conversation/session_state)" },
      "projectId": { "type": "string", "description": "24-char hex project ID. Required for endpoint lookups." },
      "raw": { "type": "boolean", "description": "If true, return unfiltered API response (default: false)" }
    },
    "required": ["resourceType", "id"]
  }
}
```

**API mapping**:

| resourceType | API Endpoint |
|---|---|
| `agent` | `GET /v2.0/aiagents/{id}` |
| `flow` | `GET /v2.0/flows/{id}` |
| `endpoint` | `GET /v2.0/endpoints/{id}` |
| `project` | `GET /v2.0/projects/{id}` |
| `conversation` | `GET /v2.0/conversations/{sessionId}` |
| `session_state` | `GET /v2.0/sessions/{sessionId}/state` |
| `llm_model` | `GET /v2.0/largelanguagemodels/{id}` |
| `knowledge_store` | `GET /v2.0/knowledgestores/{id}` |
| `extension` | `GET /v2.0/extensions/{id}` |
| `function` | `GET /v2.0/functions/{id}` |

---

#### Tool 7: `delete_resource`

<!-- REASONING: Single point of deletion across the entire server. No other tool has destructive
     operations. The destructiveHint: true annotation lets MCP clients show a confirmation dialog.
     Optional projectId is included because some Cognigy DELETE endpoints may require project scope. -->

**Purpose**: Delete any Cognigy resource by type and ID. The **single destructive gate**.

**Schema**:
```json
{
  "name": "delete_resource",
  "description": "Permanently delete a Cognigy resource. This cannot be undone.\n\nUse list_resources to verify the resource exists before deleting.\nSome types (endpoint) may require projectId. For 'tool' type, provide aiAgentId — the handler resolves and deletes the underlying flow node internally.",
  "annotations": {
    "title": "Delete Resource",
    "readOnlyHint": false,
    "destructiveHint": true,
    "idempotentHint": true,
    "openWorldHint": true
  },
  "inputSchema": {
    "type": "object",
    "properties": {
      "resourceType": {
        "type": "string",
        "enum": ["agent", "flow", "endpoint", "llm_model", "knowledge_store", "function", "tool"],
        "description": "Type of resource to delete"
      },
      "id": { "type": "string", "description": "24-char hex resource ID (or toolId for tool type)" },
      "projectId": { "type": "string", "description": "24-char hex project ID (required for some types)" },
      "aiAgentId": { "type": "string", "description": "24-char hex AI Agent ID (required for tool type — needed to resolve the flow)" }
    },
    "required": ["resourceType", "id"]
  }
}
```

---

#### Tool 8: `manage_knowledge`

<!-- REASONING: The 3 operations are cohesive — they all operate on the knowledge domain, and
     create_source/search_chunks share the knowledgeStoreId field. This is the one place where
     multiplexing is justified: the operations share most fields and conceptual scope. Listing
     and deleting stores are handled by the generic tools. -->

**Purpose**: Create knowledge stores, add sources, and search chunks for RAG.

**Schema**:
```json
{
  "name": "manage_knowledge",
  "description": "Manage knowledge bases for RAG. Create stores, add sources (URLs, text, files), and search chunks to verify content.\n\nFor setup steps, read cognigy://guide/knowledge-setup.\nTo list stores: list_resources { resourceType: 'knowledge_store' }.\nTo delete: delete_resource { resourceType: 'knowledge_store', id }.",
  "annotations": {
    "title": "Manage Knowledge",
    "readOnlyHint": false,
    "destructiveHint": false,
    "idempotentHint": false,
    "openWorldHint": true
  },
  "inputSchema": {
    "type": "object",
    "properties": {
      "operation": {
        "type": "string",
        "enum": ["create_store", "create_source", "search_chunks"],
        "description": "create_store: new knowledge base. create_source: add content. search_chunks: query."
      },
      "projectId": { "type": "string", "description": "24-char hex project ID (required for create_store)" },
      "knowledgeStoreId": { "type": "string", "description": "24-char hex store ID (required for create_source, search_chunks)" },
      "name": { "type": "string", "description": "Store name (required for create_store)" },
      "description": { "type": "string", "description": "Store description" },
      "type": { "type": "string", "enum": ["url", "file", "text"], "description": "Source type (required for create_source)" },
      "content": { "type": "string", "description": "URL, file path, or text content (required for create_source)" },
      "query": { "type": "string", "description": "Search query (required for search_chunks)" },
      "limit": { "type": "number", "description": "Max search results (1-50)" }
    },
    "required": ["operation"]
  }
}
```

**`create_source` response** — references knowledge guide for async ingestion:
```json
{
  "source": { "id": "...", "type": "url", "status": "processing" },
  "_hints": {
    "warning": "Ingestion is async — content may not be searchable for 10-60 seconds.",
    "resource": "cognigy://guide/knowledge-setup",
    "action": "Wait, then use search_chunks to verify."
  }
}
```

**`search_chunks` empty after recent `create_source`** — references knowledge guide:
```json
{
  "chunks": [],
  "_hints": {
    "likely_cause": "Content may still be ingesting.",
    "resource": "cognigy://guide/knowledge-setup",
    "action": "Wait 10-60 seconds and retry search_chunks."
  }
}
```

---

#### Tool 9: `create_tool`

<!-- REASONING: Tools are what make agents useful beyond basic conversation. An agent without tools
     can only chat — it can't search knowledge, call APIs, or execute functions. The v1 server had
     manage_flows with create_node/update_node, but this leaked flow/node internals to the calling
     LLM, which doesn't understand Cognigy's node graph model and makes mistakes (wrong flowId,
     wrong mode, wrong extension string).

     The solution: create_tool is a single-purpose orchestration tool (same pattern as
     create_ai_agent). The LLM says "give this agent an HTTP tool that calls this URL" and the
     handler figures out which flow the agent uses, finds the right insertion point, creates the
     correct node type, and returns a toolId. The LLM never sees flowId, nodeId, chart/nodes
     endpoints, or extension strings.

     Listing tools: list_resources { resourceType: "tool", aiAgentId }
     Deleting tools: delete_resource { resourceType: "tool", id: toolId, aiAgentId }
     No need for a multiplex manage_tools — CRUD is already handled by generic tools. -->

**Purpose**: Create a tool for an AI Agent. Single-purpose orchestration — like `create_ai_agent`, it hides multi-step flow/node operations behind a simple schema. Listing and deleting tools are handled by `list_resources` and `delete_resource` (with `resourceType: "tool"`).

**Why this abstraction matters**: Creating a tool in Cognigy requires:
1. Resolving the agent's flowId (from the agent resource or its associated flow)
2. Finding the AI Agent Job Node in the flow (to know where to insert)
3. Creating a flow node of the correct type (e.g., `httpRequest`, `code`) with the right `extension` and `config`
4. Potentially updating the AI Agent Job Node's config to reference the new tool

If the LLM had to do steps 1–4 manually via flow/node APIs, it would need to understand Cognigy's node graph model, remember to use MongoDB `_id` not `referenceId`, know the correct `extension` string, set `mode: 'append'`, etc. This is exactly the kind of multi-step orchestration that LLMs get wrong. By hiding it behind `create_tool`, the LLM just says "create an HTTP tool for agent X that calls URL Y."

**Orchestration chain (hidden from LLM)**:
1. `GET /v2.0/aiagents/{aiAgentId}` — get the agent to find its associated flow
2. `GET /v2.0/flows/{flowId}/chart/nodes` — find the AI Agent Job Node in the flow
3. `POST /v2.0/flows/{flowId}/chart/nodes` — create the tool node with correct type, extension, mode, and config
4. (If needed) `PATCH /v2.0/flows/{flowId}/chart/nodes/{aiAgentJobNodeId}` — update the AI Agent Job Node to wire in the new tool
5. Return a clean `{ toolId, name, toolType }` — no flow/node internals exposed

**Schema**:
```json
{
  "name": "create_tool",
  "description": "Create a tool for an AI Agent. Tools give agents capabilities like calling APIs, executing code, or searching knowledge.\n\nPrerequisites: Agent must exist (created via create_ai_agent).\nFor available tool types and configuration, read cognigy://guide/tools-setup.\nTo list tools: list_resources { resourceType: 'tool', aiAgentId }.\nTo delete: delete_resource { resourceType: 'tool', id: toolId, aiAgentId }.\nAfter creating, use talk_to_agent to test the tool.",
  "annotations": {
    "title": "Create Tool",
    "readOnlyHint": false,
    "destructiveHint": false,
    "idempotentHint": false,
    "openWorldHint": true
  },
  "inputSchema": {
    "type": "object",
    "properties": {
      "aiAgentId": {
        "type": "string",
        "description": "24-char hex AI Agent ID (from create_ai_agent or list_resources { resourceType: 'agent' })"
      },
      "toolType": {
        "type": "string",
        "enum": ["http_request", "code", "knowledge_search"],
        "description": "http_request: call external API. code: execute JavaScript. knowledge_search: search a knowledge base."
      },
      "name": {
        "type": "string",
        "description": "Tool display name (e.g., 'Fetch Weather', 'Calculate Tax')"
      },
      "config": {
        "type": "object",
        "description": "Tool-specific configuration. See cognigy://guide/tools-setup for config schemas per toolType.",
        "properties": {
          "url": { "type": "string", "description": "HTTP endpoint URL (http_request only)" },
          "method": { "type": "string", "enum": ["GET", "POST", "PUT", "PATCH", "DELETE"], "description": "HTTP method (http_request only, default: GET)" },
          "headers": { "type": "object", "description": "HTTP headers (http_request only)" },
          "body": { "type": "string", "description": "Request body template (http_request only)" },
          "code": { "type": "string", "description": "JavaScript code to execute (code only)" },
          "knowledgeStoreId": { "type": "string", "description": "Knowledge store ID to search (knowledge_search only)" }
        }
      }
    },
    "required": ["aiAgentId", "toolType", "name", "config"]
  }
}
```

**Internal mapping (never exposed to LLM)**:

| `toolType` | Cognigy Node Type | Extension | Config Mapping |
|---|---|---|---|
| `http_request` | `httpRequest` | `@cognigy/basic-nodes` | `url`, `method`, `headers`, `body` → node config |
| `code` | `code` | `@cognigy/basic-nodes` | `code` → `config.code` |
| `knowledge_search` | `search` | `@cognigy/knowledge-ai` | `knowledgeStoreId` → `config.knowledgeStore` |

**Response — success** (clean, no node internals):
```json
{
  "toolId": "tool-abc123",
  "name": "Fetch Weather",
  "toolType": "http_request"
}
```

No `_hints` on success — the LLM knows to test next from Layer 1 instructions.

**Response — failure** (e.g., agent has no associated flow):
```json
{
  "error": "Agent has no associated flow. Create the agent with create_ai_agent first.",
  "_hints": {
    "likely_cause": "create_tool requires an agent created via create_ai_agent (which auto-provisions the flow).",
    "resource": "cognigy://guide/tools-setup",
    "action": "Read the tools guide, ensure agent was created via create_ai_agent, then retry."
  }
}
```

**Rollback**: If node creation succeeds but wiring to the AI Agent Job Node fails, delete the newly created node. Single cleanup step — much simpler than `create_ai_agent`'s chain.

**How `list_resources` handles tools internally**: When `resourceType: "tool"` is requested, the handler resolves the agent's flowId, fetches all nodes in the flow, filters to tool nodes (non-entry, non-aiAgentJob), and returns `{ toolId, name, toolType }` for each. The LLM sees a clean list — no flow/node internals.

**How `delete_resource` handles tools internally**: When `resourceType: "tool"` is requested with `aiAgentId`, the handler resolves the agent's flowId, finds the node matching the toolId, deletes it via `DELETE /v2.0/flows/{flowId}/chart/nodes/{nodeId}`, and (if needed) updates the AI Agent Job Node to unwire it. The LLM just passes `{ resourceType: "tool", id: toolId, aiAgentId }`.

---

## Part 3: MCP Resources — The Accuracy Engine

<!-- REASONING: The v1 server embedded 600 lines of markdown as MCP resources that clients rarely
     fetched. The problem wasn't the resources — it was that nothing told the LLM to fetch them.
     The v2 approach keeps MCP resources but makes them useful by having tool responses ACTIVELY
     REFERENCE specific resource URIs in _hints when the LLM needs guidance. This creates a
     pull-based context system: zero overhead on happy path, precise guidance on errors. -->

### Design: Tool Responses Reference Resources

MCP resources are useless if the LLM never reads them. The key design decision: **every `_hints` object that needs to guide the LLM includes a `resource` field pointing to the exact MCP resource URI to fetch**. The server instructions (Layer 1) teach the LLM to look for this pattern:

```
RULES:
...
- When errors occur, check _hints.resource for a guide URI to read.
```

This creates a pull-based context system:
- **Happy path**: 0 resource fetches, 0 hint tokens.
- **Error/warning path**: `_hints.resource` points to the right guide, the LLM fetches it, gets the full context.

### When to reference which resource

| Trigger | Resource | Why |
|---------|----------|-----|
| `create_ai_agent` succeeds but `llmStatus: "missing"` | `cognigy://guide/agent-creation` | Full workflow including setup_llm step |
| `create_ai_agent` fails at any step | `cognigy://guide/troubleshooting` | Diagnose + retry instructions |
| `talk_to_agent` returns empty response | `cognigy://guide/troubleshooting` | Ranked causes + diagnostic steps |
| `talk_to_agent` HTTP error | `cognigy://guide/troubleshooting` | Endpoint validation steps |
| `setup_llm` fails (bad provider/credentials) | `cognigy://guide/llm-providers` | Valid provider strings + credential help |
| `setup_llm` description references providers | `cognigy://guide/llm-providers` | LLM can proactively read before calling |
| `manage_knowledge` — `create_source` success | `cognigy://guide/knowledge-setup` | Async ingestion warning + verification |
| `manage_knowledge` — `search_chunks` empty after source creation | `cognigy://guide/knowledge-setup` | Ingestion delay explanation |
| `create_tool` fails (missing flow, bad tool type) | `cognigy://guide/tools-setup` | Valid tool types + prerequisites |
| `list_resources` returns empty for agents | `cognigy://guide/agent-creation` | How to create the first agent |
| Any tool — API 404 error | `cognigy://guide/troubleshooting` | ID format help + discovery steps |

### When NOT to reference a resource

<!-- REASONING: Emitting resource references on every response would defeat the purpose. The whole
     point is that happy-path calls are zero-overhead. The LLM already knows the workflow from
     Layer 1 instructions. References are for moments where the LLM needs information it can't
     infer from context alone. -->

- **Happy-path success** on any tool — data speaks for itself
- **`update_ai_agent` succeeds** — LLM knows to test next
- **`talk_to_agent` returns a response** — the response is the output
- **`list_resources` returns results** — results are self-explanatory

### Resource Definitions

#### `cognigy://guide/agent-creation`

```markdown
# Building a Cognigy AI Agent

## Prerequisites
- A project (use list_resources { resourceType: "project" } to find one)
- An LLM resource in the project (use setup_llm if none exists)

## Steps
1. list_resources { resourceType: "project" } — pick a projectId
2. list_resources { resourceType: "llm_model", projectId } — check if LLM exists
3. If no LLM: setup_llm { projectId, provider, modelName, apiKey }
   (See cognigy://guide/llm-providers for valid provider/model values)
4. create_ai_agent { projectId, name, description }
   — Returns: agent, flow, endpoint, endpointUrl
5. talk_to_agent { endpointUrl, message }
6. update_ai_agent { aiAgentId, description } — refine
7. Repeat 5-6 until satisfied

## Adding tools (optional)
8. create_tool { aiAgentId, toolType, name, config }
   (See cognigy://guide/tools-setup for tool types and config)
9. talk_to_agent — test with tool-triggering messages
10. Repeat 5-9 until satisfied

## Key facts
- create_ai_agent auto-provisions: flow, AI Agent Job Node, REST endpoint
- create_tool auto-provisions: flow nodes for tools. Do NOT create tool nodes manually.
- The description field is how you change agent behavior
- Use same sessionId across talk_to_agent calls for multi-turn testing
- endpointUrl uses a different base URL (endpoint-*.cognigy.ai), not the API URL
```

#### `cognigy://guide/llm-providers`

```markdown
# LLM Provider Reference

## setup_llm parameters

| provider | modelName examples | Notes |
|----------|-------------------|-------|
| openai | gpt-4o, gpt-4o-mini, gpt-4-turbo | Requires apiKey (sk-...) |
| anthropic | claude-sonnet-4-20250514, claude-3-5-haiku-20241022 | Requires apiKey |
| azure-openai | gpt-4o (deployment name) | Requires apiKey, may need connectionId |
| google | gemini-2.0-flash, gemini-1.5-pro | Requires apiKey |

## Credential resolution
- Provide apiKey for direct authentication (simplest)
- Provide connectionId for pre-configured Cognigy Connection
- At least one of apiKey or connectionId is required

## Common errors
- "Invalid provider": use exact strings from the provider column
- "Authentication failed": verify API key is valid for that provider
- "Model not found": check exact model name spelling
```

#### `cognigy://guide/troubleshooting`

```markdown
# Troubleshooting

## Agent returns empty response
1. Check LLM exists: list_resources { resourceType: "llm_model", projectId }
   If none: run setup_llm
2. Check agent description is not empty: get_resource { resourceType: "agent", id }
3. Check endpoint is connected: get_resource { resourceType: "endpoint", id }
   Verify flowId is set and URLToken exists

## create_ai_agent failed
- The tool auto-rolls back created resources on failure. Safe to retry.
- "Could not find entry node": transient issue, retry immediately
- Endpoint step error: check project exists and is accessible

## "Resource not found" errors
- All IDs are 24-char hex strings (e.g., 507f1f77bcf86cd799439011)
- UUIDs (36-char with dashes) are referenceIds — most tools need _id, not referenceId
- Use list_resources to find valid IDs

## setup_llm fails
- See cognigy://guide/llm-providers for valid provider and model strings
- Verify API key has access to the specified model

## delete_resource fails
- Some types need projectId — add it if delete fails without it
- Deleting a flow may cascade-delete child nodes
```

#### `cognigy://guide/tools-setup`

```markdown
# Adding Tools to an AI Agent

## What are tools?
Tools give an AI Agent capabilities beyond conversation — calling APIs, executing code, or searching knowledge bases. Without tools, an agent can only chat.

## Steps
1. Create the agent first: create_ai_agent { projectId, name, description }
   (create_tool requires an agent with an auto-provisioned flow)
2. create_tool { aiAgentId, toolType, name, config }
3. The tool is automatically wired into the agent's flow
4. Test with talk_to_agent

## Tool types

### http_request — Call external APIs
create_tool {
  aiAgentId: "...",
  toolType: "http_request",
  name: "Fetch Weather",
  config: {
    url: "https://api.weather.com/v1/current",
    method: "GET",
    headers: { "Authorization": "Bearer ..." }
  }
}

### code — Execute JavaScript
create_tool {
  aiAgentId: "...",
  toolType: "code",
  name: "Calculate Tax",
  config: {
    code: "const tax = input.amount * 0.2; actions.output('Tax: ' + tax, null);"
  }
}

### knowledge_search — Search a knowledge base
create_tool {
  aiAgentId: "...",
  toolType: "knowledge_search",
  name: "Search FAQ",
  config: {
    knowledgeStoreId: "507f1f77bcf86cd799439011"
  }
}

## Managing tools
- List: list_resources { resourceType: "tool", aiAgentId }
- Remove: delete_resource { resourceType: "tool", id: toolId, aiAgentId }
- Tool IDs come from create_tool response or list_resources

## Prerequisites
- Agent MUST be created via create_ai_agent (not manually) — create_tool needs the auto-provisioned flow
- For knowledge_search tools, the knowledge store must exist (use manage_knowledge first)
```

#### `cognigy://guide/knowledge-setup`

```markdown
# Adding Knowledge to an Agent

## Steps
1. manage_knowledge { operation: "create_store", projectId, name }
2. manage_knowledge { operation: "create_source", knowledgeStoreId, type, content }
   - type: "url" (web page), "text" (inline), "file" (file path)
   - IMPORTANT: Ingestion is async. Content is NOT searchable immediately.
   - Wait 10-60 seconds before searching.
3. manage_knowledge { operation: "search_chunks", knowledgeStoreId, query }
   - Verify content was ingested correctly
   - If no results right after create_source, wait and retry
4. Attach to agent:
   - create_ai_agent { projectId, name, knowledgeReferenceId: storeId }
   - Or: update_ai_agent to add knowledge reference to existing agent

## Tips
- Search chunks to verify content before attaching to agent
- For URLs, ensure the page is publicly accessible
- Text sources are best for structured FAQ content
```

---

## Part 4: 3-Layer Context System

<!-- REASONING: This system was designed across 4 iterations. Layer 1 gives the LLM the workflow on
     every session. Layer 2 makes each tool self-documenting. Layer 3 (hints + resource references)
     provides deep context exactly when needed. The key improvement over the earlier plan is that
     Layer 3 now actively bridges to MCP resources instead of just emitting inline text hints. -->

### Layer 1: Server Instructions (~200 tokens, loaded once at connection)

```
Cognigy.AI MCP Server — builds and iteratively improves LLM-powered AI Agents.

BUILD WORKFLOW (follow this order for new agents):
1. list_resources { resourceType: "project" } → pick a projectId
2. list_resources { resourceType: "llm_model", projectId } → check if LLM exists
   If none: setup_llm { projectId, provider, modelName, apiKey }
3. create_ai_agent { projectId, name, description } → returns agent + flow + endpoint + endpointUrl
4. talk_to_agent { endpointUrl, message } → test the agent
5. update_ai_agent { aiAgentId, description } → refine behavior
6. Repeat steps 4-5 until satisfied

RULES:
- create_ai_agent auto-provisions flow + AI Agent Job Node + REST endpoint. Do NOT create these separately.
- An LLM resource MUST exist in the project before talk_to_agent returns meaningful responses.
- talk_to_agent hits a DIFFERENT base URL (endpoint-*.cognigy.ai) — not the API base URL.
- delete_resource is the ONLY way to delete anything.
- create_tool handles tool creation — it auto-provisions flow nodes internally. Do NOT create flow nodes for tools manually.
- When errors occur, check _hints.resource for a guide URI to read.
```

The last rule is critical — it teaches the LLM to look for `_hints.resource` in error responses, which is the bridge that makes MCP resources actually get fetched.

### Layer 2: Tool Descriptions (~250 tokens per tool, ~2250 total for 9 tools)

Each tool's `description` is self-contained — an LLM can use the tool correctly from the description alone, without Layer 1. Descriptions state prerequisites, return values, and reference other tools for operations they don't handle. Where relevant, they also reference MCP resources directly (e.g., `setup_llm` references `cognigy://guide/llm-providers`).

### Layer 3: Response Hints with Resource References (0 tokens on happy path)

The `_hints` interface:

```typescript
interface ResponseHints {
  hint?: string;           // Simple one-liner for empty results
  warning?: string;        // Non-blocking issue (e.g., missing LLM, async ingestion)
  likely_cause?: string;   // Diagnostic text for errors
  resource?: string;       // MCP resource URI to fetch for guidance
  action?: string;         // What to do after reading the resource
}
```

**Token budget**: Happy-path calls emit 0 hint tokens. Error/warning hints average ~80 tokens including the resource URI. Over a 10-call happy-path session, total hint overhead is 0. Over a session with 2 errors, it's ~160 tokens — vs. ~800-1500 in the earlier approach that hinted on every response.

---

## Part 5: Rollback

<!-- REASONING: The earlier plan proposed a generic executeOrchestration() framework. This is
     over-engineered — there is exactly one orchestration chain (create_ai_agent), and the failure
     modes are narrow (at most 3 DELETEs). A simple inline try/catch is clearer and shorter. -->

`create_ai_agent` chains 6 API calls. On failure at any step, previously created resources are deleted in reverse order:

```typescript
async function handleCreateAiAgent(args: CreateAiAgentArgs): Promise<any> {
  let agentId: string | null = null;
  let flowId: string | null = null;
  let endpointId: string | null = null;

  try {
    const agent = await apiClient.post('/v2.0/aiagents', { ... });
    agentId = agent._id || agent.id;

    const flow = await apiClient.post('/v2.0/flows', { ... });
    flowId = flow._id || flow.id;

    const entryNode = await retryGetEntryNode(flowId, 3); // 3 retries, 500ms backoff

    await apiClient.post(`/v2.0/flows/${flowId}/chart/nodes`, { ... });

    const endpoint = await apiClient.post('/v2.0/endpoints', { ... });
    endpointId = endpoint._id || endpoint.id;

    const llmStatus = await checkLlmStatus(args.projectId); // non-critical

    return { agent: filter(agent), flow: filter(flow), endpoint: filter(endpoint), ... };
  } catch (error) {
    if (endpointId) try { await apiClient.delete(`/v2.0/endpoints/${endpointId}`); } catch {}
    if (flowId) try { await apiClient.delete(`/v2.0/flows/${flowId}`); } catch {}
    if (agentId) try { await apiClient.delete(`/v2.0/aiagents/${agentId}`); } catch {}

    return {
      failed: { step: identifyFailedStep(agentId, flowId, endpointId), error: error.message },
      _hints: {
        likely_cause: 'Orchestration failed. All created resources were rolled back.',
        resource: 'cognigy://guide/troubleshooting',
        action: 'Read troubleshooting guide, then retry create_ai_agent.'
      },
    };
  }
}
```

| If step fails... | Resources to clean up |
|---|---|
| `POST /v2.0/aiagents` | None |
| `POST /v2.0/flows` | DELETE agent |
| `GET /flows/{id}/chart/nodes` (retry exhausted) | DELETE flow, DELETE agent |
| `POST /flows/{id}/chart/nodes` | DELETE flow, DELETE agent |
| `POST /v2.0/endpoints` | DELETE flow, DELETE agent |
| `GET /v2.0/largelanguagemodels` (non-critical) | No rollback — just `llmStatus: "unknown"` |

**Cascade assumption**: Deleting a flow via `DELETE /v2.0/flows/{id}` is assumed to cascade-delete child nodes. **Verify against the Cognigy API during implementation.** If cascading does NOT work, the rollback must explicitly delete the AI Agent Job Node before deleting the flow: `DELETE /v2.0/flows/{flowId}/chart/nodes/{nodeId}`. Track `aiAgentJobNodeId` alongside the other resource IDs.

---

## Part 6: Response Filtering

<!-- REASONING: The v1 server returns raw API responses via JSON.stringify(result, null, 2). A single
     AI Agent object has 50+ fields. Listing 25 agents = 1000+ fields in the LLM's context. Response
     filtering extracts only fields the LLM needs, cutting tokens by 60-80%. -->

Each handler applies a response mapper that extracts only useful fields:

```typescript
const rid = (r: any) => r._id || r.id;

const RESOURCE_FILTERS: Record<string, (raw: any) => any> = {
  agent: (r) => ({ id: rid(r), referenceId: r.referenceId, name: r.name, description: r.description, createdAt: r.createdAt }),
  flow: (r) => ({ id: rid(r), referenceId: r.referenceId, name: r.name, createdAt: r.createdAt }),
  endpoint: (r) => ({ id: rid(r), name: r.name, channel: r.channel, flowId: r.flowId, URLToken: r.URLToken, createdAt: r.createdAt }),
  llm_model: (r) => ({ id: rid(r), name: r.name, provider: r.provider, model: r.model, isDefault: r.isDefault }),
  knowledge_store: (r) => ({ id: rid(r), name: r.name, description: r.description, sourceCount: r.sourceCount }),
  conversation: (r) => ({ sessionId: r.sessionId, channel: r.channel, startedAt: r.startedAt, messageCount: r.messageCount }),
  project: (r) => ({ id: rid(r), name: r.name, description: r.description, createdAt: r.createdAt }),
};
```

**JSON format**: `JSON.stringify(result)` — no pretty-printing. Indentation adds tokens for zero benefit.

**Escape hatches**: `get_resource` accepts `raw: true`, `talk_to_agent` accepts `verbose: true`.

---

## Part 7: Implementation File Changes

### Files to create

| File | Purpose |
|---|---|
| `src/tools/definitions.ts` | 9 tool definitions with descriptions + annotations |
| `src/tools/filters.ts` | Response mapper functions per resource type |
| `src/instructions.ts` | Server instructions constant (~12 lines) |
| `src/resources/agent-creation.md` | Agent creation guide |
| `src/resources/llm-providers.md` | LLM provider reference |
| `src/resources/troubleshooting.md` | Troubleshooting guide |
| `src/resources/knowledge-setup.md` | Knowledge/RAG setup guide |
| `src/resources/tools-setup.md` | Tool creation guide (types, config, prerequisites) |

### Files to modify

| File | Changes |
|---|---|
| `src/index.ts` | Strip from 862 to ~130 lines. Add `instructions` to Server constructor. Resource handlers load `.md` files via `fs.readFileSync`. Register 8 tools. Remove all embedded markdown functions. |
| `src/tools/handlers.ts` | Rewrite for 9 tools. Add `setup_llm` handler. Add `create_tool` handler with internal node orchestration. Inline rollback for `create_ai_agent`. Response filtering on all outputs. `_hints` with resource URIs on errors. Static axios import for `talk_to_agent`. Add `tool` type support to `list_resources` and `delete_resource` handlers. Remove intent/analytics/extension handlers. |
| `src/schemas/tools.ts` | New schemas for 9 tools. Remove intent/analytics schemas. Add LLM schemas. Add `create_tool` schema. Add `tool` to `list_resources`/`delete_resource` enums. Add conversation filter params to list schema. |
| `src/api/client.ts` | Add retry interceptor for 429/5xx with exponential backoff. |

### Files unchanged

| File | Reason |
|---|---|
| `src/config.ts` | No changes needed |
| `src/utils/logger.ts` | No changes needed |
| `src/utils/rateLimiter.ts` | Consider simplifying to global counter (optional) |
| `src/cli/init.ts` | No changes needed |

### Root-level cleanup

Remove AI-session artifact files from project root: `FINAL_SUMMARY.md`, `FOR_NEW_CHAT.md`, `HANDOFF.md`, `INDEX.md`, `PROJECT_SUMMARY.md`, `READ_ME_FIRST.txt`, `START_HERE.md`.

### Version bump

Set server version to `2.0.0` in config. Tool names change — well-behaved MCP clients adapt automatically via `ListTools`.
