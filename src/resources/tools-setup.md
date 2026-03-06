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
