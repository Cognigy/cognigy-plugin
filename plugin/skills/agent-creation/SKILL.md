---
name: agent-creation
description: "Use when the user wants to build, create, or set up a new Cognigy AI Agent from scratch, or change an agent's settings, skills, tools, knowledge or system prompt, or make it answer faster — covers checking what the environment supports, listing projects, ensuring an LLM exists, creating the agent, testing it, and refining it."
---

# Building a Cognigy AI Agent

## Which kind to build — decide first

Cognigy has two kinds of agent. With the user, call both "AI Agents"; say "legacy" only when you must tell them apart, and never say "V1", "V2" or "Agents V2".

1. `check_capabilities` once per conversation, before creating or changing any agent.
2. `aiAgents: "available"` → first list the project's agents (`list_resources { resourceType: 'agent', projectId }`). If it has agents and every one has `legacy: true`, the project is legacy-only: use **Path B** with `create_ai_agent { legacy: true }`. Do the same when the user asked for a legacy agent. Otherwise build with `manage_agent` (**Path A**); a new project has no agents, so it gets Path A.
3. `aiAgents: "unavailable"` → **Path B**, `create_ai_agent` without `legacy`. Say nothing about kinds.
4. `aiAgents: "unknown"` → try Path A; if `manage_agent` fails with 403 or 404, use Path B.

**Existing agents:** `list_resources { resourceType: 'agent', projectId }` returns both kinds. If the project has AI Agents they are in `items`; legacy agents are under `legacyAgents` and carry `legacy: true`, and are only used when the user names one. Pass each item's `use` on (`{ agentId }` or `{ aiAgentId }`, plus `projectId`). A pasted UUID is a `referenceId` — find the matching item in that list and use its `id`.

## Shared steps: project and a working LLM

1. list_resources { resourceType: "project" } — inspect all projects
2. Choose the target project
   - If it already exists: use its projectId
   - If the user wants a new project: Path A creates one when `manage_agent create` gets no projectId; Path B when `create_ai_agent` gets none. Keep the returned projectId and run steps 3-6 for it before testing.
3. Run list_resources { resourceType: "llm_model", projectId } — check whether the target project already has a working LLM: a text model with a non-empty connectionId, or a NiCE-provided one (`isInPlatformLlm: true`, shown as "Included by NiCE Cognigy"), which needs no connection. Either one is enough; skip steps 4-6.
4. If the target project has no reusable LLM, check the other projects for reusable LLMs
   - Run list_resources { resourceType: "llm_model", projectId } for each other project
   - Choose only candidates whose llm_model has a non-empty connectionId
   - Do not treat an LLM without connectionId as a valid reuse candidate. NiCE-provided models are never transferred; they are already in the target project or not available at all
5. If another project already has a reusable LLM, transfer the required model set together with its connection resource(s):
   - manage_packages { operation: "list_exportable", projectId: "<sourceProjectId>" }
   - If this workflow will use knowledge, identify the source project's exact Knowledge Search model and embedding model before exporting anything
   - manage_packages { operation: "export", projectId: "<sourceProjectId>", resourceIds: ["<llmResourceId1>", "<llmResourceId2>", "<connectionResourceId>"], name: "llm-transfer" }
   - manage_packages { operation: "upload_and_inspect", projectId: "<targetProjectId>", filePath: "<savedTo from export>" }
   - manage_packages { operation: "import", projectId: "<targetProjectId>", packageId: "<packageId from upload_and_inspect>" }
   - list_resources { resourceType: "llm_model", projectId: "<targetProjectId>" } — verify the required models are present before testing or continuing setup
6. Only if no reusable LLM with connectionId exists, or the package transfer failed: setup_llm { projectId, provider: "openAI", modelType: "gpt-4o", apiKey }
   - With isDefault: true (the default), agents auto-use this LLM — no extra step needed.
   - Save the `referenceId` from the response if you need to assign it explicitly later.
     (See the llm-providers skill for valid provider/modelType values)

## Path A — AI Agents (manage_agent)

1. manage_agent { operation: "create", projectId, name, role, description, instructions, largeLanguageModelReferenceId }
   — Returns: agent, endpointUrl, use, and `llm` when the plugin picked the model. A REST endpoint for testing is created too.
   — Bind the text LLM from the shared steps by its `referenceId`. Omitted, the plugin binds the model create_ai_agent would pick (a connected or NiCE-provided one, the project default first). Never bind a voice-to-voice model (gpt-live-1).
   — `agentType`: "text" for a chat agent, "voice" for a phone or voice agent. Omitted, the platform makes a voice agent.
