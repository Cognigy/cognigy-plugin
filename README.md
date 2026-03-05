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

## 🎯 Key Feature: Self-Improving AI Agents

**Create a complete AI Agent setup in ONE tool call**, then iterate and improve through conversation:

1. **Create** → AI Agent + Flow + Job Node + Endpoint (automatic!)
2. **Test** → Talk to your agent via REST endpoint  
3. **Improve** → Update job description based on responses
4. **Test Again** → Compare responses and iterate
5. **Repeat** → Until your agent is perfect!

## Overview

This MCP server exposes the Cognigy.AI API through 9 high-level workflow tools focused on **LLM-based AI Agents** (the modern approach), making it easy for AI assistants to build, test, and improve conversational AI systems.

## Features

- **9 High-Level Workflow Tools**: Grouped 359 API endpoints into 9 logical workflows (97.5% reduction!)
- **100% Automatic AI Agent Setup**: One tool call creates Agent + Flow + Job Node + Endpoint
- **Self-Improvement Loop**: Talk to agents, test responses, iterate until perfect
- **System Prompt Included**: AI assistants automatically become Cognigy experts
- **Authentication**: API Key authentication (configured via MCP)
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
- **A Cognigy API key** — Cognigy.AI → User Menu → My Profile → API Keys → Create New

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

**Config file location:**
- macOS: `~/Library/Application Support/Cursor/User/globalStorage/mcp/mcp.json`
- Windows: `%APPDATA%\Cursor\User\globalStorage\mcp\mcp.json`
- Linux: `~/.config/Cursor/User/globalStorage/mcp/mcp.json`

Add the config block above. Restart Cursor. Open the AI chat and type `@cognigy` to use the tools.

### ChatGPT / Windsurf / Other MCP Clients

Any MCP client that supports the **stdio** transport works. Add the same config block to your client's MCP settings.

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
2. **User Menu → My Profile**
3. **API Keys** section
4. Click **Create API Key**
5. Copy the key

<details>
<summary>Local development setup (for contributors)</summary>

If you're developing the MCP server itself:

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

The MCP server follows a modular architecture:

- `src/index.ts` - Main server initialization and MCP protocol handling
- `src/tools/` - Tool handlers for each workflow category
- `src/api/` - API client and request handlers
- `src/schemas/` - Zod schemas for input validation
- `src/utils/` - Utilities (logging, rate limiting, etc.)
- `src/resources/` - MCP resources (documentation, examples)

## Security

- API keys are never logged or exposed
- All inputs are validated using Zod schemas
- Rate limiting prevents API abuse
- Supports OAuth2 for enterprise deployments

## Project Statistics

- **9 Tools**: Instead of 359 endpoint-specific tools (97.5% reduction)
- **34 Operations**: Covering all major Cognigy workflows + agent testing
- **~115 API Endpoints**: Accessible through workflow grouping
- **Full Type Safety**: TypeScript with Zod validation
- **Production Ready**: Rate limiting, logging, error handling, tests
- **🔄 100% Automated**: Create AI Agent → Flow → Job Node → Endpoint in one call
- **✅ Tested & Working**: Complete self-improvement loop validated end-to-end

## What's Working (Verified!)

✅ **Automatic AI Agent Setup** - Creates agent, flow, job node, and endpoint in one tool call
✅ **Talk to Agent** - Sends messages and receives responses via REST endpoint
✅ **Agent Updates** - Modify agent configuration and see changes immediately
✅ **Complete Improvement Loop** - Create → Test → Improve → Test → Iterate
✅ **All Infrastructure Tools** - Projects, flows, endpoints, knowledge, analytics
✅ **System Prompt** - AI assistants have full Cognigy domain expertise

## Important ID Format Note

Cognigy uses two ID formats:
- **MongoDB _id** (24-char hex): `691b1c2e36bda2b14170fd73` - Used for most operations
- **UUID referenceId** (36-char): `8184e6a8-e10c-4b03-8a83-538c004c321a` - Used for flowId in endpoints

When creating resources, both IDs are returned. The tools handle this automatically.

## Key Design Decision: Why Only 9 Tools?

The Cognigy API has ~359 endpoints across 50+ categories. Creating one tool per endpoint would overwhelm AI agents and make the system unusable. Our solution:

**Workflow-Based Grouping**: Group related endpoints into high-level workflows that represent what users actually want to accomplish:

- ✅ Natural for AI agents to understand
- ✅ Matches human mental models
- ✅ Easy to discover and use
- ✅ Maintainable and extensible

Example: Instead of separate tools for `createAgent`, `getAgent`, `updateAgent`, `deleteAgent`, `listAgents`, `hireAgent`, we have one `manage_ai_agents` tool with an `operation` parameter.

## Modern AI Agent-Centric Approach

The MCP server focuses on **LLM-based AI Agents** (the modern approach) rather than traditional NLU/intents (legacy).

**What Happens When You Create an AI Agent:**
1. ✅ AI Agent resource created
2. ✅ Flow created automatically
3. ✅ AI Agent Job Node added to flow (connected to agent)
4. ✅ REST Endpoint created (ready to use!)
5. ✅ Endpoint URL returned

**Then:** Use `talk_to_agent` tool to test responses and iterate!

**Note:** You'll need an LLM resource (GPT-4, Claude, etc.) configured in the project via Cognigy UI for the agent to work.

## Documentation Navigation

- **Quick Start**: See [QUICK_START.md](QUICK_START.md) for setup & usage examples
- **Technical Details**: See [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md) for architecture
- **For Developers**: See [HANDOFF.md](HANDOFF.md) for implementation details
- **All Docs**: See [INDEX.md](INDEX.md) for complete documentation index

## Contributing

Contributions are welcome! Read [.cursorrules](.cursorrules) for development guidelines and [HANDOFF.md](HANDOFF.md) for technical details.

## Support

- **Documentation**: See `docs/` directory
- **Issues**: GitHub issues
- **Cognigy API Support**: support@cognigy.com

## License

MIT

