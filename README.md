# Cognigy MCP Server

A Model Context Protocol (MCP) server that provides AI assistants with access to the Cognigy.AI REST API.

## Install

### One-command setup

Requires [Node.js 20+](https://nodejs.org) installed on your machine. Run the command for your MCP client:

| MCP Client | Command |
|---|---|
| Cursor | `npx @cognigy/mcp-server init --client cursor` |
| Claude Desktop | `npx @cognigy/mcp-server init --client claude` |
| Claude Code | `npx @cognigy/mcp-server init --client claude-code` |
| VS Code (Copilot) | `npx @cognigy/mcp-server init --client vscode` |

The command will prompt you for your Cognigy API URL and API key, then automatically configure your client. Restart your client after setup.

### Claude Desktop (one-click)

Download the `.mcpb` file from the [latest release](https://github.com/Cognigy/cognigy-mcp/releases/latest) and double-click it. No Node.js required.

<details>
<summary>Manual config (if you prefer)</summary>

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

</details>

Requires [Node.js 20+](https://nodejs.org). Get your API key from Cognigy.AI → User Menu → My Profile → API Keys.

---

## What It Does

Create a complete AI Agent in one tool call, then iterate and improve through conversation:

1. **Create** → AI Agent + Flow + Job Node + Endpoint (automatic)
2. **Test** → Talk to your agent via REST endpoint
3. **Improve** → Update persona, guardrails, job description, tools
4. **Test Again** → Compare responses and iterate
5. **Deploy** → Publish to Webchat with one call

## Tools

| Tool | Description |
|---|---|
| `create_ai_agent` | Create a complete AI Agent with auto-provisioned flow, job node, and REST endpoint |
| `update_ai_agent` | Update persona, guardrails, job config (role, procedures, LLM, temperature) |
| `setup_llm` | Create an LLM resource (GPT-4, Claude, Mistral, etc.) in a project |
| `talk_to_agent` | Send a message to an AI Agent and get its response |
| `list_resources` | List projects, agents, flows, endpoints, LLMs, knowledge stores, and more |
| `get_resource` | Get detailed information about a single resource |
| `delete_resource` | Permanently delete a resource |
| `manage_knowledge` | Create knowledge stores, add sources (URL, text, file), list chunks for RAG |
| `create_tool` | Add a tool (HTTP, knowledge, email, MCP) to an agent's job node |
| `update_tool` | Update an existing tool node's configuration |
| `manage_webchat` | Create or configure a Webchat v3 endpoint for website deployment |
| `manage_flow_nodes` | Create, update, delete, or list flow nodes for conversation logic |

The server also includes built-in guides (MCP resources) that AI assistants automatically read for detailed workflows, field references, and troubleshooting.

## Configuration

All configuration is passed via the `env` block in the MCP config. No `.env` file needed.

| Variable | Required | Default | Description |
|---|---|---|---|
| `COGNIGY_API_BASE_URL` | Yes | — | Your Cognigy API URL |
| `COGNIGY_API_KEY` | Yes | — | Your Cognigy API key |
| `LOG_LEVEL` | No | `info` | `debug`, `info`, `warn`, `error` |
| `RATE_LIMIT_MAX_REQUESTS` | No | `100` | Max requests per window |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` | Rate limit window (ms) |

### Getting Your API Key

1. Log in to Cognigy.AI
2. User Menu → My Profile
3. API Keys section → Create API Key
4. Copy the key

## Setup by MCP Client

### Claude Desktop (one-click install)

Download the `.mcpb` file from [Releases](https://github.com/Cognigy/cognigy-mcp/releases) and double-click it. Claude Desktop will open an install dialog where you enter your API URL and API key — no config files to edit, no Node.js required.

Alternatively, use the npx config approach: edit `~/Library/Application Support/Claude/claude_desktop_config.json` and add the config block above.

### Cursor IDE

Edit the MCP config file directly, or go to **Cursor > Settings > Cursor Settings > MCP > Add MCP Server**.

Config file location: `~/.cursor/mcp.json` (all platforms)

Add the config block above. Restart Cursor. Open the AI chat and type `@cognigy` to use the tools.

### ChatGPT / Windsurf / Other MCP Clients

Any MCP client that supports the **stdio** transport works. Add the same config block to your client's MCP settings.

<details>
<summary>Local development setup (for contributors)</summary>

```bash
git clone <repo-url>
cd cognigy-mcp
npm install
npm run build
```

Then point your MCP client to the local build:

```json
{
  "mcpServers": {
    "cognigy": {
      "command": "node",
      "args": ["/absolute/path/to/cognigy-mcp/dist/index.js"],
      "env": {
        "COGNIGY_API_BASE_URL": "https://api-trial.cognigy.ai",
        "COGNIGY_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

Or use the interactive setup: `npm run setup`

</details>

## Architecture

- `src/index.ts` — MCP server initialization and protocol handling
- `src/instructions.ts` — Server instructions (build workflow, rules)
- `src/tools/definitions.ts` — Tool definitions and schemas
- `src/tools/handlers.ts` — Tool handler implementations
- `src/tools/filters.ts` — API response filters
- `src/schemas/tools.ts` — Zod input validation schemas
- `src/api/client.ts` — Cognigy REST API client
- `src/resources/` — MCP resource guides (agent creation, LLM providers, knowledge, tools, webchat, troubleshooting)
- `src/utils/` — Logging and rate limiting

## Security

- API keys are never logged or exposed
- All inputs are validated using Zod schemas
- Rate limiting prevents API abuse

## Contributing

Contributions are welcome! Read [.cursorrules](.cursorrules) for development guidelines.

## Support

- **Issues**: [GitHub Issues](https://github.com/Cognigy/cognigy-mcp/issues)
- **Cognigy API Support**: support@cognigy.com

## License

MIT