2. Add skills, tools and knowledge — see "Skills, tools, MCP servers and personas" below.
3. Only after the project has a confirmed working LLM: talk_to_agent { agentId, projectId, message }
   — If the result carries `error` (e.g. "language model isn't fully configured"), fix the LLM binding with manage_agent { operation: "update", largeLanguageModelReferenceId } before anything else.
4. Refine with manage_agent { operation: "update", agentId, projectId, ... } — only the fields you pass change. See the fields below.
5. Repeat 3-4 until satisfied.

### Fields (manage_agent create / update)

| Field                            | Purpose                                                                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| name                             | Display name, also used when the agent introduces itself                                                                            |
| role                             | Short role, e.g. "Customer support specialist" (max 100 chars). Opens the generated system prompt                                  |
| description                      | Who the agent is, its personality and tone                                                                                          |
| instructions                     | How it does its job: procedures, rules, what to escalate (max 5000 chars; may hold CognigyScript)                                   |
| largeLanguageModelReferenceId    | The text LLM                                                                                                                        |
| llmConfig                        | `{ temperature, maxOutputTokens, reasoningEffort }`. On update the whole block is replaced                                         |
| knowledge                        | Knowledge search — see "Knowledge" below                                                                                            |
| guardrails                       | `safetySettings` switches (all on by default) and `dataPrivacy.contactProfilesOption` (none, completeProfile, profileMemoriesOnly, selectedProfileFields) |
| hooks                            | `{ preTurn: [{ handler: { kind: "conversationFlow", flowReferenceId } }] }` — a pre-turn Flow that runs before every answer (see "Pre-turn hook"). `null` removes it |
| personaReferenceId               | A brand persona shared by several agents. The UI requires one: create picks the project's first, or makes the default "NiCE" |
| image                            | Avatar URL or base64 data URI                                                                                                       |
| skillReferenceIds / toolReferenceIds | create only; later use attach/detach                                                                                            |
| disabledToolReferenceIds         | update only: switch attached tools off without detaching them                                                                       |

Spread the configuration across role, description and instructions instead of putting everything in one field.

### Skills, tools, MCP servers and personas (manage_agent_components)

Components live in the project; an agent points at skills and tools by `referenceId`. Pass `agentId` on `create` to attach in the same call, or use `attach` / `detach` later.

- **Builtin tools:** `catalog { component: "tool", projectId }` lists what the platform ships and each tool's parameters. Then
  `create { component: "tool", projectId, agentId, config: { builtinSlug, name, description, parameters: { <key>: value | { mode, value } } } }`.
  - `mode: "dynamic"` — you fix the value now (a URL, a method). `mode: "aiFilled"` — the LLM fills it per turn (a query, a payload). A plain value (`url: "https://…"`) makes the parameter dynamic; pass `{ mode: "aiFilled" }` to leave it to the LLM.
  - `description` tells the LLM when to call the tool; write it for that.
  - Parameters of type `connection` hold credentials. Never invent them: the user picks the Connection in the agent editor.
  - Common ones: `http-request` (call an API), `knowledge-search`, `send-email`, `handoff-to-flow`, `execute-tool-flow` (see "A Flow as a tool"); for voice agents `voice-hangup`, `voice-transfer`, `voice-config-defaults`.
- **Skills:** `catalog { component: "skill" }` for the builtin ones (`config: { builtinSlug }`), or your own:
  `create { component: "skill", projectId, agentId, config: { name, description, instructions, bundledTools?: [tool referenceIds], resources?: [{ path, content, encoding: "utf8" }] } }`.
  `update { component: "skill", componentId, config: { bundledTools } }` replaces the skill's whole tool list. A bundled tool does not need to be attached to the agent: the agent gets it when it loads the skill.
  - **Skill or instructions?** A journey is a series of tool calls the agent makes, in order, to finish one user goal. With one journey, write it into the agent's `instructions`. With two or more, make one skill per journey: its `description` says when to use it, and its tools go in `bundledTools`. Skills hold steps, not facts; rules the agent needs on every turn stay in `instructions`. Write a skill for what the agent got wrong without one, so test with `talk_to_agent` first.
