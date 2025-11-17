# AI Agent Architecture in Cognigy

## Modern Approach: LLM-Based AI Agents

Cognigy's modern approach uses **LLM-powered AI Agents** instead of traditional NLU/intent-based systems.

## ✅ TESTED & WORKING

The MCP server **automatically creates complete AI Agent setups** in one tool call. This document explains what gets created and how it works.

## Architecture Components

### 1. AI Agent Resource

The AI Agent is a resource you create with a detailed **job description** that defines:
- The agent's role and purpose
- Step-by-step instructions for handling conversations
- Guidelines for behavior and tone
- When to use which tools
- Edge case handling

**Created via**: `manage_ai_agents` tool with `operation: create`

**Example Job Description**:
```
You are a customer support agent for Acme Corp. Your job is to:

1. Greet customers warmly and professionally
2. Ask clarifying questions to understand their issue
3. Search the knowledge base for relevant solutions
4. Provide clear, step-by-step guidance
5. Escalate to human support if the issue is complex or urgent

Guidelines:
- Always be professional but friendly
- Verify you understood correctly before providing solutions
- If unsure, search the knowledge base first
- Keep responses concise (2-3 sentences maximum)
- Never make promises about delivery dates or refunds
```

### 2. LLM Resource

The LLM Resource defines which language model powers the AI Agent:
- GPT-4
- Claude
- Other supported LLMs

**Note**: LLM resources are typically configured via the Cognigy UI, not the API.

**Required**: Every AI Agent needs an LLM resource configured in the project.

### 3. AI Agent Job Node in Flow

The **AI Agent Job Node** is a special flow node type that:
- References an AI Agent resource in its configuration
- Executes the AI Agent's logic when the flow reaches this node
- Handles the conversation using the agent's job description
- Can access tools configured for the agent

**Created via**: `manage_flows` tool with `operation: create_node`, type: AI Agent Job Node

**Configuration**: The node must be configured to reference your AI Agent resource.

## Complete Workflow (100% Automatic!)

### ✅ Automatic Setup (ONE Tool Call!)

```typescript
{
  tool: "manage_ai_agents",
  operation: "create",
  projectId: "67ae00859756766d5e31fcb8",
  name: "Support Agent",
  description: "Handles customer support inquiries"
}
```

**This automatically creates:**
1. ✅ AI Agent resource
2. ✅ Flow (named "Support Agent Flow")
3. ✅ AI Agent Job Node in the flow (connected to the agent via config.aiAgent = agent.referenceId)
4. ✅ REST Endpoint pointing to the flow
5. ✅ Returns endpoint URL ready to use!

**Response includes:**
- `agent` - The AI Agent resource
- `flow` - The created flow
- `endpoint` - The REST endpoint
- `endpointUrl` - Full URL like `https://endpoint-trial.cognigy.ai/xxxxx`

### ⚠️ One Manual Step: LLM Resource

**Before the agent can respond**, you need an LLM resource configured in the project:
1. Go to Cognigy UI
2. Project Settings → LLM Connections
3. Add GPT-4, Claude, or other LLM
4. Save

This only needs to be done once per project.

### ✅ Test Your Agent

```typescript
{
  tool: "talk_to_agent",
  endpointUrl: "https://endpoint-trial.cognigy.ai/xxxxx",
  message: "I need help resetting my password"
}
```

**Returns the agent's actual text response!**

### ✅ Improve Your Agent

**Option 1: Update via MCP**
```typescript
{
  tool: "manage_ai_agents",
  operation: "update",
  aiAgentId: "691b1c2e36bda2b14170fd73",
  description: "Updated description with better instructions..."
}
```

**Option 2: Update via UI**
1. Open flow in Cognigy UI
2. Click AI Agent Job Node
3. Update job description
4. Save

### ✅ Test Again & Compare

Use `talk_to_agent` with the same message and compare responses!

```typescript
{
  tool: "talk_to_agent",
  endpointUrl: "same-url-as-before",
  message: "I need help resetting my password"  // Same question
}
```

**Observe the improvement!** Then iterate until perfect! 🔄

