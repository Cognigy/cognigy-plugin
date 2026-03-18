# Architecture

## Source Layout

- `src/index.ts` — Main server initialization and MCP protocol handling
- `src/tools/` — Tool handlers for each workflow category
- `src/api/` — API client and request handlers
- `src/schemas/` — Zod schemas for input validation
- `src/utils/` — Utilities (logging, rate limiting, etc.)
- `src/resources/` — MCP resources (documentation, examples)

## Why 11 Tools Instead of 359?

The Cognigy API has ~359 endpoints across 50+ categories. Creating one tool per endpoint would overwhelm AI agents and make the system unusable. Our solution:

**Workflow-Based Grouping**: Group related endpoints into high-level workflows that represent what users actually want to accomplish:

- Natural for AI agents to understand
- Matches human mental models
- Easy to discover and use
- Maintainable and extensible

**Example**: Rather than separate tools for every CRUD operation on every resource type, `list_resources` and `get_resource` cover all read operations via a `resourceType` parameter, while `delete_resource` handles all deletions.

**Result**: 11 tools covering ~115 API endpoints (97% reduction from 359 endpoints).

### Tool inventory

| Tool | Operation type |
|---|---|
| `create_ai_agent` | Write |
| `update_ai_agent` | Write |
| `setup_llm` | Write |
| `talk_to_agent` | Write |
| `manage_knowledge` | Write |
| `create_tool` | Write |
| `update_tool` | Write |
| `manage_webchat` | Write |
| `list_resources` | Read |
| `get_resource` | Read |
| `delete_resource` | Write |

## Modern AI Agent-Centric Approach

The MCP server focuses on **LLM-based AI Agents** (the modern approach) rather than traditional NLU/intents (legacy).

**What happens when you create an AI Agent:**

1. AI Agent resource created
2. Flow created automatically
3. AI Agent Job Node added to flow (connected to agent)
4. REST Endpoint created (ready to use!)
5. Endpoint URL returned

Then use `talk_to_agent` to test responses and iterate.

**Note**: You need an LLM resource (GPT-4, Claude, etc.) configured in the project via Cognigy UI for the agent to work.

## Self-Improvement Loop

The `talk_to_agent` tool enables a powerful iterative improvement workflow:

```
1. Create/Update AI Agent (job description)
        ↓
2. Talk to Agent (via REST endpoint)
   "How do I reset my password?"
        ↓
3. Evaluate Response
   - Is it helpful?
   - Is the tone right?
   - Does it follow guidelines?
        ↓
4. Improve Job Description
   - Add specific instructions
   - Fix issues found
   - Add edge case handling
        ↓
5. Talk to Agent Again (same question)
   Compare responses → Better? → Iterate
```

Human in the loop: you provide feedback, suggest improvements, and approve changes.

## ID Formats

Cognigy uses two ID formats:

- **MongoDB `_id`** (24-char hex): `691b1c2e36bda2b14170fd73` — used for most operations
- **UUID `referenceId`** (36-char): `8184e6a8-e10c-4b03-8a83-538c004c321a` — used for `flowId` in endpoints

When creating resources, both IDs are returned. The tools handle this automatically.
