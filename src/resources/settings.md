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
