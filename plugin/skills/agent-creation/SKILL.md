---
name: agent-creation
description: "Use when the user wants to build, create, or set up a new Cognigy AI Agent from scratch — covers listing projects, ensuring an LLM exists, creating the agent, testing it, and refining persona/job fields."
---

<!-- GENERATED from src/resources/agent-creation.md by scripts/generate-skills.mjs. Do not edit by hand — edit the guide and run `npm run generate:skills`. -->

> The full **Agent Creation Guide** is included below — you already have it. Do NOT call `read_guide` for `agent-creation`; just follow the content here.

# Building a Cognigy AI Agent

## Prerequisites

- A project (use list_resources { resourceType: "project" } to find one, or let create_ai_agent create one)
- A working LLM resource in the target project before testing the agent

## Steps

1. list_resources { resourceType: "project" } — inspect all projects
2. Choose the target project
   - If it already exists: use its projectId
   - If the user wants a new project: call create_ai_agent without projectId, keep the returned projectId, and if llmStatus is "unknown" continue with the LLM reuse steps below before testing the agent
3. Run list_resources { resourceType: "llm_model", projectId } — check whether the target project already has a reusable LLM with a non-empty connectionId
4. If the target project has no reusable LLM, check the other projects for reusable LLMs
   - Run list_resources { resourceType: "llm_model", projectId } for each other project
   - Choose only candidates whose llm_model has a non-empty connectionId
   - Do not treat an LLM without connectionId as a valid reuse candidate
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
     (See cognigy://guide/llm-providers for valid provider/modelType values)
7. create_ai_agent { projectId, name, description }
   — Returns: agent, flow, endpoint, endpointUrl
   — The default LLM is automatically assigned to the agent's job node. If llmStatus is "configured", no extra step is needed.
8. (Only if llmStatus is "unknown" after create) Do not test yet. First repeat steps 4-6 for the returned projectId, then assign LLM to agent if needed:
   update_ai_agent { aiAgentId, jobConfig: { llmProviderReferenceId: "<referenceId from step 4 or 5>" } }
9. Only after the project has a confirmed working LLM: talk_to_agent { endpointUrl, message }
10. Refine the agent using update_ai_agent — see "All configuration fields" below
11. Repeat 9-10 until satisfied

## Adding tools (optional)

11. create_tool { aiAgentId, toolType, name, config }
    (See cognigy://guide/tools-setup for tool types and config)
12. talk_to_agent — test with tool-triggering messages
13. Repeat 8-12 until satisfied

Important: before creating a new tool, inspect the existing agent flow/tools first and make sure you are not reusing an existing `toolId`. Tool IDs must be unique within an agent flow.

## All configuration fields (update_ai_agent)

update_ai_agent updates two layers: the **AI Agent resource** and the **AI Agent Job Node**.

### Agent-level fields (the agent's identity)

| Field        | Purpose                                                                                                                                             | Example                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| name         | Agent display name                                                                                                                                  | "Acme Support Bot"                                                                                      |
| description  | **Agent persona** — defines who the agent is, its personality, tone, and high-level behavior. This is the primary field for shaping agent identity. | "You are a friendly customer support agent for Acme Corp. You speak in a professional yet warm tone..." |
| instructions | **Agent instructions** — high-level guidance and constraints (up to 1000 chars). Use for guardrails and policies that apply regardless of the job.  | "Never share internal pricing. Always verify customer identity before account changes."                 |

### Job-level fields (jobConfig — how the agent performs its job)

| Field                  | Purpose                                                                                                               | Example                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| jobName                | **Job title** — the role the agent is performing                                                                      | "Customer Support Specialist"                                                                                          |
| jobDescription         | **Job description** — detailed description of responsibilities, scope, and expertise areas for this job               | "Handle customer inquiries about orders, returns, and product information. Escalate billing disputes to human agents." |
| jobInstructions        | **Job instructions** — specific behavioral rules, step-by-step procedures, and output format requirements for the job | "1. Greet the customer. 2. Ask for their order number. 3. Look up the order using the search tool..."                  |
| llmProviderReferenceId | Which LLM the agent uses (from setup_llm or list_resources { resourceType: "llm_model" })                             | "abc-123-def-456"                                                                                                      |
| temperature            | LLM temperature (0-1). Lower = more deterministic, higher = more creative. Default: 0.7                               | 0.3                                                                                                                    |
| maxTokens              | Max tokens for LLM response (100-8000). Default: 4000                                                                 | 2000                                                                                                                   |

### Example: fully configured agent

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

### How the fields work together

- **description** (persona): "Who am I?" — The agent's identity, personality, and tone
- **instructions** (guardrails): "What must I always/never do?" — Global constraints and policies
- **jobName**: "What is my role?" — The job title
- **jobDescription**: "What is my scope?" — What the job covers, what tools are available, what to escalate
- **jobInstructions**: "How do I do my job?" — Step-by-step procedures, output formats, decision trees
- **temperature/maxTokens**: "How do I think?" — LLM generation parameters

Always use ALL relevant fields when configuring an agent. Do not put everything in `description` alone — distribute the configuration across the appropriate fields for best results.

## Key facts

- create_ai_agent auto-provisions: flow, AI Agent Job Node, REST endpoint
- If the target project was just auto-created and llmStatus is "unknown", immediately inspect other projects for reusable llm_model entries with connectionId before falling back to setup_llm.
- Cognigy connections are project-scoped. If you want to reuse LLMs from another project, import the required model set and their distinct connection resource(s) via manage_packages before testing the agent.
- For knowledge workflows, do not guess with the agent response model for Knowledge Search. Import the source project's exact Knowledge Search model into the target project before the first Knowledge AI settings attempt.
- create_tool auto-provisions: flow nodes for tools. Do NOT create tool nodes manually.
- Duplicate `toolId` values can cause empty or failed responses. Check the flow/tools before assuming the problem is the LLM or connection.
- **Knowledge**: Always attach knowledge stores as tools (via create_tool { toolType: "knowledge" } or knowledgeStoreReferenceId on create_ai_agent). Knowledge tools give the agent a dedicated search capability. Only attach to the persona (via update_ai_agent) if the user explicitly requests persona-level knowledge.
- Use same sessionId across talk_to_agent calls for multi-turn testing
- endpointUrl uses a different base URL (endpoint-\*.cognigy.ai), not the API URL
