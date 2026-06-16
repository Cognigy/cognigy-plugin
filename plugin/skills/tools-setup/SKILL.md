---
name: tools-setup
description: "Use when creating or configuring Cognigy agent tools — choosing the tool type (tool, http, mcp, knowledge, send_email) and their configuration schemas."
---

<!-- GENERATED from src/resources/tools-setup.md by scripts/generate-skills.mjs. Do not edit by hand — edit the guide and run `npm run generate:skills`. -->

> The full **Tools Setup Guide** is included below — you already have it. Do NOT call `read_guide` for `tools-setup`; just follow the content here.

# Adding Tools to an AI Agent

## What are tools?

Tools give an AI Agent capabilities beyond conversation — calling APIs, executing code, or searching knowledge bases. Without tools, an agent can only chat.

## Steps

1. Create the agent first: create_ai_agent { projectId, name, description }
   (create_tool requires an agent with an auto-provisioned flow)
2. create_tool { aiAgentId, toolType, name, config }
3. The tool is automatically wired into the agent's flow
4. Test with talk_to_agent

Rule of thumb: each tool in an agent flow should have a unique `toolId`. If you need more logic, parameters, validation, or HTTP calls for that tool, add them inside the same tool branch instead of creating another tool with the same `toolId`.

## Tool types (create_tool)

### tool — General-purpose tool with custom logic

```text
create_tool {
aiAgentId: "...",
toolType: "tool",
name: "Fetch Weather",
config: {
toolId: "fetch_weather",
description: "Fetches current weather for a city",
parameters: '{"type":"object","properties":{"city":{"type":"string"}}}',
toolResponseValue: "{{JSON.stringify(input.result)}}"
}
}
```

IMPORTANT: The node label in the flow uses `toolId` (snake_case), not the display `name`. Always provide `toolId`.

The Resolve Tool Action node is auto-created with an `answer` field that controls what is returned to the LLM. Default for general-purpose tools: `{{JSON.stringify(input.result)}}`. Set `toolResponseValue` to customize it.

### knowledge — Search a Knowledge Store

```text
create_tool {
aiAgentId: "...",
toolType: "knowledge",
name: "Search FAQ",
config: {
knowledgeStoreId: "507f1f77bcf86cd799439011",
toolId: "search_faq",
description: "Search the FAQ knowledge base"
}
}
```

### send_email — Send emails

```text
create_tool {
aiAgentId: "...",
toolType: "send_email",
name: "Send Email",
config: {
toolId: "send_email",
description: "Send an email to support",
recipient: "support@example.com"
}
}
```

### mcp — Connect to an EXTERNAL MCP server (specialized — not for general use)

⚠️ ONLY use this when the user explicitly asks to integrate with an external MCP (Model Context Protocol) server and provides a server URL. For general tool requests (e.g., "unlock account", "check status"), use toolType "tool" instead.

```text
create_tool {
aiAgentId: "...",
toolType: "mcp",
name: "External MCP",
config: {
mcpName: "my-mcp-server",
mcpServerUrl: "https://mcp.example.com",
timeout: 30
}
}
```

### http — Call an external HTTP API

Creates a composite node structure with optional pre/post-processing Code nodes:

aiAgentJobTool (the tool node the LLM sees)
└─ [Code node: pre-process] (optional)
└─ HTTP Request node (makes the API call)
└─ [Code node: post-process] (optional)

#### HTTP response shape — read this before writing postProcessCode

The HTTP Request node writes the response into the `input` object. Two things about this are not obvious from the schema and silently break tools when missed:

1. **Default storage key.** The response is stored at `input.httprequest` by default. This is the same key used in the default `toolResponseValue` of `{{JSON.stringify(input.httprequest)}}`.
2. **Wrapping.** The value at `input.httprequest` is NOT the raw response body. It is a wrapper object — typically:

   ```text
   input.httprequest = {
     result:     <parsed body>,   // JSON for application/json responses, string otherwise
     statusCode: 200,
     length:     <bytes>
   }
   ```

   So if the API returns `{ "meals": [...] }`, your `postProcessCode` reads `input.httprequest.result.meals`, NOT `input.httprequest.meals` and NOT `input.httprequest.body.meals`.

