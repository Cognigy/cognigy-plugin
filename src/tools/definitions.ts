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
      'Create a complete AI Agent with auto-provisioned flow, AI Agent Job Node, and REST endpoint. Returns everything needed for talk_to_agent.\n\nBEFORE USING THIS TOOL: Read cognigy://guide/agent-creation for the full setup workflow, prerequisites, and required steps.\n\nIf projectId is omitted, a new project is auto-created using the agent name.\n\nLLM SETUP (required for the agent to generate responses):\n1. Use setup_llm to create an LLM resource in the project (with isDefault: true, the default).\n2. If the LLM is not set as default, assign it via update_ai_agent { aiAgentId, jobConfig: { llmProviderReferenceId: "<llm referenceId>" } }.\n\nKNOWLEDGE: If knowledgeStoreReferenceId is provided, a knowledge search tool is automatically created on the agent\'s Job Node. This is the preferred way to give agents access to knowledge stores.\n\nReturns: agent, flow, endpoint objects, endpointUrl, llmStatus, and the projectId used. If a knowledge tool was created, it is included in the response.\nIf llmStatus is \'missing\', read cognigy://guide/agent-creation for next steps.',
    annotations: {
      title: 'Create AI Agent',
      readOnlyHint: false,
      destructiveHint: true,
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
        knowledgeStoreReferenceId: {
          type: 'string',
          description: 'Reference ID of a knowledge store to attach as a knowledge search tool on the agent (optional). This automatically creates a knowledge tool on the AI Agent Job Node. Use manage_knowledge { operation: "create_store" } first to get the store reference ID.',
        },
      },
      required: ['name'],
    },
  },

  // 2. update_ai_agent
  {
    name: 'update_ai_agent',
    description:
      "Update an AI Agent's configuration. This tool updates both the AI Agent resource and the AI Agent Job Node config.\n\nUSE ALL RELEVANT FIELDS — do not put everything in description alone. Distribute configuration across the appropriate fields:\n\nAGENT-LEVEL FIELDS (the agent's identity):\n- name: Display name\n- description: Agent PERSONA — who the agent is, personality, tone, and high-level behavior. This is the primary identity field.\n- instructions: Agent GUARDRAILS — high-level constraints and policies (up to 1000 chars). Things the agent must always/never do.\n\nJOB-LEVEL FIELDS (jobConfig — how the agent performs its job):\n- jobName: Job title / role name (e.g., 'Customer Support Specialist')\n- jobDescription: Detailed responsibilities, scope, expertise areas, and what tools are available for this job\n- jobInstructions: Step-by-step procedures, output format requirements, decision trees for the job\n- llmProviderReferenceId: LLM to use (from setup_llm or list_resources { resourceType: 'llm_model' })\n- temperature: 0-1, lower = more deterministic (default: 0.7)\n- maxTokens: 100-8000 (default: 4000)\n\nKNOWLEDGE: Always use create_tool { toolType: 'knowledge' } to attach knowledge stores as tools. Only use persona-level knowledge if the user explicitly requests it.\n\nRead cognigy://guide/agent-creation for the full field reference, examples, and how the fields work together.\n\nRequires: aiAgentId (from create_ai_agent or list_resources { resourceType: 'agent' }).\nAfter updating, use talk_to_agent to test the changes.",
    annotations: {
      title: 'Update AI Agent',
      readOnlyHint: false,
      destructiveHint: true,
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
        name: { type: 'string', description: 'Agent display name' },
        description: {
          type: 'string',
          description: "Agent PERSONA — who the agent is, its personality, tone, and high-level behavior. This is the primary field for shaping agent identity. Example: 'You are a friendly customer support agent for Acme Corp...'",
        },
        instructions: {
          type: 'string',
          description: "Agent GUARDRAILS — high-level constraints and policies that apply regardless of the job (up to 1000 chars). Example: 'Never share internal pricing. Always verify identity before account changes.'",
        },
        jobConfig: {
          type: 'object',
          description: 'AI Agent Job Node configuration — controls the job role, procedures, LLM, and model parameters. Use ALL relevant fields to fully configure agent behavior.',
          properties: {
            jobName: {
              type: 'string',
              description: "Job TITLE — the role the agent is performing. Example: 'Customer Support Specialist', 'Sales Assistant', 'Technical Advisor'",
            },
            jobDescription: {
              type: 'string',
              description: "Job SCOPE — detailed description of responsibilities, expertise areas, available tools, and what to escalate. Example: 'Handle customer inquiries about orders, returns, and shipping. Use the search tool for order lookups. Escalate billing disputes to human agents.'",
            },
            jobInstructions: {
              type: 'string',
              description: "Job PROCEDURES — step-by-step instructions, output format requirements, and decision trees. Example: '1. Greet the customer. 2. Ask for order number. 3. Look up order. 4. Provide status update.'",
            },
            llmProviderReferenceId: {
              type: 'string',
              description: "LLM referenceId to assign (from setup_llm or list_resources { resourceType: 'llm_model' }). Determines which LLM generates responses.",
            },
            temperature: {
              type: 'number',
              description: 'LLM temperature (0-1). Lower = more deterministic, higher = more creative. Default: 0.7',
            },
            maxTokens: {
              type: 'number',
              description: 'Max tokens for LLM response (100-8000). Default: 4000',
            },
          },
        },
      },
      required: ['aiAgentId'],
    },
  },

  // 3. setup_llm
  {
    name: 'setup_llm',
    description:
      "Create an LLM resource (GPT-4, Claude, etc.) in a project.\n\nAfter creation, the connection is normally tested by sending a minimal probe to the provider. If this connection test runs and fails (for example, invalid credentials or model name), the model is deleted and an error is returned — this prevents broken model references from silently breaking downstream flows.\n\nIf the provider's test endpoint is unreachable or returns a non-testable status, the model is kept but a warning is returned so you know connectivity could not be fully verified.\n\nIf dangerouslySkipConnectionTest is true, the connection test is not run at all; the model is kept and the response includes a warning that no connectivity check was performed. Only use this flag when you explicitly accept the risk that the created LLM might not be callable.\n\nIf isDefault is true (the default), agents in the project will automatically use this LLM. If isDefault is false, you must explicitly assign it to the agent via update_ai_agent { aiAgentId, jobConfig: { llmProviderReferenceId: '<referenceId from this response>' } }.\n\nThe response includes the LLM's referenceId — use this value for jobConfig.llmProviderReferenceId if assigning manually.\n\nFor valid provider names and model strings, read cognigy://guide/llm-providers.\nTo list existing LLMs: use list_resources { resourceType: 'llm_model', projectId }.\nTo delete: use delete_resource { resourceType: 'llm_model', id }.",
    annotations: {
      title: 'Setup LLM',
      readOnlyHint: false,
      destructiveHint: true,
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
        dangerouslySkipConnectionTest: {
          type: 'boolean',
          description:
            'LAST RESORT ONLY — Skip the automatic connection validation after creating the model. ' +
            'This may leave a broken model reference that silently fails downstream. ' +
            'Only use when the test endpoint is known to be unavailable (e.g., air-gapped environments, ' +
            'unsupported custom model providers). Default: false.',
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
      destructiveHint: true,
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
      "Get detailed information about a single Cognigy resource. Returns a summary view by default. Set `raw: true` for the complete unfiltered API response with all fields.\n\nUse list_resources first to find IDs. Supports all list_resources types plus 'session_state' for session context data.",
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
      "Permanently delete a Cognigy resource. This cannot be undone.\n\nUse list_resources to verify the resource exists before deleting.\nSome types (endpoint) may require projectId. For 'tool' type, provide aiAgentId — the handler resolves and deletes the underlying flow node internally.\n\nAGENT DELETION: Deleting an agent is a last resort. By default (cascade: true), it cascade-deletes all associated resources in the correct order: endpoints → flow → agent. The Cognigy API rejects agent deletion while a referencing flow exists, so cascade is required. Set cascade: false to attempt a bare agent delete (will fail if flow still exists). The response reports every resource deleted and any failures.",
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
        cascade: {
          type: 'boolean',
          description: "Agent deletion only. If true (default), cascade-deletes endpoints → flow → agent. If false, attempts bare agent delete (fails if flow still exists).",
        },
      },
      required: ['resourceType', 'id'],
    },
  },

  // 8. manage_knowledge
  {
    name: 'manage_knowledge',
    description:
      "Manage knowledge bases for RAG. Create stores, add sources (URLs, text, or files), and list chunks to verify content.\n\nBEFORE USING THIS TOOL: Read cognigy://guide/knowledge-setup for the full setup workflow, prerequisites, and required steps.\n\nPREREQUISITE: An embedding model must be configured in the project before creating or using knowledge stores. Use setup_llm to create an embedding model first (e.g., setup_llm { projectId, provider: 'openAI', modelType: 'text-embedding-ada-002', apiKey }).\n\nFor URL sources: provide type 'url' and url field — the page is scraped and ingested automatically.\nFor text sources: provide text field (type defaults to 'manual') — a source and chunk are created.\nFor file sources (PDF, TXT, DOCX, CTXT, PPTX): provide type 'file' with filePath pointing to a local file. The server reads the file from disk and uploads it. Ingestion is async.\nTo verify content: use list_chunks with knowledgeStoreId (and optionally sourceId, filter).\n\nTo list stores: list_resources { resourceType: 'knowledge_store' }.\nTo delete: delete_resource { resourceType: 'knowledge_store', id }.",
    annotations: {
      title: 'Manage Knowledge',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['create_store', 'create_source', 'list_chunks', 'list_sources'],
          description: 'create_store: new knowledge base. create_source: add content from URL, text, or file. list_chunks: list/filter chunks in a source. list_sources: list all sources in a knowledge store.',
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
          enum: ['url', 'manual', 'file'],
          description: "Source type (create_source). 'url' scrapes a web page. 'manual' stores text directly. 'file' uploads a local document. Auto-detected from provided fields if omitted.",
        },
        url: {
          type: 'string',
          description: 'URL to scrape (required when type is url)',
        },
        text: {
          type: 'string',
          description: 'Text content to store as a knowledge chunk (required when type is manual)',
        },
        filePath: {
          type: 'string',
          description: "Absolute path to a local file to upload (required when type is file). Supported formats: PDF, TXT, DOCX, CTXT, PPTX. Max 10MB. Example: '/Users/me/docs/report.pdf'.",
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
      "Create a tool as a child of an AI Agent's Job node. Tools extend what the agent can do.\n\nTool types:\n- tool: General-purpose tool with custom logic branch. Provide toolId, description, and optional parameters (JSON Schema). After creation, use manage_flow_nodes with parentNodeId = returned toolNodeId and mode = \"appendChild\" to add logic nodes (say, code, ifThenElse, httpRequest, etc.) inside the tool branch.\n- knowledge: Search a Knowledge Store. Provide knowledgeStoreId, toolId, description.\n- send_email: Send emails. Provide toolId, description, recipient.\n- mcp: Connect to a remote MCP server. Provide mcpName, mcpServerUrl, timeout.\n- http: Call an external HTTP API. Provide toolId, description, url, method, and optionally headers, body, preProcessCode, postProcessCode. Creates an aiAgentJobTool with child HTTP Request node (and optional pre/post-process Code nodes).\n\nPrerequisites: Agent must exist (created via create_ai_agent).\nTo list tools: list_resources { resourceType: 'tool', aiAgentId }.\nTo delete: delete_resource { resourceType: 'tool', id: toolId, aiAgentId }.\nAfter creating, use talk_to_agent to test.",
    annotations: {
      title: 'Create Tool',
      readOnlyHint: false,
      destructiveHint: true,
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
          enum: ['tool', 'knowledge', 'send_email', 'mcp', 'http'],
          description: 'tool: general-purpose with custom logic. knowledge: search a Knowledge Store. send_email: send emails. mcp: connect to MCP server. http: call an external HTTP API.',
        },
        name: {
          type: 'string',
          description: "Tool display name (e.g., 'Fetch Weather', 'Search FAQ'). The node label in the flow uses the snake_case toolId from config (e.g., 'fetch_weather') if provided, otherwise falls back to this name.",
        },
        config: {
          type: 'object',
          description: 'Tool-specific configuration — fields depend on toolType.',
          properties: {
            toolId: { type: 'string', description: 'Tool identifier for the LLM in snake_case (e.g., fetch_weather, search_faq). Also used as the node label in the flow. (tool, knowledge, send_email, http)' },
            description: { type: 'string', description: 'Tool description for the LLM (tool, knowledge, send_email, http)' },
            parameters: { type: 'string', description: 'JSON Schema string defining tool parameters (tool, http)' },
            knowledgeStoreId: { type: 'string', description: 'Knowledge store reference ID (knowledge only)' },
            topK: { type: 'number', description: 'Number of results to return (knowledge only, default varies)' },
            recipient: { type: 'string', description: 'Email recipient address(es) (send_email only)' },
            mcpServerUrl: { type: 'string', description: 'MCP server URL (mcp only)' },
            mcpName: { type: 'string', description: 'MCP connection name (mcp only)' },
            timeout: { type: 'number', description: 'Timeout in seconds (mcp only)' },
            url: { type: 'string', description: "HTTP endpoint URL, e.g. 'https://api.example.com/v1/data' (http only)" },
            method: {
              type: 'string',
              enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
              description: 'HTTP method, default: GET (http only)',
            },
            headers: {
              type: 'object',
              description: 'HTTP headers as key-value pairs, e.g. { "Authorization": "Bearer ..." } (http only)',
            },
            body: {
              type: 'string',
              description: 'Request body template. Use CognigyScript tokens like {{input.aiAgent.toolArgs.param}} for dynamic values (http only).',
            },
            preProcessCode: {
              type: 'string',
              description: "JavaScript code to run BEFORE the HTTP request. Runs in Cognigy's Code Node environment with access to input, context, actions (http only).",
            },
            postProcessCode: {
              type: 'string',
              description: "JavaScript code to run AFTER the HTTP response. Runs in Cognigy's Code Node environment with access to input, context, actions (http only).",
            },
            toolResponseValue: {
              type: 'string',
              description: "CognigyScript expression for the Resolve Tool Action node's answer field. Controls what value is returned to the LLM as the tool result. For http tools, default: '{{JSON.stringify(input.httprequest)}}'. For general-purpose tools, default: '{{JSON.stringify(input.result)}}'. Set this to match where your code stores the result. Must be a valid CognigyScript expression.",
            },
          },
        },
      },
      required: ['aiAgentId', 'toolType', 'name', 'config'],
    },
  },

  // 10. update_tool
  {
    name: 'update_tool',
    description:
      "Update an existing tool node's configuration in an AI Agent's flow. Accepts the same config fields as create_tool.\n\nRequires: aiAgentId (to resolve the flow) and toolNodeId (the node ID from create_tool or list_resources { resourceType: 'tool', aiAgentId }).\n\nYou can update the name (display label) and/or tool-type-specific config fields. For http tools, config fields like url, method, headers, body update the child HTTP Request node, and preProcessCode/postProcessCode update the child Code nodes.\n\nAfter updating, use talk_to_agent to test the changes.",
    annotations: {
      title: 'Update Tool',
      readOnlyHint: false,
      destructiveHint: true,
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
          description: "24-char hex tool node ID (from create_tool or list_resources { resourceType: 'tool', aiAgentId })",
        },
        name: {
          type: 'string',
          description: 'New display name for the tool node (optional)',
        },
        toolType: {
          type: 'string',
          enum: ['tool', 'knowledge', 'send_email', 'mcp', 'http'],
          description: 'Tool type hint — helps the handler know which config fields to map. Optional if only updating name.',
        },
        config: {
          type: 'object',
          description: 'Tool-specific configuration — same fields as create_tool config. Merged with existing config on the node.',
          properties: {
            toolId: { type: 'string', description: 'Tool identifier for the LLM (tool, knowledge, send_email, http)' },
            description: { type: 'string', description: 'Tool description for the LLM (tool, knowledge, send_email, http)' },
            parameters: { type: 'string', description: 'JSON Schema string defining tool parameters (tool, http)' },
            knowledgeStoreId: { type: 'string', description: 'Knowledge store reference ID (knowledge only)' },
            topK: { type: 'number', description: 'Number of results to return (knowledge only)' },
            recipient: { type: 'string', description: 'Email recipient address(es) (send_email only)' },
            mcpServerUrl: { type: 'string', description: 'MCP server URL (mcp only)' },
            mcpName: { type: 'string', description: 'MCP connection name (mcp only)' },
            timeout: { type: 'number', description: 'Timeout in seconds (mcp only)' },
            url: { type: 'string', description: 'HTTP endpoint URL (http only)' },
            method: {
              type: 'string',
              enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
              description: 'HTTP method (http only)',
            },
            headers: {
              type: 'object',
              description: 'HTTP headers as key-value pairs (http only)',
            },
            body: {
              type: 'string',
              description: 'Request body template (http only)',
            },
            preProcessCode: {
              type: 'string',
              description: 'JavaScript code for the pre-process Code node (http only)',
            },
            postProcessCode: {
              type: 'string',
              description: 'JavaScript code for the post-process Code node (http only)',
            },
            toolResponseValue: {
              type: 'string',
              description: "CognigyScript expression for the Resolve Tool Action node's answer field. Controls what value is returned to the LLM. For http tools, default: '{{JSON.stringify(input.httprequest)}}'. For general-purpose tools, default: '{{JSON.stringify(input.result)}}'. Set to match where your code stores results.",
            },
          },
        },
      },
      required: ['aiAgentId', 'toolNodeId'],
    },
  },

  // 12. manage_flow_nodes
  {
    name: 'manage_flow_nodes',
    description:
      "Add flow nodes inside tool branches to build custom logic for AI Agent tools.\n\nIMPORTANT: Nodes should be created INSIDE tool branches. First create a tool with create_tool { toolType: \"tool\" }, then use this tool to add logic nodes under it (parentNodeId = toolNodeId, mode = \"appendChild\"). Do NOT add standalone nodes before the AI Agent Job node unless the user explicitly asks for it.\n\nTool branch placement is handled automatically: when you appendChild to an aiAgentJobTool, then, else, case, or default node, the handler auto-rewrites to append mode so nodes land in the correct execution chain. Both appendChild and append work correctly for tool branches.\n\nBRANCHING NODES (ifThenElse, lookup):\n- ifThenElse auto-creates then/else child nodes. lookup auto-creates case/default child nodes.\n- To add nodes inside a branch: list nodes to find the branch child ID, then use mode \"append\" with parentNodeId = the branch child node ID.\n- Do NOT use mode \"appendChild\" on then/else/case/default nodes — use \"append\" instead (the handler auto-corrects this, but \"append\" is the correct approach).\n- To set case values on a lookup/switch node, update the parent switch with a cases array: config { cases: [{ id: \"<caseNodeId>\", value: \"billing\" }] }.\n- To update a single case node directly: update with config { value: \"billing\" }.\n\nBEFORE USING THIS TOOL: Read cognigy://guide/flow-nodes for the full node type reference, config schemas, branching guidance, and placement rules.\n\nOPERATIONS:\n- list: List all nodes in a flow (returns id, type, label, parentId).\n- create: Add a node inside a tool branch. Requires nodeType and config. Set parentNodeId to the tool node ID and mode to \"appendChild\" to place nodes inside the tool. Use mode \"append\" to place after a sibling node within the same branch.\n- update: Modify a node's config or label. Only provided config fields are changed — existing fields are preserved. For switch/lookup nodes, include a cases array in config to set case values on child case nodes.\n- delete: Remove a node from the flow.\n\nSUPPORTED NODE TYPES: say, question, ifThenElse, lookup, setSessionContext, code, goTo, sleep, httpRequest. Read cognigy://guide/flow-nodes for config details.\n\nIf a nodeType is not in the supported list, the tool will return an error with the list of supported types.\n\nFor AI Agent tool nodes (knowledge, send_email, mcp, http), use create_tool / update_tool instead — they handle the required parent-child node wiring automatically.",
    annotations: {
      title: 'Manage Flow Nodes',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['list', 'create', 'update', 'delete'],
          description: 'Operation to perform',
        },
        flowId: {
          type: 'string',
          description: "24-char hex flow ID (from create_ai_agent response or list_resources { resourceType: 'flow' })",
        },
        nodeId: {
          type: 'string',
          description: '24-char hex node ID (required for update and delete)',
        },
        nodeType: {
          type: 'string',
          description: 'Node type key from the supported list: say, question, ifThenElse, lookup, setSessionContext, code, goTo, sleep, httpRequest. Read cognigy://guide/flow-nodes for details. Required for create.',
        },
        label: {
          type: 'string',
          description: 'Display label for the node (required for create, optional for update)',
        },
        parentNodeId: {
          type: 'string',
          description: 'Target node ID. Set to the tool node ID (from create_tool) and use mode=appendChild to add nodes inside a tool branch. Use mode=append to place after a sibling node.',
        },
        mode: {
          type: 'string',
          enum: ['append', 'appendChild'],
          description: 'Placement mode: appendChild (inside target — use this to add nodes under a tool) or append (after target as a sibling). Default: append.',
        },
        config: {
          type: 'object',
          description: 'Node-type-specific configuration. See cognigy://guide/flow-nodes for the schema of each node type.',
        },
      },
      required: ['operation', 'flowId'],
    },
  },

  // 11. manage_webchat
  {
    name: 'manage_webchat',
    description:
      "Create or configure a Webchat v3 Endpoint. This is the primary tool for deploying an AI Agent as an embeddable website chat widget.\n\nBEFORE USING THIS TOOL: Read cognigy://guide/webchat-setup for the full settings reference, style presets, and common recipes.\n\nCREATE vs UPDATE:\n- To create: provide projectId + flowId (+ optional name). A new webchat3 endpoint is always created.\n- To update: provide endpointId. Settings are merged with existing configuration.\n- Without endpointId, the tool never modifies existing endpoints — it always creates a new one.\n\nTo update an existing webchat, you MUST provide the endpointId. Use list_resources { resourceType: 'endpoint', projectId } to find existing webchat endpoints first.\n\nSTYLE PRESETS: Use stylePreset ('classic', 'modern', 'slick') to apply a predefined look. You can override individual fields in the same call.\n\nSETTINGS are organized into semantic groups (layout, behavior, startBehavior, homeScreen, teaserMessage, chatOptions, privacyNotice, businessHours, unreadMessages, maintenance, watermark, persistentMenu, attachmentUpload, webchatIcon). Only include groups/fields you want to change — everything else is preserved.\n\nFor advanced customization not covered by the groups, use customJson (raw JSON string for Webchat Custom Settings).\n\nRESPONSE HANDLING — CRITICAL:\nThe response always contains demoWebchatUrl — a direct browser link to test the webchat. You MUST ALWAYS present this URL to the user as a clickable link after every successful create or update. Do NOT tell the user to go to the UI to find it. The _integration section contains configUrl and embeddingSnippet — only mention these if the user explicitly asks about embedding or deploying to their website.",
    annotations: {
      title: 'Manage Webchat',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        endpointId: {
          type: 'string',
          description: '24-char hex endpoint ID. If provided, updates the existing endpoint. If omitted, creates a new endpoint.',
        },
        projectId: {
          type: 'string',
          description: '24-char hex project ID. Required for create, optional for update.',
        },
        flowId: {
          type: 'string',
          description: 'Flow referenceId to connect the webchat endpoint to. Required for create.',
        },
        name: {
          type: 'string',
          description: 'Endpoint display name (e.g. "Customer Support Webchat")',
        },
        stylePreset: {
          type: 'string',
          enum: ['classic', 'modern', 'slick'],
          description: 'Apply a predefined style. classic: compact 460px. modern: wide 900px with streaming. slick: medium 600px with grey bubbles.',
        },
        layout: {
          type: 'object',
          description: 'Visual layout: title, logo, chat window size, bot output width, input behavior, HTML settings, agent avatars.',
          properties: {
            title: { type: 'string', description: 'Webchat title bar text' },
            logoUrl: { type: 'string', description: 'Header logo URL (28x28px JPG/PNG/SVG/GIF)' },
            colors: {
              type: 'object',
              description: 'Color scheme',
              properties: {
                primaryColor: { type: 'string', description: 'Primary color (hex, e.g. "#0052cc")' },
                secondaryColor: { type: 'string', description: 'Secondary color' },
                chatBackground: { type: 'string', description: 'Chat interface background' },
                agentMessageBg: { type: 'string', description: 'Bot message background (default: "#ffffff")' },
                userMessageBg: { type: 'string', description: 'User message background' },
                textLink: { type: 'string', description: 'Text link color' },
              },
            },
            chatWindowWidth: { type: 'number', description: 'Chat window width in px (default: 460)' },
            botOutputMaxWidth: { type: 'number', description: 'Bot output max-width percentage 1-100 (default: 73)' },
            disableBotOutputBorder: { type: 'boolean', description: 'Hide chat bubble border' },
            maxInputRows: { type: 'number', description: 'Max lines in reply field before scrollbar' },
            enableInputCollation: { type: 'boolean', description: 'Combine rapid inputs into one message' },
            inputCollationTimeout: { type: 'number', description: 'Input collation delay in ms (default: 1000)' },
            dynamicImageAspectRatio: { type: 'boolean', description: 'Maintain original image proportions' },
            disableInputAutocomplete: { type: 'boolean', description: 'Disable browser autocomplete' },
            enableGenericHtml: { type: 'boolean', description: 'Style HTML in text messages' },
            allowJsInHtml: { type: 'boolean', description: 'Allow JS in HTML messages (security risk)' },
            allowJsInUrls: { type: 'boolean', description: 'Allow javascript: URLs (security risk)' },
            useAgentAvatars: { type: 'boolean', description: 'Show separate avatar/name for bot vs human' },
            botAvatarName: { type: 'string', description: 'Name above bot messages' },
            botAvatarLogoUrl: { type: 'string', description: 'Logo above bot messages' },
            humanAvatarName: { type: 'string', description: 'Name above human agent messages' },
            humanAvatarLogoUrl: { type: 'string', description: 'Logo above human agent messages' },
          },
        },
        behavior: {
          type: 'object',
          description: 'Chat behavior: scrolling, streaming, markdown, typing indicators, STT/TTS, message delay.',
          properties: {
            scrollingBehavior: { type: 'string', enum: ['alwaysScroll', 'scrollToLastInput'], description: 'Scroll behavior on new messages' },
            collateStreamedOutputs: { type: 'boolean', description: 'Merge streamed text into one bubble' },
            progressiveMessageRendering: { type: 'boolean', description: 'Show text appearing progressively' },
            renderMarkdown: { type: 'boolean', description: 'Render markdown in bot outputs (default: true)' },
            enableTypingIndicator: { type: 'boolean', description: 'Show typing animation' },
            inputPlaceholder: { type: 'string', description: 'Reply field placeholder (default: "Type something…")' },
            messageDelay: { type: 'number', description: 'Delay ms before bot response (default: 500)' },
            focusInputAfterPostback: { type: 'boolean', description: 'Focus input after button click' },
            enableConnectionStatusIndicator: { type: 'boolean', description: 'Show warning on lost connection' },
            enableStt: { type: 'boolean', description: 'Speech-to-text microphone button' },
            enableTts: { type: 'boolean', description: 'Text-to-speech for bot messages' },
            collectMetadata: { type: 'boolean', description: 'Collect browser metadata' },
            displayAIAgentNotice: { type: 'boolean', description: 'Show AI agent notice (default: true)' },
            aiAgentNoticeText: { type: 'string', description: 'AI agent notice text' },
            enableScrollButton: { type: 'boolean', description: 'Show scroll-to-bottom button (default: true)' },
          },
        },
        startBehavior: {
          type: 'object',
          description: 'How conversation starts: text field, button click, or auto-send.',
          properties: {
            mode: { type: 'string', enum: ['textField', 'button', 'autoSend'], description: 'Start mode' },
            textPayload: { type: 'string', description: 'First message to agent (button/autoSend)' },
            dataPayload: { type: 'string', description: 'Additional data to flow (button/autoSend)' },
            displayText: { type: 'string', description: 'Simulated user input bubble (button/autoSend)' },
            buttonTitle: { type: 'string', description: 'Start button label (button mode only)' },
          },
        },
        homeScreen: {
          type: 'object',
          description: 'Home screen with welcome message, background, conversation starters, and previous conversations.',
          properties: {
            enabled: { type: 'boolean', description: 'Show home screen on launch' },
            welcomeText: { type: 'string', description: 'Greeting message' },
            backgroundImage: { type: 'string', description: 'Background image URL (460x608px)' },
            backgroundColor: { type: 'string', description: 'CSS color/gradient for background' },
            startConversationButtonText: { type: 'string', description: 'Button text (default: "Start conversation")' },
            conversationStarters: {
              type: 'array',
              description: 'Up to 5 starters',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  type: { type: 'string', enum: ['postback', 'url'] },
                  value: { type: 'string' },
                },
                required: ['title', 'type', 'value'],
              },
            },
            previousConversations: {
              type: 'object',
              properties: {
                enabled: { type: 'boolean' },
                enableDeleteAll: { type: 'boolean' },
                buttonText: { type: 'string' },
                title: { type: 'string' },
                startNewButtonText: { type: 'string' },
              },
            },
          },
        },
        teaserMessage: {
          type: 'object',
          description: 'Teaser message beside webchat icon with optional conversation starters.',
          properties: {
            text: { type: 'string', description: 'Message beside webchat icon' },
            showInChat: { type: 'boolean', description: 'Also show teaser inside chat' },
            conversationStarters: {
              type: 'array',
              description: 'Up to 5 starters',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  type: { type: 'string', enum: ['postback', 'url'] },
                  value: { type: 'string' },
                },
                required: ['title', 'type', 'value'],
              },
            },
          },
        },
        chatOptions: {
          type: 'object',
          description: 'Chat options menu: quick replies, TTS toggle, conversation rating, footer links.',
          properties: {
            enabled: { type: 'boolean', description: 'Enable chat options menu' },
            title: { type: 'string', description: 'Options screen title' },
            enableDeleteConversation: { type: 'boolean', description: 'Let users delete current conversation' },
            quickReplies: {
              type: 'object',
              properties: {
                enabled: { type: 'boolean' },
                sectionTitle: { type: 'string' },
                items: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, type: { type: 'string', enum: ['postback', 'url'] }, value: { type: 'string' } }, required: ['title', 'type', 'value'] } },
              },
            },
            textToSpeech: {
              type: 'object',
              properties: {
                showToggle: { type: 'boolean' },
                toggleLabel: { type: 'string' },
                activateByDefault: { type: 'boolean' },
              },
            },
            rating: {
              type: 'object',
              properties: {
                enabled: { type: 'boolean' },
                titleText: { type: 'string' },
                commentPlaceholder: { type: 'string' },
                submitButtonText: { type: 'string' },
                submittedBannerText: { type: 'string' },
              },
            },
            footer: {
              type: 'object',
              properties: {
                enabled: { type: 'boolean' },
                items: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string' } }, required: ['title', 'url'] } },
              },
            },
          },
        },
        privacyNotice: {
          type: 'object',
          description: 'Privacy notice shown before chat begins.',
          properties: {
            enabled: { type: 'boolean' },
            title: { type: 'string' },
            text: { type: 'string', description: 'Supports Markdown' },
            submitButton: { type: 'string' },
            policyLinkTitle: { type: 'string' },
            policyLinkUrl: { type: 'string' },
          },
        },
        businessHours: {
          type: 'object',
          description: 'Restrict webchat availability to business hours.',
          properties: {
            enabled: { type: 'boolean' },
            mode: { type: 'string', enum: ['inform', 'disable', 'hide'] },
            informationText: { type: 'string' },
            informationTitle: { type: 'string' },
            timezone: { type: 'string', description: 'IANA timezone (e.g. "Europe/Berlin")' },
            schedule: {
              type: 'array',
              items: {
                type: 'object',
                properties: { dayOfWeek: { type: 'string' }, startTime: { type: 'string' }, endTime: { type: 'string' } },
                required: ['dayOfWeek', 'startTime', 'endTime'],
              },
            },
          },
        },
        unreadMessages: {
          type: 'object',
          description: 'Unread message notifications.',
          properties: {
            enableTitleIndicator: { type: 'boolean' },
            enableBadge: { type: 'boolean' },
            enablePreview: { type: 'boolean' },
            enableSound: { type: 'boolean' },
          },
        },
        maintenance: {
          type: 'object',
          description: 'Maintenance mode settings.',
          properties: {
            enabled: { type: 'boolean' },
            mode: { type: 'string', enum: ['inform', 'disable', 'hide'] },
            informationText: { type: 'string' },
            informationTitle: { type: 'string' },
          },
        },
        watermark: {
          type: 'object',
          description: 'Bottom watermark branding.',
          properties: {
            type: { type: 'string', enum: ['default', 'custom', 'none'] },
            text: { type: 'string' },
            url: { type: 'string' },
          },
        },
        persistentMenu: {
          type: 'object',
          description: 'Persistent menu with quick-access items.',
          properties: {
            enabled: { type: 'boolean' },
            title: { type: 'string' },
            items: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, payload: { type: 'string' } }, required: ['title', 'payload'] } },
          },
        },
        attachmentUpload: {
          type: 'object',
          description: 'File upload settings.',
          properties: {
            enabled: { type: 'boolean' },
            dropzoneText: { type: 'string' },
          },
        },
        webchatIcon: {
          type: 'object',
          description: 'Webchat icon animation settings.',
          properties: {
            animation: { type: 'string', enum: ['none', 'bounce', 'swing', 'pulse'] },
            animationInterval: { type: 'number', description: 'Seconds between animations (default: 5)' },
            animationSpeed: { type: 'string', enum: ['slow', 'normal', 'fast', 'superfast'] },
          },
        },
        customJson: {
          type: 'string',
          description: 'Raw JSON string for advanced Webchat Custom Settings not covered by other fields.',
        },
      },
    },
  },
];
