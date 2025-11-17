# Usage Guide

## Quick Start

### 1. Installation

```bash
cd /Users/dscheier/Workspace/cognigy/services/mcp-server
npm install
npm run build
```

### 2. Configuration

Create a `.env` file:

```bash
cp env.template .env
```

Edit `.env` with your Cognigy credentials:

```env
COGNIGY_API_BASE_URL=https://api-trial.cognigy.ai
COGNIGY_API_KEY=your-api-key-here
LOG_LEVEL=info
```

### 3. Start the Server

```bash
npm start
```

## Using with Claude Desktop

Add to your Claude Desktop MCP configuration (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "cognigy": {
      "command": "node",
      "args": [
        "/Users/dscheier/Workspace/cognigy/services/mcp-server/dist/index.js"
      ],
      "env": {
        "COGNIGY_API_BASE_URL": "https://api-trial.cognigy.ai",
        "COGNIGY_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

Restart Claude Desktop. You should now see Cognigy tools available.

## Common Workflows

### Workflow 1: Create and Configure a Project

```typescript
// 1. Create a project
{
  tool: "manage_projects",
  operation: "create_project",
  name: "Customer Support Bot",
  description: "24/7 customer support automation"
}

// 2. Create a flow
{
  tool: "manage_flows",
  operation: "create",
  projectId: "PROJECT_ID_FROM_STEP_1",
  name: "Main Flow"
}

// 3. Add nodes to the flow
{
  tool: "manage_flows",
  operation: "create_node",
  flowId: "FLOW_ID_FROM_STEP_2",
  type: "say",
  label: "Welcome",
  config: {
    text: "Welcome to support!"
  }
}

// 4. Create an endpoint
{
  tool: "manage_projects",
  operation: "create_endpoint",
  projectId: "PROJECT_ID_FROM_STEP_1",
  name: "Webchat",
  type: "webchat3"
}
```

### Workflow 2: Set Up Knowledge Base

```typescript
// 1. Create a knowledge store
{
  tool: "manage_knowledge",
  operation: "create_store",
  projectId: "YOUR_PROJECT_ID",
  name: "Product Documentation",
  description: "All product docs and FAQs"
}

// 2. Add knowledge sources
{
  tool: "manage_knowledge",
  operation: "create_source",
  knowledgeStoreId: "STORE_ID_FROM_STEP_1",
  type: "url",
  content: "https://docs.example.com/faq"
}

// 3. Search knowledge
{
  tool: "manage_knowledge",
  operation: "search_chunks",
  knowledgeStoreId: "STORE_ID_FROM_STEP_1",
  query: "How to reset password?",
  limit: 5
}
```

### Workflow 3: Train an Intent Model

```typescript
// 1. Create intents with training data
{
  tool: "manage_intents",
  operation: "create",
  flowId: "YOUR_FLOW_ID",
  name: "greeting",
  sentences: [
    "hello",
    "hi",
    "good morning",
    "hey there"
  ]
}

{
  tool: "manage_intents",
  operation: "create",
  flowId: "YOUR_FLOW_ID",
  name: "help",
  sentences: [
    "I need help",
    "can you assist me",
    "support please"
  ]
}

// 2. Train the model
{
  tool: "manage_intents",
  operation: "train",
  flowId: "YOUR_FLOW_ID"
}
```

### Workflow 4: Monitor and Analyze

```typescript
// 1. Get conversation statistics
{
  tool: "get_analytics",
  operation: "conversation_count",
  projectId: "YOUR_PROJECT_ID",
  year: 2024,
  month: 11
}

// 2. Check error logs
{
  tool: "get_analytics",
  operation: "logs",
  projectId: "YOUR_PROJECT_ID",
  level: "error",
  startDate: "2024-11-01T00:00:00Z",
  endDate: "2024-11-17T23:59:59Z"
}

// 3. Review audit events
{
  tool: "get_analytics",
  operation: "audit_events",
  projectId: "YOUR_PROJECT_ID",
  startDate: "2024-11-01T00:00:00Z"
}
```

### Workflow 5: Deploy AI Agents

```typescript
// 1. Create an AI agent
{
  tool: "manage_ai_agents",
  operation: "create",
  projectId: "YOUR_PROJECT_ID",
  name: "Sales Assistant",
  description: "Helps with product recommendations",
  job: "You are a knowledgeable sales assistant...",
  tools: ["knowledge_search", "product_catalog"]
}

// 2. Configure the agent
{
  tool: "manage_ai_agents",
  operation: "update",
  aiAgentId: "AGENT_ID_FROM_STEP_1",
  job: "Updated instructions...",
  tools: ["knowledge_search", "product_catalog", "order_tracking"]
}

// 3. Hire the agent (deploy)
{
  tool: "manage_ai_agents",
  operation: "hire",
  aiAgentId: "AGENT_ID_FROM_STEP_1"
}
```

## Tips and Best Practices

### 1. Use Pagination for Large Datasets

When listing resources, always use pagination:

```typescript
{
  tool: "manage_conversations",
  operation: "list",
  projectId: "YOUR_PROJECT_ID",
  limit: 50,
  skip: 0  // Start at 0, then 50, 100, etc.
}
```

### 2. Filter by Date Range

Use date filters to limit results:

```typescript
{
  tool: "get_analytics",
  operation: "logs",
  projectId: "YOUR_PROJECT_ID",
  startDate: "2024-11-01T00:00:00Z",
  endDate: "2024-11-17T23:59:59Z"
}
```

### 3. Handle Errors Gracefully

All errors include a `traceId`. Save this for support:

```typescript
try {
  // Make tool call
} catch (error) {
  console.error('Error:', error.message);
  console.error('TraceID:', error.traceId); // Use this when contacting support
}
```

### 4. Monitor Rate Limits

Be aware of rate limits. The server will return:

```json
{
  "error": "Rate limit exceeded",
  "remaining": 0
}
```

### 5. Use Environment-Specific API Keys

Never use production API keys in development:

```bash
# Development
COGNIGY_API_KEY=dev_key_123

# Production
COGNIGY_API_KEY=prod_key_456
```

## Advanced Usage

### Custom Functions

Create serverless functions for custom logic:

```typescript
{
  tool: "manage_extensions",
  operation: "create_function",
  projectId: "YOUR_PROJECT_ID",
  name: "calculateShipping",
  code: `
    const calculateShipping = (input) => {
      const { weight, destination } = input;
      let cost = 5.00; // Base cost
      
      if (weight > 10) {
        cost += (weight - 10) * 0.5;
      }
      
      if (destination === 'international') {
        cost *= 2;
      }
      
      return { cost };
    };
    
    return calculateShipping(input);
  `,
  description: "Calculates shipping cost based on weight and destination"
}
```

### Bulk Operations

For bulk operations, make multiple calls:

```typescript
const intents = [
  { name: "greeting", sentences: ["hello", "hi"] },
  { name: "farewell", sentences: ["bye", "goodbye"] },
  { name: "help", sentences: ["help me", "I need assistance"] }
];

for (const intent of intents) {
  await callTool("manage_intents", {
    operation: "create",
    flowId: "YOUR_FLOW_ID",
    ...intent
  });
}
```

### Complex Flow Building

Build sophisticated flows programmatically:

```typescript
// Create main flow
const mainFlow = await callTool("manage_flows", {
  operation: "create",
  projectId: "YOUR_PROJECT_ID",
  name: "Main Support Flow"
});

// Add nodes sequentially
const nodes = [
  { type: "say", label: "Welcome", config: { text: "Welcome!" } },
  { type: "question", label: "Ask Name", config: { text: "What's your name?" } },
  { type: "say", label: "Greet", config: { text: "Nice to meet you!" } }
];

for (const node of nodes) {
  await callTool("manage_flows", {
    operation: "create_node",
    flowId: mainFlow._id,
    ...node
  });
}
```

## Troubleshooting

### Issue: "COGNIGY_API_KEY environment variable is required"

**Solution:** Ensure your `.env` file is in the correct location and contains the API key.

### Issue: "Rate limit exceeded"

**Solution:** Wait before making more requests or increase the rate limit configuration.

### Issue: "Invalid ID format"

**Solution:** Ensure all IDs are 24-character hexadecimal strings.

### Issue: Connection timeout

**Solution:** Check network connectivity and verify the API base URL is correct.

## Getting Help

- **Documentation**: See `docs/API_REFERENCE.md` for complete API reference
- **Deployment**: See `docs/DEPLOYMENT.md` for deployment options
- **GitHub Issues**: Report bugs and request features
- **Cognigy Support**: support@cognigy.com for API-related issues

