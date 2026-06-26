export const SERVER_INSTRUCTIONS = `Cognigy.AI Plugin — builds and iteratively improves LLM-powered AI Agents.

In clients that support plugin skills (e.g. Claude Code), detailed step-by-step workflow guidance auto-loads when your intent matches. The overview and hard rules below always apply.

WORKFLOWS:
- Build a new AI Agent: list projects → ENSURE an LLM exists (reuse via packages before setup_llm) → create_ai_agent → talk_to_agent → update_ai_agent. NEVER call talk_to_agent until a working LLM is confirmed in the project.
- Add knowledge / RAG: embedding model vs project-level Knowledge Search model, set_knowledge_ai BEFORE creating the store, attach knowledge as a tool (not the persona) by default.
- Reuse an LLM across projects: export each largeLanguageModel WITH its connection resource → upload_and_inspect → import → verify. An LLM without its connection is useless. Prefer this over setup_llm.
- Add custom logic: create a tool first (create_tool), then add nodes INSIDE the tool branch with manage_flow_nodes (parentNodeId = toolNodeId, mode = "appendChild"). NEVER add nodes before the AI Agent Job node.
- Deploy to Webchat: manage_webchat to create/update the endpoint. ALWAYS show the returned demoWebchatUrl as a clickable link.
- Voice setup & go-live: create the Voice Gateway endpoint, then audit_voice_agent (dry-run, then apply).

TOOL TYPE SELECTION (create_tool):
- Default to toolType "tool" for general requests (e.g., "unlock account", "check balance", "validate user"). This is the most common and versatile type.
- Use toolType "http" only when the user specifies a concrete HTTP/REST API endpoint to call.
- Use toolType "mcp" ONLY when the user explicitly asks to connect to an external MCP (Model Context Protocol) server and provides a server URL. NEVER use "mcp" for general-purpose tool requests — it is a specialized integration type, not a default.
- Use toolType "knowledge" when the user wants to search a Knowledge Store.
- Use toolType "send_email" when the user wants to send emails.

RULES:
- create_ai_agent auto-provisions flow + AI Agent Job Node + REST endpoint. Do NOT create these separately.
- An LLM resource MUST exist AND be successfully connected in the project before calling talk_to_agent. Do NOT attempt to test an agent without a confirmed working LLM — it will fail silently or return empty responses. If LLM setup failed or was not completed, skip testing and inform the user.
- If another project already has a reusable LLM with connectionId, DO NOT call setup_llm first. Transfer the LLM + connection via manage_packages and only fall back to setup_llm if reuse is unavailable or failed.
- NEVER hallucinate or guess API keys, connection URLs, or credentials. If an LLM needs to be created and no API key was provided by the user, ASK for it. Do NOT invent values.
- Cognigy Connections are PROJECT-SCOPED. A connectionId from project A cannot be used in project B — it will fail with "Connection does not exist". The ONLY way to share a connection across projects is via package export/import. Do NOT attempt to pass a cross-project connectionId to setup_llm.
- NEVER use dangerouslySkipConnectionTest to bypass a missing or cross-project connection. Fix the connection by importing the package or by creating a real same-project connection.
- talk_to_agent hits a DIFFERENT base URL (endpoint-*.cognigy.ai) — not the API base URL.
- delete_resource is the ONLY way to delete anything.
- create_tool handles tool creation — it auto-provisions flow nodes internally. Do NOT create flow nodes for tools manually.
- Never create two tools with the same \`toolId\`. Duplicate tool IDs can lead to failed tool execution or empty agent responses, and this is often a flow issue rather than an LLM or connection issue.
- manage_flow_nodes is ONLY for building logic INSIDE tool branches. ALWAYS create a tool first (create_tool { toolType: "tool" }) then add nodes inside it using manage_flow_nodes with parentNodeId = toolNodeId and mode = "appendChild".
- NEVER create standalone nodes before the AI Agent Job node. This is an anti-pattern that causes conversation loops and broken flows. ALL behavior — including authentication, data collection, greetings, and conditional logic — must be implemented as agent tools that the LLM decides when to invoke.
- manage_flow_nodes only supports a curated set of node types: say, question, ifThenElse, lookup, setSessionContext, code, goTo, sleep, httpRequest.
- manage_webchat creates a new endpoint when endpointId is omitted, and updates an existing endpoint only when endpointId is explicitly provided. To update an existing webchat, first use list_resources { resourceType: "endpoint", projectId } to find the endpointId.
- manage_webchat ALWAYS returns demoWebchatUrl — present it to the user every time as a clickable link. Do NOT tell the user to find the URL in the Cognigy UI.`;
