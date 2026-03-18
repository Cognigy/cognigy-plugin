export const SERVER_INSTRUCTIONS = `Cognigy.AI MCP Server — builds and iteratively improves LLM-powered AI Agents.

BUILD WORKFLOW (follow this order for new agents):
1. list_resources { resourceType: "project" } → pick a projectId
2. list_resources { resourceType: "llm_model", projectId } → check if LLM exists
   If none: setup_llm { projectId, provider: "openAI", modelType: "gpt-4o", apiKey }
3. create_ai_agent { projectId, name, description } → returns agent + flow + endpoint + endpointUrl
4. talk_to_agent { endpointUrl, message } → test the agent
5. update_ai_agent → refine the agent using ALL available fields:
   - Agent-level: name, description (persona), instructions (guardrails)
   - Job-level (jobConfig): jobName (role title), jobDescription (responsibilities), jobInstructions (procedures), temperature, maxTokens
   Read cognigy://guide/agent-creation for the full field reference and examples.
   IMPORTANT: Always distribute configuration across the appropriate fields — do NOT put everything in description alone.
6. Repeat steps 4-5 until satisfied

KNOWLEDGE STORES:
- Knowledge stores should ALWAYS be attached as tools (via create_tool { toolType: "knowledge" } or knowledgeStoreReferenceId on create_ai_agent).
- This creates a dedicated search tool the agent can invoke during conversations.
- Only attach knowledge to the agent persona (via update_ai_agent) if the user EXPLICITLY asks to put it on the persona.

ADDING CUSTOM LOGIC (flow nodes inside tools):
Flow nodes are helpers for tools — they add logic INSIDE a tool's branch (e.g., conditionals, code, say nodes).
The default workflow is: create a tool first, then add nodes under it.
1. create_tool { aiAgentId, toolType: "tool", name, config } → creates the tool; returns toolNodeId
2. manage_flow_nodes { operation: "create", flowId, parentNodeId: "<toolNodeId>", mode: "appendChild", nodeType: "code", label: "...", config: { ... } } → adds a node inside the tool branch
3. manage_flow_nodes { operation: "list", flowId } → see all nodes
4. manage_flow_nodes { operation: "update", flowId, nodeId, config: { ... } }
5. manage_flow_nodes { operation: "delete", flowId, nodeId }
Read cognigy://guide/flow-nodes for supported node types and config schemas.
CRITICAL: NEVER add standalone nodes before the AI Agent Job node. ALL logic MUST live inside tool branches. The AI Agent (LLM) orchestrates everything — it decides when to call tools. Pre-agent nodes break the conversational flow and cause loops. Even authentication, data collection, and conditional greetings should be implemented as tools that the agent calls.

DEPLOY TO WEBCHAT (after agent is working):
1. manage_webchat { projectId, flowId, name } → creates a Webchat v3 endpoint
   Or: manage_webchat { endpointId, layout: {...}, behavior: {...} } → updates existing webchat
2. Use stylePreset ("classic", "modern", "slick") for quick setup, or configure individual groups.
3. Read cognigy://guide/webchat-setup for full settings reference and recipes.
4. ALWAYS show the demoWebchatUrl from the response to the user as a clickable link. Never tell them to go to the UI to find it.

RULES:
- create_ai_agent auto-provisions flow + AI Agent Job Node + REST endpoint. Do NOT create these separately.
- An LLM resource MUST exist in the project before talk_to_agent returns meaningful responses.
- talk_to_agent hits a DIFFERENT base URL (endpoint-*.cognigy.ai) — not the API base URL.
- delete_resource is the ONLY way to delete anything.
- create_tool handles tool creation — it auto-provisions flow nodes internally. Do NOT create flow nodes for tools manually.
- manage_flow_nodes is ONLY for building logic INSIDE tool branches. ALWAYS create a tool first (create_tool { toolType: "tool" }) then add nodes inside it using manage_flow_nodes with parentNodeId = toolNodeId and mode = "appendChild".
- NEVER create standalone nodes before the AI Agent Job node. This is an anti-pattern that causes conversation loops and broken flows. ALL behavior — including authentication, data collection, greetings, and conditional logic — must be implemented as agent tools that the LLM decides when to invoke.
- manage_flow_nodes only supports a curated set of node types. Read cognigy://guide/flow-nodes for the full list.
- manage_webchat creates a new endpoint when endpointId is omitted, and updates an existing endpoint only when endpointId is explicitly provided. To update an existing webchat, first use list_resources { resourceType: "endpoint", projectId } to find the endpointId.
- manage_webchat ALWAYS returns demoWebchatUrl — present it to the user every time as a clickable link. Do NOT tell the user to find the URL in the Cognigy UI.
- When errors occur, check _hints.resource for a guide URI to read.`;
