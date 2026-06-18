# Usage Guide

For installation and configuration, see the [README](../README.md).

## Workflow 1: Create an AI Agent from scratch

```
1. Create an AI Agent called "Support Bot" in project <projectId>.
   Set up GPT-4 as the LLM and give it a customer support persona.
```

This triggers the following tool calls automatically:

1. `setup_llm` — creates an LLM resource (e.g. GPT-4) in the project and validates the connection
2. `create_ai_agent` — provisions the agent, flow, AI Agent Job Node, and REST endpoint

The response includes `endpointUrl` — use this for testing with `talk_to_agent`.
On success, the `setup_llm` response may include `connectionTest` details (for example, whether credentials were validated or the test was skipped with a warning). If the connection test fails due to invalid credentials, `setup_llm` instead returns an error payload and the model is cleaned up, rather than a successful response with `connectionTest.isCredentialsValid: false`.

## Workflow 2: Self-improvement loop

```
Talk to my Support Bot at <endpointUrl> and ask "How do I reset my password?".
Evaluate the response, then update the job description to improve it.
Talk to it again and compare.
```

Tool sequence:

1. `talk_to_agent` — sends message, returns `agentResponse`
2. `update_ai_agent` — updates `jobDescription`, `jobInstructions`, or `description`
3. `talk_to_agent` — re-tests with the same question

Repeat until the agent behaves as expected.

## Workflow 3: Add a knowledge store for RAG

```
Create a knowledge store in project <projectId>, ingest https://docs.example.com/faq,
then attach it to my Support Bot.
```

Tool sequence:

1. `setup_llm` — creates an embedding model (e.g. `text-embedding-ada-002`) if not already present
2. `manage_knowledge` with `operation: create_store` — creates the knowledge store
3. `manage_knowledge` with `operation: create_source` and `type: url` — ingests the URL
4. `create_tool` with `toolType: knowledge` — attaches the store to the agent's job node

## Workflow 4: Add a custom HTTP tool to an agent

```
Add an HTTP tool to my Support Bot that calls https://api.example.com/orders
so it can look up order status.
```

Tool sequence:

1. `create_tool` with `toolType: http`, providing `url`, `method`, and optional `headers`/`body`
2. `talk_to_agent` — test that the agent can invoke the tool

## Workflow 5: List and inspect resources

```
List all AI Agents in project <projectId>.
Show me the details of agent <aiAgentId>.
```

Tool sequence:

1. `list_resources` with `resourceType: agent` and `projectId`
2. `get_resource` with `resourceType: agent` and `id`

Supported `resourceType` values: `agent`, `flow`, `endpoint`, `llm_model`, `knowledge_store`, `tool`, `project`, `conversation`.

## Workflow 6: Delete a resource

```
Delete the knowledge store <knowledgeStoreId>.
```

Tool: `delete_resource` with `resourceType: knowledge_store` and `id`.

## Tips

### Use the same `sessionId` for multi-turn conversations

Pass the same `sessionId` across `talk_to_agent` calls to maintain conversation context:

```
Talk to my agent at <endpointUrl> with sessionId "test-session-1".
Then follow up with "What did I just ask?".
```

### Verbose mode for debugging

Add `verbose: true` to `talk_to_agent` to get the full raw API response alongside `agentResponse`.

### ID formats

Cognigy uses two ID formats — see [ARCHITECTURE.md](ARCHITECTURE.md#id-formats) for details.

## Troubleshooting

**"Rate limit exceeded"** — wait for the window to reset, or increase `RATE_LIMIT_MAX_REQUESTS` in your env config.

**Agent returns no response / empty output** — check that an LLM resource exists in the project (`list_resources` with `resourceType: llm_model`). The agent cannot generate responses without one.

**`setup_llm` fails connection test** — the model was created but the provider rejected the credentials. The model is automatically deleted. Check your API key, model type spelling, and provider name, then retry.

**`setup_llm` returns warning about skipped test** — the test endpoint was unreachable (network issue, timeout). The model was kept but may not work. Verify manually or delete and recreate.

**Knowledge search returns no results** — verify ingestion completed by calling `manage_knowledge` with `operation: list_chunks` and the `knowledgeStoreId`.

**Connection errors** — confirm `COGNIGY_API_BASE_URL` is reachable and `COGNIGY_API_KEY` is valid.

## Getting help

- [GitHub Issues](https://github.com/Cognigy/cognigy-plugin/issues)
- Cognigy support: support@cognigy.com
- [API Reference](API_REFERENCE.md)
