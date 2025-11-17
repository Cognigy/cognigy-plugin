# Quick Start Guide

## What This Is

A **Model Context Protocol (MCP) server** that lets AI assistants (Claude, Cursor) interact with Cognigy.AI through 9 high-level tools, including a **complete self-improvement loop** for AI Agents.

## Key Feature: 100% Automatic AI Agent Setup

**One tool call creates everything:**
- ✅ AI Agent resource
- ✅ Flow with AI Agent Job Node
- ✅ REST Endpoint
- ✅ **Agent is immediately testable!**

## Installation (5 minutes)

### 1. Install Dependencies

```bash
cd /path/to/cognigy/services/mcp-server
npm install
```

### 2. Build

```bash
npm run build
```

### 3. Configure for Cursor

Add to `~/Library/Application Support/Cursor/User/globalStorage/mcp/mcp.json`:

```json
{
  "mcpServers": {
    "cognigy": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/cognigy/services/mcp-server/dist/index.js"
      ],
      "env": {
        "COGNIGY_API_BASE_URL": "https://api-trial.cognigy.ai",
        "COGNIGY_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

**Get your API key:**
1. Login to Cognigy.AI
2. User Menu → My Profile → API Keys
3. Create new key, copy it

### 4. Restart Cursor

Settings → MCP → Toggle "cognigy" off/on (or restart Cursor completely)

## Usage

### Create an AI Agent (Fully Automatic!)

In Cursor chat:
```
@cognigy Create an AI agent called "Support Bot" in project <project-id>
```

**This ONE command creates:**
- AI Agent resource
- Flow
- AI Agent Job Node (connected to agent)
- REST Endpoint
- Returns endpoint URL

### Talk to Your Agent

```
@cognigy Talk to the agent at <endpoint-url>
Message: "I need help with something"
```

**Returns the agent's actual response!**

### Improve Your Agent (The Loop!)

```
@cognigy Update agent <agent-id> description to be more empathetic and friendly
```

Then talk to it again and compare responses!

### The Complete Self-Improvement Loop

```
1. @cognigy Create AI agent "Password Reset Helper" in project <id>
   → Everything created, endpoint URL returned

2. @cognigy Talk to agent at <url>: "I forgot my password"
   → Agent responds (might be generic)

3. Update agent description in Cognigy UI with better instructions
   (Or use update tool if supported)

4. @cognigy Talk to agent again: "I forgot my password"
   → Compare responses - should be better!

5. Repeat steps 3-4 until perfect!
```

## The 9 Tools

1. **`manage_ai_agents`** ⭐ - Create/update AI agents (AUTO-CREATES EVERYTHING!)
2. **`manage_knowledge`** - Knowledge stores for RAG
3. **`manage_conversations`** - Query conversation history
4. **`manage_flows`** - Create/modify flows
5. **`manage_intents`** (Legacy) - Old NLU approach
6. **`get_analytics`** - Metrics, logs, audit events
7. **`manage_projects`** - Projects and endpoints
8. **`manage_extensions`** - Custom functions
9. **`talk_to_agent`** 🔄 - Talk to your agent, test responses

## Important Notes

### ID Formats (Critical!)

Cognigy uses **two different ID formats**:

**MongoDB _id** (24-char hex):
- Format: `691b1c2e36bda2b14170fd73`
- Used for: `projectId`, `aiAgentId`, most operations

**UUID referenceId** (36-char with hyphens):
- Format: `8184e6a8-e10c-4b03-8a83-538c004c321a`
- Used for: `flowId` in endpoints

When you create resources, you get both IDs. Use the right one for each operation!

### System Prompt

The MCP server includes a **comprehensive system prompt** as a resource that Claude/Cursor can read. This gives context about:
- Cognigy.AI concepts (flows, agents, endpoints)
- How tools work together
- Best practices
- Common workflows

The AI assistant automatically becomes a Cognigy expert!

### Modern Approach: AI Agents > Intents

Focus on **LLM-based AI Agents** (tool #1), not traditional NLU/intents (tool #5 - legacy).

## Troubleshooting

### "COGNIGY_API_BASE_URL environment variable is required"
→ Check your MCP config has the `env` section with API credentials

### Agent not responding
→ Make sure you have an LLM resource configured in the project (via Cognigy UI)

### Invalid ID format errors
→ Check if you're using the right ID format (MongoDB _id vs UUID referenceId)

## What's Tested and Working

✅ AI Agent creation with automatic flow/endpoint setup
✅ REST endpoint creation
✅ Talk to agent via endpoint
✅ Agent responds properly
✅ Update agent and see changes
✅ Complete improvement loop

## Next Steps

1. **Get your project ID:**
   ```
   @cognigy List my projects
   ```

2. **Create your first agent:**
   ```
   @cognigy Create AI agent "My First Bot" in project <id>
   ```

3. **Start talking to it:**
   ```
   @cognigy Talk to agent at <endpoint-url>: "Hello!"
   ```

4. **Improve and iterate!** 🔄

---

**That's it!** You're ready to build and improve AI agents with the self-improvement loop! 🚀

