# NiCE Cognigy MCP

A Model Context Protocol (MCP) server that connects your AI assistant to the [Cognigy.AI](https://www.cognigy.com) REST API. Create, test, and improve LLM-based AI Agents through a self-improvement loop — without leaving your AI assistant.

## Features

- **17 workflow tools** for agent creation, deployment, packaging, voice setup, and guide access
- **One-call agent setup**: creates Agent + Flow + AI Agent Job Node + REST Endpoint automatically
- **Self-improvement loop**: talk to your agent, evaluate responses, update the job description, repeat
- **Knowledge store support**: attach RAG knowledge stores to agents as tools
- **Browser voice deployment**: create Voice Gateway endpoints with WebRTC demo URLs
- **Voice preview setup**: configure supported speech providers for voice experiences
- **Built-in guides**: workflow guides are exposed both as MCP resources and through the `read_guide` tool
- Built-in rate limiting, Zod input validation, and RFC 7807 error responses

## Tools

| Tool                   | Type  | Description                                                                                         |
| ---------------------- | ----- | --------------------------------------------------------------------------------------------------- |
| `create_ai_agent`      | Write | Create a complete AI Agent with auto-provisioned flow, job node, and REST endpoint                  |
| `update_ai_agent`      | Write | Update persona, guardrails, job config (role, procedures, LLM, temperature)                         |
| `setup_llm`            | Write | Create an LLM resource (GPT-4, Claude, Mistral, etc.) with automatic connection validation          |
| `talk_to_agent`        | Write | Send a message to an AI Agent and get its response                                                  |
| `list_resources`       | Read  | List projects, agents, flows, endpoints, LLMs, knowledge stores, and more                           |
| `get_resource`         | Read  | Get detailed information about a single resource                                                    |
| `delete_resource`      | Write | Permanently delete a resource                                                                       |
| `manage_knowledge`     | Write | Create knowledge stores, add sources (URL, text, file), list chunks for RAG                         |
| `create_tool`          | Write | Add a tool (HTTP, knowledge, email, MCP) to an agent's job node                                     |
| `update_tool`          | Write | Update an existing tool node's configuration                                                        |
| `manage_webchat`       | Write | Create or configure a Webchat v3 endpoint for website deployment                                    |
| `manage_flow_nodes`    | Write | Create, update, delete, or list flow nodes for conversation logic                                   |
| `manage_packages`      | Write | List exportable resources, upload, inspect, import, export, and download Cognigy package zip files  |
| `manage_voice_gateway` | Write | Create or configure a Voice Gateway endpoint with WebRTC for browser-based voice interaction        |
| `manage_settings`      | Write | Manage project-level settings including voice preview and Knowledge AI configuration                |
| `read_guide`           | Read  | Load the full markdown content of a built-in Cognigy workflow guide                                 |
| `audit_voice_agent`    | Write | Audit a voice agent against the Go-Live Checklist; reports by default, applies safe fixes on demand |

The server also includes built-in guides for detailed workflows, field references, and troubleshooting. They are exposed as MCP resources and through `read_guide`, which is the reliable cross-client path when an assistant needs the full content of a guide.

## Installation

### Claude Desktop (one-click)

Download the `.mcpb` file from the [latest release](https://github.com/Cognigy/cognigy-mcp/releases/latest) and double-click it. Claude Desktop opens an install dialog — enter your API URL and API key. No Node.js required.

### One-command setup (all MCP clients)

Requires [Node.js 20+](https://nodejs.org).

| MCP Client        | Command                                             |
| ----------------- | --------------------------------------------------- |
| Claude Desktop    | `npx @cognigy/mcp-server init --client claude`      |
| Claude Code       | `npx @cognigy/mcp-server init --client claude-code` |
| Codex             | `npx @cognigy/mcp-server init --client codex`       |
| Cursor            | `npx @cognigy/mcp-server init --client cursor`      |
| VS Code (Copilot) | `npx @cognigy/mcp-server init --client vscode`      |

The command prompts for your Cognigy API URL and API key, then configures your client automatically. Restart the client after setup.

### Manual config

Add to your MCP client's config file.

For Claude Desktop, Claude Code, and Cursor:

```json
{
  "mcpServers": {
    "cognigy": {
      "command": "npx",
      "args": ["-y", "@cognigy/mcp-server"],
      "env": {
        "COGNIGY_API_BASE_URL": "your-api-endpoint",
        "COGNIGY_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

For Codex, add this to `~/.codex/config.toml`:

```toml
[mcp_servers.cognigy]
command = "npx"
args = ["-y", "@cognigy/mcp-server"]

[mcp_servers.cognigy.env]
COGNIGY_API_BASE_URL = "your-api-endpoint"
COGNIGY_API_KEY = "your-api-key-here"
```

For VS Code (Copilot), add this to `.vscode/mcp.json`:

```json
{
  "servers": {
    "cognigy": {
      "command": "npx",
      "args": ["-y", "@cognigy/mcp-server"],
      "env": {
        "COGNIGY_API_BASE_URL": "your-api-endpoint",
        "COGNIGY_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

Get your API key: Cognigy.AI → User Menu → My Profile → API Keys → Create New.

---

## What It Does

Create a complete AI Agent in one tool call, then iterate and improve through conversation:

1. **Create** → AI Agent + Flow + Job Node + Endpoint (automatic)
2. **Test** → Talk to your agent via REST endpoint
3. **Improve** → Update persona, guardrails, job description, tools
4. **Test Again** → Compare responses and iterate
5. **Deploy** → Publish to Webchat or create a Voice Gateway endpoint with one call

## Configuration

All configuration is passed via `env` in the MCP config. No `.env` file needed.

| Variable                  | Required | Default | Description                      |
| ------------------------- | -------- | ------- | -------------------------------- |
| `COGNIGY_API_BASE_URL`    | Yes      | —       | Your Cognigy API base URL        |
| `COGNIGY_API_KEY`         | Yes      | —       | Your Cognigy API key             |
| `LOG_LEVEL`               | No       | `info`  | `debug`, `info`, `warn`, `error` |
| `RATE_LIMIT_MAX_REQUESTS` | No       | `100`   | Max requests per window          |
| `RATE_LIMIT_WINDOW_MS`    | No       | `60000` | Rate limit window in ms          |

## Usage Examples

### 1. Create a customer support agent

```
Create a Cognigy AI Agent called "Support Bot" in project <projectId> with a helpful
customer support persona. If the project has no working LLM, first look for another
project with an llm_model that has a connectionId, import that LLM and its connection
via manage_packages, and only fall back to setup_llm if no reusable LLM exists.
Return the endpoint URL only after the project has a confirmed working LLM.
```

The MCP server should first check whether the target project already has a working LLM. If not, it should prefer reusing the required LLM resource set plus its connection resources from another project via `manage_packages`, and only use `setup_llm` as the last resort before calling `create_ai_agent`.

### 2. Test and improve the agent

```
Talk to my Support Bot at <endpointUrl> and ask "How do I reset my password?".
Then update the job description to make the response more concise and actionable.
Talk to it again and compare the responses.
```

This triggers the self-improvement loop: `talk_to_agent` → evaluate → `update_ai_agent` → `talk_to_agent` again.

### 3. Add a knowledge store for RAG

```
Create a knowledge store in project <projectId>, add the URL
https://docs.example.com/faq as a source, then attach it to my Support Bot
so the agent can search it when answering questions.
```

The server will call `manage_knowledge` to create the store and ingest the URL,
then `create_tool` to attach it as a knowledge search tool on the agent's job
node.

If the project will use Knowledge Search, the server should first configure
Knowledge AI Settings with `manage_settings { operation: 'set_knowledge_ai',
... }` using model IDs from the same project.

For normal AI-agent knowledge flows, this should happen before
`manage_knowledge { operation: 'create_store', ... }`.

The model roles are different:

- The knowledge store itself needs an embedding-capable model for the index.
- `knowledgeSearchModelId` is a separate Knowledge AI setting for search
  behavior, but the accepted model type is instance-dependent.
- If reusing another project's knowledge setup, identify the exact source-project
  Knowledge Search model first and import it into the target project before the
  first `set_knowledge_ai` attempt.
- Import the full required knowledge model set in one pass. If the embedding
  model, Knowledge Search model, and agent model share one connection, transfer
  that single connection once alongside all of those models.
- After importing LLMs into the target project, enumerate the target
  project's `llm_model` resources and try those same-project IDs before
  creating a new model.
- For Knowledge Search specifically, use `list_resources` with
  `resourceType: 'llm_model'` and `useCase: 'knowledgeSearch'` so the
  candidates match the Settings UI dropdown rather than the unfiltered
  project-wide LLM list.
- Do not substitute a fresh or generic model for `knowledgeSearchModelId`
  unless the user explicitly asks for that and existing same-project candidates
  have already failed API validation.
- If the exact source-project Knowledge Search model is missing from the target
  project, import it before trying a different model.
- If all same-project candidates fail, report the exact attempted model IDs
  and API errors rather than claiming a platform-side bug.
- Do not describe an untried model as "likely" unsupported or rejected.
- Treat model names in examples as examples only, not as the source of truth.

### 4. Get analytics on recent conversations

```
Show me the last 20 conversations for project <projectId> and summarize
what topics users asked about most.
```

Uses `list_resources` to fetch conversations, then your AI assistant summarizes the content.

### 5. List all projects and agents

```
List all my Cognigy projects and show which AI Agents exist in each one.
```

Uses `list_resources` with `resourceType: 'project'` and `resourceType: 'agent'`.

### 6. Import a package into a project

```
Upload the package at /absolute/path/to/support-bot.zip into project <projectId>,
show me the import preview, then import it using the default selections.
```

Uses `manage_packages` with `operation: 'upload_and_inspect'`, then `operation: 'import'`.

### 7. Export a package from project resources

```
Create a package named "support-bot" from these resource IDs in project <projectId>,
include dependencies, and save the zip to /absolute/path/to/exports/.
```

Uses `manage_packages` with `operation: 'list_exportable'` to discover candidates, then `operation: 'export'`, then `operation: 'download'` when needed.

### 8. Configure voice preview and create a browser voice endpoint

```
Set the voice preview provider for project <projectId> to Microsoft, then create
a Voice Gateway endpoint for flow <flowId> named "Support Voice" and give me the
WebRTC demo URL I can open in the browser.
```

This uses `manage_settings` with `operation: 'set_voice_preview'` to configure speech, then `manage_voice_gateway` to provision a `voiceGateway2` endpoint with a `webrtcDemoUrl`.

### 9. Configure Knowledge AI settings for search

```
Configure Knowledge AI settings for project <projectId> by setting the Knowledge Search
model and the Content Parser. If I am creating a new project and another project already
has a working knowledge setup, reproduce that exact Knowledge Search model and Content
Parser choice in the new project before trying generic defaults.
```

This uses `manage_settings` with `operation: 'set_knowledge_ai'` to configure
`knowledgeSearch` and `contentParser` at the project-settings level. Reusing
settings does not mean copying another project's settings alone; the required
model must exist in the target project first, either by import or by creating it there.
For knowledge workflows, the MCP should import the full required source-project model set
in one pass, reuse shared connections only once, and try the imported same-project model
IDs before falling back to `setup_llm`.

## Security

- API keys are passed via environment variables and never logged
- All inputs are validated using Zod schemas before reaching the API
- Rate limiting is built in to prevent API abuse

## Privacy Policy

This MCP server transmits requests to the Cognigy.AI API endpoint configured via `COGNIGY_API_BASE_URL`. No data is collected, stored, or shared by this MCP server itself — all data remains between your AI client and your Cognigy.AI instance.

Full privacy policy: [https://www.cognigy.com/privacy-policy](https://www.cognigy.com/privacy-policy)

## Support

- **Issues**: [GitHub Issues](https://github.com/Cognigy/cognigy-mcp/issues)
- **Cognigy support**: support@cognigy.com
- **Documentation**: see [`docs/`](https://github.com/Cognigy/cognigy-mcp/tree/main/docs) folder

## Documentation

- [docs/ARCHITECTURE.md](https://github.com/Cognigy/cognigy-mcp/blob/main/docs/ARCHITECTURE.md) — tool design, self-improvement loop, ID formats
- [docs/USAGE.md](https://github.com/Cognigy/cognigy-mcp/blob/main/docs/USAGE.md) — detailed usage reference
- [docs/TESTING.md](https://github.com/Cognigy/cognigy-mcp/blob/main/docs/TESTING.md) — ways to test local builds, CLI installation, and `.mcpb` distribution
- [docs/CONTRIBUTING.md](https://github.com/Cognigy/cognigy-mcp/blob/main/docs/CONTRIBUTING.md) — development setup and contribution guide

## License

[MIT](LICENSE)
