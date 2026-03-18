# Cognigy MCP Server

A Model Context Protocol (MCP) server that connects your AI assistant to the [Cognigy.AI](https://www.cognigy.com) REST API. Create, test, and improve LLM-based AI Agents through a self-improvement loop — without leaving your AI assistant.

## Features

- **9 workflow tools** covering 34 operations across ~115 Cognigy API endpoints
- **One-call agent setup**: creates Agent + Flow + AI Agent Job Node + REST Endpoint automatically
- **Self-improvement loop**: talk to your agent, evaluate responses, update the job description, repeat
- **Knowledge store support**: attach RAG knowledge stores to agents as tools
- **System prompt included**: AI assistants automatically become Cognigy experts via MCP resource
- Built-in rate limiting, Zod input validation, and RFC 7807 error responses

## Tools

| Tool | Type | Description |
|---|---|---|
| `create_ai_agent` | Write | Create an AI Agent with auto-provisioned flow, job node, and endpoint |
| `update_ai_agent` | Write | Update agent configuration, persona, job description, and LLM settings |
| `setup_llm` | Write | Create an LLM resource (GPT-4, Claude, etc.) in a project |
| `talk_to_agent` | Write | Send a message to an agent and get its response |
| `manage_knowledge` | Write | Create knowledge stores, add sources (URL/text/file), list chunks |
| `create_tool` | Write | Add a tool (knowledge, HTTP, MCP, email, custom) to an agent's job node |
| `update_tool` | Write | Update an existing tool node's configuration |
| `list_resources` | Read | List agents, flows, endpoints, LLMs, knowledge stores, and tools |
| `get_resource` | Read | Get details for a single resource |
| `delete_resource` | Write | Delete any resource by type and ID |
| `manage_webchat` | Write | Manage Webchat v3 widget settings |

## Installation

### Claude Desktop (one-click)

Download the `.mcpb` file from the [latest release](https://github.com/Cognigy/cognigy-mcp/releases/latest) and double-click it. Claude Desktop opens an install dialog — enter your API URL and API key. No Node.js required.

### One-command setup (all MCP clients)

Requires [Node.js 20+](https://nodejs.org).

| MCP Client | Command |
|---|---|
| Claude Desktop | `npx @cognigy/mcp-server init --client claude` |
| Claude Code | `npx @cognigy/mcp-server init --client claude-code` |
| Cursor | `npx @cognigy/mcp-server init --client cursor` |
| VS Code (Copilot) | `npx @cognigy/mcp-server init --client vscode` |

The command prompts for your Cognigy API URL and API key, then configures your client automatically. Restart the client after setup.

### Manual config

Add to your MCP client's config file:

```json
{
  "mcpServers": {
    "cognigy": {
      "command": "npx",
      "args": ["-y", "@cognigy/mcp-server"],
      "env": {
        "COGNIGY_API_BASE_URL": "https://api-trial.cognigy.ai",
        "COGNIGY_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

Get your API key: Cognigy.AI → User Menu → My Profile → API Keys → Create New.

## Configuration

All configuration is passed via `env` in the MCP config. No `.env` file needed.

| Variable | Required | Default | Description |
|---|---|---|---|
| `COGNIGY_API_BASE_URL` | Yes | — | Your Cognigy API base URL |
| `COGNIGY_API_KEY` | Yes | — | Your Cognigy API key |
| `LOG_LEVEL` | No | `info` | `debug`, `info`, `warn`, `error` |
| `RATE_LIMIT_MAX_REQUESTS` | No | `100` | Max requests per window |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` | Rate limit window in ms |

## Usage Examples

### 1. Create a customer support agent

```
Create a Cognigy AI Agent called "Support Bot" in project <projectId>.
Give it a helpful customer support persona, set up GPT-4 as the LLM,
and return the endpoint URL so I can test it.
```

The MCP server will call `setup_llm` to create the LLM resource, then `create_ai_agent` to provision the agent, flow, job node, and REST endpoint in a single workflow.

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

The server will call `manage_knowledge` to create the store and ingest the URL, then `create_tool` to attach it as a knowledge search tool on the agent's job node.

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
- **Documentation**: see [`docs/`](docs/) folder

## Documentation

- [QUICK_START.md](QUICK_START.md) — step-by-step setup and first agent walkthrough
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — tool design, self-improvement loop, ID formats
- [docs/USAGE.md](docs/USAGE.md) — detailed usage reference
- [docs/API_REFERENCE.md](docs/API_REFERENCE.md) — full API reference
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — deployment options
- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) — development setup and contribution guide
- [CHANGELOG.md](CHANGELOG.md) — version history

## License

[MIT](LICENSE)
