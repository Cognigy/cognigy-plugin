---
name: knowledge-setup
description: "Use when the user wants to add knowledge, RAG, or a knowledge store/source to a Cognigy agent — covers embedding vs Knowledge Search models, Knowledge AI settings, ingesting sources, and attaching knowledge as a tool."
---

<!-- GENERATED from src/resources/knowledge-setup.md by scripts/generate-skills.mjs. Do not edit by hand — edit the guide and run `npm run generate:skills`. -->

> The full **Knowledge Setup Guide** is included below — you already have it. Do NOT call `read_guide` for `knowledge-setup`; just follow the content here.

# Adding Knowledge to an Agent

## Prerequisites

- An **embedding model** must be configured in the project before creating knowledge stores.
  Use `setup_llm` to create one first if the target project does not already have one (e.g., `setup_llm { projectId, provider: "openAI", modelType: "<embedding model type>", apiKey }`).
  To check: `list_resources { resourceType: "llm_model", projectId }` and inspect `modelType`.
  Use provider docs or an existing same-project model to identify the correct embedding-capable model type for the store index.
- Configure the project's **Knowledge AI Settings** before creating the store in normal AI-agent knowledge flows.
  Use `manage_settings { operation: "set_knowledge_ai", projectId, knowledgeSearchModelId: "<llm referenceId>" }`.
  If you use the Azure content parser, also set `contentParser: "azure"` and `azureDIConnectionId`.

## Important Distinction

- The embedding model is for the knowledge store index itself.
- `knowledgeSearchModelId` is a separate project setting for Knowledge Search and must reference an `llm_model` from the same project.
- For normal AI-agent knowledge-store setups, `answerExtractionModelId` is usually not needed.
- The model you pick for the AI Agent itself is a separate decision. The agent response model should not be reused for `knowledgeSearchModelId` just because it is already available.
- The accepted model type for `knowledgeSearchModelId` is instance-dependent. Start with existing same-project candidates and rely on the API response.
- Model names shown in examples are not a whitelist for either role.

## Steps

1. list_resources { resourceType: "llm_model", projectId }
   - For Knowledge Search, prefer `list_resources { resourceType: "llm_model", projectId, useCase: "knowledgeSearch" }` so the candidates match the Settings UI dropdown
   - Refresh this after any package import
   - Start with the source project's exact Knowledge Search model when reusing an existing setup
   - Import the full required source-project model set before the first `manage_settings { operation: "set_knowledge_ai", ... }` attempt
   - If multiple required models share one connection, import that connection once alongside all of those models
2. manage_settings { operation: "set_knowledge_ai", projectId, knowledgeSearchModelId, contentParser }
   - Do this before `manage_knowledge { operation: "create_store", ... }` in normal AI-agent knowledge flows
3. manage_knowledge { operation: "create_store", projectId, name }
4. manage_knowledge { operation: "create_source", knowledgeStoreId, type, ... }
   - type: "url" — scrape a web page. Provide `url`.
   - type: "manual" — store text directly. Provide `text`.
   - type: "file" — upload a local document. Provide `filePath` (absolute path, e.g. "/Users/me/docs/report.pdf").
   - IMPORTANT: URL and file ingestion is async. Content is NOT searchable immediately.
   - Wait 10-60 seconds before searching.
5. manage_knowledge { operation: "list_chunks", knowledgeStoreId }
   - Verify content was ingested correctly
   - If no results right after create_source, wait and retry
6. Attach to agent as a TOOL (default approach):
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
- Cache `list_resources { resourceType: "llm_model", projectId }` results while you are working in the same project. Only refresh after imports, `setup_llm`, or other changes.
- The use-case-filtered `llm_model` list is a better source of truth for `knowledgeSearchModelId` than the unfiltered project-wide list.
- Treat `manage_settings` validation as authoritative for which project model works for Knowledge Search on that instance.
- If all same-project candidates fail for `knowledgeSearchModelId`, stop and report the exact rejected model IDs and messages.
- If the source project's exact Knowledge Search model is not yet in the target project, import it before trying a different model.
- Do not infer that an untried candidate is rejected or unsupported. Only report actual API results.
- If the user is creating a new project and another project already has a working knowledge setup, reproduce that exact Knowledge Search model and Content Parser choice before inventing a new combination.
- DEFAULT: Knowledge stores are attached as tools — this gives the agent a dedicated search capability it can invoke during conversations. Use create_tool { toolType: "knowledge" } or knowledgeStoreReferenceId on create_ai_agent.
- EXCEPTION: Only attach knowledge to the agent persona (via update_ai_agent) if the user explicitly requests persona-level knowledge attachment.

## Workflow Policy (source of truth for model selection & reporting)

This section is the authoritative policy for knowledge workflows. Follow it over any hardcoded assumption.

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
- For knowledge workflows, import the full required source-project model set up front before the first Knowledge AI settings attempt: the embedding model, the exact source-project Knowledge Search model, and any other required LLMs for the workflow. If the agent also needs a separate response model, transfer that as part of the same plan.
- When multiple required LLMs share the same source-project connection, export/import all of those llm_model resources together with that single connection resource in one package. Do NOT re-import the same shared connection in a later package just to bring over another model.
- If the exact source-project Knowledge Search model is not yet present in the target project, stop and import it before retrying set_knowledge_ai. Do NOT fall back to an arbitrary generic model first.
- If the useCase-filtered knowledgeSearch list contains only one real candidate, do NOT speculate outside that list before trying it and reporting the result.
- When reporting blockers or partial completion, distinguish observed tool errors from inference. Do not claim a setting or model is broken unless a tool call actually returned that failure.
- Do not describe a knowledgeSearchModelId rejection as a platform-side bug just because a similar model worked in another project. Report the exact target-project attempts and failures only.
- Do not say an untried model is "likely" rejected or unsupported. Only report actual API validation results for models you tried.