## Iterative Improvement Process

AI Agent quality comes from **iterative refinement** of the job description:

### 1. Initial Creation
Start with a basic job description covering core responsibilities.

### 2. Test Conversations
Run real conversations and observe:
- Does the agent understand user intent?
- Are responses appropriate?
- Does it handle edge cases?
- Is the tone right?

### 3. Analyze & Refine
Update the job description to:
- Add handling for edge cases discovered
- Clarify ambiguous instructions
- Add examples of good responses
- Refine guidelines based on actual behavior

### 4. Deploy & Monitor
Use analytics tools to track:
- Conversation success rates
- Common failure patterns
- User satisfaction

### 5. Continuous Improvement
Keep refining based on production data.

## Legacy vs Modern Approach

### ❌ Legacy: Intent-Based (NLU)

**Old way:**
1. Create intents with training sentences
2. Train NLU model
3. Map intents to flows
4. Handle slots and entities
5. Retrain when adding new intents

**Problems:**
- Requires training data
- Limited to predefined intents
- Can't handle unexpected inputs well
- Rigid conversation flow

### ✅ Modern: AI Agent-Based (LLM)

**New way:**
1. Create AI Agent with job description
2. Add AI Agent Job Node to flow
3. Agent handles conversations naturally
4. Refine job description based on behavior
5. No training required

**Benefits:**
- No training data needed
- Handles unexpected inputs
- Flexible, natural conversations
- Easy to improve (just edit job description)

## When to Use Each Approach

### Use AI Agents (Modern) ✅
- **Default choice** for all new projects
- Natural, flexible conversations
- Complex reasoning required
- Handling unexpected inputs
- Continuous improvement through iteration

### Use Intents (Legacy) ⚠️
- Working with existing legacy projects
- Specific requirement for traditional NLU
- Migration path not yet available

**Recommendation**: Always prefer AI Agents for new projects.

## Best Practices

### 1. Write Detailed Job Descriptions
The job description is the agent's brain. Be specific:
- ✅ "If user asks about pricing, search knowledge base first, then provide the standard pricing table. Never quote custom pricing."
- ❌ "Help with pricing questions."

### 2. Include Examples in Job Description
Show the agent what good looks like:
```
Example conversation:
User: "How much does it cost?"
Agent: "Let me check our pricing for you. [searches knowledge] 
        We have three plans: Basic ($49/mo), Pro ($99/mo), 
        and Enterprise (custom pricing). Which features are 
        most important to you?"
```

### 3. Specify Tool Usage
Be explicit about when to use tools:
```
Always search the knowledge base before answering questions about:
- Product features
- Pricing
- Technical specifications
- Company policies
```

### 4. Handle Edge Cases
Add sections for special situations:
```
If user is angry or frustrated:
1. Acknowledge their frustration
2. Apologize for the inconvenience
3. Focus on solving their problem quickly
4. Offer to escalate if needed
```

### 5. Iterate Based on Real Conversations
- Review actual conversations regularly
- Update job description based on findings
- Test changes before deploying widely
- Track improvements over time

## Tools for AI Agents

AI Agents can be configured with various tools:

### Common Tools
- `knowledge_search` - Search knowledge bases
- `ticket_creation` - Create support tickets
- `calendar_booking` - Schedule appointments
- `api_call` - Call external APIs
- Custom functions - Your own logic

Configure tools when creating/updating agents:
```typescript
{
  tool: "manage_ai_agents",
  operation: "create",
  tools: ["knowledge_search", "ticket_creation"]
}
```

## Deployment

Once your AI Agent is ready:

```typescript
{
  tool: "manage_ai_agents",
  operation: "hire",
  aiAgentId: "507f1f77bcf86cd799439013"
}
```

This deploys the agent to production.

## Summary

**Modern Cognigy = AI Agents + LLM Resources + Job Descriptions**

Focus on:
1. Creating AI Agents with detailed job descriptions
2. Configuring LLM resources
3. Adding AI Agent Job Nodes to flows
4. Iteratively improving through job description refinement

**Not**: Intents, training data, NLU models (legacy approach)

