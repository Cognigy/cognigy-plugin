---
name: settings
description: "Use when configuring project-level Cognigy settings — voice preview / speech provider configuration and Knowledge AI settings."
---

<!-- GENERATED from src/resources/settings.md by scripts/generate-skills.mjs. Do not edit by hand — edit the guide and run `npm run generate:skills`. -->

> The full **Settings Guide** is included below — you already have it. Do NOT call `read_guide` for `settings`; just follow the content here.

# Settings Guide

Manage project-level settings in Cognigy via the `manage_settings` tool.

## Voice Preview Settings

Configure a speech provider so voice endpoints (WebRTC) can synthesize and recognize speech.

### Quick Start

```json
{
  "operation": "set_voice_preview",
  "projectId": "<24-char hex>",
  "provider": "microsoft"
}
```

This auto-detects an existing speech connection for the provider. If none is found, you'll get instructions to upload a package containing one.

### With explicit connection

```json
{
  "operation": "set_voice_preview",
  "projectId": "<24-char hex>",
  "provider": "microsoft",
  "connectionId": "<connection referenceId>"
}
```

### Supported Providers

| Provider     | Connection Type          |
| ------------ | ------------------------ |
| `microsoft`  | MicrosoftSpeechProvider  |
| `google`     | GoogleSpeechProvider     |
| `aws`        | AWSSpeechProvider        |
| `deepgram`   | DeepgramSpeechProvider   |
| `elevenlabs` | ElevenLabsSpeechProvider |

### No speech connection found?

Speech connections are typically installed via Cognigy packages. To add one:

1. `manage_packages { operation: "upload_and_inspect", projectId, filePath: "<path to package.zip>" }`
2. `manage_packages { operation: "import", projectId, packageId }`
3. Retry `manage_settings { operation: "set_voice_preview", projectId, provider }`

### Typical Full Workflow

1. `create_ai_agent` → get projectId
2. `setup_llm` → configure LLM
3. `manage_settings { operation: "set_voice_preview", projectId, provider: "microsoft" }` → configure speech
4. `manage_voice_gateway { projectId, flowId }` → create voice endpoint with WebRTC

## Knowledge AI Settings

Configure the project-level settings used by Knowledge Search and document parsing.

This is separate from the embedding model used by `manage_knowledge` to build the knowledge-store index. Do not confuse these settings:

- Embedding model: required for the knowledge store itself
- Knowledge Search model: configured here via `knowledgeSearchModelId`
- `answerExtractionModelId` is also supported by the tool, but it is usually not needed for normal AI-agent knowledge-store setups.
- `knowledgeSearchModelId` must reference an `llm_model` from the same project
- The accepted model type for `knowledgeSearchModelId` is instance-dependent

### Quick Start

```json
{
  "operation": "set_knowledge_ai",
  "projectId": "<24-char hex>",
  "knowledgeSearchModelId": "<llm referenceId>",
  "contentParser": "default"
}
```

If you provide `knowledgeSearchModelId` or `answerExtractionModelId`, the tool automatically enables generative AI settings for the project.

### With Azure Content Parser

```json
{
  "operation": "set_knowledge_ai",
  "projectId": "<24-char hex>",
  "contentParser": "azure",
  "azureDIConnectionId": "<connection referenceId>"
}
```

### Fields

| Field                     | Meaning                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| `knowledgeSearchModelId`  | `llm_model` referenceId from the same project for Knowledge Search                              |
| `answerExtractionModelId` | Optional `llm_model` referenceId from the same project for Answer Extraction                    |
| `contentParser`           | One of `default`, `legacy`, or `azure`                                                          |
| `azureDIConnectionId`     | Azure AI Document Intelligence connection referenceId; required when `contentParser` is `azure` |

### Important Notes

- Knowledge AI model IDs must come from the SAME project. Use `list_resources { resourceType: "llm_model", projectId }` to find them.
- For Knowledge Search, prefer `list_resources { resourceType: "llm_model", projectId, useCase: "knowledgeSearch" }` so the candidate set matches the Settings UI dropdown.
- `knowledgeSearchModelId` is not the embedding-model field used by `manage_knowledge`
- Keep the AI Agent model and `knowledgeSearchModelId` separate. The response model you want for the agent is not a reason to test that same model for Knowledge Search.
- Treat model names in guides as examples only. The use-case-filtered LLM list and API validation are the source of truth.
- In normal AI-agent knowledge flows, set these settings before `manage_knowledge { operation: "create_store", ... }`
- If reusing another project's setup, import the exact source-project Knowledge Search model into the target project before the first `set_knowledge_ai` attempt
- If multiple required imported models share one connection, transfer that connection once together with all of those models instead of importing it again later
- If the exact source-project Knowledge Search model is still missing from the target project, stop and import it before trying a different model here

### Typical Knowledge Workflow

1. Ensure the target project has an embedding model for the knowledge store, and if reusing another project, bring over the exact source-project Knowledge Search model before guessing with another candidate
2. `manage_settings { operation: "set_knowledge_ai", projectId, knowledgeSearchModelId, contentParser }`
3. `manage_knowledge { operation: "create_store", projectId, name }`
4. `create_tool { toolType: "knowledge", ... }` or `create_ai_agent { knowledgeStoreReferenceId }`
