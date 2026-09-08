// Always-on baseline injected into every session (MCP `instructions`).
// Keep it terse: an overview plus genuinely cross-tool hard rules. Step-by-step
// workflow lives in plugin/skills/*/SKILL.md, per-tool contract in
// src/tools/definitions.ts, and "what to do next" in tool-result _hints.
// src/__tests__/toolSurfaceBudget.test.ts caps the size of all three.
export const SERVER_INSTRUCTIONS = `NiCE Cognigy Plugin — builds and iteratively improves LLM-powered AI Agents on the NiCE Cognigy platform.

In clients that support plugin skills (e.g. Claude Code), step-by-step workflow guidance auto-loads when your intent matches: agent-creation, tools-setup, flow-nodes, knowledge-setup, llm-providers, package-management, snapshot-backups, webchat-setup, voice-gateway-setup, voice-go-live-checklist, xapps, agent-red-team, docs-lookup, troubleshooting. Tool results carry _hints with warnings and the next step; follow them.

CAPABILITIES:
- Build & iterate: list projects → ensure a working LLM → create_ai_agent → talk_to_agent → update_ai_agent / create_tool.
- Knowledge (RAG), custom tool logic (manage_flow_nodes), Webchat and Voice Gateway deployment, voice go-live audit (audit_voice_agent).
- Reuse LLMs and other resources across projects with manage_packages; back up and roll back a project with manage_snapshots.
- Official documentation: the bundled Cognigy docs MCP server (query_docs_filesystem_cognigy_documentation, search_cognigy_documentation). Consult it before answering platform questions from memory; the platform changes faster than training data.

HARD RULES:
- An LLM must exist AND be connected in the project before talk_to_agent; without it the agent returns empty responses. Prefer reusing an existing LLM together with its Connection via manage_packages; setup_llm is the last resort.
- NEVER guess or invent API keys, URLs or credentials. Ask the user.
- Cognigy Connections are PROJECT-SCOPED: a connectionId from another project fails. Share one only via package export/import, and never use dangerouslySkipConnectionTest to bypass that.
- Build agent behavior as tools (create_tool), never as standalone flow nodes before the AI Agent Job Node; manage_flow_nodes only adds logic inside a tool branch. Never create two tools with the same toolId.
- create_tool toolType defaults to "tool". Use "http" only for a concrete API endpoint the user named, and "mcp" only for an explicitly requested external MCP server URL.
- For knowledge / RAG: set Knowledge AI settings (manage_settings set_knowledge_ai) BEFORE creating the store, and attach knowledge as a tool, not as persona text.
- The FIRST change to an existing agent in a project is HELD: the tool changes nothing and returns error backup_not_offered. Follow its hint (offer a backup, then manage_snapshots create or decline), then retry the same call. Never claim the change happened.
- manage_snapshots restore is IRREVERSIBLE and project-wide. Call it without confirm first, show the user the preflight, and pass confirm: true only after explicit agreement.
- delete_resource is the only way to delete resources; agents, flows and projects are renamed with a DELETE_ prefix rather than deleted. Flow nodes are deleted via manage_flow_nodes, snapshots via manage_snapshots (plugin-created backups only).
- Plugin changes are attributed as actor "mcp-plugin" in Cognigy audit events (2026.17.0+): list_resources { resourceType: "audit_event", actor: ["mcp-plugin"], sort: "timestamp:desc" }. createdBy / lastChangedBy are opaque ids: resolve the current user with get_resource { resourceType: "user", id: "me" } before attributing a change to anyone.
- Always show returned demo links (demoWebchatUrl, webrtcDemoUrl) to the user as clickable links. Deliver a flow's mermaid only as a native diagram artifact, never inline in a code fence or wrapped in HTML.`;