If you are unsure of the exact shape in your Cognigy version, instrument the post-process on the very first run (`input.debug = { keys: Object.keys(input.httprequest), sample: input.httprequest };`) instead of guessing — a wrong key returns `undefined`, the Resolve Tool Action serializes that, and the LLM honestly reports "no results found" even when the API call succeeded.

#### Code node rules

Both `preProcessCode` and `postProcessCode` run inside Cognigy Code nodes. Two rules apply:

- **No top-level `return`.** Code nodes are not full functions; the engine rejects `return` at the top level. Mutate `input` directly — `input.foo = bar;` instead of `return { foo: bar };`. If you need to short-circuit, set a flag and check it in a downstream node.
- **`input` is the only persistent surface.** Anything you write to `input.*` is visible to subsequent nodes (post-process, Resolve, downstream flow). Local `const`/`let` variables disappear at the end of the node.

#### Example — simple GET with post-processing

```text
create_tool {
aiAgentId: "...",
toolType: "http",
name: "Get Weather",
config: {
toolId: "get_weather",
description: "Fetches current weather for a location",
parameters: '{"type":"object","properties":{"city":{"type":"string"}}}',
url: "https://api.weather.com/v1/current?q={{input.aiAgent.toolArgs.city}}",
method: "GET",
headers: { "X-Api-Key": "your-api-key" },
postProcessCode: "input.weather = input.httprequest.result.current; delete input.httprequest;"
}
}
```

#### Example — POST with pre/post-processing and custom tool response

```text
create_tool {
aiAgentId: "...",
toolType: "http",
name: "Create Order",
config: {
toolId: "create_order",
description: "Creates a new order in the order management system",
parameters: '{"type":"object","properties":{"items":{"type":"array"},"customerId":{"type":"string"}}}',
url: "https://api.example.com/orders",
method: "POST",
headers: { "Authorization": "Bearer {{context.apiToken}}" },
body: "{{JSON.stringify(input.orderPayload)}}",
preProcessCode: "input.orderPayload = { items: input.aiAgent.toolArgs.items, customer: input.aiAgent.toolArgs.customerId, timestamp: new Date().toISOString() };",
postProcessCode: "input.orderResult = { orderId: input.httprequest.result.id, status: input.httprequest.result.status }; delete input.httprequest;",
toolResponseValue: "{{JSON.stringify(input.orderResult)}}"
}
}
```

#### Tool response value (toolResponseValue)

The `toolResponseValue` field controls what the Resolve Tool Action node returns to the LLM as the tool's result. This is a CognigyScript expression. It applies to BOTH `http` and general-purpose `tool` types.

Defaults (if omitted):

- **http tools**: `{{JSON.stringify(input.httprequest)}}` — returns the wrapped response object (`{ result, statusCode, length }`). The LLM sees the wrapper, not just the parsed body. For most tools you will want to override this with a trimmed payload from your `postProcessCode`.
- **general-purpose tools**: `{{JSON.stringify(input.result)}}` — returns the `input.result` field

IMPORTANT: The Resolve Tool Action node MUST have an `answer` value, otherwise nothing is returned to the LLM and the tool appears to produce no output. If your code stores results in a custom field, set toolResponseValue to match.

Common patterns:

- `{{JSON.stringify(input.result)}}` — return a processed result object (default for general-purpose tools)
- `{{JSON.stringify(input.orderResult)}}` — return a named result from post-processing
- `{{input.summary}}` — return a plain string value
- `{{JSON.stringify(input.httprequest.result)}}` — return only the parsed body of an HTTP response, dropping the `statusCode` / `length` wrapper

## Accessing tool parameters in code

Inside AI Agent tool branches, the LLM's tool call arguments are at `input.aiAgent.toolArgs`, **NOT** `input.data`. For example, if the tool defines a `city` parameter, access it as:

- Code nodes: `input.aiAgent.toolArgs.city`
- CognigyScript fields (URLs, body templates): `{{input.aiAgent.toolArgs.city}}`

## Adding logic inside tools (manage_flow_nodes)

