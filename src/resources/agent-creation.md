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
5. (Only if LLM is not set as default) Assign LLM to agent:
   update_ai_agent { aiAgentId, jobConfig: { llmProviderReferenceId: "<referenceId from step 3>" } }
6. talk_to_agent { endpointUrl, message }
7. Refine the agent — update_ai_agent supports both agent-level and job-level fields:
   - Agent persona: update_ai_agent { aiAgentId, description: "..." }
   - Job instructions: update_ai_agent { aiAgentId, jobConfig: { jobInstructions: "..." } }
   - LLM parameters: update_ai_agent { aiAgentId, jobConfig: { temperature: 0.5, maxTokens: 2000 } }
8. Repeat 6-7 until satisfied

## Adding tools (optional)
9. create_tool { aiAgentId, toolType, name, config }
   (See cognigy://guide/tools-setup for tool types and config)
10. talk_to_agent — test with tool-triggering messages
11. Repeat 6-10 until satisfied

## Key facts
- create_ai_agent auto-provisions: flow, AI Agent Job Node, REST endpoint
- create_tool auto-provisions: flow nodes for tools. Do NOT create tool nodes manually.
- update_ai_agent updates two things: the AI Agent resource (name, description, instructions, knowledge) and the Job Node config (LLM, job instructions, temperature, maxTokens)
- The agent `description` field defines the agent's persona and high-level behavior
- The `jobConfig.jobInstructions` field provides specific behavioral rules for the job
- The `jobConfig.llmProviderReferenceId` field controls which LLM the agent uses
- Use same sessionId across talk_to_agent calls for multi-turn testing
- endpointUrl uses a different base URL (endpoint-*.cognigy.ai), not the API URL
