# Building a Cognigy AI Agent

## Prerequisites
- A project (use list_resources { resourceType: "project" } to find one)
- An LLM resource in the project (use setup_llm if none exists)

## Steps
1. list_resources { resourceType: "project" } — pick a projectId
2. list_resources { resourceType: "llm_model", projectId } — check if LLM exists
3. If no LLM: setup_llm { projectId, provider: "openAI", modelType: "gpt-4o", apiKey }
   - With isDefault: true (the default), agents auto-use this LLM — no extra step needed.
   - Save the `referenceId` from the response if you need to assign it explicitly later.
   (See cognigy://guide/llm-providers for valid provider/modelType values)
4. create_ai_agent { projectId, name, description }
   — Returns: agent, flow, endpoint, endpointUrl
   — The default LLM is automatically assigned to the agent's job node. If llmStatus is "configured", no extra step is needed.
5. (Only if llmStatus is "missing" after create) Assign LLM to agent:
   update_ai_agent { aiAgentId, jobConfig: { llmProviderReferenceId: "<referenceId from step 3>" } }
6. talk_to_agent { endpointUrl, message }
7. Refine the agent using update_ai_agent — see "All configuration fields" below
8. Repeat 6-7 until satisfied

## Adding tools (optional)
9. create_tool { aiAgentId, toolType, name, config }
   (See cognigy://guide/tools-setup for tool types and config)
10. talk_to_agent — test with tool-triggering messages
11. Repeat 6-10 until satisfied

## All configuration fields (update_ai_agent)

update_ai_agent updates two layers: the **AI Agent resource** and the **AI Agent Job Node**.

### Agent-level fields (the agent's identity)
| Field | Purpose | Example |
|-------|---------|---------|
| name | Agent display name | "Acme Support Bot" |
| description | **Agent persona** — defines who the agent is, its personality, tone, and high-level behavior. This is the primary field for shaping agent identity. | "You are a friendly customer support agent for Acme Corp. You speak in a professional yet warm tone..." |
| instructions | **Agent instructions** — high-level guidance and constraints (up to 1000 chars). Use for guardrails and policies that apply regardless of the job. | "Never share internal pricing. Always verify customer identity before account changes." |

### Job-level fields (jobConfig — how the agent performs its job)
| Field | Purpose | Example |
|-------|---------|---------|
| jobName | **Job title** — the role the agent is performing | "Customer Support Specialist" |
| jobDescription | **Job description** — detailed description of responsibilities, scope, and expertise areas for this job | "Handle customer inquiries about orders, returns, and product information. Escalate billing disputes to human agents." |
| jobInstructions | **Job instructions** — specific behavioral rules, step-by-step procedures, and output format requirements for the job | "1. Greet the customer. 2. Ask for their order number. 3. Look up the order using the search tool..." |
| llmProviderReferenceId | Which LLM the agent uses (from setup_llm or list_resources { resourceType: "llm_model" }) | "abc-123-def-456" |
| temperature | LLM temperature (0-1). Lower = more deterministic, higher = more creative. Default: 0.7 | 0.3 |
| maxTokens | Max tokens for LLM response (100-8000). Default: 4000 | 2000 |

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
- create_tool auto-provisions: flow nodes for tools. Do NOT create tool nodes manually.
- **Knowledge**: Always attach knowledge stores as tools (via create_tool { toolType: "knowledge" } or knowledgeStoreReferenceId on create_ai_agent). Knowledge tools give the agent a dedicated search capability. Only attach to the persona (via update_ai_agent) if the user explicitly requests persona-level knowledge.
- Use same sessionId across talk_to_agent calls for multi-turn testing
- endpointUrl uses a different base URL (endpoint-*.cognigy.ai), not the API URL
