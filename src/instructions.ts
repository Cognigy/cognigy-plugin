export const SERVER_INSTRUCTIONS = `Cognigy.AI MCP Server — builds and iteratively improves LLM-powered AI Agents.

GUIDE ACCESS:
- Use read_guide to load the full contents of a Cognigy guide. Do NOT assume the client will automatically resolve a bare cognigy://guide/... URI.
- When another tool returns _hints.guideToolCall, prefer using that exact read_guide call.
- MCP resources are still exposed, but tool-based guide reads are the reliable cross-client path.

BUILD WORKFLOW (follow this order for new agents):
1. list_resources { resourceType: "project" } → list ALL projects
2. ENSURE LLM EXISTS — this step is MANDATORY before testing an agent, and should be completed before agent creation whenever the target project already exists. Do NOT skip or call setup_llm without completing these checks first:
   a. If the user wants a NEW project and no projectId exists yet, create it first via create_ai_agent with omitted projectId. Then immediately continue with the checks below against the returned projectId if llmStatus is "unknown".
   b. Check the TARGET project for existing LLMs: list_resources { resourceType: "llm_model", projectId: "<targetProjectId>" }
      - Reuse prior discovery results. Do NOT spam repeated list_resources calls for the same project unless something changed (for example: after import, after setup_llm, or after user asks to refresh).
   c. If the target project already has a reusable LLM with a non-empty connectionId → proceed to step 3.
   d. If NO reusable LLM exists in the target project, check whether the user has MORE THAN ONE project (from step 1 results).
      - If user has multiple projects: check the OTHER projects for LLMs (list_resources { resourceType: "llm_model", projectId } for each), but only once per project unless the state changes.
      - Choose only source-project candidates whose llm_model has a non-empty connectionId. An LLM without a connectionId is not a valid reuse candidate.
      - If another project has a reusable LLM with connectionId: REUSE VIA PACKAGES automatically (see LLM REUSE VIA PACKAGES section below). Prefer reusing an existing working LLM + connection instead of creating a new LLM.
      - If user has only one project (or no other project has reusable LLMs with connectionId): proceed to setup_llm (step 2e).
   e. setup_llm — ONLY as last resort, after confirming there is no reusable LLM package path or that package transfer failed. Ask the user for provider, model, and API key. NEVER guess or hallucinate API keys or connection details.
3. create_ai_agent { projectId, name, description } → returns agent + flow + endpoint + endpointUrl
4. ONLY test the agent if an LLM is confirmed working in the project:
   - talk_to_agent { endpointUrl, message } → test the agent
   - If the LLM setup failed, was skipped, or package import has not completed successfully, do NOT call talk_to_agent. Instead, inform the user that the agent was created but cannot be tested until a working LLM is configured.
5. update_ai_agent → refine the agent using ALL available fields:
   - Agent-level: name, description (persona), instructions (guardrails)
   - Job-level (jobConfig): jobName (role title), jobDescription (responsibilities), jobInstructions (procedures), temperature, maxTokens
   Use read_guide { guideId: "agent-creation" } for the full field reference and examples.
   IMPORTANT: Always distribute configuration across the appropriate fields — do NOT put everything in description alone.
6. Repeat steps 4-5 until satisfied

KNOWLEDGE STORES:
- Use the guidance below as the source of truth for workflow policy. The resource guides provide concise reference material.
- There are TWO model roles you usually need for AI-agent knowledge workflows. Do not mix them up:
  1. Embedding model: required to create and use the knowledge store index itself.
  2. Knowledge Search model: project-level Knowledge AI setting used for knowledge search behavior.
- Do not use hardcoded model-name assumptions as the source of truth for either role. Model names in guides are examples, not a whitelist.
- For knowledgeSearchModelId, do NOT assume a chat model is always required, and do NOT assume an embedding model is always rejected. The accepted model type is instance-dependent. Treat the Cognigy API response as the source of truth.
- Before calling setup_llm for knowledge workflows, ALWAYS list llm_model resources in the TARGET project and try/reuse imported same-project model IDs first.
- When choosing knowledgeSearchModelId, prefer list_resources { resourceType: "llm_model", projectId, useCase: "knowledgeSearch" } so the candidate set matches the Cognigy Settings UI dropdown instead of the unfiltered project-wide LLM list.
- After package import, refresh list_resources { resourceType: "llm_model", projectId } before deciding what to use for knowledgeSearchModelId.
- If another project already has a working knowledge workflow, inspect that source project's exact Knowledge Search model and Content Parser choice BEFORE the first set_knowledge_ai call in the target project.
- Do NOT attempt knowledgeSearchModelId with the agent chat model or any other generic default until the source project's exact Knowledge Search choice has been imported and tried, or you have confirmed that no such source-project choice is available.
- If manage_settings rejects one knowledgeSearchModelId with a message like "model type not allowed", try other existing llm_model IDs in the SAME project before creating a new model.
- For normal AI-agent knowledge flows, set Knowledge AI Settings with manage_settings BEFORE creating the knowledge store or uploading sources.
- Do NOT substitute a freshly created or generic model for knowledgeSearchModelId just because the user asked for a new project. Reuse the imported same-project model that matches the source project's Knowledge Search choice when available.
- If an imported same-project model is rejected for knowledgeSearchModelId, do NOT call setup_llm to create another model as a workaround unless the user explicitly asks for a brand-new model after you have exhausted the existing target-project candidates.
- Keep the AI Agent response model choice separate from the Knowledge Search model choice. The model preferred for agent responses is not a reason to try that same model for knowledgeSearchModelId.
- Do NOT speculatively probe arbitrary unfiltered models for knowledgeSearchModelId before trying the source project's known Knowledge Search model or the other existing same-project candidates.
- Knowledge stores should ALWAYS be attached as tools (via create_tool { toolType: "knowledge" } or knowledgeStoreReferenceId on create_ai_agent).
- This creates a dedicated search tool the agent can invoke during conversations.
- Only attach knowledge to the agent persona (via update_ai_agent) if the user EXPLICITLY asks to put it on the persona.
- Knowledge Search depends on the embedding-backed knowledge store and on project-level Knowledge AI Settings. Configure them with manage_settings { operation: "set_knowledge_ai", ... } before assuming knowledge features will work.
- If the user is creating a NEW project and intends to use knowledge stores, prefer reproducing one existing working knowledge setup exactly instead of mixing defaults from multiple projects.
- For knowledge workflows, import the full required source-project model set up front before the first Knowledge AI settings attempt: the embedding model, the exact source-project Knowledge Search model, and any other required LLMs for the workflow. If the agent also needs a separate response model, transfer that as part of the same plan.
- When multiple required LLMs share the same source-project connection, export/import all of those llm_model resources together with that single connection resource in one package. Do NOT re-import the same shared connection in a later package just to bring over another model.
- If the exact source-project Knowledge Search model is not yet present in the target project, stop and import it before retrying set_knowledge_ai. Do NOT fall back to an arbitrary generic model first.
- If the useCase-filtered knowledgeSearch list contains only one real candidate, do NOT speculate outside that list before trying it and reporting the result.
- When reporting blockers or partial completion, distinguish observed tool errors from inference. Do not claim a setting or model is broken unless a tool call actually returned that failure.
- Do not describe a knowledgeSearchModelId rejection as a platform-side bug just because a similar model worked in another project. Report the exact target-project attempts and failures only.
- Do not say an untried model is "likely" rejected or unsupported. Only report actual API validation results for models you tried.
- If reading a guide resource fails, continue using the existing instructions and tool descriptions. Do not treat guide-fetch failure as the root cause of the Cognigy configuration problem.

ADDING CUSTOM LOGIC (flow nodes inside tools):
Flow nodes are helpers for tools — they add logic INSIDE a tool's branch (e.g., conditionals, code, say nodes).
The default workflow is: create a tool first, then add nodes under it.
1. create_tool { aiAgentId, toolType: "tool", name, config } → creates the tool; returns toolNodeId
2. manage_flow_nodes { operation: "create", flowId, parentNodeId: "<toolNodeId>", mode: "appendChild", nodeType: "code", label: "...", config: { ... } } → adds a node inside the tool branch
3. manage_flow_nodes { operation: "list", flowId } → see all nodes
4. manage_flow_nodes { operation: "update", flowId, nodeId, config: { ... } }
5. manage_flow_nodes { operation: "delete", flowId, nodeId }
Use read_guide { guideId: "flow-nodes" } for supported node types and config schemas.
CRITICAL: Each tool in an agent flow must have a unique \`toolId\`. Do NOT create a second tool with the same \`toolId\`. If a tool with that \`toolId\` already exists, reuse it and add logic inside that branch with manage_flow_nodes or modify it with update_tool.
CRITICAL: NEVER add standalone nodes before the AI Agent Job node. ALL logic MUST live inside tool branches. The AI Agent (LLM) orchestrates everything — it decides when to call tools. Pre-agent nodes break the conversational flow and cause loops. Even authentication, data collection, and conditional greetings should be implemented as tools that the agent calls.

DEPLOY TO WEBCHAT (after agent is working):
1. manage_webchat { projectId, flowId, name } → creates a Webchat v3 endpoint
   Or: manage_webchat { endpointId, layout: {...}, behavior: {...} } → updates existing webchat
2. Use stylePreset ("classic", "modern", "slick") for quick setup, or configure individual groups.
3. Use read_guide { guideId: "webchat-setup" } for full settings reference and recipes.
4. ALWAYS show the demoWebchatUrl from the response to the user as a clickable link. Never tell them to go to the UI to find it.

LLM REUSE VIA PACKAGES:
When another project already has a working LLM, you should transfer the required llm_model resource set plus its connection resources into the target project before considering setup_llm.
CRITICAL: An LLM resource WITHOUT its connection is useless. The connection holds the API credentials (API key). You MUST export each required largeLanguageModel together with its associated connection resource.
CRITICAL: For knowledge workflows, "required" can mean more than one model. Do NOT stop after importing one working chat model if the source project uses a different Knowledge Search model or a separate embedding model.

Automated transfer workflow:
  1. list_resources { resourceType: "llm_model", projectId: "<sourceProjectId>" } → identify the full required source-project model set and confirm each selected llm_model has a non-empty connectionId.
  2. If the workflow will use knowledge, determine the source project's exact Knowledge Search model and Content Parser choice before exporting anything. Do NOT guess with the agent response model first.
  3. manage_packages { operation: "list_exportable", projectId: "<sourceProjectId>" } → find ALL required largeLanguageModel resource IDs and the DISTINCT connection resource IDs they depend on. Look for resources with type "largeLanguageModel" and type "connection". Match connections via llm_model.connectionId.
  4. manage_packages { operation: "export", projectId: "<sourceProjectId>", resourceIds: ["<llmResourceId1>", "<llmResourceId2>", "<connectionResourceId1>"], name: "llm-transfer" } → export the full required model set in one package. If multiple models share one connection, include that connection resource only once. Do not rely on automatic dependency resolution for connections.
  5. manage_packages { operation: "upload_and_inspect", projectId: "<targetProjectId>", filePath: "<path from step 4>" } → upload the exported .zip into the target project and inspect it.
  6. manage_packages { operation: "import", projectId: "<targetProjectId>", packageId: "<packageId from step 5>" } → import the package into the target project.
  7. Verify with list_resources { resourceType: "llm_model", projectId: "<targetProjectId>" } that the required models are now available before creating or testing the agent, and before calling set_knowledge_ai.

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
- Cognigy Connections are PROJECT-SCOPED. A connectionId from project A cannot be used in project B — it will fail with "Connection does not exist". The ONLY way to share a connection across projects is via package export/import (see LLM REUSE VIA PACKAGES). Do NOT attempt to pass a cross-project connectionId to setup_llm.
- NEVER use dangerouslySkipConnectionTest to bypass a missing or cross-project connection. Fix the connection by importing the package or by creating a real same-project connection.
- talk_to_agent hits a DIFFERENT base URL (endpoint-*.cognigy.ai) — not the API base URL.
- delete_resource is the ONLY way to delete anything.
- create_tool handles tool creation — it auto-provisions flow nodes internally. Do NOT create flow nodes for tools manually.
- Never create two tools with the same \`toolId\`. Duplicate tool IDs can lead to failed tool execution or empty agent responses, and this is often a flow issue rather than an LLM or connection issue.
- manage_flow_nodes is ONLY for building logic INSIDE tool branches. ALWAYS create a tool first (create_tool { toolType: "tool" }) then add nodes inside it using manage_flow_nodes with parentNodeId = toolNodeId and mode = "appendChild".
- NEVER create standalone nodes before the AI Agent Job node. This is an anti-pattern that causes conversation loops and broken flows. ALL behavior — including authentication, data collection, greetings, and conditional logic — must be implemented as agent tools that the LLM decides when to invoke.
- manage_flow_nodes only supports a curated set of node types. Use read_guide { guideId: "flow-nodes" } for the full list.
- manage_webchat creates a new endpoint when endpointId is omitted, and updates an existing endpoint only when endpointId is explicitly provided. To update an existing webchat, first use list_resources { resourceType: "endpoint", projectId } to find the endpointId.
- manage_webchat ALWAYS returns demoWebchatUrl — present it to the user every time as a clickable link. Do NOT tell the user to find the URL in the Cognigy UI.
- When errors occur, if _hints.guideToolCall is present, call that tool to load the referenced guide before retrying.`;
