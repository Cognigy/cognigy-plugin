#!/usr/bin/env node

/**
 * Cognigy MCP Server - Main entry point
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { loadConfig } from './config.js';
import { CognigyApiClient } from './api/client.js';
import { ToolHandlers } from './tools/handlers.js';
import { tools } from './tools/index.js';
import { logger } from './utils/logger.js';
import { RateLimiter } from './utils/rateLimiter.js';

/**
 * Initialize and start the MCP server
 */
async function main() {
  try {
    // Load configuration
    const config = loadConfig();
    logger.setLevel(config.logLevel);
    logger.info('Starting Cognigy MCP Server', {
      name: config.serverName,
      version: config.serverVersion,
    });

    // Initialize API client
    const apiClient = new CognigyApiClient({
      baseUrl: config.apiBaseUrl,
      apiKey: config.apiKey,
    });

    // Initialize tool handlers
    const toolHandlers = new ToolHandlers(apiClient, config.endpointBaseUrl);

    // Initialize rate limiter
    const rateLimiter = new RateLimiter(config.rateLimit);

    // Create MCP server
    const server = new Server(
      {
        name: config.serverName,
        version: config.serverVersion,
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    /**
     * List available tools
     */
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      logger.debug('Listing tools');
      return { tools };
    });

    /**
     * Handle tool calls
     */
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
      logger.info(`Tool call received: ${name}`);

      // Check rate limit
      const rateLimitKey = config.apiKey.substring(0, 10); // Use first 10 chars as key
      if (!rateLimiter.check(rateLimitKey)) {
        const remaining = rateLimiter.getRemaining(rateLimitKey);
        logger.warn('Rate limit exceeded', { remaining });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: 'Rate limit exceeded',
                message: 'Too many requests. Please try again later.',
                remaining,
              }),
            },
          ],
        };
      }

      try {
        // Execute tool call
        const result = await toolHandlers.handleToolCall(name, args || {});

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error: any) {
        logger.error('Tool execution error', {
          tool: name,
          error: error.message,
          stack: error.stack,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: error.message,
                status: error.status,
                code: error.code,
                traceId: error.traceId,
                details: error.details,
              }, null, 2),
            },
          ],
          isError: true,
        };
      }
    });

    /**
     * List available resources
     */
    server.setRequestHandler(ListResourcesRequestSchema, async () => {
      logger.debug('Listing resources');
      
      return {
        resources: [
          {
            uri: 'cognigy://prompt/system',
            name: 'Cognigy AI Assistant System Prompt',
            description: 'System prompt with context about Cognigy.AI platform, tools, and best practices',
            mimeType: 'text/markdown',
          },
          {
            uri: 'cognigy://api-docs/overview',
            name: 'API Overview',
            description: 'Overview of the Cognigy API and available workflows',
            mimeType: 'text/markdown',
          },
          {
            uri: 'cognigy://api-docs/authentication',
            name: 'Authentication Guide',
            description: 'How to authenticate with the Cognigy API',
            mimeType: 'text/markdown',
          },
          {
            uri: 'cognigy://api-docs/workflows',
            name: 'Workflow Examples',
            description: 'Example workflows using the MCP tools',
            mimeType: 'text/markdown',
          },
          {
            uri: 'cognigy://openapi/spec',
            name: 'OpenAPI Specification',
            description: 'Complete OpenAPI specification for Cognigy.AI',
            mimeType: 'application/json',
          },
        ],
      };
    });

    /**
     * Read resource content
     */
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      logger.debug(`Reading resource: ${uri}`);

      switch (uri) {
        case 'cognigy://prompt/system':
          return {
            contents: [
              {
                uri,
                mimeType: 'text/markdown',
                text: getSystemPrompt(),
              },
            ],
          };

        case 'cognigy://api-docs/overview':
          return {
            contents: [
              {
                uri,
                mimeType: 'text/markdown',
                text: getApiOverview(),
              },
            ],
          };

        case 'cognigy://api-docs/authentication':
          return {
            contents: [
              {
                uri,
                mimeType: 'text/markdown',
                text: getAuthenticationGuide(),
              },
            ],
          };

        case 'cognigy://api-docs/workflows':
          return {
            contents: [
              {
                uri,
                mimeType: 'text/markdown',
                text: getWorkflowExamples(),
              },
            ],
          };

        default:
          throw new Error(`Unknown resource: ${uri}`);
      }
    });

    // Create transport and connect
    const transport = new StdioServerTransport();
    await server.connect(transport);

    logger.info('Cognigy MCP Server started successfully');

    // Handle shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down Cognigy MCP Server');
      await server.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Shutting down Cognigy MCP Server');
      await server.close();
      process.exit(0);
    });
  } catch (error: any) {
    logger.error('Failed to start MCP Server', {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
}

/**
 * Resource content generators
 */

function getSystemPrompt(): string {
  return `# Cognigy.AI Assistant - System Prompt

You are an expert assistant for the Cognigy.AI conversational AI platform. You have access to the Cognigy REST API through 8 workflow-based tools.

## About Cognigy.AI

Cognigy.AI is an enterprise conversational AI platform that enables organizations to build, deploy, and manage AI-powered virtual agents across multiple channels (chat, voice, messaging apps, etc.).

### Key Concepts (Modern LLM-Based Approach)

**Projects**: Containers for all resources (AI agents, LLM configs, flows, endpoints, knowledge bases)
**AI Agents**: LLM-powered autonomous agents with job descriptions that can use tools and make decisions
**LLM Resources**: Language model configurations (GPT-4, Claude, etc.) that power AI Agents
**AI Agent Job Nodes**: Flow nodes that execute AI Agent logic with selected Agent resource in configuration
**Knowledge Stores**: Vector databases containing company knowledge for RAG (used by AI Agents)
**Flows**: Visual conversation orchestration with AI Agent Job Nodes as the core
**Endpoints**: Channel configurations (Webchat, Voice Gateway, Microsoft Teams, etc.)
**Conversations**: Individual user sessions with analytics and state tracking

**Note**: The old NLU/intent-based approach is legacy. Modern Cognigy focuses on LLM-based AI Agents.

### ID Format

All IDs in Cognigy are 24-character hexadecimal strings (MongoDB ObjectIDs):
- Valid: \`507f1f77bcf86cd799439011\`
- Invalid: \`abc123\`, \`project-1\`, UUIDs

## Your 8 Tools

### 1. manage_ai_agents ⭐ PRIMARY TOOL
Create and manage LLM-powered AI agents. This is the core of modern Cognigy.

**Common operations:**
- \`create\`: Create a new AI agent with job description and tools
- \`update\`: Refine agent's job description, add/remove tools, improve behavior
- \`list\`: See all agents in a project
- \`get\`: View agent configuration and job description
- \`hire\`: Deploy an agent to production

**When to use:** This is your primary tool for building conversational AI. AI Agents replace the old intent/NLU approach.

**Important**: After creating an AI Agent resource, you need:
1. An LLM resource in the project (for the agent to use)
2. An AI Agent Job Node in a Flow (with the agent selected in its config)

### 2. manage_knowledge
Manage knowledge bases for RAG (Retrieval-Augmented Generation).

**Common operations:**
- \`create_store\`: Create a new knowledge base
- \`create_source\`: Add documents (URLs, files, text) to a store
- \`search_chunks\`: Query the knowledge base

**When to use:** When users need semantic search, want to add company knowledge, or build Q&A systems.

### 3. manage_conversations
Query and analyze conversation data.

**Common operations:**
- \`list\`: Get conversations with filters (date range, channel)
- \`get\`: Get detailed conversation transcript
- \`get_session_state\`: Get current state variables

**When to use:** When users need to analyze conversations, debug issues, or export conversation data.

### 4. manage_flows
Build conversation orchestration with visual flows centered around AI Agents.

**Common operations:**
- \`create\`: Create a new flow
- \`create_node\`: Add nodes (AI Agent Job Node is most important!)
- \`list\`: See all flows in a project

**When to use:** To create the conversation structure. Modern flows center around AI Agent Job Nodes.

**Key node types:**
- **\`AI Agent Job Node\`**: Executes an AI Agent (select agent resource in config) - **PRIMARY NODE**
- \`say\`: Output text/speech (often handled by AI Agent instead)
- \`code\`: Execute custom JavaScript
- \`http\`: Call external APIs
- \`condition\`: Branch based on conditions

**Modern pattern**: Create a flow with an AI Agent Job Node that has your AI Agent resource configured. The agent handles most conversation logic.

### 5. manage_intents (Legacy - Use AI Agents Instead!)
**⚠️ LEGACY TOOL**: Intents are the old NLU-based approach. Modern Cognigy uses LLM-based AI Agents.

**Only use this if:**
- Working with legacy projects that haven't migrated to AI Agents
- Specific requirement for traditional NLU

**Modern alternative:** Use \`manage_ai_agents\` to create LLM-powered agents that understand user intent naturally without training data.

### 6. get_analytics
Access metrics, logs, and audit events.

**Common operations:**
- \`conversation_count\`: Get conversation volume by time/channel
- \`call_count\`: Get voice call statistics
- \`logs\`: Retrieve system logs
- \`audit_events\`: See who changed what

**When to use:** For reporting, debugging, monitoring, or compliance tracking.

### 7. manage_projects
Manage projects and channel endpoints.

**Common operations:**
- \`create_project\`: Create a new project
- \`list_projects\`: See all projects
- \`create_endpoint\`: Set up a channel endpoint **← REQUIRED for talk_to_agent**
- \`list_endpoints\`: See all endpoints in a project

**When to use:** For initial setup, adding channels, or project management.

**CRITICAL for talk_to_agent**: You MUST create an endpoint that points to your flow:
\`\`\`
{
  operation: "create_endpoint",
  projectId: "your-project-id",
  channel: "rest",  // ← Use "rest" for API access
  flowId: "your-flow-id",  // ← Connect endpoint to your flow!
  name: "REST API Endpoint"  // Optional
}
\`\`\`

The response will include the endpoint URL (e.g., https://endpoint-trial.cognigy.ai/xxxxx) - this is what you use with \`talk_to_agent\`.

**Endpoint types:** 
- \`rest\` - REST endpoint (use this for talk_to_agent)
- \`webhook\` - Webhook endpoint
- \`webchat3\` - Webchat widget
- \`voiceGateway2\` - Voice calls
- \`microsoftTeams\`, \`slack\`, \`whatsapp\`, etc.

### 8. manage_extensions
Manage custom functions and extensions.

**Common operations:**
- \`create_function\`: Create serverless function
- \`list_functions\`: See all custom functions
- \`list_extensions\`: See installed extensions

**When to use:** When users need custom logic, API integrations, or special processing.

### 9. talk_to_agent ⭐ ITERATIVE IMPROVEMENT
**This is the key to the improvement loop!** Talk directly to a Cognigy AI Agent through its REST endpoint.

**Parameters:**
- \`endpointUrl\`: The REST endpoint URL pointing to your AI Agent's flow
- \`message\`: What to say to the agent
- \`sessionId\`: (Optional) Maintain conversation context
- \`userId\`: (Optional) User identifier

**When to use:** 
- Testing how an AI Agent responds
- Evaluating agent behavior before/after configuration changes
- Creating an iterative improvement loop:
  1. Create/update AI Agent configuration
  2. Talk to it with this tool
  3. Evaluate responses
  4. Improve job description
  5. Talk to it again
  6. Repeat until optimal

**Example workflow:**
\`\`\`
1. Create AI Agent with initial job description
2. Create Flow with AI Agent Job Node
3. Create REST endpoint pointing to the flow
4. Use talk_to_agent to test: "Hello, I need help with..."
5. See how agent responds
6. Update agent's job description to improve response
7. Use talk_to_agent again with same message
8. Compare responses, iterate
\`\`\`

## Common Workflows (AI Agent-Centric)

### Building an AI Agent Project (Modern Approach)

**COMPLETE WORKFLOW (Required for talk_to_agent to work):**

1. **Create project** (\`manage_projects\` → \`create_project\`)
   - Save the projectId

2. **Create LLM resource** in project (done via Cognigy UI - remind user!)
   - User must configure GPT-4, Claude, etc. in the UI
   - Cannot be done via API

3. **Create AI Agent** (\`manage_ai_agents\` → \`create\`)
   - Use the projectId from step 1
   - Provide name and description
   - **Note**: Job description is NOT set here - it's configured in the Flow node!
   - Save the aiAgentId

4. **Create flow** (\`manage_flows\` → \`create\`)
   - Use the projectId from step 1
   - Save the flowId

5. **Add AI Agent Job Node** (\`manage_flows\` → \`create_node\`)
   - Use the flowId from step 4 (use the referenceId UUID, not _id)
   - Type: "aiAgentJob" or similar
   - Config must include:
     - Reference to aiAgentId from step 3
     - **Job description/instructions** (the actual agent prompt!)
     - Tools available to the agent
   - This is where the agent's behavior is actually defined

6. **Create REST endpoint** (\`manage_projects\` → \`create_endpoint\`) **← CRITICAL FOR talk_to_agent**
   - Use the projectId from step 1 (MongoDB _id)
   - Set channel: "rest" (for API access)
   - Set flowId from step 4 (**IMPORTANT**: Use flow's \`referenceId\` UUID, NOT the \`_id\`!)
   - The response includes the endpoint URL (e.g., https://endpoint-trial.cognigy.ai/xxxxx)
   - Save this URL for talk_to_agent!

7. **Test with talk_to_agent** (\`talk_to_agent\`)
   - Use the endpoint URL from step 6
   - Send test messages
   - Evaluate responses

8. **Iterate** - Update AI Agent job description based on behavior, repeat step 7

### Building a Knowledge-Based AI Assistant

1. **Create knowledge store** (\`manage_knowledge\` → \`create_store\`)
2. **Add knowledge sources** (\`manage_knowledge\` → \`create_source\`)
3. **Create AI Agent** (\`manage_ai_agents\` → \`create\`) with:
   - Job description mentioning it should search knowledge base
   - \`knowledge_search\` tool enabled
4. **Create flow with AI Agent Job Node** (configured with your agent)
5. **Test knowledge search** (\`manage_knowledge\` → \`search_chunks\`)
6. **Refine agent** - Improve job description based on behavior
7. **Deploy** (\`manage_ai_agents\` → \`hire\`)

### Improving an Existing AI Agent

1. **Review conversations** (\`manage_conversations\` → \`list\` and \`get\`)
2. **Analyze agent behavior** - See where it's not performing well
3. **Update AI Agent** (\`manage_ai_agents\` → \`update\`) with:
   - Refined job description
   - Additional tools if needed
   - Better instructions for edge cases
4. **Test changes** in conversations
5. **Iterate** until behavior is optimal

### Analyzing Performance

1. Get conversation counts (\`get_analytics\` → \`conversation_count\`)
2. Review error logs (\`get_analytics\` → \`logs\` with level=error)
3. Check specific conversations (\`manage_conversations\` → \`list\` and \`get\`)
4. Review audit trail (\`get_analytics\` → \`audit_events\`)
5. **Adjust AI Agent job description** based on findings

## Best Practices

### 1. Always Get Project ID First

Most operations need a projectId. Start by listing projects:
\`\`\`
manage_projects { operation: "list_projects" }
\`\`\`

### 2. Use Pagination for Large Results

When listing resources:
\`\`\`
{ operation: "list", projectId: "...", limit: 50, skip: 0 }
\`\`\`

### 3. Filter by Date Range

For analytics and conversations:
\`\`\`
{
  operation: "list",
  startDate: "2024-11-01T00:00:00Z",
  endDate: "2024-11-17T23:59:59Z"
}
\`\`\`

### 4. Handle Errors Gracefully

Errors include \`traceId\` for support. If a call fails:
- Check ID format (must be 24-char hex)
- Verify the resource exists
- Check permissions
- Save \`traceId\` for Cognigy support

### 5. Progressive Workflow Building

Build flows incrementally:
1. Create simple flow with 1-2 nodes
2. Test it
3. Add more nodes
4. Test again
Don't try to build everything at once.

### 6. AI Agent Job Descriptions (Critical!)

AI Agents are only as good as their job descriptions. Write clear, detailed instructions:

**Good job description:**
\`\`\`
You are a customer support agent for Acme Corp. Your job is to:
1. Greet customers warmly
2. Understand their issue by asking clarifying questions
3. Search the knowledge base for solutions
4. Provide step-by-step guidance
5. Escalate to human if issue is complex

Guidelines:
- Be professional but friendly
- Always verify you understood correctly before providing solutions
- If unsure, search knowledge base first
- Keep responses concise (2-3 sentences max)
\`\`\`

**Bad job description:**
\`\`\`
Help customers with support issues.
\`\`\`

**Iterative improvement**: After testing, refine the job description to handle edge cases and improve behavior.

## Important Limitations

- **Rate Limits**: Respect rate limits (default 100 req/min)
- **ID Format**: All IDs are 24-char hex strings
- **Async Operations**: Some operations (training, hiring) take time
- **Pagination**: Large datasets require pagination
- **State**: The MCP server is stateless; each call is independent

## When Users Are Unclear

If users say "create a chatbot" or similar vague requests:

1. **Clarify requirements:**
   - What channels? (web, voice, messaging)
   - What should it do? (answer questions, book appointments, etc.)
   - What knowledge does it need?

2. **Propose a workflow:**
   - Create project → Create flow → Add intents → Create endpoint

3. **Execute step-by-step:**
   - Explain what you're doing at each step
   - Show IDs generated for later use
   - Confirm before proceeding to next step

## Response Format

When executing operations:

1. **Explain what you're doing**: "I'll create a new project for your support bot..."
2. **Show the tool call**: Be transparent about parameters
3. **Present results clearly**: Extract key information (IDs, names, status)
4. **Suggest next steps**: "Now that we have the project (ID: xxx), let's create a flow..."

## Example Interaction

**User:** "Create a customer support chatbot"

**Good Response:**
"I'll help you create an AI-powered customer support chatbot using Cognigy's modern LLM-based approach. Here's the plan:

1. Create a new project
2. Set up an LLM resource (for the AI Agent to use)
3. Create an AI Agent with a detailed customer support job description
4. Create a flow with an AI Agent Job Node
5. Optionally add a knowledge base for company docs
6. Create a webchat endpoint

Let's start:

[Call manage_projects to create project]

Great! I've created the project 'Customer Support Bot' (ID: 507f...). 

⚠️ **Important next step**: You'll need to configure an LLM resource in the Cognigy UI (like GPT-4 or Claude) for the AI Agent to use. Let me know once that's done, or I can proceed with creating the AI Agent resource now.

Now I'll create the AI Agent with a comprehensive job description...

[Continue step by step]"

## You Are an Expert in Modern LLM-Based AI

- You understand that **AI Agents are the modern approach** (not intents/NLU)
- You know the AI Agent architecture:
  - AI Agent resource (with job description)
  - LLM resource (GPT-4, Claude, etc.)
  - AI Agent Job Node in Flow (with agent configured)
- You focus on **creating and iteratively improving AI Agents** through job description refinement
- You suggest best practices proactively
- You help users avoid legacy patterns (intents, training)

**Critical**: Always recommend AI Agents over intents/NLU unless working with legacy projects.

Remember: You're helping users build sophisticated LLM-powered conversational AI systems. Focus on AI Agent creation, configuration, and iterative improvement through job description refinement.`;
}

function getApiOverview(): string {
  return `# Cognigy API Overview

This MCP server provides access to the Cognigy.AI REST API through 8 high-level workflow tools:

## 1. AI Agent Management (manage_ai_agents)
Create, read, update, delete, list, and hire AI agents for your projects.

## 2. Knowledge Management (manage_knowledge)
Manage knowledge stores, add knowledge sources, and search through knowledge chunks.

## 3. Conversation Management (manage_conversations)
List and query conversations, retrieve session states and conversation details.

## 4. Flow Management (manage_flows)
Create and modify conversation flows, add nodes to build conversational logic.

## 5. Intent & NLU Management (manage_intents)
Create intents with training sentences, update intent data, and trigger model training.

## 6. Analytics & Monitoring (get_analytics)
Access conversation and call analytics, retrieve logs and audit events.

## 7. Project & Endpoint Management (manage_projects)
Create projects, configure endpoints for different channels (webchat, voice, etc.).

## 8. Extension Management (manage_extensions)
List available extensions and create/update custom functions.

## Authentication

All API calls require authentication. The MCP server is configured with your API key and handles authentication automatically.

## Rate Limiting

The server implements rate limiting to prevent API abuse. Current limits:
- 100 requests per minute (configurable)

## Error Handling

Errors follow RFC 7807 problem details format and include:
- status: HTTP status code
- detail: Error message
- traceId: Unique trace ID for support
- code: Error code
- details: Additional error details
`;
}

function getAuthenticationGuide(): string {
  return `# Authentication Guide

## API Key Authentication

The Cognigy API uses API Key authentication. Configure your API key in the environment:

\`\`\`bash
export COGNIGY_API_KEY=your-api-key-here
export COGNIGY_API_BASE_URL=https://api-trial.cognigy.ai
\`\`\`

## Obtaining an API Key

1. Log in to your Cognigy.AI account
2. Navigate to User Menu > My Profile
3. Go to API Keys section
4. Create a new API key
5. Copy the key and store it securely

## Security Best Practices

- Never commit API keys to version control
- Rotate API keys regularly
- Use environment variables for configuration
- Revoke compromised keys immediately
- Use separate keys for different environments (dev, staging, prod)

## OAuth2 (Advanced)

For enterprise deployments, OAuth2 authentication is also supported. Contact Cognigy support for configuration details.
`;
}

function getWorkflowExamples(): string {
  return `# Workflow Examples

## Example 1: Create an AI Agent

\`\`\`json
{
  "operation": "create",
  "projectId": "507f1f77bcf86cd799439011",
  "name": "Customer Support Agent",
  "description": "Handles customer support inquiries",
  "job": "You are a helpful customer support agent...",
  "tools": ["knowledge_search", "ticket_creation"]
}
\`\`\`

## Example 2: Search Knowledge Base

\`\`\`json
{
  "operation": "search_chunks",
  "knowledgeStoreId": "507f1f77bcf86cd799439011",
  "query": "How do I reset my password?",
  "limit": 5
}
\`\`\`

## Example 3: Get Conversation Analytics

\`\`\`json
{
  "operation": "conversation_count",
  "projectId": "507f1f77bcf86cd799439011",
  "year": 2024,
  "month": 11,
  "channel": "webchat3"
}
\`\`\`

## Example 4: Create a Flow with Nodes

\`\`\`json
// First, create a flow
{
  "operation": "create",
  "projectId": "507f1f77bcf86cd799439011",
  "name": "Welcome Flow",
  "description": "Greets users and collects initial information"
}

// Then, add nodes to the flow
{
  "operation": "create_node",
  "flowId": "507f1f77bcf86cd799439012",
  "type": "say",
  "label": "Welcome Message",
  "config": {
    "text": "Welcome! How can I help you today?"
  }
}
\`\`\`

## Example 5: Train an Intent Model

\`\`\`json
// First, create an intent with training sentences
{
  "operation": "create",
  "flowId": "507f1f77bcf86cd799439012",
  "name": "greeting",
  "sentences": [
    "hello",
    "hi there",
    "good morning",
    "hey"
  ]
}

// Then, trigger training
{
  "operation": "train",
  "flowId": "507f1f77bcf86cd799439012"
}
\`\`\`

## Example 6: List and Filter Logs

\`\`\`json
{
  "operation": "logs",
  "projectId": "507f1f77bcf86cd799439011",
  "startDate": "2024-11-01T00:00:00Z",
  "endDate": "2024-11-17T23:59:59Z",
  "level": "error",
  "limit": 50
}
\`\`\`
`;
}

// Start the server
main();