After creating a `toolType: "tool"`, you can add flow nodes inside the tool's branch to build custom logic. This is the recommended way to add conversation logic — nodes should live inside tools, not as standalone nodes in the flow.

### Workflow

1. Create the tool — `create_tool` returns a `toolNodeId`
2. Add the first node using `parentNodeId` = toolNodeId and `mode` = `appendChild`
3. Add subsequent nodes using `parentNodeId` = previous node ID and `mode` = `append`

If you already created the tool for this action, stop there and reuse that same `toolNodeId`. Do not call `create_tool` again for the same `toolId`.

Note: Both `appendChild` and `append` work correctly when targeting a tool node. The handler automatically places new nodes in the correct execution chain (before the Resolve Tool Action node) regardless of which mode you use.

### Example — tool with validation logic and response

```
Step 1: Create the tool
create_tool {
  aiAgentId: "...",
  toolType: "tool",
  name: "Check Order Status",
  config: {
    toolId: "check_order_status",
    description: "Looks up the status of a customer order",
    parameters: '{"type":"object","properties":{"orderId":{"type":"string"}}}'
  }
}
→ returns toolNodeId: "abc123..."

Step 2: Add a Code node inside the tool branch
manage_flow_nodes {
  operation: "create",
  flowId: "<flowId>",
  parentNodeId: "abc123...",
  mode: "appendChild",
  nodeType: "code",
  label: "Validate Order ID",
  config: { code: "if (!input.aiAgent.toolArgs.orderId) { input.error = 'Missing order ID'; }" }
}
→ returns nodeId: "def456..."

Step 3: Add an If/Else node after the Code node
manage_flow_nodes {
  operation: "create",
  flowId: "<flowId>",
  parentNodeId: "def456...",
  mode: "append",
  nodeType: "ifThenElse",
  label: "Has Error?",
  config: { condition: "{{input.error}}" }
}
```

### Supported node types for tool branches

All node types supported by `manage_flow_nodes` can be used inside tool branches: `say`, `question`, `ifThenElse`, `lookup`, `setSessionContext`, `code`, `goTo`, `sleep`, `httpRequest`.

Read cognigy://guide/flow-nodes for config schemas of each node type.

## Updating tools (update_tool)

Modify an existing tool node's label or config:

```text
update_tool {
aiAgentId: "...",
toolNodeId: "...",
name: "Updated Weather Tool",
config: { description: "Updated description for the LLM" }
}
```

For http tools, include HTTP fields in config to update child nodes:

```text
update_tool {
aiAgentId: "...",
toolNodeId: "...",
toolType: "http",
config: {
url: "https://api.weather.com/v2/current",
postProcessCode: "input.result = input.httprequest.result;"
}
}
```

If the tool was originally created without `preProcessCode` / `postProcessCode`, passing them here will provision and wire the missing Code node automatically — no need to delete and recreate the tool. To target a specific existing child by ID (useful after a rename, or when the tool's flow contains other tools with the same label prefix), pass `httpNodeId` / `preProcessNodeId` / `postProcessNodeId` / `resolveNodeId` from the `childNodes` block in `create_tool`'s response.

## Managing tools

- List: list_resources { resourceType: "tool", aiAgentId }
- Remove: delete_resource { resourceType: "tool", id: toolId, aiAgentId }
- Update: update_tool { aiAgentId, toolNodeId, name?, config? }
- Tool IDs come from create_tool response or list_resources
- Tool IDs must be unique within an agent flow. If a tool already exists for an action, reuse it.

## Prerequisites

- Agent MUST be created via create_ai_agent (not manually) — tools need the auto-provisioned flow
- For knowledge tools, the knowledge store must exist (use manage_knowledge first)

## Knowledge: tool vs persona-level

- **Default (ALWAYS use unless told otherwise)**: Use create_tool with toolType "knowledge" to attach knowledge stores. This gives the agent a dedicated search tool it can invoke during conversations.
- **Exception**: Only attach knowledge to the agent persona (via create_ai_agent or update_ai_agent) if the user EXPLICITLY asks to put it on the persona. Do not default to persona-level attachment.
