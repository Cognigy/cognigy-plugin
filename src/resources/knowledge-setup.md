# Adding Knowledge to an Agent

## Prerequisites
- An **embedding model** must be configured in the project before creating knowledge stores.
  Use setup_llm to create one first (e.g., `setup_llm { projectId, provider: "openAI", modelType: "text-embedding-ada-002", apiKey }`).
  To check: `list_resources { resourceType: "llm_model", projectId }` — look for an embedding model.

## Steps
1. manage_knowledge { operation: "create_store", projectId, name }
2. manage_knowledge { operation: "create_source", knowledgeStoreId, type, content }
   - type: "url" (web page), "text" (inline), "file" (file path)
   - IMPORTANT: Ingestion is async. Content is NOT searchable immediately.
   - Wait 10-60 seconds before searching.
3. manage_knowledge { operation: "search_chunks", knowledgeStoreId, query }
   - Verify content was ingested correctly
   - If no results right after create_source, wait and retry
4. Attach to agent:
   - create_ai_agent { projectId, name, knowledgeReferenceId: storeId }
   - Or: update_ai_agent to add knowledge reference to existing agent

## Tips
- Search chunks to verify content before attaching to agent
- For URLs, ensure the page is publicly accessible
- Text sources are best for structured FAQ content
