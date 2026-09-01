---
name: llm-providers
description: "Use when configuring or choosing an LLM for a Cognigy agent — valid provider names (openAI, anthropic, azureOpenAI, google, mistral, openAICompatible), model strings, connection types, credential resolution, and OpenAI-compatible endpoints (vLLM, Hugging Face, LiteLLM, Azure AI Foundry, self-hosted)."
---

# LLM Provider Reference

## setup_llm parameters

| provider    | modelType examples                                         | Connection type        | Notes                                                         |
| ----------- | ---------------------------------------------------------- | ---------------------- | ------------------------------------------------------------- |
| openAI      | gpt-4o, gpt-4o-mini, gpt-4.1, gpt-4.1-mini                 | OpenAIProvider         | Requires apiKey (sk-...)                                      |
| anthropic   | claude-sonnet-4-0, claude-opus-4-0, claude-3-opus-20240229 | AnthropicProvider      | Requires apiKey                                               |
| azureOpenAI | gpt-4o (deployment name)                                   | AzureOpenAIProviderV2  | Requires apiKey, may need connectionId with deployment config |
| google      | gemini-2.0-flash, gemini-1.5-pro                           | GoogleVertexAIProvider | Requires apiKey                                               |
| mistral     | mistral-small-2503, mistral-medium-latest                  | MistralProvider        | Requires apiKey                                               |
| openAICompatible | custom-model, custom-embedding-model                  | OpenAICompatibleProvider | Requires apiKey + baseCustomUrl + customModel (see below)   |

## Model groups

`setup_llm` can create different kinds of Cognigy LLM resources. The important distinction is the `modelType`:

- Chat models: used for AI Agents, Knowledge Search, and Answer Extraction.
  Examples: `gpt-4o`, `gpt-4o-mini`, `gpt-4.1`, `claude-sonnet-4-0`, `gemini-2.0-flash`, `mistral-small-2503`.
- Embedding models: used for knowledge-store vector indexing.
  Examples: `text-embedding-3-small`, `text-embedding-3-large`, `text-embedding-ada-002`, `luminous-embedding-128`, `amazon.titan-embed-text-v2:0`, `Pharia-1-Embedding-4608`, `gemini-embedding-001`, `custom-embedding-model`.

Chat/completion models are not embedding models. `gpt-4o-mini` is a chat model, not a valid embedding-model choice for knowledge-store indexing.

When using `list_resources { resourceType: "llm_model", projectId }`, inspect the returned `modelType` and select the model by its exact role. Do not infer that all LLMs are interchangeable.

## OpenAI-compatible providers (openAICompatible)

Use provider `openAICompatible` for ANY endpoint that speaks the OpenAI API but is not OpenAI itself: vLLM, Hugging Face, LiteLLM, Groq, Together AI, Azure AI Foundry (model router), or self-hosted deployments. Do NOT mislabel these as `openAI` — without a base URL the connection test hits api.openai.com and fails.

Required parameters:

- `modelType`: exactly `custom-model` (chat) or `custom-embedding-model` (embedding) — never the real model name
- `customModel`: the model name as known by the provider, e.g. `llama-3.3-70b-instruct`
- `baseCustomUrl`: the provider's OpenAI-compatible base URL, e.g. `https://my-llm-host.example.com/v1`
- `apiKey` (or a same-project `connectionId`)

Optional parameters:

- `customAuthHeader`: custom HTTP header name for authentication (e.g. `Ocp-Apim-Subscription-Key`). When set, the API key is sent in that header instead of `Authorization: Bearer <key>`.
- `apiType`: `chatCompletion` (default) or `responses` — only use `responses` if the provider supports OpenAI's Responses API.

Example:

```json
{
  "projectId": "<projectId>",
  "provider": "openAICompatible",
  "modelType": "custom-model",
  "customModel": "llama-3.3-70b-instruct",
  "baseCustomUrl": "https://my-llm-host.example.com/v1",
  "apiKey": "<key>"
}
```

Notes:

- The Completions API for custom LLMs is deprecated (removal planned for Cognigy.AI 2026.24.0) — use Chat Completions or Responses.
- When inspecting existing models via `list_resources` / `get_resource`, openAI-compatible models show `modelType: "custom-model"`; the real model name and endpoint are in the `openAICompatible` object (`customModel`, `baseCustomUrl`, `customAuthHeader`).

## Credential resolution

- Provide apiKey — a Connection is auto-created, then the LLM resource is linked to it
- Provide connectionId (UUID referenceId of an existing Connection in the SAME project) to skip connection creation
- At least one of apiKey or connectionId is required
- If the only working connection lives in another project, transfer the LLM + connection via manage_packages instead of passing that connectionId directly

## Connection validation

After creating the model, setup_llm automatically tests the connection by sending a minimal probe to the provider. This catches invalid API keys, wrong model types, and misconfigured providers before they can break downstream flows.

- **Test passes**: the response includes `connectionTest.isCredentialsValid: true` and the provider's confirmation message.
- **Test fails**: the model is automatically deleted to prevent broken references, and an error is returned with the provider's error message.
- **Test endpoint unreachable**: the model is kept but a warning is returned advising manual verification.

## Common errors

- "Invalid provider": use exact camelCase strings from the provider column (openAI, not openai)
- "Authentication failed": verify API key is valid for that provider
- "Model not found": check exact modelType spelling (e.g. gpt-4o, not gpt4o)

## Troubleshooting: dangerouslySkipConnectionTest

If the connection test cannot run in your environment (e.g., air-gapped setup, unsupported custom model provider), you can pass `dangerouslySkipConnectionTest: true` to skip validation. **This is a last resort** — it may leave a non-functional model reference that silently breaks agent conversations and knowledge stores. Always prefer fixing the root cause instead. Do not use this to work around a missing, invalid, or cross-project connection.
