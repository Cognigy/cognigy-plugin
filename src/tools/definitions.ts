// The audit_event filter enums are advertised straight from the Zod schemas'
// constants: two hand-kept copies would drift the moment the platform grows a
// new actor value, and the LLM would then be offered a value Zod rejects (or
// never told about one it accepts).
import { AUDIT_ACTORS, AUDIT_EVENT_TYPES } from "../schemas/tools.js";

export interface ToolDefinition {
  name: string;
  description: string;
  annotations: Record<string, unknown>;
  inputSchema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}

export const tools: ToolDefinition[] = [
  // 1. create_ai_agent
  {
    name: "create_ai_agent",
    description:
      "Create a complete AI Agent in one call: the agent resource plus an auto-provisioned flow, AI Agent Job Node and REST endpoint. Do not create those pieces separately. If projectId is omitted, a new project is created from the agent name. Passing knowledgeStoreReferenceId also attaches a knowledge-search tool to the Job Node. Returns the agent, flow and endpoint, the endpointUrl for talk_to_agent, the projectId used, and llmStatus. The agent cannot answer until the project has a working, connected LLM; llmStatus 'unknown' means that is not yet confirmed.",
    annotations: {
      title: "Create AI Agent",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description:
            "24-char hex project ID. Optional — if omitted, a new project is created automatically.",
        },
        name: {
          type: "string",
          description: "Agent name (1-200 chars)",
        },
        description: {
          type: "string",
          description:
            "Agent description — defines the agent's persona and behavior",
        },
        knowledgeStoreReferenceId: {
          type: "string",
          description:
            "Optional knowledge store referenceId (from manage_knowledge create_store). When set, a knowledge-search tool for that store is created on the Job Node.",
        },
      },
      required: ["name"],
    },
  },

  // 2. update_ai_agent
  {
    name: "update_ai_agent",
    description:
      "Update an existing AI Agent: its identity fields (name, persona in description, guardrails in instructions) and its AI Agent Job Node config (jobConfig: job name, scope, procedures, LLM, temperature, maxTokens) in one call. Only the fields you pass change. Spread configuration across the matching fields rather than putting everything into description. To give the agent knowledge, use create_tool with toolType 'knowledge' instead of persona text. Requires aiAgentId (from create_ai_agent or list_resources { resourceType: 'agent' }).",
    annotations: {
      title: "Update AI Agent",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        aiAgentId: {
          type: "string",
          description:
            "24-char hex AI Agent ID (from create_ai_agent response or list_resources)",
        },
        name: { type: "string", description: "Agent display name" },
        description: {
          type: "string",
          description:
            "Agent PERSONA — who the agent is, its personality, tone, and high-level behavior. This is the primary field for shaping agent identity. Example: 'You are a friendly customer support agent for Acme Corp...'",
        },
        instructions: {
          type: "string",
          description:
            "Agent GUARDRAILS — high-level constraints and policies that apply regardless of the job (up to 1000 chars). Example: 'Never share internal pricing. Always verify identity before account changes.'",
        },
        jobConfig: {
          type: "object",
          description:
            "AI Agent Job Node configuration — controls the job role, procedures, LLM, and model parameters. Use ALL relevant fields to fully configure agent behavior.",
          properties: {
            jobName: {
              type: "string",
              description:
                "Job TITLE — the role the agent is performing. Example: 'Customer Support Specialist', 'Sales Assistant', 'Technical Advisor'",
            },
            jobDescription: {
              type: "string",
              description:
                "Job SCOPE — detailed description of responsibilities, expertise areas, available tools, and what to escalate. Example: 'Handle customer inquiries about orders, returns, and shipping. Use the search tool for order lookups. Escalate billing disputes to human agents.'",
            },
            jobInstructions: {
              type: "string",
              description:
                "Job PROCEDURES — step-by-step instructions, output format requirements, and decision trees. Example: '1. Greet the customer. 2. Ask for order number. 3. Look up order. 4. Provide status update.'",
            },
            llmProviderReferenceId: {
              type: "string",
              description:
                "LLM referenceId to assign (from setup_llm or list_resources { resourceType: 'llm_model' }). Determines which LLM generates responses.",
            },
            temperature: {
              type: "number",
              description:
                "LLM temperature (0-1). Lower = more deterministic, higher = more creative. Default: 0.7",
            },
            maxTokens: {
              type: "number",
              description:
                "Max tokens for LLM response (100-8000). Default: 4000",
            },
          },
        },
      },
      required: ["aiAgentId"],
    },
  },

  // 3. setup_llm
  {
    name: "setup_llm",
    description:
      "Create a NEW LLM resource in a project, auto-creating a Connection from apiKey or reusing a same-project connectionId, then test the connection with a minimal probe. Use it only when no existing LLM can be reused via manage_packages; provider names, model strings and OpenAI-compatible endpoints are covered by the llm-providers skill. Never invent credentials: if no apiKey or connectionId was given, ask the user. A failed connection test deletes the model and returns an error; an untestable provider keeps it with a warning. Returns the LLM's referenceId, which update_ai_agent jobConfig.llmProviderReferenceId takes when isDefault is false.",
    annotations: {
      title: "Setup LLM",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "24-char hex project ID" },
        provider: {
          type: "string",
          enum: [
            "openAI",
            "azureOpenAI",
            "anthropic",
            "google",
            "mistral",
            "openAICompatible",
          ],
          description:
            "LLM provider (API values: 'openAI', 'azureOpenAI', 'anthropic', 'google', 'mistral', 'openAICompatible'). Use 'openAICompatible' for any endpoint that speaks the OpenAI API (vLLM, Hugging Face, LiteLLM, Azure AI Foundry, ...).",
        },
        modelType: {
          type: "string",
          description:
            "Model type string. Chat examples: 'gpt-4o', 'gpt-4o-mini', 'claude-sonnet-4-0', 'mistral-small-2503'. Embedding examples: 'text-embedding-3-small', 'text-embedding-3-large', 'text-embedding-ada-002', 'gemini-embedding-001'. For provider 'openAICompatible' this MUST be 'custom-model' (chat) or 'custom-embedding-model' (embedding); the real model name goes in customModel.",
        },
        name: {
          type: "string",
          description:
            "Display name for the LLM resource. If omitted, defaults to customModel for openAICompatible providers and modelType for all other providers.",
        },
        apiKey: {
          type: "string",
          description:
            "Provider API key. A Connection will be auto-created from this key.",
        },
        connectionId: {
          type: "string",
          description:
            "Existing Connection referenceId (UUID) from the SAME project. Connections are project-scoped; to reuse one from another project, transfer it with manage_packages instead of passing it here.",
        },
        isDefault: {
          type: "boolean",
          description: "Set as project default (default: true)",
        },
        baseCustomUrl: {
          type: "string",
          description:
            "openAICompatible only (required): base URL of the OpenAI-compatible API, e.g. 'https://my-llm-host.example.com/v1'.",
        },
        customModel: {
          type: "string",
          description:
            "openAICompatible only (required): the model name as known by the provider, e.g. 'llama-3.3-70b-instruct'.",
        },
        customAuthHeader: {
          type: "string",
          description:
            "openAICompatible only (optional): custom HTTP header name for authentication, e.g. 'X-Custom-Auth' or 'Ocp-Apim-Subscription-Key'. When set, the API key is sent in this header instead of 'Authorization: Bearer'.",
        },
        apiType: {
          type: "string",
          enum: ["chatCompletion", "responses"],
          description:
            "API flavor for chat models (openAI, azureOpenAI, openAICompatible only). Default: 'chatCompletion'. Use 'responses' only if the provider supports OpenAI's Responses API.",
        },
        dangerouslySkipConnectionTest: {
          type: "boolean",
          description:
            "Skip the connection test after creating the model (default: false). Last resort for providers whose test endpoint is known to be unreachable, and only with the user's explicit confirmation. A failed test means wrong credentials or a missing connection; skipping hides that rather than fixing it.",
        },
      },
      required: ["projectId", "provider", "modelType"],
    },
  },

  // 4. talk_to_agent
  {
    name: "talk_to_agent",
    description:
      "Send one message to a Cognigy AI Agent through its REST endpoint and return the reply, for testing during iterative development. Pass endpointUrl directly, or aiAgentId to have the tool find or create a REST endpoint for the agent's flow. Reuse the returned sessionId across calls for a multi-turn conversation. The project needs a working LLM, otherwise the reply is empty. Returns agentResponse and sessionId; verbose: true adds the raw API response.",
    annotations: {
      title: "Talk to Agent",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        endpointUrl: {
          type: "string",
          description:
            "REST endpoint URL (e.g., https://endpoint-trial.cognigy.ai/xxxxx). If omitted, provide aiAgentId instead.",
        },
        aiAgentId: {
          type: "string",
          description:
            "24-char hex AI Agent ID. When endpointUrl is omitted, the tool finds or auto-creates a REST endpoint for this agent's flow.",
        },
        projectId: {
          type: "string",
          description:
            "24-char hex project ID. Pass alongside aiAgentId when known (returned by create_ai_agent and list_resources) — saves a server-side lookup that can fail. Not used when endpointUrl is provided.",
        },
        message: {
          type: "string",
          description: "Message to send to the agent",
        },
        sessionId: {
          type: "string",
          description:
            "Session ID for conversation continuity. Omit to start new session.",
        },
        userId: {
          type: "string",
          description: "User identifier (defaults to 'mcp-user')",
        },
        data: {
          type: "object",
          description: "Additional data payload to send with the message",
        },
        verbose: {
          type: "boolean",
          description:
            "If true, include the full raw API response (default: false)",
        },
      },
      required: ["message"],
    },
  },

  // 5. list_resources
  {
    name: "list_resources",
    description:
      "List Cognigy resources of one type, paginated, with optional server-side sort. Types: project (no projectId needed), tool (takes aiAgentId instead of projectId), audit_event (organisation-wide, no projectId; answers \"who changed what\" via the actor and eventType filters, Cognigy 2026.17.0+), and the project-scoped agent, flow, endpoint, llm_model, knowledge_store, conversation, extension, function. Packages and snapshots are listed by manage_packages and manage_snapshots. Returns id, name and a few type-specific fields per item; use get_resource for full detail. For recency questions use sort (e.g. 'lastChanged:desc' with a small limit) instead of paging through everything.",
    annotations: {
      title: "List Resources",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        resourceType: {
          type: "string",
          enum: [
            "project",
            "agent",
            "flow",
            "endpoint",
            "llm_model",
            "knowledge_store",
            "conversation",
            "extension",
            "function",
            "tool",
            "audit_event",
          ],
          description: "Type of resource to list",
        },
        projectId: {
          type: "string",
          description:
            "24-char hex project ID. Required for all types except 'project', 'tool' and 'audit_event'.",
        },
        aiAgentId: {
          type: "string",
          description:
            "24-char hex AI Agent ID (tools only — lists tools in the agent's flow)",
        },
        startDate: {
          type: "string",
          description: "ISO 8601 date filter (conversations only)",
        },
        endDate: {
          type: "string",
          description: "ISO 8601 date filter (conversations only)",
        },
        channel: {
          type: "string",
          description:
            "Channel filter, e.g. 'rest', 'webchat3' (conversations only)",
        },
        useCase: {
          type: "string",
          description:
            "llm_model only — filter LLMs to the models allowed for a specific use case, matching the Cognigy UI dropdown. Example: 'knowledgeSearch', 'answerExtraction', 'aiAgent', or 'promptNode'.",
        },
        sort: {
          type: "string",
          description:
            "Server-side sort as 'field:direction', e.g. 'lastChanged:desc' or 'name:asc'. Sort on any field the resource returns. Not supported for 'tool' (read from the flow chart, not a list endpoint).",
        },
        actor: {
          type: "array",
          minItems: 1,
          items: {
            type: "string",
            enum: [...AUDIT_ACTORS],
          },
          description:
            "audit_event only: who performed the action. 'mcp-plugin' is this plugin, 'ask-ai' the Cognigy Ask AI agent, 'human' a person in the UI or API. Filtered server-side on Cognigy 2026.17.0+, otherwise on the fetched page.",
        },
        eventType: {
          type: "array",
          minItems: 1,
          items: {
            type: "string",
            enum: [...AUDIT_EVENT_TYPES],
          },
          description:
            "audit_event only: operation type filter. Filtered server-side on Cognigy 2026.17.0+, otherwise on the fetched page.",
        },
        user: {
          type: "string",
          description:
            "audit_event only — filter by the email of the user the action ran as.",
        },
        limit: {
          type: "number",
          description: "Results per page (1-100, default 25)",
        },
        skip: {
          type: "number",
          description: "Number of results to skip (default 0)",
        },
      },
      required: ["resourceType"],
    },
  },

  // 6. get_resource
  {
    name: "get_resource",
    description:
      "Get one Cognigy resource by id, as a filtered summary by default or the complete API response with raw: true. Supports every list_resources type plus session_state (session context by session id) and user, where id 'me' returns the account the API key belongs to and a 24-char hex id another user. createdBy / lastChangedBy are opaque user ids: compare them with 'me' rather than guessing who they are. Use list_resources first to find ids.",
    annotations: {
      title: "Get Resource",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        resourceType: {
          type: "string",
          enum: [
            "agent",
            "flow",
            "endpoint",
            "project",
            "conversation",
            "session_state",
            "llm_model",
            "knowledge_store",
            "extension",
            "function",
            "user",
            "audit_event",
          ],
          description: "Type of resource to retrieve",
        },
        id: {
          type: "string",
          description:
            "Resource ID (24-char hex, a session ID for conversation/session_state, or 'me' for resourceType 'user')",
        },
        projectId: {
          type: "string",
          description: "24-char hex project ID. Required for endpoint lookups.",
        },
        raw: {
          type: "boolean",
          description:
            "If true, return unfiltered API response (default: false)",
        },
      },
      required: ["resourceType", "id"],
    },
  },

  // 7. delete_resource
  {
    name: "delete_resource",
    description:
      "Delete a Cognigy resource, or mark it for manual deletion. agent, flow and project are never hard-deleted: they are renamed with a DELETE_ prefix (idempotent; the response reports markedForDeletion or alreadyMarked), and agent and flow deletion also deactivate their endpoints, reversibly, unless cascade is false. endpoint, llm_model, knowledge_store, function and tool are permanently deleted and cannot be undone; tool additionally needs aiAgentId. Flow nodes are deleted with manage_flow_nodes and snapshots with manage_snapshots, not here.",
    annotations: {
      title: "Delete Resource",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        resourceType: {
          type: "string",
          enum: [
            "agent",
            "flow",
            "project",
            "endpoint",
            "llm_model",
            "knowledge_store",
            "function",
            "tool",
          ],
          description:
            "Type of resource to delete (flow/project/agent are renamed with a DELETE_ prefix instead of being deleted)",
        },
        id: {
          type: "string",
          description: "24-char hex resource ID (or toolId for tool type)",
        },
        projectId: {
          type: "string",
          description: "24-char hex project ID (required for some types)",
        },
        aiAgentId: {
          type: "string",
          description:
            "24-char hex AI Agent ID (required for tool type — needed to resolve the flow)",
        },
        cascade: {
          type: "boolean",
          description:
            "Agent deletion only. If true (default), deactivates the agent's endpoints and renames its flow and the agent with the DELETE_ prefix. If false, renames only the agent.",
        },
      },
      required: ["resourceType", "id"],
    },
  },

  // 8. manage_knowledge
  {
    name: "manage_knowledge",
    description:
      "Manage Knowledge AI stores for RAG. Operations: create_store, create_source (type 'url' scrapes a page, 'manual' stores text, 'file' uploads a local PDF/TXT/DOCX/CTXT/PPTX; ingestion is async), list_sources, and list_chunks to verify what was ingested. The project needs an embedding model and Knowledge AI settings (manage_settings set_knowledge_ai) before a store is created; the knowledge-setup skill has the order. Stores are listed with list_resources and deleted with delete_resource. Attach a store to an agent with create_tool toolType 'knowledge'.",
    annotations: {
      title: "Manage Knowledge",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: [
            "create_store",
            "create_source",
            "list_chunks",
            "list_sources",
          ],
          description:
            "create_store: new knowledge base. create_source: add content from URL, text, or file. list_chunks: list/filter chunks in a source. list_sources: list all sources in a knowledge store.",
        },
        projectId: {
          type: "string",
          description: "24-char hex project ID (required for create_store)",
        },
        knowledgeStoreId: {
          type: "string",
          description:
            "24-char hex store ID (required for create_source, list_chunks)",
        },
        sourceId: {
          type: "string",
          description:
            "24-char hex source ID (optional for list_chunks — if omitted, uses the first source in the store)",
        },
        name: {
          type: "string",
          description:
            "Source or store name (required for create_store, optional for create_source)",
        },
        description: {
          type: "string",
          description: "Store or source description",
        },
        type: {
          type: "string",
          enum: ["url", "manual", "file"],
          description:
            "Source type (create_source). 'url' scrapes a web page. 'manual' stores text directly. 'file' uploads a local document. Auto-detected from provided fields if omitted.",
        },
        url: {
          type: "string",
          description: "URL to scrape (required when type is url)",
        },
        text: {
          type: "string",
          description:
            "Text content to store as a knowledge chunk (required when type is manual)",
        },
        filePath: {
          type: "string",
          description:
            "Absolute path to a local file to upload (required when type is file). Supported formats: PDF, TXT, DOCX, CTXT, PPTX. Max 10MB. Example: '/Users/me/docs/report.pdf'.",
        },
        filter: {
          type: "string",
          description:
            "Text filter for list_chunks — matches against chunk text",
        },
        limit: { type: "number", description: "Max results (1-50)" },
      },
      required: ["operation"],
    },
  },

  // 9. create_tool
  {
    name: "create_tool",
    description:
      "Add a tool to an AI Agent's Job Node so the agent's LLM can call it. toolType: 'tool' (default: a custom logic branch you fill with manage_flow_nodes afterwards), 'http' (call a concrete REST endpoint, with optional pre/post-process Code nodes), 'knowledge' (search a Knowledge Store), 'send_email', or 'mcp' (only for an explicitly named external MCP server URL). One tool per business action: an existing toolId is reused, never duplicated. Cognigy runtime conventions for http and Code nodes are in the parameter descriptions and the tools-setup skill. Returns toolNodeId and child node ids for update_tool and manage_flow_nodes.",
    annotations: {
      title: "Create Tool",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        aiAgentId: {
          type: "string",
          description:
            "24-char hex AI Agent ID (from create_ai_agent or list_resources { resourceType: 'agent' })",
        },
        toolType: {
          type: "string",
          enum: ["tool", "knowledge", "send_email", "mcp", "http"],
          description:
            "tool: general-purpose with custom logic (DEFAULT — use for most requests). knowledge: search a Knowledge Store. send_email: send emails. mcp: connect to an external MCP server (ONLY when user explicitly requests MCP integration with a specific server URL). http: call an external HTTP API (when user specifies a concrete API endpoint).",
        },
        name: {
          type: "string",
          description:
            "Tool display name (e.g., 'Fetch Weather', 'Search FAQ'). The node label in the flow uses the snake_case toolId from config (e.g., 'fetch_weather') if provided, otherwise falls back to this name.",
        },
        config: {
          type: "object",
          description:
            "Tool-specific configuration — fields depend on toolType.",
          properties: {
            toolId: {
              type: "string",
              description:
                "Tool identifier for the LLM in snake_case (e.g., fetch_weather, search_faq). Also used as the node label in the flow. (tool, knowledge, send_email, http)",
            },
            description: {
              type: "string",
              description:
                "Tool description for the LLM (tool, knowledge, send_email, http)",
            },
            parameters: {
              type: "string",
              description:
                'JSON Schema string for the tool parameters (tool, http). Top level must be {"type":"object","properties":{...},"required":[...]}: "required" is mandatory (use [] if none), every property needs "type" and "description", arrays need "items", nested objects their own "required". "additionalProperties": false is added automatically. Strict-mode models (OpenAI Responses API) need every key in "required", optional ones nullable.',
            },
            knowledgeStoreId: {
              type: "string",
              description: "Knowledge store reference ID (knowledge only)",
            },
            topK: {
              type: "number",
              description:
                "Number of results to return (knowledge only, default varies)",
            },
            recipient: {
              type: "string",
              description: "Email recipient address(es) (send_email only)",
            },
            mcpServerUrl: {
              type: "string",
              description: "MCP server URL (mcp only)",
            },
            mcpName: {
              type: "string",
              description: "MCP connection name (mcp only)",
            },
            timeout: {
              type: "number",
              description: "Timeout in seconds (mcp only)",
            },
            url: {
              type: "string",
              description:
                "HTTP endpoint URL, e.g. 'https://api.example.com/v1/data' (http only)",
            },
            method: {
              type: "string",
              enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
              description: "HTTP method, default: GET (http only)",
            },
            headers: {
              type: "object",
              description:
                'HTTP headers as key-value pairs, e.g. { "Authorization": "Bearer ..." } (http only)',
            },
            body: {
              type: "string",
              description:
                "Request body template. Use CognigyScript tokens like {{input.aiAgent.toolArgs.param}} for dynamic values (http only).",
            },
            preProcessCode: {
              type: "string",
              description:
                "JavaScript for a Code node that runs BEFORE the HTTP request (http only). Cognigy Code-node rules: no top-level return, mutate input / context directly; the LLM's tool arguments are at input.aiAgent.toolArgs.<param>, not input.data.",
            },
            postProcessCode: {
              type: "string",
              description:
                "JavaScript for a Code node that runs AFTER the HTTP response (http only). input.httprequest is an object { result, statusCode, length }, not the raw body; no top-level return; store what the LLM should see where toolResponseValue reads it.",
            },
            toolResponseValue: {
              type: "string",
              description:
                "CognigyScript expression for the Resolve Tool Action node's answer, i.e. what the LLM receives as the tool result. Defaults: '{{JSON.stringify(input.httprequest)}}' for http tools, '{{JSON.stringify(input.result)}}' for general tools. Set it to wherever your code stores the result.",
            },
          },
        },
      },
      required: ["aiAgentId", "toolType", "name", "config"],
    },
  },

  // 10. update_tool
  {
    name: "update_tool",
    description:
      "Update an existing tool node on an AI Agent: its display name and any config field create_tool accepts, merged into the current config. For http tools url, method, headers and body update the child HTTP Request node, and preProcessCode / postProcessCode update or create the child Code nodes; pass httpNodeId, preProcessNodeId, postProcessNodeId or resolveNodeId to target a specific child when label lookup is ambiguous. Requires aiAgentId and toolNodeId (from create_tool or list_resources { resourceType: 'tool', aiAgentId }).",
    annotations: {
      title: "Update Tool",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        aiAgentId: {
          type: "string",
          description:
            "24-char hex AI Agent ID (from create_ai_agent or list_resources { resourceType: 'agent' })",
        },
        toolNodeId: {
          type: "string",
          description:
            "24-char hex tool node ID (from create_tool or list_resources { resourceType: 'tool', aiAgentId })",
        },
        name: {
          type: "string",
          description: "New display name for the tool node (optional)",
        },
        toolType: {
          type: "string",
          enum: ["tool", "knowledge", "send_email", "mcp", "http"],
          description:
            "Tool type hint — helps the handler know which config fields to map. Optional if only updating name.",
        },
        config: {
          type: "object",
          description:
            "Tool-specific configuration — same fields as create_tool config. Merged with existing config on the node.",
          properties: {
            toolId: {
              type: "string",
              description:
                "Tool identifier for the LLM (tool, knowledge, send_email, http)",
            },
            description: {
              type: "string",
              description:
                "Tool description for the LLM (tool, knowledge, send_email, http)",
            },
            parameters: {
              type: "string",
              description:
                "JSON Schema string for the tool parameters (tool, http). Same contract as create_tool config.parameters.",
            },
            knowledgeStoreId: {
              type: "string",
              description: "Knowledge store reference ID (knowledge only)",
            },
            topK: {
              type: "number",
              description: "Number of results to return (knowledge only)",
            },
            recipient: {
              type: "string",
              description: "Email recipient address(es) (send_email only)",
            },
            mcpServerUrl: {
              type: "string",
              description: "MCP server URL (mcp only)",
            },
            mcpName: {
              type: "string",
              description: "MCP connection name (mcp only)",
            },
            timeout: {
              type: "number",
              description: "Timeout in seconds (mcp only)",
            },
            url: {
              type: "string",
              description: "HTTP endpoint URL (http only)",
            },
            method: {
              type: "string",
              enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
              description: "HTTP method (http only)",
            },
            headers: {
              type: "object",
              description: "HTTP headers as key-value pairs (http only)",
            },
            body: {
              type: "string",
              description: "Request body template (http only)",
            },
            preProcessCode: {
              type: "string",
              description:
                "JavaScript code for the pre-process Code node (http only)",
            },
            postProcessCode: {
              type: "string",
              description:
                "JavaScript code for the post-process Code node (http only)",
            },
            toolResponseValue: {
              type: "string",
              description:
                "CognigyScript expression for the Resolve Tool Action node's answer (what the LLM receives). Defaults as in create_tool.",
            },
            httpNodeId: {
              type: "string",
              description:
                "Optional 24-char hex id of the HTTP Request child node (from create_tool childNodes), when label lookup fails (http only).",
            },
            preProcessNodeId: {
              type: "string",
              description:
                "Optional 24-char hex id of the pre-process Code child node (from create_tool childNodes), when label lookup fails (http only).",
            },
            postProcessNodeId: {
              type: "string",
              description:
                "Optional 24-char hex id of the post-process Code child node (from create_tool childNodes), when label lookup fails (http only).",
            },
            resolveNodeId: {
              type: "string",
              description:
                "Optional 24-char hex id of the Resolve Tool Action child node (from create_tool childNodes). Needed for toolResponseValue when the flow has more than one such node.",
            },
          },
        },
      },
      required: ["aiAgentId", "toolNodeId"],
    },
  },

  // 12. manage_flow_nodes
  {
    name: "manage_flow_nodes",
    description:
      "Manage the logic nodes inside a Cognigy flow and render the flow as a diagram. Operations: list (id, type, label, parentId; no config), get (one node with config), create (nodeType + config, placed by parentNodeId and mode), update (partial config or label; cases for switch/lookup nodes), delete, render (read-only ascii tree plus mermaid string, optionally a local HTML file). Nodes belong inside a tool branch: create the tool first and pass parentNodeId = toolNodeId with mode 'appendChild'; never add standalone nodes before the AI Agent Job Node. Tool nodes themselves are managed with create_tool / update_tool. Node types and config schemas are in the flow-nodes skill; an unsupported nodeType returns the current list.",
    annotations: {
      title: "Manage Flow Nodes",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["list", "get", "create", "update", "delete", "render"],
          description: "Operation to perform",
        },
        flowId: {
          type: "string",
          description:
            "24-char hex flow ID (from create_ai_agent response or list_resources { resourceType: 'flow' })",
        },
        nodeId: {
          type: "string",
          description:
            "24-char hex node ID (required for get, update, and delete)",
        },
        nodeType: {
          type: "string",
          description:
            "Node type key (required for create). The authoritative set comes from the server node registry; an unsupported value returns an error listing the current types. Common types: say, question, ifThenElse, lookup, setSessionContext, code, goTo, sleep, httpRequest. xApp nodes: initAppSession, showXAppAdaptiveCard, showXAppHtml, setXAppState, getXAppSessionPin.",
        },
        label: {
          type: "string",
          description:
            "Display label for the node (required for create, optional for update)",
        },
        parentNodeId: {
          type: "string",
          description:
            "Target node ID. Set to the tool node ID (from create_tool) and use mode=appendChild to add nodes inside a tool branch. Use mode=append to place after a sibling node.",
        },
        mode: {
          type: "string",
          enum: ["append", "appendChild"],
          description:
            "Placement mode: appendChild (inside target — use this to add nodes under a tool) or append (after target as a sibling). Default: append.",
        },
        config: {
          type: "object",
          description: "Node-type-specific configuration.",
        },
        focus: {
          oneOf: [
            { type: "string" },
            { type: "array", items: { type: "string" } },
          ],
          description:
            "render only: node ID (or an array of node IDs) to highlight in the diagram (e.g. nodes you just created or edited).",
        },
        format: {
          type: "string",
          enum: ["ascii", "mermaid", "both"],
          description:
            "render only: which representation(s) to return. Default: both.",
        },
        legend: {
          type: "boolean",
          description:
            "render only: include a key of only the shapes/edges present in this flow (embedded in the mermaid + returned as `legend` rows + shown in the HTML). Default: true.",
        },
        writeHtml: {
          type: "boolean",
          description:
            "render only: also write a self-contained HTML graph to a tmp file on the user's machine and return htmlUrl / htmlPath. Hand the user the link; do not fetch or regenerate the file. Default: false.",
        },
        openInBrowser: {
          type: "boolean",
          description:
            "render only (requires writeHtml): open the generated HTML in the user's default browser automatically. Default: true — set false to only get htmlUrl/htmlPath back without opening.",
        },
      },
      required: ["operation", "flowId"],
    },
  },

  // 13. manage_packages
  {
    name: "manage_packages",
    description:
      "Export and import Cognigy package .zip files with the same staged workflow as the UI, including moving an LLM together with its Connection between projects. Operations: list_exportable, export (saves the zip locally, dependencies included by default), download (saves an existing package), upload_and_inspect (upload a local zip and return the import preview), inspect (preview an uploaded packageId), import (merge selected resources with UI-parity defaults: 're-identify', knowledge stores 'replace'), read_task (poll a long-running task). Import and export wait for completion by default. Export and download return the absolute saved path and file:// URIs; show them to the user verbatim.",
    annotations: {
      title: "Manage Packages",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: [
            "list_exportable",
            "upload_and_inspect",
            "inspect",
            "import",
            "export",
            "download",
            "read_task",
          ],
          description: "Package workflow operation to perform.",
        },
        projectId: {
          type: "string",
          description:
            "24-char hex project ID for the package import/export workflow.",
        },
        filePath: {
          type: "string",
          description:
            "Absolute path to a local package `.zip` file. Required for upload_and_inspect.",
        },
        packageId: {
          type: "string",
          description:
            "24-char hex package ID. Required for inspect, import, and download.",
        },
        taskId: {
          type: "string",
          description: "24-char hex task ID. Required for read_task.",
        },
        resourceIds: {
          type: "array",
          description:
            "Resource IDs to export into a package. Required for export.",
          items: { type: "string" },
        },
        dependencyResourceIds: {
          type: "array",
          description:
            "Optional dependency resource IDs to include during export. If omitted, all detected dependencies are included by default.",
          items: { type: "string" },
        },
        includeDependencies: {
          type: "boolean",
          description:
            "When true (default), export includes detected dependencies for the selected resources.",
        },
        name: {
          type: "string",
          description:
            "Base package name for export. A timestamp suffix is appended automatically for UI parity.",
        },
        description: {
          type: "string",
          description: "Optional package description for export.",
        },
        outputPath: {
          type: "string",
          description:
            "Absolute local file path or directory where the exported `.zip` should be saved. Used by export and download. If omitted, a temp path is created automatically.",
        },
        resources: {
          type: "array",
          description:
            "Optional resource selections for import. If omitted, preview defaults are used.",
          items: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description:
                  "24-char hex resource ID from the package preview.",
              },
              import: {
                type: "boolean",
                description:
                  "Whether to import the resource. Default: true unless disabled in preview.",
              },
              strategy: {
                type: "string",
                enum: ["replace", "re-identify"],
                description:
                  'Conflict strategy. UI-parity only: "replace" or "re-identify".',
              },
            },
            required: ["id"],
          },
        },
        localeMapping: {
          type: "array",
          description: "Optional locale mapping overrides for import.",
          items: {
            type: "object",
            properties: {
              packageLocaleId: { type: "string" },
              agentLocaleId: { type: "string" },
            },
            required: ["packageLocaleId", "agentLocaleId"],
          },
        },
        waitForCompletion: {
          type: "boolean",
          description:
            "When true (default), wait for import/export task completion.",
        },
        timeoutMs: {
          type: "number",
          description:
            "Polling/upload timeout in milliseconds. Default: 600000.",
        },
      },
      required: ["operation", "projectId"],
    },
  },

  // 11. manage_webchat
  {
    name: "manage_webchat",
    description:
      "Create or update a Webchat v3 endpoint that deploys an agent's flow as an embeddable website chat widget. Without endpointId a new endpoint is created (projectId and flowId required); with endpointId the existing endpoint is updated and the given settings are merged, so pass only what should change. stylePreset applies a predefined look, the setting groups (layout, behavior, startBehavior, homeScreen, ...) cover the Webchat settings, and customJson takes anything else. Always returns demoWebchatUrl, a live test page to show the user as a link, plus _integration with the embed snippet.",
    annotations: {
      title: "Manage Webchat",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        endpointId: {
          type: "string",
          description:
            "24-char hex endpoint ID. If provided, updates the existing endpoint. If omitted, creates a new endpoint.",
        },
        projectId: {
          type: "string",
          description:
            "24-char hex project ID. Required for create, optional for update.",
        },
        flowId: {
          type: "string",
          description:
            "Flow referenceId to connect the webchat endpoint to. Required for create.",
        },
        name: {
          type: "string",
          description:
            'Endpoint display name (e.g. "Customer Support Webchat")',
        },
        stylePreset: {
          type: "string",
          enum: ["classic", "modern", "slick"],
          description:
            "Apply a predefined style. classic: compact 460px. modern: wide 900px with streaming. slick: medium 600px with grey bubbles.",
        },
        layout: {
          type: "object",
          description:
            "Visual layout: title, logo, chat window size, bot output width, input behavior, HTML settings, agent avatars.",
          properties: {
            title: { type: "string", description: "Webchat title bar text" },
            logoUrl: {
              type: "string",
              description: "Header logo URL (28x28px JPG/PNG/SVG/GIF)",
            },
            colors: {
              type: "object",
              description: "Color scheme",
              properties: {
                primaryColor: {
                  type: "string",
                  description: 'Primary color (hex, e.g. "#0052cc")',
                },
                secondaryColor: {
                  type: "string",
                  description: "Secondary color",
                },
                chatBackground: {
                  type: "string",
                  description: "Chat interface background",
                },
                agentMessageBg: {
                  type: "string",
                  description: 'Bot message background (default: "#ffffff")',
                },
                userMessageBg: {
                  type: "string",
                  description: "User message background",
                },
                textLink: { type: "string", description: "Text link color" },
              },
            },
            chatWindowWidth: {
              type: "number",
              description: "Chat window width in px (default: 460)",
            },
            botOutputMaxWidth: {
              type: "number",
              description:
                "Bot output max-width percentage 1-100 (default: 73)",
            },
            disableBotOutputBorder: {
              type: "boolean",
              description: "Hide chat bubble border",
            },
            maxInputRows: {
              type: "number",
              description: "Max lines in reply field before scrollbar",
            },
            enableInputCollation: {
              type: "boolean",
              description: "Combine rapid inputs into one message",
            },
            inputCollationTimeout: {
              type: "number",
              description: "Input collation delay in ms (default: 1000)",
            },
            dynamicImageAspectRatio: {
              type: "boolean",
              description: "Maintain original image proportions",
            },
            disableInputAutocomplete: {
              type: "boolean",
              description: "Disable browser autocomplete",
            },
            enableGenericHtml: {
              type: "boolean",
              description: "Style HTML in text messages",
            },
            allowJsInHtml: {
              type: "boolean",
              description: "Allow JS in HTML messages (security risk)",
            },
            allowJsInUrls: {
              type: "boolean",
              description: "Allow javascript: URLs (security risk)",
            },
            useAgentAvatars: {
              type: "boolean",
              description: "Show separate avatar/name for bot vs human",
            },
            botAvatarName: {
              type: "string",
              description: "Name above bot messages",
            },
            botAvatarLogoUrl: {
              type: "string",
              description: "Logo above bot messages",
            },
            humanAvatarName: {
              type: "string",
              description: "Name above human agent messages",
            },
            humanAvatarLogoUrl: {
              type: "string",
              description: "Logo above human agent messages",
            },
          },
        },
        behavior: {
          type: "object",
          description:
            "Chat behavior: scrolling, streaming, markdown, typing indicators, STT/TTS, message delay.",
          properties: {
            scrollingBehavior: {
              type: "string",
              enum: ["alwaysScroll", "scrollToLastInput"],
              description: "Scroll behavior on new messages",
            },
            collateStreamedOutputs: {
              type: "boolean",
              description: "Merge streamed text into one bubble",
            },
            progressiveMessageRendering: {
              type: "boolean",
              description: "Show text appearing progressively",
            },
            renderMarkdown: {
              type: "boolean",
              description: "Render markdown in bot outputs (default: true)",
            },
            enableTypingIndicator: {
              type: "boolean",
              description: "Show typing animation",
            },
            inputPlaceholder: {
              type: "string",
              description:
                'Reply field placeholder (default: "Type something…")',
            },
            messageDelay: {
              type: "number",
              description: "Delay ms before bot response (default: 500)",
            },
            focusInputAfterPostback: {
              type: "boolean",
              description: "Focus input after button click",
            },
            enableConnectionStatusIndicator: {
              type: "boolean",
              description: "Show warning on lost connection",
            },
            enableStt: {
              type: "boolean",
              description: "Speech-to-text microphone button",
            },
            enableTts: {
              type: "boolean",
              description: "Text-to-speech for bot messages",
            },
            collectMetadata: {
              type: "boolean",
              description: "Collect browser metadata",
            },
            displayAIAgentNotice: {
              type: "boolean",
              description: "Show AI agent notice (default: true)",
            },
            aiAgentNoticeText: {
              type: "string",
              description: "AI agent notice text",
            },
            enableScrollButton: {
              type: "boolean",
              description: "Show scroll-to-bottom button (default: true)",
            },
          },
        },
        startBehavior: {
          type: "object",
          description:
            "How conversation starts: text field, button click, or auto-send.",
          properties: {
            mode: {
              type: "string",
              enum: ["textField", "button", "autoSend"],
              description: "Start mode",
            },
            textPayload: {
              type: "string",
              description: "First message to agent (button/autoSend)",
            },
            dataPayload: {
              type: "string",
              description: "Additional data to flow (button/autoSend)",
            },
            displayText: {
              type: "string",
              description: "Simulated user input bubble (button/autoSend)",
            },
            buttonTitle: {
              type: "string",
              description: "Start button label (button mode only)",
            },
          },
        },
        homeScreen: {
          type: "object",
          description:
            "Home screen with welcome message, background, conversation starters, and previous conversations.",
          properties: {
            enabled: {
              type: "boolean",
              description: "Show home screen on launch",
            },
            welcomeText: { type: "string", description: "Greeting message" },
            backgroundImage: {
              type: "string",
              description: "Background image URL (460x608px)",
            },
            backgroundColor: {
              type: "string",
              description: "CSS color/gradient for background",
            },
            startConversationButtonText: {
              type: "string",
              description: 'Button text (default: "Start conversation")',
            },
            conversationStarters: {
              type: "array",
              description: "Up to 5 starters",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  type: { type: "string", enum: ["postback", "url"] },
                  value: { type: "string" },
                },
                required: ["title", "type", "value"],
              },
            },
            previousConversations: {
              type: "object",
              properties: {
                enabled: { type: "boolean" },
                enableDeleteAll: { type: "boolean" },
                buttonText: { type: "string" },
                title: { type: "string" },
                startNewButtonText: { type: "string" },
              },
            },
          },
        },
        teaserMessage: {
          type: "object",
          description:
            "Teaser message beside webchat icon with optional conversation starters.",
          properties: {
            text: {
              type: "string",
              description: "Message beside webchat icon",
            },
            showInChat: {
              type: "boolean",
              description: "Also show teaser inside chat",
            },
            conversationStarters: {
              type: "array",
              description: "Up to 5 starters",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  type: { type: "string", enum: ["postback", "url"] },
                  value: { type: "string" },
                },
                required: ["title", "type", "value"],
              },
            },
          },
        },
        chatOptions: {
          type: "object",
          description:
            "Chat options menu: quick replies, TTS toggle, conversation rating, footer links.",
          properties: {
            enabled: {
              type: "boolean",
              description: "Enable chat options menu",
            },
            title: { type: "string", description: "Options screen title" },
            enableDeleteConversation: {
              type: "boolean",
              description: "Let users delete current conversation",
            },
            quickReplies: {
              type: "object",
              properties: {
                enabled: { type: "boolean" },
                sectionTitle: { type: "string" },
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      type: { type: "string", enum: ["postback", "url"] },
                      value: { type: "string" },
                    },
                    required: ["title", "type", "value"],
                  },
                },
              },
            },
            textToSpeech: {
              type: "object",
              properties: {
                showToggle: { type: "boolean" },
                toggleLabel: { type: "string" },
                activateByDefault: { type: "boolean" },
              },
            },
            rating: {
              type: "object",
              properties: {
                enabled: { type: "boolean" },
                titleText: { type: "string" },
                commentPlaceholder: { type: "string" },
                submitButtonText: { type: "string" },
                submittedBannerText: { type: "string" },
              },
            },
            footer: {
              type: "object",
              properties: {
                enabled: { type: "boolean" },
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      url: { type: "string" },
                    },
                    required: ["title", "url"],
                  },
                },
              },
            },
          },
        },
        privacyNotice: {
          type: "object",
          description: "Privacy notice shown before chat begins.",
          properties: {
            enabled: { type: "boolean" },
            title: { type: "string" },
            text: { type: "string", description: "Supports Markdown" },
            submitButton: { type: "string" },
            policyLinkTitle: { type: "string" },
            policyLinkUrl: { type: "string" },
          },
        },
        businessHours: {
          type: "object",
          description: "Restrict webchat availability to business hours.",
          properties: {
            enabled: { type: "boolean" },
            mode: { type: "string", enum: ["inform", "disable", "hide"] },
            informationText: { type: "string" },
            informationTitle: { type: "string" },
            timezone: {
              type: "string",
              description: 'IANA timezone (e.g. "Europe/Berlin")',
            },
            schedule: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  dayOfWeek: { type: "string" },
                  startTime: { type: "string" },
                  endTime: { type: "string" },
                },
                required: ["dayOfWeek", "startTime", "endTime"],
              },
            },
          },
        },
        unreadMessages: {
          type: "object",
          description: "Unread message notifications.",
          properties: {
            enableTitleIndicator: { type: "boolean" },
            enableBadge: { type: "boolean" },
            enablePreview: { type: "boolean" },
            enableSound: { type: "boolean" },
          },
        },
        maintenance: {
          type: "object",
          description: "Maintenance mode settings.",
          properties: {
            enabled: { type: "boolean" },
            mode: { type: "string", enum: ["inform", "disable", "hide"] },
            informationText: { type: "string" },
            informationTitle: { type: "string" },
          },
        },
        watermark: {
          type: "object",
          description: "Bottom watermark branding.",
          properties: {
            type: { type: "string", enum: ["default", "custom", "none"] },
            text: { type: "string" },
            url: { type: "string" },
          },
        },
        persistentMenu: {
          type: "object",
          description: "Persistent menu with quick-access items.",
          properties: {
            enabled: { type: "boolean" },
            title: { type: "string" },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  payload: { type: "string" },
                },
                required: ["title", "payload"],
              },
            },
          },
        },
        attachmentUpload: {
          type: "object",
          description: "File upload settings.",
          properties: {
            enabled: { type: "boolean" },
            dropzoneText: { type: "string" },
          },
        },
        webchatIcon: {
          type: "object",
          description: "Webchat icon animation settings.",
          properties: {
            animation: {
              type: "string",
              enum: ["none", "bounce", "swing", "pulse"],
            },
            animationInterval: {
              type: "number",
              description: "Seconds between animations (default: 5)",
            },
            animationSpeed: {
              type: "string",
              enum: ["slow", "normal", "fast", "superfast"],
            },
          },
        },
        customJson: {
          type: "string",
          description:
            "Raw JSON string for advanced Webchat Custom Settings not covered by other fields.",
        },
      },
    },
  },

  // 14. manage_voice_gateway
  {
    name: "manage_voice_gateway",
    description:
      "Create or update a Voice Gateway endpoint with a WebRTC client so users can talk to an agent from the browser. Without endpointId a new voiceGateway2 endpoint is created (projectId and flowId required); with endpointId the existing endpoint is updated and settings are merged. webrtcWidgetConfig customizes theme, transcription, avatar and tagline. Always returns webrtcDemoUrl, a live voice page to show the user as a link, plus _integration with the WebSocket URL and embed snippet.",
    annotations: {
      title: "Manage Voice Gateway",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        endpointId: {
          type: "string",
          description:
            "24-char hex endpoint ID. If provided, updates the existing endpoint. If omitted, creates a new endpoint.",
        },
        projectId: {
          type: "string",
          description:
            "24-char hex project ID. Required for create, optional for update.",
        },
        flowId: {
          type: "string",
          description:
            "Flow referenceId to connect the voice gateway endpoint to. Required for create.",
        },
        name: {
          type: "string",
          description:
            'Endpoint display name (e.g. "Customer Support Voice Agent")',
        },
        webrtcWidgetConfig: {
          type: "object",
          description:
            "WebRTC widget appearance and behavior. Defaults are applied if omitted.",
          properties: {
            label: {
              type: "string",
              description: "AI Agent name displayed in the widget",
            },
            theme: {
              type: "string",
              enum: ["CLEAN_WHITE", "DARK_MODE", "AI_PURPLE"],
              description: "Widget color theme (default: DARK_MODE)",
            },
            transcription: {
              type: "object",
              description: "Transcription display settings",
              properties: {
                enabled: {
                  type: "boolean",
                  description: "Show live transcription (default: true)",
                },
                backgroundMode: {
                  type: "string",
                  enum: ["transparent", "custom"],
                  description:
                    "Transcription background style (default: transparent)",
                },
              },
            },
            demoPage: {
              type: "object",
              description: "Demo page layout settings",
              properties: {
                background: {
                  type: "object",
                  properties: {
                    mode: {
                      type: "string",
                      enum: ["color", "image"],
                    },
                    color: {
                      type: "string",
                      description: 'Background color (default: "#FFFFFF")',
                    },
                  },
                },
                position: {
                  type: "string",
                  enum: ["centered", "bottom-right"],
                  description:
                    "Widget position on demo page (default: centered)",
                },
              },
            },
            avatarLogoUrl: {
              type: "string",
              description: "URL for the agent avatar image",
            },
            tagline: {
              type: "string",
              description: "Short tagline displayed under the agent name",
            },
          },
        },
      },
    },
  },

  // 15. manage_settings
  {
    name: "manage_settings",
    description:
      "Set project-level Cognigy settings. set_voice_preview selects the speech provider for voice preview, auto-detecting a matching speech Connection when connectionId is omitted. set_knowledge_ai sets the Knowledge Search and Answer Extraction models and the content parser; model ids must be llm_model referenceIds from the SAME project (list_resources with useCase 'knowledgeSearch' matches the UI dropdown), and it runs before a knowledge store is created. Details are in the settings and knowledge-setup skills.",
    annotations: {
      title: "Manage Settings",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["set_voice_preview", "set_knowledge_ai"],
          description: "Which operation to perform",
        },
        projectId: {
          type: "string",
          description: "24-char hex project ID",
        },
        provider: {
          type: "string",
          enum: ["microsoft", "google", "aws", "deepgram", "elevenlabs"],
          description: "Speech provider to configure for voice preview",
        },
        connectionId: {
          type: "string",
          description:
            "Connection referenceId to use. If omitted, auto-detects an existing speech connection for the provider.",
        },
        knowledgeSearchModelId: {
          type: "string",
          description:
            "llm_model referenceId from the SAME project to use for Knowledge Search.",
        },
        answerExtractionModelId: {
          type: "string",
          description:
            "Optional llm_model referenceId from the SAME project to use for Answer Extraction.",
        },
        contentParser: {
          type: "string",
          enum: ["default", "legacy", "azure"],
          description:
            "Content Parser to use for Knowledge AI document processing.",
        },
        azureDIConnectionId: {
          type: "string",
          description:
            "Azure AI Document Intelligence connection referenceId. Required when contentParser is azure.",
        },
      },
      required: ["operation", "projectId"],
    },
  },

  // 16. audit_voice_agent
  {
    name: "audit_voice_agent",
    description:
      "Audit a voice agent's flow, and optionally its endpoint and LLM, against the deterministic checks of the Voice AI Go-Live Checklist: Set Session Config first, barge-in and continuous ASR off, input and flow timeouts, streaming, error handling, latency logging, fallback LLM, STT hints, output transformer. Dry-run by default: each failing check reports a proposedFix and nothing changes. apply: true applies the safe fixes, optionally narrowed with only. Provide aiAgentId or flowId; endpointId and projectId enable the endpoint and LLM checks. Checks outside this subset are listed in the voice-go-live-checklist skill.",
    annotations: {
      title: "Audit Voice Agent",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        aiAgentId: {
          type: "string",
          description:
            "24-char hex AI Agent ID. The flow is resolved automatically. Provide this or flowId.",
        },
        flowId: {
          type: "string",
          description:
            "24-char hex flow ID. Use instead of aiAgentId when the flow is known directly.",
        },
        endpointId: {
          type: "string",
          description:
            "24-char hex endpoint ID (optional). When provided, the Output Transformer check is evaluated.",
        },
        projectId: {
          type: "string",
          description:
            "24-char hex project ID (optional). When provided, the agent's LLM is resolved for the fallback check.",
        },
        apply: {
          type: "boolean",
          description:
            "If true, apply the safe auto-fixes for failing checks. Default false (dry-run report only).",
        },
        only: {
          type: "array",
          items: { type: "string" },
          description:
            'Optional list of check IDs to apply when apply is true (e.g. ["vg.barge-in-off", "agent.stream-output"]). If omitted, all auto-fixable failing checks are applied.',
        },
      },
    },
  },

  // 17. manage_snapshots
  {
    name: "manage_snapshots",
    description:
      "Create, list, restore and delete Cognigy Snapshots: immutable, project-wide backups that let agent changes be rolled back. Operations: list (flags plugin-created backups and the count against the snapshot limit), create (waits for the task), restore (returns a preflight report until confirm is true), delete (plugin-created '[AI Backup]' snapshots only, never human ones), decline (record that the user refused a backup for this project), read_task. Restore deletes and recreates every resource in the project, changes all ids, and does not cover Endpoints or Knowledge AI. This is also the tool to call when another tool returns backup_not_offered. Error results such as snapshot_limit_reached or task_status_unknown carry the next step in their hints.",
    annotations: {
      title: "Manage Snapshots",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: ["list", "create", "restore", "delete", "decline", "read_task"],
          description: "Snapshot operation to perform.",
        },
        projectId: {
          type: "string",
          description:
            "24-char hex project ID the snapshot belongs to. Required for every operation.",
        },
        snapshotId: {
          type: "string",
          description:
            "24-char hex snapshot ID. Required for restore and delete. Must belong to projectId.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description:
            "For list: how many snapshots to return (default 100). The reported count, atLimit and oldestDeletableBackup always describe the whole project, never just this page.",
        },
        skip: {
          type: "integer",
          minimum: 0,
          description: "For list: how many snapshots to skip (default 0).",
        },
        taskId: {
          type: "string",
          description: "24-char hex task ID. Required for read_task.",
        },
        label: {
          type: "string",
          minLength: 1,
          maxLength: 120,
          description:
            'Optional short label describing why the backup was taken, e.g. "pre-persona-update". Used inside the generated name; do NOT pass a full snapshot name.',
        },
        confirmDeleteOldest: {
          type: "boolean",
          description:
            "For create at the snapshot limit: when true, delete the OLDEST plugin-created backup to free a slot, then create. Set this only after the user has explicitly agreed. Default: false.",
        },
        confirm: {
          type: "boolean",
          description:
            "For restore: when true, actually perform the destructive restore. When false or omitted, restore only returns a preflight report and changes nothing. Set this only after the user has seen the preflight and agreed. Default: false.",
        },
        waitForCompletion: {
          type: "boolean",
          description:
            "When true (default), wait for the create/restore/delete task to finish.",
        },
        timeoutMs: {
          type: "integer",
          minimum: 1000,
          maximum: 3600000,
          description:
            "Task polling timeout in milliseconds (1000-3600000). Default: 600000. For create it is the budget for the WHOLE call, including any deletion needed to free a slot.",
        },
      },
      required: ["operation", "projectId"],
    },
  },
];
