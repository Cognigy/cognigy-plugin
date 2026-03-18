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

The command will prompt you for your Cognigy API URL and then ask for an API key. API key is the recommended local setup. If you leave it empty, the installer will configure local OAuth instead. Restart your client after setup.

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

## Features

- **9 High-Level Workflow Tools**: Grouped 359 API endpoints into 9 logical workflows (97.5% reduction!)
- **100% Automatic AI Agent Setup**: One tool call creates Agent + Flow + Job Node + Endpoint
- **Self-Improvement Loop**: Talk to agents, test responses, iterate until perfect
- **System Prompt Included**: AI assistants automatically become Cognigy experts
- **Authentication**: API key preferred, local OAuth also supported
- **Rate Limiting**: Built-in protection against API abuse  
- **Error Handling**: RFC 7807 compliant error responses
- **Type Safety**: Full TypeScript with Zod validation
- **Production Ready**: Logging, tests, multiple deployment options

## Workflow Tools (AI Agent-Centric)

1. **AI Agent Management** ⭐ - Create, update LLM-powered AI agents (PRIMARY TOOL)
2. **Knowledge Management** - Manage knowledge stores for RAG-enabled AI agents
3. **Conversation Management** - Query conversations to improve AI agent behavior
4. **Flow Management** - Create flows with AI Agent Job Nodes
5. **Intent & NLU Management** (Legacy) - Old approach, use AI Agents instead
6. **Analytics & Monitoring** - Get metrics, logs, and audit events
7. **Project & Endpoint Management** - Manage projects and REST endpoints
8. **Extension Management** - Manage custom extensions and functions
9. **Talk to AI Agent** 🔄 - **THE IMPROVEMENT LOOP** - Talk directly to your AI Agent via REST endpoint!

**Important**: AI Agent job descriptions are configured in the **AI Agent Job Node** within a Flow, not in the Agent resource itself.

**Modern Approach**: Focus on AI Agents (LLM-powered) rather than intents/NLU (legacy)

### 🔄 The Self-Improvement Loop

The **`talk_to_agent`** tool enables a powerful iterative improvement workflow:

```
┌─────────────────────────────────────────────────────┐
│  1. Create/Update AI Agent (job description)       │
└────────────────┬────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────────────────┐
│  2. Talk to Agent (via REST endpoint)              │
│     "How do I reset my password?"                  │
└────────────────┬────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────────────────┐
│  3. Evaluate Response                               │
│     - Is it helpful?                               │
│     - Is the tone right?                           │
│     - Does it follow guidelines?                   │
└────────────────┬────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────────────────┐
│  4. Improve Job Description                        │
│     - Add specific instructions                     │
│     - Fix issues found                             │
│     - Add edge case handling                       │
└────────────────┬────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────────────────┐
│  5. Talk to Agent Again (same question)            │
│     Compare responses → Better? → Iterate          │
└─────────────────────────────────────────────────────┘
```

**Human in the loop**: You provide feedback, suggest improvements, and approve changes!

## Quick Start

### Prerequisites

- **Node.js 20+** (check with `node -v`)
- **Either a Cognigy API key or OAuth access to your Cognigy environment**

### Add to your MCP client

Add the following to your MCP client's config file. No build step, no cloning — `npx` handles everything automatically.

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

Restart your MCP client, then try:
```
@cognigy List my Cognigy projects
```

**See [QUICK_START.md](QUICK_START.md) for detailed usage examples!**

## Setup by MCP Client

### Claude Desktop (one-click install)

Download the `.mcpb` file from [Releases](https://github.com/Cognigy/cognigy-mcp/releases) and double-click it. Claude Desktop will open an install dialog where you enter your API URL and API key — no config files to edit, no Node.js required.

Alternatively, use the npx config approach: edit `~/Library/Application Support/Claude/claude_desktop_config.json` and add the config block above.

### Cursor IDE

Edit the MCP config file directly, or go to **Cursor > Settings > Cursor Settings > MCP > Add MCP Server**.

**Config file location:** `~/.cursor/mcp.json` (all platforms)

Add the config block above. Restart Cursor. Open the AI chat and type `@cognigy` to use the tools.

### ChatGPT / Windsurf / Other MCP Clients

Any MCP client that supports the **stdio** transport works. Add the same config block to your client's MCP settings.

## Configuration

All configuration is passed via the `env` block in the MCP config. No `.env` file needed.

| Variable | Required | Default | Description |
|---|---|---|---|
| `COGNIGY_API_BASE_URL` | Yes | — | Your Cognigy API URL |
| `COGNIGY_API_KEY` | Recommended | — | Your Cognigy API key |
| `COGNIGY_AUTH_MODE` | No | `api-key` if API key exists, otherwise `oauth` | `api-key`, `oauth`, or `both` |
| `COGNIGY_OAUTH_ISSUER_BASE_URL` | OAuth only | `COGNIGY_API_BASE_URL` | OAuth issuer base URL |
| `COGNIGY_OAUTH_CLIENT_ID` | OAuth only | — | OAuth client ID |
| `COGNIGY_OAUTH_REDIRECT_URI` | OAuth only | — | Localhost redirect URI for OAuth |
| `COGNIGY_OAUTH_SCOPES` | No | `mcp:access` | OAuth scopes |
| `LOG_LEVEL` | No | `info` | `debug`, `info`, `warn`, `error` |
| `RATE_LIMIT_MAX_REQUESTS` | No | `100` | Max requests per window |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` | Rate limit window (ms) |

### Local Authentication Options

#### Option 1: API key

This is the recommended local setup.

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

#### Option 2: OAuth

If you do not have an API key, local MCP can still authenticate through OAuth against your Cognigy environment. The setup CLI will configure this path when you leave the API key blank.

<details>
<summary>Local development setup (for contributors)</summary>

```bash
git clone <repo-url>
cd cognigy-mcp
npm install
npm run build
```

To test the install CLI against your local build, run one of these commands after building:

```bash
node dist/index.js init --client cursor
node dist/index.js init --client claude
node dist/index.js init --client claude-code
node dist/index.js init --client vscode
```

For `claude-code` and `vscode`, run the command from the project directory where you want the local MCP config file written.

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

See [docs/LOCAL_VS_REMOTE_MCP.md](docs/LOCAL_VS_REMOTE_MCP.md) for a short comparison of why local MCP is the better supported model for Cognigy right now.

### System Prompt (Included!)

The MCP server includes a comprehensive **system prompt as an MCP resource** that Claude automatically loads. This transforms Claude into a Cognigy expert that:

- ✅ Understands modern **LLM-based AI Agent architecture**
- ✅ Focuses on **creating and refining AI Agents** (not legacy NLU/intents)
- ✅ Knows the AI Agent workflow: Agent resource → LLM resource → AI Agent Job Node
- ✅ Plans multi-step workflows automatically
- ✅ Suggests best practices for AI Agent job descriptions
- ✅ Guides users to iterate and improve agent behavior

**No additional configuration needed** - it works automatically! See `docs/SYSTEM_PROMPT.md` for details.

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
