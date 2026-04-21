# Adding Knowledge to an Agent

## Prerequisites

- An **embedding model** must be configured in the project before creating knowledge stores.
  Use setup_llm to create one first (e.g., `setup_llm { projectId, provider: "openAI", modelType: "text-embedding-ada-002", apiKey }`).
  To check: `list_resources { resourceType: "llm_model", projectId }` — look for an embedding model.
- The project's **Knowledge AI Settings** should be configured before relying on Knowledge Search or Answer Extraction.
  Use `manage_settings { operation: "set_knowledge_ai", projectId, knowledgeSearchModelId: "<llm referenceId>" }` for Knowledge Search, and add `answerExtractionModelId` if your flow uses Answer Extraction.
  If you use the Azure content parser, also set `contentParser: "azure"` and `azureDIConnectionId`.

## Steps

1. manage_knowledge { operation: "create_store", projectId, name }
2. manage_knowledge { operation: "create_source", knowledgeStoreId, type, ... }
   - type: "url" — scrape a web page. Provide `url`.
   - type: "manual" — store text directly. Provide `text`.
   - type: "file" — upload a local document. Provide `filePath` (absolute path, e.g. "/Users/me/docs/report.pdf").
   - IMPORTANT: URL and file ingestion is async. Content is NOT searchable immediately.
   - Wait 10-60 seconds before searching.
3. manage_knowledge { operation: "list_chunks", knowledgeStoreId }
   - Verify content was ingested correctly
   - If no results right after create_source, wait and retry
4. Attach to agent as a TOOL (default approach):
   - **During agent creation** — create_ai_agent { projectId, name, knowledgeStoreReferenceId: storeReferenceId }
     This automatically creates a knowledge search tool on the agent's Job Node.
   - **After agent creation** — create_tool { aiAgentId, toolType: "knowledge", name: "Search KB", config: { knowledgeStoreId: storeReferenceId, toolId: "search_kb", description: "Search the knowledge base" } }
     This creates a dedicated search tool the agent can invoke to query the knowledge store.
   - IMPORTANT: Always use the tool-based approach unless the user explicitly asks to attach knowledge to the agent persona.

## File Upload Notes

- Supported formats: PDF, TXT, DOCX, CTXT, PPTX
- Maximum file size: 10MB
- Provide `filePath` with an absolute path — the server reads the file directly from disk
- Tilde paths (`~/Documents/file.pdf`) are expanded automatically
- The file extension determines how the content is processed

## Tips

- Search chunks to verify content before attaching to agent
- For URLs, ensure the page is publicly accessible
- Text sources are best for structured FAQ content
- File sources are best for existing documents (PDFs, Word docs, etc.)
- If the user is creating a new project and wants knowledge features, ask whether they want to reuse their Knowledge Search / Answer Extraction settings from another project before importing any LLMs.
- DEFAULT: Knowledge stores are attached as tools — this gives the agent a dedicated search capability it can invoke during conversations. Use create_tool { toolType: "knowledge" } or knowledgeStoreReferenceId on create_ai_agent.
- EXCEPTION: Only attach knowledge to the agent persona (via update_ai_agent) if the user explicitly requests persona-level knowledge attachment.
