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

Configure the project-level settings used by Knowledge Search, Answer Extraction, and document parsing.

### Quick Start

```json
{
  "operation": "set_knowledge_ai",
  "projectId": "<24-char hex>",
  "knowledgeSearchModelId": "<llm referenceId>",
  "answerExtractionModelId": "<llm referenceId>",
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
| `answerExtractionModelId` | `llm_model` referenceId from the same project for Answer Extraction                             |
| `contentParser`           | One of `default`, `legacy`, or `azure`                                                          |
| `azureDIConnectionId`     | Azure AI Document Intelligence connection referenceId; required when `contentParser` is `azure` |

### Important Notes

- Knowledge AI model IDs must come from the SAME project. Use `list_resources { resourceType: "llm_model", projectId }` to find them.
- If another project has the Knowledge Search or Answer Extraction model you want, ask the user whether to reuse it before importing anything into the new project.
- Reusing those settings in a new project is not automatic. First import or create the required LLMs in the target project, then call `manage_settings { operation: "set_knowledge_ai", ... }`.

### Typical Knowledge Workflow

1. Ensure the target project has reusable LLMs for `knowledgeSearch` and `answerExtraction`
2. `manage_settings { operation: "set_knowledge_ai", projectId, knowledgeSearchModelId, answerExtractionModelId, contentParser }`
3. `manage_knowledge { operation: "create_store", projectId, name }`
4. `create_tool { toolType: "knowledge", ... }` or `create_ai_agent { knowledgeStoreReferenceId }`
