# Adding Tools to an AI Agent

## What are tools?
Tools give an AI Agent capabilities beyond conversation — calling APIs, executing code, or searching knowledge bases. Without tools, an agent can only chat.

## Steps
1. Create the agent first: create_ai_agent { projectId, name, description }
   (create_tool requires an agent with an auto-provisioned flow)
2. create_tool { aiAgentId, toolType, name, config }
3. The tool is automatically wired into the agent's flow
4. Test with talk_to_agent

## Tool types (create_tool)

### tool — General-purpose tool with custom logic
create_tool {
  aiAgentId: "...",
  toolType: "tool",
  name: "Fetch Weather",
  config: {
    toolId: "fetch_weather",
    description: "Fetches current weather for a city",
    parameters: '{"type":"object","properties":{"city":{"type":"string"}}}'
  }
}

### knowledge — Search a Knowledge Store
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

### send_email — Send emails
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

### mcp — Connect to a remote MCP server
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

### http — Call an external HTTP API

Creates a composite node structure with optional pre/post-processing Code nodes:

  aiAgentJobTool (the tool node the LLM sees)
    └─ [Code node: pre-process] (optional)
    └─ HTTP Request node (makes the API call)
    └─ [Code node: post-process] (optional)

#### Example — simple GET with post-processing
create_tool {
  aiAgentId: "...",
  toolType: "http",
  name: "Get Weather",
  config: {
    toolId: "get_weather",
    description: "Fetches current weather for a location",
    parameters: '{"type":"object","properties":{"city":{"type":"string"}}}',
    url: "https://api.weather.com/v1/current?q={{input.data.city}}",
    method: "GET",
    headers: { "X-Api-Key": "your-api-key" },
    postProcessCode: "input.weather = input.httpResponse.body.current; delete input.httpResponse;"
  }
}

#### Example — POST with pre/post-processing and custom tool response
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
    preProcessCode: "input.orderPayload = { items: input.data.items, customer: input.data.customerId, timestamp: new Date().toISOString() };",
    postProcessCode: "input.orderResult = { orderId: input.httpResponse.body.id, status: input.httpResponse.body.status }; delete input.httpResponse;",
    toolResponseValue: "{{JSON.stringify(input.orderResult)}}"
  }
}

#### Tool response value (toolResponseValue)
The `toolResponseValue` field controls what the Resolve Tool Action node returns to the LLM as the tool's result. This is a CognigyScript expression.

- **Default** (if omitted): `{{JSON.stringify(input.httprequest)}}` — returns the raw HTTP response object
- **Custom**: Set to any CognigyScript expression pointing to where your code nodes store the processed result

IMPORTANT: If you use postProcessCode to transform the HTTP response and store it in a custom field (e.g., `input.result` or `input.orderResult`), you MUST set toolResponseValue to match (e.g., `{{JSON.stringify(input.result)}}`). Otherwise the Resolve node will return the raw HTTP response instead of your processed data.

Common patterns:
- `{{JSON.stringify(input.result)}}` — return a processed result object
- `{{JSON.stringify(input.orderResult)}}` — return a named result from post-processing
- `{{input.summary}}` — return a plain string value
- `{{JSON.stringify(input.httprequest)}}` — return the raw HTTP response (default)

## Updating tools (update_tool)

Modify an existing tool node's label or config:
update_tool {
  aiAgentId: "...",
  toolNodeId: "...",
  name: "Updated Weather Tool",
  config: { description: "Updated description for the LLM" }
}

For http tools, include HTTP fields in config to update child nodes:
update_tool {
  aiAgentId: "...",
  toolNodeId: "...",
  toolType: "http",
  config: {
    url: "https://api.weather.com/v2/current",
    postProcessCode: "input.result = input.httpResponse.body;"
  }
}

## Managing tools
- List: list_resources { resourceType: "tool", aiAgentId }
- Remove: delete_resource { resourceType: "tool", id: toolId, aiAgentId }
- Update: update_tool { aiAgentId, toolNodeId, name?, config? }
- Tool IDs come from create_tool response or list_resources

## Prerequisites
- Agent MUST be created via create_ai_agent (not manually) — tools need the auto-provisioned flow
- For knowledge tools, the knowledge store must exist (use manage_knowledge first)

## Knowledge: tool vs persona-level
- **Default (ALWAYS use unless told otherwise)**: Use create_tool with toolType "knowledge" to attach knowledge stores. This gives the agent a dedicated search tool it can invoke during conversations.
- **Exception**: Only attach knowledge to the agent persona (via create_ai_agent or update_ai_agent) if the user EXPLICITLY asks to put it on the persona. Do not default to persona-level attachment.
