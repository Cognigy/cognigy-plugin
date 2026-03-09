export interface ToolDefinition {
  name: string;
  description: string;
  annotations: Record<string, unknown>;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export const tools: ToolDefinition[] = [
  // 1. create_ai_agent
  {
    name: 'create_ai_agent',
    description:
      'Create a complete AI Agent with auto-provisioned flow, AI Agent Job Node, and REST endpoint. Returns everything needed for talk_to_agent.\n\nIf projectId is omitted, a new project is auto-created using the agent name. An LLM resource should exist in the project (use setup_llm) for the agent to generate responses.\n\nReturns: agent, flow, endpoint objects, endpointUrl, llmStatus, and the projectId used.\nIf llmStatus is \'missing\', read cognigy://guide/agent-creation for next steps.',
    annotations: {
      title: 'Create AI Agent',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: '24-char hex project ID. Optional — if omitted, a new project is created automatically.',
        },
        name: {
          type: 'string',
          description: 'Agent name (1-200 chars)',
        },
        description: {
          type: 'string',
          description: "Agent description — defines the agent's persona and behavior",
        },
        knowledgeReferenceId: {
          type: 'string',
          description: 'UUID of a knowledge store to attach (optional)',
        },
      },
      required: ['name'],
    },
  },

  // 2. update_ai_agent
  {
    name: 'update_ai_agent',
    description:
      "Update an AI Agent's configuration to improve its behavior. Change the description to refine how the agent responds, update the job instructions, add/remove tools, or attach knowledge stores.\n\nRequires: aiAgentId (from create_ai_agent or list_resources { resourceType: 'agent' }).\nAfter updating, use talk_to_agent to test the changes.",
    annotations: {
      title: 'Update AI Agent',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        aiAgentId: {
          type: 'string',
          description: '24-char hex AI Agent ID (from create_ai_agent response or list_resources)',
        },
        name: { type: 'string', description: 'New agent name' },
        description: {
          type: 'string',
          description: 'New agent description — this is the primary way to change agent behavior',
        },
        job: {
          type: 'string',
          description: 'Job description text — detailed instructions for the agent',
        },
        tools: {
          type: 'array',
          items: { type: 'string' },
          description:
            "Tool reference IDs available to the agent. Use create_tool to create tools first, then attach them here. Use list_resources { resourceType: 'tool', aiAgentId } to see available tools.",
        },
      },
      required: ['aiAgentId'],
    },
  },

  // 3. setup_llm
  {
    name: 'setup_llm',
    description:
      "Create an LLM resource (GPT-4, Claude, etc.) in a project. An LLM resource must exist before an AI Agent can generate responses.\n\nFor valid provider names and model strings, read cognigy://guide/llm-providers.\nTo list existing LLMs: use list_resources { resourceType: 'llm_model', projectId }.\nTo delete: use delete_resource { resourceType: 'llm_model', id }.",
    annotations: {
      title: 'Setup LLM',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: '24-char hex project ID' },
        provider: {
          type: 'string',
          enum: ['openAI', 'azureOpenAI', 'anthropic', 'google', 'mistral'],
          description: "LLM provider (API values: 'openAI', 'azureOpenAI', 'anthropic', 'google', 'mistral').",
        },
        modelType: {
          type: 'string',
          description: "Model type string (e.g., 'gpt-4o', 'gpt-4o-mini', 'claude-sonnet-4-0', 'claude-opus-4-0', 'mistral-small-2503')",
        },
        name: {
          type: 'string',
          description: 'Display name for the LLM resource (defaults to modelType if omitted)',
        },
        apiKey: {
          type: 'string',
          description: 'Provider API key. A Connection will be auto-created from this key.',
        },
        connectionId: {
          type: 'string',
          description: 'Existing Cognigy Connection referenceId (UUID). Use instead of apiKey if a connection already exists.',
        },
        isDefault: {
          type: 'boolean',
          description: 'Set as project default (default: true)',
        },
      },
      required: ['projectId', 'provider', 'modelType'],
    },
  },

  // 4. talk_to_agent
  {
    name: 'talk_to_agent',
    description:
      "Send a message to a Cognigy AI Agent and get its response. Use this to test agent behavior during iterative development.\n\nThe endpointUrl comes from create_ai_agent or list_resources { resourceType: 'endpoint' }. Use the same sessionId across calls for multi-turn conversations.\n\nReturns: agentResponse text and sessionId. Add verbose: true for the full raw API response.",
    annotations: {
      title: 'Talk to Agent',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        endpointUrl: {
          type: 'string',
          description: 'REST endpoint URL (e.g., https://endpoint-trial.cognigy.ai/xxxxx)',
        },
        message: { type: 'string', description: 'Message to send to the agent' },
        sessionId: {
          type: 'string',
          description: 'Session ID for conversation continuity. Omit to start new session.',
        },
        userId: { type: 'string', description: "User identifier (defaults to 'mcp-user')" },
        data: { type: 'object', description: 'Additional data payload to send with the message' },
        verbose: {
          type: 'boolean',
          description: 'If true, include the full raw API response (default: false)',
        },
      },
      required: ['endpointUrl', 'message'],
    },
  },

  // 5. list_resources
  {
    name: 'list_resources',
    description:
      "List resources in a Cognigy project. Use this to discover projects, agents, flows, endpoints, LLM models, knowledge stores, conversations, extensions, functions, or tools.\n\nSet resourceType to 'project' to find projectIds (no projectId needed). 'tool' requires aiAgentId instead of projectId. All other types require projectId.\n\nReturns a paginated list with id, name, and type-specific fields.",
    annotations: {
      title: 'List Resources',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        resourceType: {
          type: 'string',
          enum: [
            'project', 'agent', 'flow', 'endpoint', 'llm_model',
            'knowledge_store', 'conversation', 'extension', 'function', 'tool',
          ],
          description: 'Type of resource to list',
        },
        projectId: {
          type: 'string',
          description: "24-char hex project ID. Required for all types except 'project' and 'tool'.",
        },
        aiAgentId: {
          type: 'string',
          description: "24-char hex AI Agent ID (tools only — lists tools in the agent's flow)",
        },
        startDate: { type: 'string', description: 'ISO 8601 date filter (conversations only)' },
        endDate: { type: 'string', description: 'ISO 8601 date filter (conversations only)' },
        channel: {
          type: 'string',
          description: "Channel filter, e.g. 'rest', 'webchat3' (conversations only)",
        },
        limit: { type: 'number', description: 'Results per page (1-100, default 25)' },
        skip: { type: 'number', description: 'Number of results to skip (default 0)' },
      },
      required: ['resourceType'],
    },
  },

  // 6. get_resource
  {
    name: 'get_resource',
    description:
      "Get detailed information about a single Cognigy resource. Use list_resources first to find IDs.\n\nSupports all list_resources types plus 'session_state' for session context data. Set raw: true for unfiltered API response.",
    annotations: {
      title: 'Get Resource',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        resourceType: {
          type: 'string',
          enum: [
            'agent', 'flow', 'endpoint', 'project', 'conversation',
            'session_state', 'llm_model', 'knowledge_store', 'extension', 'function',
          ],
          description: 'Type of resource to retrieve',
        },
        id: {
          type: 'string',
          description: 'Resource ID (24-char hex or session ID for conversation/session_state)',
        },
        projectId: {
          type: 'string',
          description: '24-char hex project ID. Required for endpoint lookups.',
        },
        raw: {
          type: 'boolean',
          description: 'If true, return unfiltered API response (default: false)',
        },
      },
      required: ['resourceType', 'id'],
    },
  },

  // 7. delete_resource
  {
    name: 'delete_resource',
    description:
      "Permanently delete a Cognigy resource. This cannot be undone.\n\nUse list_resources to verify the resource exists before deleting.\nSome types (endpoint) may require projectId. For 'tool' type, provide aiAgentId — the handler resolves and deletes the underlying flow node internally.",
    annotations: {
      title: 'Delete Resource',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        resourceType: {
          type: 'string',
          enum: ['agent', 'flow', 'endpoint', 'llm_model', 'knowledge_store', 'function', 'tool'],
          description: 'Type of resource to delete',
        },
        id: {
          type: 'string',
          description: '24-char hex resource ID (or toolId for tool type)',
        },
        projectId: {
          type: 'string',
          description: '24-char hex project ID (required for some types)',
        },
        aiAgentId: {
          type: 'string',
          description: '24-char hex AI Agent ID (required for tool type — needed to resolve the flow)',
        },
      },
      required: ['resourceType', 'id'],
    },
  },

  // 8. manage_knowledge
  {
    name: 'manage_knowledge',
    description:
      "Manage knowledge bases for RAG. Create stores, add sources (URLs or text), and list chunks to verify content.\n\nFor URL sources: provide type 'url' and url field — the page is scraped and ingested automatically.\nFor text sources: provide text field (type defaults to 'manual') — a source and chunk are created.\nTo verify content: use list_chunks with knowledgeStoreId (and optionally sourceId, filter).\n\nFor setup steps, read cognigy://guide/knowledge-setup.\nTo list stores: list_resources { resourceType: 'knowledge_store' }.\nTo delete: delete_resource { resourceType: 'knowledge_store', id }.",
    annotations: {
      title: 'Manage Knowledge',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['create_store', 'create_source', 'list_chunks'],
          description: 'create_store: new knowledge base. create_source: add content from URL or text. list_chunks: list/filter chunks in a source.',
        },
        projectId: {
          type: 'string',
          description: '24-char hex project ID (required for create_store)',
        },
        knowledgeStoreId: {
          type: 'string',
          description: '24-char hex store ID (required for create_source, list_chunks)',
        },
        sourceId: {
          type: 'string',
          description: '24-char hex source ID (optional for list_chunks — if omitted, uses the first source in the store)',
        },
        name: { type: 'string', description: 'Source or store name (required for create_store, optional for create_source)' },
        description: { type: 'string', description: 'Store or source description' },
        type: {
          type: 'string',
          enum: ['url', 'manual'],
          description: "Source type (create_source). 'url' scrapes a web page. 'manual' stores text directly. Defaults to 'url' if url is provided, otherwise 'manual'.",
        },
        url: {
          type: 'string',
          description: 'URL to scrape (required when type is url)',
        },
        text: {
          type: 'string',
          description: 'Text content to store as a knowledge chunk (required when type is manual)',
        },
        filter: { type: 'string', description: 'Text filter for list_chunks — matches against chunk text' },
        limit: { type: 'number', description: 'Max results (1-50)' },
      },
      required: ['operation'],
    },
  },

  // 9. create_tool
  {
    name: 'create_tool',
    description:
      "Create a tool as a child of an AI Agent's Job node. Tools extend what the agent can do.\n\nTool types:\n- tool: General-purpose tool with custom logic branch. Provide toolId, description, and optional parameters (JSON Schema).\n- knowledge: Search a Knowledge Store. Provide knowledgeStoreId, toolId, description.\n- send_email: Send emails. Provide toolId, description, recipient.\n- mcp: Connect to a remote MCP server. Provide mcpName, mcpServerUrl, timeout.\n\nPrerequisites: Agent must exist (created via create_ai_agent).\nTo list tools: list_resources { resourceType: 'tool', aiAgentId }.\nTo delete: delete_resource { resourceType: 'tool', id: toolId, aiAgentId }.\nAfter creating, use talk_to_agent to test.",
    annotations: {
      title: 'Create Tool',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        aiAgentId: {
          type: 'string',
          description:
            "24-char hex AI Agent ID (from create_ai_agent or list_resources { resourceType: 'agent' })",
        },
        toolType: {
          type: 'string',
          enum: ['tool', 'knowledge', 'send_email', 'mcp'],
          description: 'tool: general-purpose with custom logic. knowledge: search a Knowledge Store. send_email: send emails. mcp: connect to MCP server.',
        },
        name: {
          type: 'string',
          description: "Tool display name (e.g., 'Fetch Weather', 'Search FAQ')",
        },
        config: {
          type: 'object',
          description: 'Tool-specific configuration — fields depend on toolType.',
          properties: {
            toolId: { type: 'string', description: 'Tool identifier for the LLM (tool, knowledge, send_email)' },
            description: { type: 'string', description: 'Tool description for the LLM (tool, knowledge, send_email)' },
            parameters: { type: 'string', description: 'JSON Schema string defining tool parameters (tool only)' },
            knowledgeStoreId: { type: 'string', description: 'Knowledge store reference ID (knowledge only)' },
            topK: { type: 'number', description: 'Number of results to return (knowledge only, default varies)' },
            recipient: { type: 'string', description: 'Email recipient address(es) (send_email only)' },
            mcpServerUrl: { type: 'string', description: 'MCP server URL (mcp only)' },
            mcpName: { type: 'string', description: 'MCP connection name (mcp only)' },
            timeout: { type: 'number', description: 'Timeout in seconds (mcp only)' },
          },
        },
      },
      required: ['aiAgentId', 'toolType', 'name', 'config'],
    },
  },

  // 10. create_custom_http_tool
  {
    name: 'create_custom_http_tool',
    description:
      "Create a custom HTTP tool for an AI Agent. This creates an aiAgentJobTool node with an HTTP Request child node, and optional Code nodes for pre-processing (before the HTTP call) and/or post-processing (after the HTTP call).\n\nUse this when the agent needs to call an external API and optionally transform data before sending or after receiving.\n\nThe node hierarchy created:\n  aiAgentJobTool (the tool node the LLM sees)\n    └─ [Code node: pre-process] (optional — runs before HTTP call)\n    └─ HTTP Request node (makes the API call)\n    └─ [Code node: post-process] (optional — runs after HTTP call)\n\nPrerequisites: Agent must exist (created via create_ai_agent).\nAfter creating, use talk_to_agent to test.",
    annotations: {
      title: 'Create Custom HTTP Tool',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        aiAgentId: {
          type: 'string',
          description: "24-char hex AI Agent ID (from create_ai_agent or list_resources { resourceType: 'agent' })",
        },
        name: {
          type: 'string',
          description: "Tool display name (e.g., 'Fetch Weather', 'Create Order')",
        },
        toolId: {
          type: 'string',
          description: "Tool identifier the LLM uses to invoke this tool (e.g., 'fetch_weather', 'create_order')",
        },
        description: {
          type: 'string',
          description: 'Description shown to the LLM explaining what this tool does and when to use it',
        },
        parameters: {
          type: 'string',
          description: 'JSON Schema string defining the tool parameters the LLM can pass (optional)',
        },
        http: {
          type: 'object',
          description: 'HTTP Request configuration',
          properties: {
            url: { type: 'string', description: "HTTP endpoint URL (e.g., 'https://api.example.com/v1/data')" },
            method: {
              type: 'string',
              enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
              description: 'HTTP method (default: GET)',
            },
            headers: {
              type: 'object',
              description: 'HTTP headers as key-value pairs (e.g., { "Authorization": "Bearer ..." })',
            },
            body: {
              type: 'string',
              description: 'Request body template. Use Cognigy CognigyScript tokens like {{input.data.param}} for dynamic values.',
            },
          },
          required: ['url'],
        },
        preProcessCode: {
          type: 'string',
          description: "Optional JavaScript code to run BEFORE the HTTP request. Use this to transform input data, set headers dynamically, etc. The code runs in Cognigy's Code Node environment with access to `input`, `context`, `actions`, etc.",
        },
        postProcessCode: {
          type: 'string',
          description: "Optional JavaScript code to run AFTER the HTTP response. Use this to transform the response, extract fields, format data, etc. The code runs in Cognigy's Code Node environment with access to `input`, `context`, `actions`, etc.",
        },
      },
      required: ['aiAgentId', 'name', 'toolId', 'description', 'http'],
    },
  },

  // 11. update_tool
  {
    name: 'update_tool',
    description:
      "Update an existing tool node's configuration in an AI Agent's flow. Accepts the same config fields as create_tool and create_custom_http_tool.\n\nRequires: aiAgentId (to resolve the flow) and toolNodeId (the node ID from create_tool, create_custom_http_tool, or list_resources { resourceType: 'tool', aiAgentId }).\n\nYou can update the name (display label), tool-type-specific config, HTTP settings, and/or code node contents. For custom HTTP tools, if you provide http/preProcessCode/postProcessCode, the handler will also update the child HTTP Request and Code nodes.\n\nAfter updating, use talk_to_agent to test the changes.",
    annotations: {
      title: 'Update Tool',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        aiAgentId: {
          type: 'string',
          description: "24-char hex AI Agent ID (from create_ai_agent or list_resources { resourceType: 'agent' })",
        },
        toolNodeId: {
          type: 'string',
          description: "24-char hex tool node ID (from create_tool, create_custom_http_tool, or list_resources { resourceType: 'tool', aiAgentId })",
        },
        name: {
          type: 'string',
          description: 'New display name for the tool node (optional)',
        },
        toolType: {
          type: 'string',
          enum: ['tool', 'knowledge', 'send_email', 'mcp'],
          description: 'Tool type hint — helps the handler know which config fields to map. Optional if only updating name.',
        },
        config: {
          type: 'object',
          description: 'Tool-specific configuration — same fields as create_tool config. Merged with existing config on the node.',
          properties: {
            toolId: { type: 'string', description: 'Tool identifier for the LLM (tool, knowledge, send_email)' },
            description: { type: 'string', description: 'Tool description for the LLM (tool, knowledge, send_email)' },
            parameters: { type: 'string', description: 'JSON Schema string defining tool parameters (tool only)' },
            knowledgeStoreId: { type: 'string', description: 'Knowledge store reference ID (knowledge only)' },
            topK: { type: 'number', description: 'Number of results to return (knowledge only)' },
            recipient: { type: 'string', description: 'Email recipient address(es) (send_email only)' },
            mcpServerUrl: { type: 'string', description: 'MCP server URL (mcp only)' },
            mcpName: { type: 'string', description: 'MCP connection name (mcp only)' },
            timeout: { type: 'number', description: 'Timeout in seconds (mcp only)' },
          },
        },
        http: {
          type: 'object',
          description: 'Updated HTTP Request config — for custom HTTP tools. Updates the child HTTP Request node.',
          properties: {
            url: { type: 'string', description: 'HTTP endpoint URL' },
            method: {
              type: 'string',
              enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
              description: 'HTTP method',
            },
            headers: {
              type: 'object',
              description: 'HTTP headers as key-value pairs',
            },
            body: {
              type: 'string',
              description: 'Request body template',
            },
          },
        },
        preProcessCode: {
          type: 'string',
          description: 'Updated JavaScript code for the pre-process Code node (custom HTTP tools only). Updates the existing pre-process child node.',
        },
        postProcessCode: {
          type: 'string',
          description: 'Updated JavaScript code for the post-process Code node (custom HTTP tools only). Updates the existing post-process child node.',
        },
      },
      required: ['aiAgentId', 'toolNodeId'],
    },
  },
];
