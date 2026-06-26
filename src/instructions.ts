export const SERVER_INSTRUCTIONS = `NiCE Cognigy Plugin — builds and iteratively improves LLM-powered AI Agents.

In clients that support plugin skills (e.g. Claude Code), detailed step-by-step workflow guidance auto-loads when your intent matches. This overview and the hard rules below always apply.

CAPABILITIES:
- Build & iterate on AI Agents: list projects → ensure an LLM → create_ai_agent → talk_to_agent → update_ai_agent.
- Knowledge / RAG, custom tool logic, Webchat deployment, and Voice Gateway setup + go-live audit (audit_voice_agent).
- Reuse LLMs and other resources across projects via manage_packages.

TOOL TYPE SELECTION (create_tool):
- Default to toolType "tool" for general requests (e.g., "unlock account", "check balance", "validate user"). This is the most common and versatile type.
- Use toolType "http" only when the user specifies a concrete HTTP/REST API endpoint to call.
- Use toolType "mcp" ONLY when the user explicitly asks to connect to an external MCP (Model Context Protocol) server and provides a server URL. NEVER use "mcp" for general-purpose tool requests — it is a specialized integration type, not a default.
- Use toolType "knowledge" when the user wants to search a Knowledge Store.
- Use toolType "send_email" when the user wants to send emails.

RULES:
- create_ai_agent auto-provisions flow + AI Agent Job Node + REST endpoint. Do NOT create these separately.
- An LLM resource MUST exist AND be successfully connected in the project before calling talk_to_agent. Do NOT test an agent without a confirmed working LLM — it fails silently or returns empty responses. If LLM setup failed or was not completed, skip testing and inform the user.
- If another project already has a reusable LLM with a connectionId, DO NOT call setup_llm first. Transfer the LLM + its connection via manage_packages and only fall back to setup_llm if reuse is unavailable or failed. An LLM without its connection is useless.
- NEVER hallucinate or guess API keys, connection URLs, or credentials. If an LLM needs to be created and no API key was provided, ASK for it. Do NOT invent values.
- Cognigy Connections are PROJECT-SCOPED: a connectionId from project A cannot be used in project B (fails with "Connection does not exist"). The ONLY way to share one across projects is package export/import. Never pass a cross-project connectionId to setup_llm, and never use dangerouslySkipConnectionTest to bypass a missing or cross-project connection.
- For knowledge / RAG: the embedding model and the project-level Knowledge Search model are distinct; call set_knowledge_ai BEFORE creating the store; attach knowledge as a tool (not the persona) by default.
- talk_to_agent hits a DIFFERENT base URL (endpoint-*.cognigy.ai) — not the API base URL.
- delete_resource is the ONLY way to delete anything.
- Build agent behavior as tools, not standalone flow nodes. manage_flow_nodes is ONLY for logic INSIDE a tool branch: create a tool first (create_tool { toolType: "tool" }), then add nodes with parentNodeId = toolNodeId and mode = "appendChild". NEVER add standalone nodes before the AI Agent Job node — it causes conversation loops and broken flows. (Supported node types: say, question, ifThenElse, lookup, setSessionContext, code, goTo, sleep, httpRequest.)
- Never create two tools with the same \`toolId\` — duplicates cause failed execution or empty responses, and this is usually a flow issue rather than an LLM or connection issue.
- audit_voice_agent runs a dry-run first; apply fixes only after review.
- manage_webchat creates a new endpoint when endpointId is omitted, and updates an existing one only when endpointId is provided (find it via list_resources { resourceType: "endpoint", projectId }). It ALWAYS returns demoWebchatUrl — present it to the user every time as a clickable link; do NOT tell the user to find the URL in the Cognigy UI.`;
