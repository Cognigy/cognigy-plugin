# 👋 START HERE - For New Contributors/Users

## What Is This?

A **TypeScript MCP server** that lets Cursor/Claude interact with Cognigy.AI through 9 tools.

**Key feature:** Create AI Agents and iteratively improve them through conversation.

## Status: ✅ FULLY WORKING

All core functionality implemented and tested. Ready to use!

## Quick Setup (5 min)

### 1. Build
```bash
npm install
npm run build
```

### 2. Add to Cursor/Claude

**Update your MCP config** with:
- Path to `dist/index.js` (absolute path!)
- Your Cognigy API key
- API base URL

See `QUICK_START.md` for exact config format.

### 3. Restart & Test
```
@cognigy List my projects
```

## The Main Feature: Self-Improvement Loop

### Create Agent (Automatic!)
```
@cognigy Create AI agent "Test Bot" in project <project-id>
```

**Creates everything:**
- AI Agent resource ✅
- Flow ✅  
- AI Agent Job Node (connected!) ✅
- REST Endpoint ✅
- Returns URL ✅

### Talk to Agent
```
@cognigy Talk to agent at <url>: "Hello"
```

**Returns:** Agent's actual text response

### Improve & Iterate
1. Update agent description (via tool or UI)
2. Talk to agent again with same message
3. Compare responses
4. Repeat!

## Key Files to Read

1. **QUICK_START.md** ← Read this first for usage examples
2. **PROJECT_SUMMARY.md** ← Technical overview & architecture
3. **README.md** ← Complete documentation
4. **docs/AI_AGENT_ARCHITECTURE.md** ← How the automatic setup works

## Important Notes

### ID Formats (Critical!)

Cognigy uses TWO different ID formats:
- **MongoDB _id**: 24-char hex (e.g., `691b1c2e36bda2b14170fd73`)
- **UUID referenceId**: 36-char (e.g., `8184e6a8-e10c-4b03-8a83-538c004c321a`)

**The tools handle this automatically**, but good to know when debugging.

### LLM Resource Required

AI Agents need an **LLM resource** (GPT-4, Claude, etc.) configured in the project via Cognigy UI. This can't be done via API.

**Setup once per project:**
1. Cognigy UI → Project Settings → LLM Connections
2. Add your LLM
3. All agents in that project can use it

### System Prompt

The MCP server includes a comprehensive **system prompt as an MCP resource**. AI assistants automatically read it and gain Cognigy domain expertise.

**You don't need to do anything** - it just works!

## What Works (Tested)

✅ Create AI Agent (automatic setup)
✅ Talk to AI Agent (via REST endpoint)
✅ Update AI Agent
✅ Test again and see changes
✅ All 9 workflow tools
✅ Rate limiting
✅ Error handling
✅ Logging

## Common Issues

### "COGNIGY_API_BASE_URL environment variable is required"
**Fix:** Check your MCP config has the `env` section with API credentials

### Agent created but not responding
**Fix:** Add LLM resource to project via Cognigy UI

### Invalid ID format errors
**Fix:** Tools should handle this automatically - if you see this, file a bug

## Testing It Works

Try these in Cursor/Claude:

```
1. @cognigy List my projects
   → Should return your Cognigy projects

2. @cognigy Create AI agent "Test" in project <id>
   → Should return agent, flow, endpoint, and URL

3. @cognigy Talk to agent at <url>: "Hello"
   → Should return agent's response

4. @cognigy Update agent <id> description to "Be friendly"
   → Should update successfully

5. @cognigy Talk to agent at <url>: "Hello"  
   → Should show different response
```

If all 5 work, everything is operational! ✅

## Next Steps

1. Read **QUICK_START.md** for detailed examples
2. Read **PROJECT_SUMMARY.md** for technical details
3. Start building AI agents!

## Questions?

- Check **docs/API_REFERENCE.md** for complete tool documentation
- Check **docs/AI_AGENT_ARCHITECTURE.md** for how AI Agents work
- Check **README.md** for comprehensive overview

**That's it! You're ready to go!** 🚀