- **MCP servers:** `create { component: "mcp_server", config: { name, url, authType: "none" | "oAuth2" | "customHeader", headers?, authConnectionReferenceId? } }`. `headers` are plain, non-secret headers. `oAuth2` and `customHeader` need `authConnectionReferenceId`, a Connection that holds the credentials (for customHeader also the header name); the user creates it in Cognigy, never invent one. Then `discover_tools` → `sync_tools { import: ["<name>"] }` → `attach` each imported tool by its referenceId. To remove a server, first `sync_tools { remove: [imported tool referenceIds] }`; the platform refuses to delete a server whose tools still exist.
- **Brand personas:** `create { component: "persona", config: { name, description, speakingStyle: { formality, completeness }, voiceConfig: { ttsVendor, ttsVoice, ttsModel, ttsLabel } } }`, then manage_agent `update { personaReferenceId }`. Every agent needs one, or the Cognigy UI can't save it: create sets it when you pass none (the result's `persona`), and a persona still in use can't be deleted. When create made the default "NiCE" (`persona.created: true`), offer to tailor it to the brand. The API requires real `voiceConfig` values (empty strings are rejected): copy them from an existing persona (`list` / `get` with component `persona`) or ask the user. Never invent them.
- `delete` is permanent and detaches the component from every agent (the result's `detachedFrom` lists the agents a deleted skill was taken off); tell the user before you delete one that agents use.

### Faster answers

Loading a skill adds an LLM call to that turn, and a loaded skill stays for the rest of the conversation. To make an agent faster:

- Keep a single journey in `instructions` rather than a skill.
- Put journeys that always run together in one skill, so a turn does not load several.
- Attach to the agent only the tools every journey needs; put each journey's other tools in its skill's `bundledTools`.
- Keep `instructions`, skill text and tool descriptions short, and detach tools and skills the agent no longer uses.
- A lower `llmConfig.reasoningEffort` answers faster.

### Knowledge

Create and fill a store first (knowledge-setup skill), then:
`manage_agent { operation: "update", agentId, projectId, knowledge: { ragType: "cognigy", ragMode: "agent", onSearchFailure: "answerAnyway", cognigyParameters: { stores: ["<store referenceId>"], topK: 5 } } }`.
`ragMode` "agent" lets the LLM decide when to search, "always" searches on every turn, "never" switches it off.

### Pre-turn hook

A pre-turn Flow runs before every answer and can rewrite the message or add context for that one turn.

1. `manage_agent { operation: "create_flow", projectId, flowType: "preTurn", name }` makes the Flow with its closing **Continue to AI Agent** node. Without that node the agent gives no answer.
2. Add the Flow's logic with manage_flow_nodes (flow-nodes skill): `mode: "append"` on the Start node (`startNodeId`) or on the node before, so Continue stays last. Set Continue's `turnContext` (label → value pairs the agent sees with the message) or `text` with manage_flow_nodes `update` on `closingNodeId`.
3. Set the hook: `manage_agent { operation: "update", agentId, projectId, hooks: { preTurn: [{ handler: { kind: "conversationFlow", flowReferenceId } }] } }`.

### A Flow as a tool (Execute Tool Flow)

Use it when a tool needs Flow logic (several API calls, Code nodes, branching). The agent calls the tool, the Flow runs, and its **Tool Result** answer is what the call returns.

1. `manage_agent { operation: "create_flow", projectId, flowType: "tool", name, answer? }` makes the Flow with its closing Tool Result node. The call's arguments arrive in the Flow as `input.data.toolArgs`; `answer` (CognigyScript) is what the agent gets back, by default the arguments as JSON.
2. Add the logic with manage_flow_nodes (`mode: "append"` on `startNodeId`, Tool Result stays last) and set the real answer with manage_flow_nodes `update { nodeId: closingNodeId, config: { answer } }`.
3. Add the tool: `manage_agent_components { operation: "create", component: "tool", projectId, agentId, config: { builtinSlug: "execute-tool-flow", name, description, parameters: { flowReferenceId, <argument>: { mode: "aiFilled", description } } } }`. Every parameter besides `flowReferenceId` is an argument: `aiFilled` ones the LLM fills, a plain value is fixed. The `description` tells the LLM when to call the tool.

A Flow that ends without Tool Result answers "The flow finished without returning an answer."; a failed one "The flow failed before returning an answer." Neither Flow kind can wait for the user (no Question nodes).

### Custom system prompt

Only when `check_capabilities` reports `customSystemPrompt: "available"` and the user wants to edit the prompt itself — role, description and instructions cover most needs.

1. manage_agent { operation: "get_system_prompt" } — the current or generated template and the tokens it may use.
2. Edit the template; keep the `[[agent.*]]` tokens the agent needs.
3. manage_agent { operation: "preview_system_prompt", template } — fix every warning.
4. Tell the user a custom prompt replaces the generated one, and get their OK.
5. manage_agent { operation: "save_system_prompt", template, acknowledgeRisk: true }. `reset_system_prompt` goes back to the generated prompt.
   — `onBuildFailure` decides what happens when the template cannot be built (too large, empty, or the script engine fails; a CognigyScript mistake only renders empty): `"defaultPrompt"` falls back to the generated prompt, `"noAnswer"` sends no reply.

### Deploy and remove

- Webchat: manage_webchat { projectId, agentId } (webchat-setup skill). Voice: manage_voice_gateway { projectId, agentId } (voice-gateway-setup skill).
- delete_resource { resourceType: "agent", id, projectId } renames the agent DELETE\_… and takes its endpoints offline; a person deletes it in the UI.

## Path B — legacy AI Agents (create_ai_agent)

Only when Path A does not apply (see "Which kind to build").

7. create_ai_agent { projectId, name, description, legacy: true } (leave out `legacy` where check_capabilities said aiAgents is unavailable)
   — Returns: agent, flow, endpoint, endpointUrl
   — The default LLM is automatically assigned to the agent's job node. If llmStatus is "configured", no extra step is needed.
   — `error: "use_manage_agent"` means nothing was created: this environment builds AI Agents — go to Path A unless the user asked for a legacy agent.
8. (Only if llmStatus is "unknown" after create) Do not test yet. First repeat steps 4-6 for the returned projectId, then assign LLM to agent if needed:
   update_ai_agent { aiAgentId, jobConfig: { llmProviderReferenceId: "<referenceId from step 4 or 5>" } }
9. Only after the project has a confirmed working LLM: talk_to_agent { endpointUrl, message }
10. Refine the agent using update_ai_agent — see "All configuration fields" below
11. Repeat 9-10 until satisfied

### Adding tools to a legacy agent (optional)

11. create_tool { aiAgentId, toolType, name, config }
    (See the tools-setup skill for tool types and config)
12. talk_to_agent — test with tool-triggering messages
13. Repeat 8-12 until satisfied

Important: before creating a new tool, inspect the existing agent flow/tools first and make sure you are not reusing an existing `toolId`. Tool IDs must be unique within an agent flow.

### All configuration fields (update_ai_agent)

update_ai_agent updates two layers: the **AI Agent resource** and the **AI Agent Job Node**.

#### Agent-level fields (the agent's identity)

| Field        | Purpose                                                                                                                                             | Example                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| name         | Agent display name                                                                                                                                  | "Acme Support Bot"                                                                                      |
| description  | **Agent persona** — defines who the agent is, its personality, tone, and high-level behavior. This is the primary field for shaping agent identity. | "You are a friendly customer support agent for Acme Corp. You speak in a professional yet warm tone..." |
| instructions | **Agent instructions** — high-level guidance and constraints (up to 1000 chars). Use for guardrails and policies that apply regardless of the job.  | "Never share internal pricing. Always verify customer identity before account changes."                 |

#### Job-level fields (jobConfig — how the agent performs its job)

| Field                  | Purpose                                                                                                               | Example                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| jobName                | **Job title** — the role the agent is performing                                                                      | "Customer Support Specialist"                                                                                          |
| jobDescription         | **Job description** — detailed description of responsibilities, scope, and expertise areas for this job               | "Handle customer inquiries about orders, returns, and product information. Escalate billing disputes to human agents." |
| jobInstructions        | **Job instructions** — specific behavioral rules, step-by-step procedures, and output format requirements for the job | "1. Greet the customer. 2. Ask for their order number. 3. Look up the order using the search tool..."                  |
| llmProviderReferenceId | Which LLM the agent uses (from setup_llm or list_resources { resourceType: "llm_model" })                             | "abc-123-def-456"                                                                                                      |
| temperature            | LLM temperature (0-1). Lower = more deterministic, higher = more creative. Default: 0.7                               | 0.3                                                                                                                    |
| maxTokens              | Max tokens for LLM response (100-8000). Default: 4000                                                                 | 2000                                                                                                                   |

#### Example: fully configured agent

```
update_ai_agent {
  aiAgentId: "...",
  name: "Acme Support Bot",
  description: "You are a friendly and professional customer support agent for Acme Corp. You help customers with orders, returns, and product questions. You maintain a warm but efficient tone.",
  instructions: "Never share internal pricing or competitor comparisons. Always verify identity before account changes.",
  jobConfig: {
    jobName: "Customer Support Specialist",
    jobDescription: "Handle customer inquiries about orders, returns, shipping, and product information. You have access to the order database and knowledge base.",
    jobInstructions: "1. Greet the customer warmly. 2. Identify their issue. 3. Use the search tool to look up relevant information. 4. Provide a clear answer. 5. Ask if there is anything else you can help with.",
    temperature: 0.3,
    maxTokens: 2000
  }
}
```

#### How the fields work together

- **description** (persona): "Who am I?" — The agent's identity, personality, and tone
- **instructions** (guardrails): "What must I always/never do?" — Global constraints and policies
- **jobName**: "What is my role?" — The job title
- **jobDescription**: "What is my scope?" — What the job covers, what tools are available, what to escalate
- **jobInstructions**: "How do I do my job?" — Step-by-step procedures, output formats, decision trees
- **temperature/maxTokens**: "How do I think?" — LLM generation parameters

Always use ALL relevant fields when configuring an agent. Do not put everything in `description` alone — distribute the configuration across the appropriate fields for best results.

## LLM Prompt node — explicit request ONLY

Use the **LLM Prompt** node only when the user asks for it by name, e.g. "create an agent using an LLM Prompt node." Otherwise, build agents as described above.

When (and only when) the user explicitly asked for it:

- New agent: `create_ai_agent { name, agentNodeType: "llmPrompt", systemPrompt: "..." }` — provisions project + flow + LLM Prompt node + REST endpoint. There is NO agent resource in this mode.
- `systemPrompt` is the full persona, job, and guardrail definition.
- Iterate with `manage_flow_nodes { operation: "update", flowId, nodeId, config: { prompt } }` — NOT update_ai_agent (there is no agent to update).
- Tools: `create_tool { flowId, ... }` (only tool/mcp/http types). Test with `talk_to_agent { endpointUrl }`.

## Key facts

- create_ai_agent (legacy) auto-provisions: flow, AI Agent Job Node, REST endpoint. manage_agent creates the agent and a REST endpoint; there is no flow to edit.
- If the target project was just auto-created and llmStatus is "unknown", immediately inspect other projects for reusable llm_model entries with connectionId before falling back to setup_llm.
- Cognigy connections are project-scoped. If you want to reuse LLMs from another project, import the required model set and their distinct connection resource(s) via manage_packages before testing the agent.
- For knowledge workflows, do not guess with the agent response model for Knowledge Search. Import the source project's exact Knowledge Search model into the target project before the first Knowledge AI settings attempt.
- create_tool (legacy agents) auto-provisions: flow nodes for tools. Do NOT create tool nodes manually. AI Agents get tools through manage_agent_components.
- Duplicate `toolId` values can cause empty or failed responses. Check the flow/tools before assuming the problem is the LLM or connection.
- **Knowledge on legacy agents**: Always attach knowledge stores as tools (via create_tool { toolType: "knowledge" } or knowledgeStoreReferenceId on create_ai_agent). Knowledge tools give the agent a dedicated search capability. Only attach to the persona (via update_ai_agent) if the user explicitly requests persona-level knowledge.
- **Changing an EXISTING agent**: the first such change in a session is HELD by the server and returns `error: "backup_not_offered"` without changing anything. Ask the user whether they want a backup, then call `manage_snapshots { operation: "create", projectId, label }` or `{ operation: "decline", projectId }`, then retry the held call — see the snapshot-backups skill. This applies to manage_agent and manage_agent_components changes too, but NOT to an agent you created in this same session, so the build flow above is unaffected.
- If LLM setup failed or could not be completed, do not call talk_to_agent at all — testing without a confirmed working LLM fails silently or returns empty responses. Skip the test and tell the user what is missing.
- Use same sessionId across talk_to_agent calls for multi-turn testing
- endpointUrl uses a different base URL (endpoint-\*.cognigy.ai), not the API URL
- talk_to_agent sends in Cognigy Endpoint Test Mode by default, so test messages are not counted as billable; the response reports `testMode` and the regular `endpointUrl`. It never falls back to a billable send on its own. If a send fails, read `_hints` and check whether the message was processed before re-sending it (see the troubleshooting skill). Cognigy documents a fair-use limit of 600 test messages per hour (scope unspecified).
