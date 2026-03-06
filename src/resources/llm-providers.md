# LLM Provider Reference

## setup_llm parameters

| provider | modelType examples | Connection type | Notes |
|----------|-------------------|-----------------|-------|
| openAI | gpt-4o, gpt-4o-mini, gpt-4.1, gpt-4.1-mini | OpenAIProvider | Requires apiKey (sk-...) |
| anthropic | claude-sonnet-4-0, claude-opus-4-0, claude-3-opus-20240229 | AnthropicProvider | Requires apiKey |
| azureOpenAI | gpt-4o (deployment name) | AzureOpenAIProviderV2 | Requires apiKey, may need connectionId with deployment config |
| google | gemini-2.0-flash, gemini-1.5-pro | GoogleVertexAIProvider | Requires apiKey |
| mistral | mistral-small-2503, mistral-medium-latest | MistralProvider | Requires apiKey |

## Credential resolution
- Provide apiKey — a Connection is auto-created, then the LLM resource is linked to it
- Provide connectionId (UUID referenceId of an existing Connection) to skip connection creation
- At least one of apiKey or connectionId is required

## Common errors
- "Invalid provider": use exact camelCase strings from the provider column (openAI, not openai)
- "Authentication failed": verify API key is valid for that provider
- "Model not found": check exact modelType spelling (e.g. gpt-4o, not gpt4o)
