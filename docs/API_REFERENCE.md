# API Reference

Complete reference for all MCP tools provided by the Cognigy MCP Server.

## Tool: `manage_ai_agents`

Manage AI agents in your Cognigy projects.

### Operations

#### create

Create a new AI agent.

**Parameters:**
- `projectId` (string, required): Project ID (24-char hex)
- `name` (string, required): Agent name (1-200 chars)
- `description` (string, optional): Agent description
- `job` (string, optional): Job description/instructions
- `tools` (array, optional): Available tools for the agent

**Example:**
```json
{
  "operation": "create",
  "projectId": "507f1f77bcf86cd799439011",
  "name": "Support Agent",
  "description": "Handles customer support",
  "job": "You are a helpful support agent...",
  "tools": ["knowledge_search"]
}
```

#### get

Get details of a specific AI agent.

**Parameters:**
- `aiAgentId` (string, required): AI agent ID

#### update

Update an existing AI agent.

**Parameters:**
- `aiAgentId` (string, required): AI agent ID
- `name` (string, optional): New name
- `description` (string, optional): New description
- `job` (string, optional): New job description
- `tools` (array, optional): New tools list

#### delete

Delete an AI agent.

**Parameters:**
- `aiAgentId` (string, required): AI agent ID

#### list

List all AI agents in a project.

**Parameters:**
- `projectId` (string, required): Project ID
- `limit` (number, optional): Results per page (1-100)
- `skip` (number, optional): Results to skip

#### hire

Hire an AI agent using a template.

**Parameters:**
- `aiAgentId` (string, required): AI agent ID
- `templateId` (string, optional): Template ID

---

## Tool: `manage_knowledge`

Manage knowledge stores and search knowledge bases.

### Operations

#### create_store

Create a new knowledge store.

**Parameters:**
- `projectId` (string, required): Project ID
- `name` (string, required): Store name
- `description` (string, optional): Store description
- `embeddingModel` (string, optional): Embedding model to use

#### create_source

Add a knowledge source to a store.

**Parameters:**
- `knowledgeStoreId` (string, required): Knowledge store ID
- `type` (string, required): Source type (`url`, `file`, or `text`)
- `content` (string, required): Source content (URL, file path, or text)
- `metadata` (object, optional): Additional metadata

**Example:**
```json
{
  "operation": "create_source",
  "knowledgeStoreId": "507f1f77bcf86cd799439011",
  "type": "url",
  "content": "https://docs.example.com/faq",
  "metadata": {
    "category": "FAQ"
  }
}
```

#### search_chunks

Search for knowledge chunks.

**Parameters:**
- `knowledgeStoreId` (string, required): Knowledge store ID
- `query` (string, required): Search query
- `limit` (number, optional): Max results (1-50)

#### list_stores

List all knowledge stores in a project.

**Parameters:**
- `projectId` (string, required): Project ID

---

## Tool: `manage_conversations`

Query and retrieve conversation data.

### Operations

#### list

List conversations in a project.

**Parameters:**
- `projectId` (string, required): Project ID
- `startDate` (string, optional): Start date (ISO 8601)
- `endDate` (string, optional): End date (ISO 8601)
- `channel` (string, optional): Filter by channel
- `limit` (number, optional): Results per page
- `skip` (number, optional): Results to skip

**Example:**
```json
{
  "operation": "list",
  "projectId": "507f1f77bcf86cd799439011",
  "startDate": "2024-11-01T00:00:00Z",
  "endDate": "2024-11-17T23:59:59Z",
  "channel": "webchat3",
  "limit": 50
}
```

#### get

Get details of a specific conversation.

**Parameters:**
- `sessionId` (string, required): Session ID

#### get_session_state

Get the current state of a session.

**Parameters:**
- `sessionId` (string, required): Session ID

---

## Tool: `manage_flows`

Create and modify conversation flows.

### Operations

#### create

Create a new flow.

**Parameters:**
- `projectId` (string, required): Project ID
- `name` (string, required): Flow name
- `description` (string, optional): Flow description

#### update

Update an existing flow.

**Parameters:**
- `flowId` (string, required): Flow ID
- `name` (string, optional): New name
- `description` (string, optional): New description

#### list

List all flows in a project.

**Parameters:**
- `projectId` (string, required): Project ID
- `limit` (number, optional): Results per page
- `skip` (number, optional): Results to skip

#### create_node

Create a node in a flow.

**Parameters:**
- `flowId` (string, required): Flow ID
- `type` (string, required): Node type
- `label` (string, optional): Node label
- `config` (object, optional): Node configuration

**Example:**
```json
{
  "operation": "create_node",
  "flowId": "507f1f77bcf86cd799439011",
  "type": "say",
  "label": "Welcome Message",
  "config": {
    "text": "Welcome to our support!",
    "channel": "all"
  }
}
```

---

## Tool: `manage_intents`

Manage intents and train NLU models.

### Operations

#### create

Create a new intent.

**Parameters:**
- `flowId` (string, required): Flow ID
- `name` (string, required): Intent name
- `sentences` (array, optional): Training sentences

#### update

Update an existing intent.

