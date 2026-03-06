# Building a Cognigy AI Agent

## Prerequisites
- A project (use list_resources { resourceType: "project" } to find one)
- An LLM resource in the project (use setup_llm if none exists)

## Steps
1. list_resources { resourceType: "project" } — pick a projectId
2. list_resources { resourceType: "llm_model", projectId } — check if LLM exists
3. If no LLM: setup_llm { projectId, provider: "openAI", modelType: "gpt-4o", apiKey }
   (See cognigy://guide/llm-providers for valid provider/modelType values)
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
