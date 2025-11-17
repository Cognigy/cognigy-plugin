/**
 * Tool definitions for the MCP server
 */

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * MCP Tool Definitions - 8 high-level workflow tools
 */
export const tools: ToolDefinition[] = [
  // 1. AI Agent Management
  {
    name: 'manage_ai_agents',
    description: 'Create, read, update, delete, list, or hire AI agents. Supports operations: create, get, update, delete, list, hire.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['create', 'get', 'update', 'delete', 'list', 'hire'],
          description: 'The operation to perform',
        },
        projectId: {
          type: 'string',
          description: 'The project ID (24-character hex string, required for create/list)',
        },
        aiAgentId: {
          type: 'string',
          description: 'The AI agent ID (24-character hex string, required for get/update/delete/hire)',
        },
        name: {
          type: 'string',
          description: 'Name of the AI agent (required for create)',
        },
        description: {
          type: 'string',
          description: 'Description of the AI agent',
        },
        job: {
          type: 'string',
          description: 'Job description for the AI agent',
        },
        tools: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tools available to the AI agent',
        },
        limit: {
          type: 'number',
          description: 'Pagination limit (1-100)',
        },
        skip: {
          type: 'number',
          description: 'Pagination skip offset',
        },
      },
      required: ['operation'],
    },
  },

  // 2. Knowledge Management
  {
    name: 'manage_knowledge',
    description: 'Manage knowledge stores, sources, and search knowledge chunks. Operations: create_store, create_source, search_chunks, list_stores.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['create_store', 'create_source', 'search_chunks', 'list_stores'],
          description: 'The operation to perform',
        },
        projectId: {
          type: 'string',
          description: 'The project ID (required for create_store/list_stores)',
        },
        knowledgeStoreId: {
          type: 'string',
          description: 'Knowledge store ID (required for create_source/search_chunks)',
        },
        name: {
          type: 'string',
          description: 'Name of the knowledge store (required for create_store)',
        },
        description: {
          type: 'string',
          description: 'Description',
        },
        embeddingModel: {
          type: 'string',
          description: 'Embedding model to use',
        },
        type: {
          type: 'string',
          enum: ['url', 'file', 'text'],
          description: 'Type of knowledge source (required for create_source)',
        },
        content: {
          type: 'string',
          description: 'Content for the knowledge source (URL, file path, or text)',
        },
        query: {
          type: 'string',
          description: 'Search query (required for search_chunks)',
        },
        limit: {
          type: 'number',
          description: 'Result limit',
        },
      },
      required: ['operation'],
    },
  },

  // 3. Conversation Management
  {
    name: 'manage_conversations',
    description: 'List conversations, get conversation details, or retrieve session state. Operations: list, get, get_session_state.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['list', 'get', 'get_session_state'],
          description: 'The operation to perform',
        },
        projectId: {
          type: 'string',
          description: 'The project ID (required for list)',
        },
        sessionId: {
          type: 'string',
          description: 'The session ID (required for get/get_session_state)',
        },
        startDate: {
          type: 'string',
          description: 'Filter by start date (ISO 8601)',
        },
        endDate: {
          type: 'string',
          description: 'Filter by end date (ISO 8601)',
        },
        channel: {
          type: 'string',
          description: 'Filter by channel (e.g., webchat3, voiceGateway2)',
        },
        limit: {
          type: 'number',
          description: 'Pagination limit',
        },
        skip: {
          type: 'number',
          description: 'Pagination skip',
        },
      },
      required: ['operation'],
    },
  },

  // 4. Flow Management
  {
    name: 'manage_flows',
    description: 'Create, update, list flows and create flow nodes. Operations: create, update, list, create_node.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['create', 'update', 'list', 'create_node'],
          description: 'The operation to perform',
        },
        projectId: {
          type: 'string',
          description: 'The project ID (required for create/list)',
        },
        flowId: {
          type: 'string',
          description: 'The flow ID (required for update/create_node)',
        },
        name: {
          type: 'string',
          description: 'Flow name',
        },
        description: {
          type: 'string',
          description: 'Flow description',
        },
        type: {
          type: 'string',
          description: 'Node type (required for create_node)',
        },
        label: {
          type: 'string',
          description: 'Node label',
        },
        config: {
          type: 'object',
          description: 'Node configuration',
        },
        limit: {
          type: 'number',
          description: 'Pagination limit',
        },
        skip: {
          type: 'number',
          description: 'Pagination skip',
        },
      },
      required: ['operation'],
    },
  },

  // 5. Intent & NLU Management
  {
    name: 'manage_intents',
    description: 'Create, update, list intents and train NLU models. Operations: create, update, list, train.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['create', 'update', 'list', 'train'],
          description: 'The operation to perform',
        },
        flowId: {
          type: 'string',
          description: 'The flow ID (required for create/list/train)',
        },
        intentId: {
          type: 'string',
          description: 'The intent ID (required for update)',
        },
        name: {
          type: 'string',
          description: 'Intent name',
        },
        sentences: {
          type: 'array',
          items: { type: 'string' },
          description: 'Training sentences for the intent',
        },
        localeId: {
          type: 'string',
          description: 'Locale ID for training',
        },
        limit: {
          type: 'number',
          description: 'Pagination limit',
        },
        skip: {
          type: 'number',
          description: 'Pagination skip',
        },
      },
      required: ['operation'],
    },
  },

  // 6. Analytics & Monitoring
  {
    name: 'get_analytics',
    description: 'Get analytics data, logs, and audit events. Operations: conversation_count, call_count, logs, audit_events.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['conversation_count', 'call_count', 'logs', 'audit_events'],
          description: 'The operation to perform',
        },
        projectId: {
          type: 'string',
          description: 'The project ID (required)',
        },
        year: {
          type: 'number',
          description: 'Year for analytics (required for conversation_count/call_count)',
        },
        month: {
          type: 'number',
          description: 'Month for analytics (1-12)',
        },
        channel: {
          type: 'string',
          description: 'Channel filter',
        },
        startDate: {
          type: 'string',
          description: 'Start date filter (ISO 8601)',
        },
        endDate: {
          type: 'string',
          description: 'End date filter (ISO 8601)',
        },
        level: {
          type: 'string',
          enum: ['debug', 'info', 'warn', 'error'],
          description: 'Log level filter',
        },
        userId: {
          type: 'string',
          description: 'User ID filter for audit events',
        },
        limit: {
          type: 'number',
          description: 'Pagination limit',
        },
        skip: {
          type: 'number',
          description: 'Pagination skip',
        },
      },
      required: ['operation', 'projectId'],
    },
  },

  // 7. Project & Endpoint Management
  {
    name: 'manage_projects',
    description: 'Create and list projects, create and list endpoints. Operations: create_project, list_projects, create_endpoint, list_endpoints.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['create_project', 'list_projects', 'create_endpoint', 'list_endpoints'],
          description: 'The operation to perform',
        },
        projectId: {
          type: 'string',
          description: 'The project ID (required for create_endpoint/list_endpoints)',
        },
        name: {
          type: 'string',
          description: 'Name (required for create_project/create_endpoint)',
        },
        description: {
          type: 'string',
          description: 'Description',
        },
        defaultLocale: {
          type: 'string',
          description: 'Default locale for project',
        },
        channel: {
          type: 'string',
          description: 'Channel type: "rest", "webchat3", "voiceGateway2", etc. (required for create_endpoint)',
        },
        flowId: {
          type: 'string',
          description: 'Flow ID to connect to the endpoint (required for create_endpoint)',
        },
        settings: {
          type: 'object',
          description: 'Optional endpoint settings/configuration',
        },
        limit: {
          type: 'number',
          description: 'Pagination limit',
        },
        skip: {
          type: 'number',
          description: 'Pagination skip',
        },
      },
      required: ['operation'],
    },
  },

  // 8. Extension Management
  {
    name: 'manage_extensions',
    description: 'List extensions and manage custom functions. Operations: list_extensions, create_function, update_function, list_functions.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['list_extensions', 'create_function', 'update_function', 'list_functions'],
          description: 'The operation to perform',
        },
        projectId: {
          type: 'string',
          description: 'The project ID (required)',
        },
        functionId: {
          type: 'string',
          description: 'The function ID (required for update_function)',
        },
        name: {
          type: 'string',
          description: 'Function name',
        },
        code: {
          type: 'string',
          description: 'Function code',
        },
        description: {
          type: 'string',
          description: 'Function description',
        },
        limit: {
          type: 'number',
          description: 'Pagination limit',
        },
        skip: {
          type: 'number',
          description: 'Pagination skip',
        },
      },
      required: ['operation', 'projectId'],
    },
  },

  // 9. Talk to AI Agent (Iterative Improvement Loop)
  {
    name: 'talk_to_agent',
    description: 'Send a message to a Cognigy AI Agent through its REST endpoint and get the response. Use this to test agent behavior, iterate on improvements, and create a feedback loop. Perfect for testing how an AI Agent responds before and after configuration changes.',
    inputSchema: {
      type: 'object',
      properties: {
        endpointUrl: {
          type: 'string',
          description: 'The REST endpoint URL (e.g., https://endpoint-trial.cognigy.ai/xxxxx)',
        },
        message: {
          type: 'string',
          description: 'The message to send to the AI Agent',
        },
        sessionId: {
          type: 'string',
          description: 'Optional session ID to maintain conversation context. Use same ID for follow-up messages.',
        },
        userId: {
          type: 'string',
          description: 'Optional user ID to identify the conversation participant',
        },
        data: {
          type: 'object',
          description: 'Optional additional data to send with the message',
        },
      },
      required: ['endpointUrl', 'message'],
    },
  },
];