**Parameters:**
- `intentId` (string, required): Intent ID
- `name` (string, optional): New name
- `sentences` (array, optional): New training sentences

#### list

List all intents in a flow.

**Parameters:**
- `flowId` (string, required): Flow ID
- `limit` (number, optional): Results per page
- `skip` (number, optional): Results to skip

#### train

Trigger NLU model training.

**Parameters:**
- `flowId` (string, required): Flow ID
- `localeId` (string, optional): Specific locale to train

---

## Tool: `get_analytics`

Retrieve analytics, logs, and audit events.

### Operations

#### conversation_count

Get conversation count for a time period.

**Parameters:**
- `projectId` (string, required): Project ID
- `year` (number, required): Year (e.g., 2024)
- `month` (number, optional): Month (1-12)
- `channel` (string, optional): Filter by channel

#### call_count

Get call count for a time period.

**Parameters:**
- `projectId` (string, required): Project ID
- `year` (number, required): Year
- `month` (number, optional): Month (1-12)

#### logs

Retrieve system logs.

**Parameters:**
- `projectId` (string, required): Project ID
- `startDate` (string, optional): Start date (ISO 8601)
- `endDate` (string, optional): End date (ISO 8601)
- `level` (string, optional): Log level (`debug`, `info`, `warn`, `error`)
- `limit` (number, optional): Results per page
- `skip` (number, optional): Results to skip

#### audit_events

Retrieve audit events.

**Parameters:**
- `projectId` (string, required): Project ID
- `startDate` (string, optional): Start date (ISO 8601)
- `endDate` (string, optional): End date (ISO 8601)
- `userId` (string, optional): Filter by user ID
- `limit` (number, optional): Results per page
- `skip` (number, optional): Results to skip

---

## Tool: `manage_projects`

Manage projects and endpoints.

### Operations

#### create_project

Create a new project.

**Parameters:**
- `name` (string, required): Project name
- `description` (string, optional): Project description
- `defaultLocale` (string, optional): Default locale code

#### list_projects

List all accessible projects.

**Parameters:**
- `limit` (number, optional): Results per page
- `skip` (number, optional): Results to skip

#### create_endpoint

Create a new endpoint in a project.

**Parameters:**
- `projectId` (string, required): Project ID
- `name` (string, required): Endpoint name
- `type` (string, required): Endpoint type
- `config` (object, optional): Endpoint configuration

**Example:**
```json
{
  "operation": "create_endpoint",
  "projectId": "507f1f77bcf86cd799439011",
  "name": "Webchat Endpoint",
  "type": "webchat3",
  "config": {
    "enabled": true,
    "settings": {
      "primaryColor": "#007bff"
    }
  }
}
```

#### list_endpoints

List all endpoints in a project.

**Parameters:**
- `projectId` (string, required): Project ID
- `limit` (number, optional): Results per page
- `skip` (number, optional): Results to skip

---

## Tool: `manage_extensions`

Manage extensions and custom functions.

### Operations

#### list_extensions

List all available extensions.

**Parameters:**
- `projectId` (string, required): Project ID
- `limit` (number, optional): Results per page
- `skip` (number, optional): Results to skip

#### create_function

Create a custom function.

**Parameters:**
- `projectId` (string, required): Project ID
- `name` (string, required): Function name
- `code` (string, required): Function code
- `description` (string, optional): Function description

**Example:**
```json
{
  "operation": "create_function",
  "projectId": "507f1f77bcf86cd799439011",
  "name": "calculateDiscount",
  "code": "const discount = input.price * 0.1; return { discount };",
  "description": "Calculates 10% discount"
}
```

#### update_function

Update an existing function.

**Parameters:**
- `functionId` (string, required): Function ID
- `name` (string, optional): New name
- `code` (string, optional): New code
- `description` (string, optional): New description

#### list_functions

List all custom functions.

**Parameters:**
- `projectId` (string, required): Project ID
- `limit` (number, optional): Results per page
- `skip` (number, optional): Results to skip

---

## Common Parameters

### Pagination

Most list operations support pagination:

- `limit`: Number of results per page (default: 50, max: 100)
- `skip`: Number of results to skip (default: 0)

### Date Formats

All dates use ISO 8601 format:

```
2024-11-17T10:30:00Z
```

### ID Format

All IDs are 24-character hexadecimal strings:

```
507f1f77bcf86cd799439011
```

## Error Handling

All errors follow RFC 7807 Problem Details format:

```json
{
  "type": "Bad Request",
  "title": "Bad Request Error",
  "status": 400,
  "detail": "Validation failed. Missing required field: name",
  "instance": "/v2.0/projects",
  "code": "1000",
  "traceId": "api--f84324f4-98eb-4f02-abdd-375a2e6c3c1f",
  "details": {}
}
```

### Common HTTP Status Codes

- `200`: Success
- `400`: Bad Request (validation error)
- `401`: Unauthorized (invalid/missing API key)
- `402`: Payment Required (quota exceeded)
- `403`: Forbidden (insufficient permissions)
- `404`: Not Found
- `429`: Too Many Requests (rate limit)
- `500`: Internal Server Error

