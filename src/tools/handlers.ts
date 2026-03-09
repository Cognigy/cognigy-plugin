import axios from 'axios';
import { CognigyApiClient } from '../api/client.js';
import { logger } from '../utils/logger.js';
import { filterResponse, filterList, withHints } from './filters.js';
import * as schemas from '../schemas/tools.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_AGENT_IMAGE = 'default-avatar:1';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function retryGetEntryNode(
  apiClient: CognigyApiClient,
  flowId: string,
  maxRetries = 3,
  delayMs = 500,
): Promise<any> {
  for (let i = 0; i < maxRetries; i++) {
    const nodes: any = await apiClient.get(`/v2.0/flows/${flowId}/chart/nodes`, {
      params: { limit: 10 },
    });
    const items = nodes.items ?? nodes;
    const entry = (Array.isArray(items) ? items : []).find((n: any) => n.isEntryPoint) ??
                  (Array.isArray(items) ? items[0] : undefined);
    if (entry) return entry;
    if (i < maxRetries - 1) await new Promise(r => setTimeout(r, delayMs * (i + 1)));
  }
  throw new Error('Could not find entry node in flow');
}

function identifyFailedStep(agentId: string | null, flowId: string | null, endpointId: string | null): string {
  if (!agentId) return 'agent';
  if (!flowId) return 'flow';
  if (!endpointId) return 'endpoint';
  return 'node';
}

const TOOL_TYPE_MAP: Record<string, { type: string; extension: string }> = {
  tool: { type: 'aiAgentJobTool', extension: '@cognigy/basic-nodes' },
  knowledge: { type: 'knowledgeTool', extension: '@cognigy/basic-nodes' },
  send_email: { type: 'sendEmailTool', extension: '@cognigy/basic-nodes' },
  mcp: { type: 'aiAgentJobMCPTool', extension: '@cognigy/basic-nodes' },
};

const AI_AGENT_TOOL_TYPES = new Set([
  'aiAgentJobDefault', 'aiAgentJobTool', 'aiAgentJobMCPTool',
  'knowledgeTool', 'handoverToAiAgentTool', 'handoverToHumanAgentTool',
  'sendEmailTool', 'executeWorkflowTool',
]);

const PROVIDER_CONNECTION_TYPE: Record<string, string> = {
  openAI: 'OpenAIProvider',
  azureOpenAI: 'AzureOpenAIProviderV2',
  anthropic: 'AnthropicProvider',
  google: 'GoogleVertexAIProvider',
  mistral: 'MistralProvider',
};

/**
 * Resolve the flow ID for an AI Agent. The Cognigy agent record doesn't store
 * a direct flowId reference, so we try multiple strategies:
 *   1. Direct field on the agent object (future-proofing)
 *   2. GET /v2.0/aiagents/{id}/jobs — returns Job nodes that reference this agent
 *   3. Search project flows for one whose name matches "{agentName} Flow"
 */
async function resolveFlowForAgent(
  apiClient: CognigyApiClient,
  agentId: string,
): Promise<{ flowId: string; agent: any } | null> {
  const agent: any = await apiClient.get(`/v2.0/aiagents/${agentId}`);

  // Strategy 1: direct field
  const directId = agent.flowId || agent.flow?._id || agent.flow?.id;
  if (directId) return { flowId: directId, agent };

  // Strategy 2: /jobs endpoint — returns nodes referencing this agent
  try {
    const jobs: any = await apiClient.get(`/v2.0/aiagents/${agentId}/jobs`);
    const items = jobs.items ?? jobs;
    if (Array.isArray(items) && items.length > 0) {
      const flowId = items[0].flowId || items[0].flow?._id || items[0].parentId;
      if (flowId) return { flowId, agent };
    }
  } catch {
    // endpoint may not exist on all versions — fall through
  }

  // Strategy 3: search project flows by naming convention
  const projectId = agent.projectId || agent.project?._id || agent.project?.id;
  if (projectId) {
    try {
      const flows: any = await apiClient.get('/v2.0/flows', {
        params: { projectId, limit: 100 },
      });
      const flowItems = flows.items ?? flows;
      if (Array.isArray(flowItems)) {
        const match = flowItems.find((f: any) =>
          f.name === `${agent.name} Flow`,
        );
        if (match) return { flowId: match._id || match.id, agent };

        // Last resort: scan all flows for an aiAgentJob node referencing this agent
        for (const f of flowItems) {
          const fid = f._id || f.id;
          try {
            const nodes: any = await apiClient.get(`/v2.0/flows/${fid}/chart/nodes`, {
              params: { limit: 50 },
            });
            const nodeItems = nodes.items ?? nodes;
            const jobNode = (Array.isArray(nodeItems) ? nodeItems : []).find(
              (n: any) => n.type === 'aiAgentJob' && n.config?.aiAgent === agent.referenceId,
            );
            if (jobNode) return { flowId: fid, agent };
          } catch {
            // skip flows we can't read
          }
        }
      }
    } catch {
      // fall through
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// ToolHandlers
// ---------------------------------------------------------------------------

export class ToolHandlers {
  constructor(
    private apiClient: CognigyApiClient,
    private endpointBaseUrl: string,
  ) {}

  // =========================================================================
  // Tool 1: create_ai_agent
  // =========================================================================
  async handleCreateAiAgent(args: any): Promise<any> {
    const data = schemas.createAiAgentSchema.parse(args);

    let projectId = data.projectId ?? null;
    let createdProject = false;
    let agentId: string | null = null;
    let flowId: string | null = null;
    let endpointId: string | null = null;

    try {
      // Step 0: Auto-create project if none provided
      if (!projectId) {
        const project: any = await this.apiClient.post('/v2.0/projects', {
          name: data.name,
          color: 'blue',
          locale: 'en-US',
        });
        projectId = project._id || project.id;
        createdProject = true;
      }

      // Step 1: Create agent resource
      const agentPayload: any = {
        projectId,
        name: data.name,
        image: DEFAULT_AGENT_IMAGE,
        imageOptimizedFormat: true,
      };
      if (data.description) agentPayload.description = data.description;
      if (data.knowledgeReferenceId) agentPayload.knowledgeReferenceId = data.knowledgeReferenceId;
      const agent: any = await this.apiClient.post('/v2.0/aiagents', agentPayload);
      agentId = agent._id || agent.id;

      // Step 2: Create flow
      const flow: any = await this.apiClient.post('/v2.0/flows', {
        projectId,
        name: `${data.name} Flow`,
        description: `Auto-generated flow for ${data.name}`,
      });
      flowId = flow._id || flow.id;

      // Step 3: Find entry node (with retry)
      const entryNode = await retryGetEntryNode(this.apiClient, flowId!);

      // Step 4: Create AI Agent Job Node
      await this.apiClient.post(`/v2.0/flows/${flowId}/chart/nodes`, {
        mode: 'append',
        target: entryNode._id,
        type: 'aiAgentJob',
        extension: '@cognigy/basic-nodes',
        label: 'AI Agent',
        config: {
          aiAgent: agent.referenceId,
          outputImmediately: true,
        },
      });

      // Step 5: Create REST endpoint
      const endpoint: any = await this.apiClient.post('/v2.0/endpoints', {
        projectId,
        channel: 'rest',
        flowId: flow.referenceId,
        name: `${data.name} REST Endpoint`,
      });
      endpointId = endpoint._id || endpoint.id;

      // Step 6: Check LLM status (non-critical)
      let llmStatus = 'unknown';
      try {
        const llms: any = await this.apiClient.get('/v2.0/largelanguagemodels', {
          params: { projectId },
        });
        const items = llms.items ?? llms;
        llmStatus = Array.isArray(items) && items.length > 0 ? 'configured' : 'missing';
      } catch {
        llmStatus = 'unknown';
      }

      const result: any = {
        projectId,
        projectCreated: createdProject,
        agent: filterResponse('agent', agent),
        flow: filterResponse('flow', flow),
        endpoint: filterResponse('endpoint', endpoint),
        endpointUrl: endpoint.URLToken
          ? `${this.endpointBaseUrl}/${endpoint.URLToken}`
          : 'URL not available',
        llmStatus,
      };

      if (llmStatus === 'missing') {
        return withHints(result, {
          warning: 'No LLM resource in project. Agent won\'t generate responses.',
          resource: 'cognigy://guide/agent-creation',
          action: `Run setup_llm with projectId "${projectId}" before talk_to_agent.`,
        });
      }

      return result;
    } catch (error: any) {
      // Rollback in reverse order
      if (endpointId) try { await this.apiClient.delete(`/v2.0/endpoints/${endpointId}`); } catch { /* swallow */ }
      if (flowId) try { await this.apiClient.delete(`/v2.0/flows/${flowId}`); } catch { /* swallow */ }
      if (agentId) try { await this.apiClient.delete(`/v2.0/aiagents/${agentId}`); } catch { /* swallow */ }
      if (createdProject && projectId) try { await this.apiClient.delete(`/v2.0/projects/${projectId}`); } catch { /* swallow */ }

      return withHints(
        { failed: { step: identifyFailedStep(agentId, flowId, endpointId), error: error.message } },
        {
          likely_cause: 'Orchestration failed. All created resources were rolled back.',
          resource: 'cognigy://guide/troubleshooting',
          action: 'Read the troubleshooting guide, then retry create_ai_agent.',
        },
      );
    }
  }

  // =========================================================================
  // Tool 2: update_ai_agent
  // =========================================================================
  async handleUpdateAiAgent(args: any): Promise<any> {
    const { aiAgentId, jobConfig, ...rest } = schemas.updateAiAgentSchema.parse(args);

    const updatedParts: string[] = [];

    // Step 1: Patch AI Agent resource if any agent-level fields provided
    const agentPayload: Record<string, any> = {};
    if (rest.name !== undefined) agentPayload.name = rest.name;
    if (rest.description !== undefined) agentPayload.description = rest.description;
    if (rest.instructions !== undefined) agentPayload.instructions = rest.instructions;
    if (rest.knowledgeReferenceId !== undefined) agentPayload.knowledgeReferenceId = rest.knowledgeReferenceId;

    let agentResult: any;
    if (Object.keys(agentPayload).length > 0) {
      agentResult = await this.apiClient.patch(`/v2.0/aiagents/${aiAgentId}`, agentPayload);
      updatedParts.push('agent');
    }

    // Step 2: Patch AI Agent Job Node config if any job-level fields provided
    let jobNodeResult: any;
    if (jobConfig && Object.keys(jobConfig).length > 0) {
      const resolved = await resolveFlowForAgent(this.apiClient, aiAgentId);
      if (!resolved) {
        return withHints(
          { error: 'Could not find a flow associated with this agent. Job config was not updated.' },
          {
            resource: 'cognigy://guide/agent-creation',
            action: 'Ensure the agent was created via create_ai_agent, which provisions the flow and Job Node.',
          },
        );
      }

      const nodes: any = await this.apiClient.get(`/v2.0/flows/${resolved.flowId}/chart/nodes`, {
        params: { limit: 100 },
      });
      const allNodes = nodes.items ?? nodes;
      const jobNode = (Array.isArray(allNodes) ? allNodes : []).find(
        (n: any) => n.type === 'aiAgentJob',
      );
      if (!jobNode) {
        return withHints(
          { error: 'No AI Agent Job Node found in the flow. Job config was not updated.' },
          {
            resource: 'cognigy://guide/agent-creation',
            action: 'Ensure the agent was created via create_ai_agent.',
          },
        );
      }

      const nodeConfigPatch: Record<string, any> = {};
      if (jobConfig.llmProviderReferenceId !== undefined) nodeConfigPatch.llmProviderReferenceId = jobConfig.llmProviderReferenceId;
      if (jobConfig.jobName !== undefined) nodeConfigPatch.name = jobConfig.jobName;
      if (jobConfig.jobDescription !== undefined) nodeConfigPatch.description = jobConfig.jobDescription;
      if (jobConfig.jobInstructions !== undefined) nodeConfigPatch.instructions = jobConfig.jobInstructions;
      if (jobConfig.temperature !== undefined) nodeConfigPatch.temperature = jobConfig.temperature;
      if (jobConfig.maxTokens !== undefined) nodeConfigPatch.maxTokens = jobConfig.maxTokens;

      const jobNodeId = jobNode._id || jobNode.id;
      jobNodeResult = await this.apiClient.patch(
        `/v2.0/flows/${resolved.flowId}/chart/nodes/${jobNodeId}`,
        { config: nodeConfigPatch },
      );
      updatedParts.push('jobNode');
    }

    if (updatedParts.length === 0) {
      return withHints(
        { error: 'Nothing to update. Provide agent-level fields (name, description, instructions, knowledgeReferenceId) and/or jobConfig fields.' },
        { action: 'Include at least one field to update.' },
      );
    }

    // Build response from what was updated
    const response: any = { updated: updatedParts };
    if (agentResult) {
      Object.assign(response, filterResponse('agent', agentResult));
    }
    if (jobNodeResult) {
      response.jobNode = { id: jobNodeResult._id || jobNodeResult.id, configUpdated: Object.keys(jobConfig!) };
    }

    return response;
  }

  // =========================================================================
  // Tool 3: setup_llm
  // =========================================================================
  async handleSetupLlm(args: any): Promise<any> {
    const data = schemas.setupLlmSchema.parse(args);

    if (!data.apiKey && !data.connectionId) {
      return withHints(
        { error: 'Either apiKey or connectionId must be provided.' },
        {
          resource: 'cognigy://guide/llm-providers',
          action: 'Read the provider guide for credential requirements.',
        },
      );
    }

    let connectionRefId = data.connectionId;

    // If apiKey is provided, auto-create a Connection first
    if (data.apiKey && !connectionRefId) {
      try {
        const connection: any = await this.apiClient.post('/v2.0/connections', {
          projectId: data.projectId,
          name: `${data.provider} - auto`,
          type: PROVIDER_CONNECTION_TYPE[data.provider] ?? data.provider,
          extension: '@cognigy/generative-ai-provider',
          fields: { apiKey: data.apiKey },
        });
        connectionRefId = connection.referenceId || connection._id || connection.id;
      } catch (connError: any) {
        return withHints(
          { error: `Failed to create connection: ${connError.message}` },
          {
            resource: 'cognigy://guide/llm-providers',
            action: 'Check API key and provider, then retry.',
          },
        );
      }
    }

    const displayName = data.name || data.modelType;

    try {
      const result = await this.apiClient.post('/v2.0/largelanguagemodels', {
        projectId: data.projectId,
        name: displayName,
        modelType: data.modelType,
        provider: data.provider,
        connectionId: connectionRefId,
        isDefault: data.isDefault ?? true,
      });
      return filterResponse('llm_model', result);
    } catch (error: any) {
      return withHints(
        { error: error.message },
        {
          resource: 'cognigy://guide/llm-providers',
          action: 'Read the provider guide for valid provider names and model strings.',
        },
      );
    }
  }

  // =========================================================================
  // Tool 4: talk_to_agent
  // =========================================================================
  async handleTalkToAgent(args: any): Promise<any> {
    const data = schemas.talkToAgentSchema.parse(args);

    const sessionId = data.sessionId || `mcp-session-${Date.now()}`;
    const userId = data.userId || 'mcp-user';

    const payload: any = { userId, sessionId, text: data.message };
    if (data.data) payload.data = data.data;

    try {
      const response = await axios.post(data.endpointUrl, payload, {
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        timeout: 30000,
      });

      let agentResponse = response.data.text || '';
      const outputStack = response.data.outputStack || [];
      const textOutputs = outputStack
        .filter((o: any) => o.text?.trim())
        .map((o: any) => o.text);
      if (textOutputs.length > 0) agentResponse = textOutputs.join(' ');

      const result: any = { agentResponse, sessionId };

      if (data.verbose) {
        result.rawResponse = response.data;
      }

      if (!agentResponse) {
        return withHints(result, {
          likely_cause: 'Agent returned no text. Possible causes: 1) no LLM configured, 2) empty agent description, 3) endpoint not connected to flow.',
          resource: 'cognigy://guide/troubleshooting',
          action: 'Read the troubleshooting guide for diagnostic steps.',
        });
      }

      return result;
    } catch (error: any) {
      return withHints(
        { error: `Request failed with status ${error.response?.status ?? 'unknown'}`, sessionId },
        {
          likely_cause: 'Endpoint URL invalid or expired.',
          resource: 'cognigy://guide/troubleshooting',
          action: "Verify endpoint with list_resources { resourceType: 'endpoint' }.",
        },
      );
    }
  }

  // =========================================================================
  // Tool 5: list_resources
  // =========================================================================
  async handleListResources(args: any): Promise<any> {
    const data = schemas.listResourcesSchema.parse(args);
    const { resourceType, projectId, aiAgentId, limit, skip } = data;
    const paging = { limit: limit ?? 25, skip: skip ?? 0 };

    // Validate projectId requirement
    if (resourceType !== 'project' && resourceType !== 'tool' && !projectId) {
      return withHints(
        { error: `projectId is required for resourceType '${resourceType}'.` },
        {
          action: "Use list_resources { resourceType: 'project' } to find projectIds first.",
        },
      );
    }
    if (resourceType === 'tool' && !aiAgentId) {
      return withHints(
        { error: "aiAgentId is required for resourceType 'tool'." },
        {
          action: "Use list_resources { resourceType: 'agent', projectId } to find agents first.",
        },
      );
    }

    let items: any[];
    let total: number | undefined;

    switch (resourceType) {
      case 'project': {
        const res: any = await this.apiClient.get('/v2.0/projects', { params: paging });
        items = res.items ?? res;
        total = res.total;
        break;
      }
      case 'agent': {
        const res: any = await this.apiClient.get('/v2.0/aiagents', {
          params: { projectId, ...paging },
        });
        items = res.items ?? res;
        total = res.total;
        break;
      }
      case 'flow': {
        const res: any = await this.apiClient.get('/v2.0/flows', {
          params: { projectId, ...paging },
        });
        items = res.items ?? res;
        total = res.total;
        break;
      }
      case 'endpoint': {
        const res: any = await this.apiClient.get('/v2.0/endpoints', {
          params: { projectId, ...paging },
        });
        items = res.items ?? res;
        total = res.total;
        break;
      }
      case 'llm_model': {
        const res: any = await this.apiClient.get('/v2.0/largelanguagemodels', {
          params: { projectId, ...paging },
        });
        items = res.items ?? res;
        total = res.total;
        break;
      }
      case 'knowledge_store': {
        const res: any = await this.apiClient.get('/v2.0/knowledgestores', {
          params: { projectId, ...paging },
        });
        items = res.items ?? res;
        total = res.total;
        break;
      }
      case 'conversation': {
        const params: any = { projectId, ...paging };
        if (data.startDate) params.startDate = data.startDate;
        if (data.endDate) params.endDate = data.endDate;
        if (data.channel) params.channel = data.channel;
        const res: any = await this.apiClient.get('/v2.0/conversations', { params });
        items = res.items ?? res;
        total = res.total;
        break;
      }
      case 'extension': {
        const res: any = await this.apiClient.get(`/v2.0/projects/${projectId}/extensions`, {
          params: paging,
        });
        items = res.items ?? res;
        total = res.total;
        break;
      }
      case 'function': {
        const res: any = await this.apiClient.get(`/v2.0/projects/${projectId}/functions`, {
          params: paging,
        });
        items = res.items ?? res;
        total = res.total;
        break;
      }
      case 'tool': {
        const resolved = await resolveFlowForAgent(this.apiClient, aiAgentId!);
        if (!resolved) {
          return withHints(
            { error: 'Could not find a flow associated with this agent.' },
            {
              likely_cause: 'Agent was not created via create_ai_agent.',
              resource: 'cognigy://guide/tools-setup',
              action: 'Create the agent with create_ai_agent first.',
            },
          );
        }
        const agentFlowId = resolved.flowId;
        const nodes: any = await this.apiClient.get(`/v2.0/flows/${agentFlowId}/chart/nodes`, {
          params: { limit: 100 },
        });
        const allNodes = nodes.items ?? nodes;
        items = (Array.isArray(allNodes) ? allNodes : [])
          .filter((n: any) => AI_AGENT_TOOL_TYPES.has(n.type))
          .map((n: any) => ({
            toolId: n._id || n.id,
            name: n.label || n.name,
            toolType: n.type,
          }));
        total = items.length;
        break;
      }
      default:
        throw new Error(`Unknown resourceType: ${resourceType}`);
    }

    if (!Array.isArray(items)) items = [];
    const filtered = resourceType === 'tool' ? items : filterList(resourceType, items);
    const result: any = { items: filtered, total: total ?? filtered.length };

    if (filtered.length === 0 && resourceType === 'agent') {
      return withHints(result, {
        hint: 'No agents found.',
        resource: 'cognigy://guide/agent-creation',
      });
    }

    return result;
  }

  // =========================================================================
  // Tool 6: get_resource
  // =========================================================================
  async handleGetResource(args: any): Promise<any> {
    const data = schemas.getResourceSchema.parse(args);
    const { resourceType, id, raw } = data;

    const endpointMap: Record<string, string> = {
      agent: `/v2.0/aiagents/${id}`,
      flow: `/v2.0/flows/${id}`,
      endpoint: `/v2.0/endpoints/${id}`,
      project: `/v2.0/projects/${id}`,
      conversation: `/v2.0/conversations/${id}`,
      session_state: `/v2.0/sessions/${id}/state`,
      llm_model: `/v2.0/largelanguagemodels/${id}`,
      knowledge_store: `/v2.0/knowledgestores/${id}`,
      extension: `/v2.0/extensions/${id}`,
      function: `/v2.0/functions/${id}`,
    };

    const url = endpointMap[resourceType];
    if (!url) throw new Error(`Unknown resourceType: ${resourceType}`);

    const result = await this.apiClient.get(url);
    if (raw) return result;

    const filterType = resourceType === 'session_state' ? resourceType : resourceType;
    return RESOURCE_FILTERS_GET[filterType]
      ? RESOURCE_FILTERS_GET[filterType](result)
      : filterResponse(resourceType, result);
  }

  // =========================================================================
  // Tool 7: delete_resource
  // =========================================================================
  async handleDeleteResource(args: any): Promise<any> {
    const data = schemas.deleteResourceSchema.parse(args);
    const { resourceType, id, aiAgentId } = data;

    if (resourceType === 'tool') {
      if (!aiAgentId) {
        return withHints(
          { error: "aiAgentId is required for resourceType 'tool'." },
          { action: "Provide aiAgentId so the handler can resolve the agent's flow." },
        );
      }
      const resolved = await resolveFlowForAgent(this.apiClient, aiAgentId);
      if (!resolved) {
        return withHints(
          { error: 'Could not find a flow associated with this agent.' },
          { resource: 'cognigy://guide/tools-setup', action: 'Ensure agent was created via create_ai_agent.' },
        );
      }
      await this.apiClient.delete(`/v2.0/flows/${resolved.flowId}/chart/nodes/${id}`);
      return { deleted: true, resourceType: 'tool', id };
    }

    const deleteMap: Record<string, string> = {
      agent: `/v2.0/aiagents/${id}`,
      flow: `/v2.0/flows/${id}`,
      endpoint: `/v2.0/endpoints/${id}`,
      llm_model: `/v2.0/largelanguagemodels/${id}`,
      knowledge_store: `/v2.0/knowledgestores/${id}`,
      function: `/v2.0/functions/${id}`,
    };

    const url = deleteMap[resourceType];
    if (!url) throw new Error(`Unknown resourceType: ${resourceType}`);

    await this.apiClient.delete(url);
    return { deleted: true, resourceType, id };
  }

  // =========================================================================
  // Tool 8: manage_knowledge
  // =========================================================================
  async handleManageKnowledge(args: any): Promise<any> {
    const data = schemas.manageKnowledgeSchema.parse(args);

    switch (data.operation) {
      case 'create_store': {
        if (!data.projectId) throw new Error('projectId is required for create_store');
        if (!data.name) throw new Error('name is required for create_store');
        const payload: any = { projectId: data.projectId, name: data.name };
        if (data.description) payload.description = data.description;
        const result = await this.apiClient.post('/v2.0/knowledgestores', payload);
        return filterResponse('knowledge_store', result);
      }
      case 'create_source': {
        if (!data.knowledgeStoreId) throw new Error('knowledgeStoreId is required for create_source');
        const storeId = data.knowledgeStoreId;
        const sourceType = data.type ?? (data.url ? 'url' : 'manual');

        if (sourceType === 'url') {
          if (!data.url) throw new Error('url is required for type "url"');
          const payload: any = {
            name: data.name || data.url,
            type: 'url',
            url: data.url,
          };
          if (data.description) payload.description = data.description;
          const result: any = await this.apiClient.post(
            `/v2.0/knowledgestores/${storeId}/sources`,
            payload,
          );
          return withHints(
            { source: { id: result.taskData?.taskId || result._id || result.id, type: 'url', status: 'ingesting' } },
            {
              warning: 'URL ingestion is async — content may not be searchable for 10-60 seconds.',
              resource: 'cognigy://guide/knowledge-setup',
              action: 'Wait, then use search_chunks to verify.',
            },
          );
        }

        // Manual/text source: create source, then add a chunk with the text
        if (!data.text) throw new Error('text is required for manual sources');
        const sourcePayload: any = {
          name: data.name || 'Manual source',
          type: 'manual',
        };
        if (data.description) sourcePayload.description = data.description;
        const sourceResult: any = await this.apiClient.post(
          `/v2.0/knowledgestores/${storeId}/sources`,
          sourcePayload,
        );
        const source = sourceResult.knowledgeSource ?? sourceResult;
        const sourceId = source._id || source.id;

        const chunkResult: any = await this.apiClient.post(
          `/v2.0/knowledgestores/${storeId}/sources/${sourceId}/chunks`,
          { text: data.text, order: 1 },
        );

        return withHints(
          {
            source: { id: sourceId, type: 'manual', name: sourcePayload.name },
            chunk: { id: chunkResult._id || chunkResult.id },
          },
          {
            warning: 'Chunk created. It may take a few seconds before it becomes searchable.',
            resource: 'cognigy://guide/knowledge-setup',
            action: 'Wait, then use search_chunks to verify.',
          },
        );
      }
      case 'list_chunks': {
        if (!data.knowledgeStoreId) throw new Error('knowledgeStoreId is required for list_chunks');
        const ksId = data.knowledgeStoreId;

        let targetSourceId = data.sourceId;
        if (!targetSourceId) {
          const sources: any = await this.apiClient.get(
            `/v2.0/knowledgestores/${ksId}/sources`,
          );
          const srcItems = sources.items ?? sources;
          if (!Array.isArray(srcItems) || srcItems.length === 0) {
            return withHints(
              { chunks: [], sources: [] },
              {
                likely_cause: 'No sources found in this knowledge store.',
                resource: 'cognigy://guide/knowledge-setup',
                action: 'Add a source first with create_source.',
              },
            );
          }
          targetSourceId = srcItems[0]._id || srcItems[0].id;
        }

        const params: any = { limit: data.limit ?? 25 };
        if (data.filter) params.filter = data.filter;

        const result: any = await this.apiClient.get(
          `/v2.0/knowledgestores/${ksId}/sources/${targetSourceId}/chunks`,
          { params },
        );
        const chunks = result.items ?? result;
        return {
          chunks: Array.isArray(chunks) ? chunks.map((c: any) => ({
            id: c._id || c.id,
            text: c.text,
            order: c.order,
            disabled: c.disabled,
          })) : [],
          total: result.total ?? (Array.isArray(chunks) ? chunks.length : 0),
          sourceId: targetSourceId,
        };
      }
      default:
        throw new Error(`Unknown operation: ${data.operation}`);
    }
  }

  // =========================================================================
  // Tool 9: create_tool
  // =========================================================================
  async handleCreateTool(args: any): Promise<any> {
    const data = schemas.createToolSchema.parse(args);

    // Step 1: Resolve the agent's flow
    const resolved = await resolveFlowForAgent(this.apiClient, data.aiAgentId);
    if (!resolved) {
      return withHints(
        { error: 'Could not find a flow associated with this agent.' },
        {
          likely_cause: 'create_tool requires an agent created via create_ai_agent (which auto-provisions the flow).',
          resource: 'cognigy://guide/tools-setup',
          action: 'Read the tools guide, ensure agent was created via create_ai_agent, then retry.',
        },
      );
    }
    const { flowId } = resolved;

    // Step 2: Find the AI Agent Job Node
    const nodes: any = await this.apiClient.get(`/v2.0/flows/${flowId}/chart/nodes`, {
      params: { limit: 100 },
    });
    const allNodes = nodes.items ?? nodes;
    const jobNode = (Array.isArray(allNodes) ? allNodes : []).find(
      (n: any) => n.type === 'aiAgentJob',
    );

    if (!jobNode) {
      return withHints(
        { error: 'No aiAgentJob node found in the flow. Tools must be children of an AI Agent Job node.' },
        {
          resource: 'cognigy://guide/tools-setup',
          action: 'Ensure the agent was created via create_ai_agent (which provisions the aiAgentJob node).',
        },
      );
    }

    // Step 3: Create the tool node
    const mapping = TOOL_TYPE_MAP[data.toolType];
    if (!mapping) throw new Error(`Unknown toolType: ${data.toolType}`);

    const nodeConfig: any = {};
    const cfg = data.config;
    switch (data.toolType) {
      case 'tool':
        if (cfg.toolId) nodeConfig.toolId = cfg.toolId;
        if (cfg.description) nodeConfig.description = cfg.description;
        if (cfg.parameters) {
          nodeConfig.useParameters = true;
          nodeConfig.parameters = cfg.parameters;
        }
        break;
      case 'knowledge':
        if (cfg.knowledgeStoreId) nodeConfig.knowledgeStoreId = cfg.knowledgeStoreId;
        if (cfg.toolId) nodeConfig.toolId = cfg.toolId;
        if (cfg.description) nodeConfig.description = cfg.description;
        if (cfg.topK) nodeConfig.topK = cfg.topK;
        break;
      case 'send_email':
        if (cfg.toolId) nodeConfig.toolId = cfg.toolId;
        if (cfg.description) nodeConfig.description = cfg.description;
        if (cfg.recipient) nodeConfig.recipient = cfg.recipient;
        break;
      case 'mcp':
        if (cfg.mcpName) nodeConfig.name = cfg.mcpName;
        if (cfg.mcpServerUrl) nodeConfig.mcpServerUrl = cfg.mcpServerUrl;
        if (cfg.timeout) nodeConfig.timeout = cfg.timeout;
        break;
    }

    let createdNodeId: string | null = null;
    try {
      const nodePayload: any = {
        type: mapping.type,
        extension: mapping.extension,
        mode: 'appendChild',
        target: jobNode._id,
        label: data.name,
        config: nodeConfig,
      };

      const createdNode: any = await this.apiClient.post(
        `/v2.0/flows/${flowId}/chart/nodes`,
        nodePayload,
      );
      createdNodeId = createdNode._id || createdNode.id;

      return {
        toolId: createdNodeId,
        name: data.name,
        toolType: data.toolType,
      };
    } catch (error: any) {
      if (createdNodeId) {
        try { await this.apiClient.delete(`/v2.0/flows/${flowId}/chart/nodes/${createdNodeId}`); } catch { /* swallow */ }
      }
      return withHints(
        { error: error.message },
        {
          resource: 'cognigy://guide/tools-setup',
          action: 'Check tool type and config, then retry.',
        },
      );
    }
  }

  // =========================================================================
  // Tool 10: create_custom_http_tool
  // =========================================================================
  async handleCreateCustomHttpTool(args: any): Promise<any> {
    const data = schemas.createCustomHttpToolSchema.parse(args);

    const resolved = await resolveFlowForAgent(this.apiClient, data.aiAgentId);
    if (!resolved) {
      return withHints(
        { error: 'Could not find a flow associated with this agent.' },
        {
          likely_cause: 'create_custom_http_tool requires an agent created via create_ai_agent (which auto-provisions the flow).',
          resource: 'cognigy://guide/tools-setup',
          action: 'Read the tools guide, ensure agent was created via create_ai_agent, then retry.',
        },
      );
    }
    const { flowId } = resolved;

    const nodes: any = await this.apiClient.get(`/v2.0/flows/${flowId}/chart/nodes`, {
      params: { limit: 100 },
    });
    const allNodes = nodes.items ?? nodes;
    const jobNode = (Array.isArray(allNodes) ? allNodes : []).find(
      (n: any) => n.type === 'aiAgentJob',
    );

    if (!jobNode) {
      return withHints(
        { error: 'No aiAgentJob node found in the flow.' },
        {
          resource: 'cognigy://guide/tools-setup',
          action: 'Ensure the agent was created via create_ai_agent.',
        },
      );
    }

    const createdNodeIds: string[] = [];
    try {
      // Step 1: Create the aiAgentJobTool node (parent tool node)
      const toolConfig: any = {
        toolId: data.toolId,
        description: data.description,
      };
      if (data.parameters) {
        toolConfig.useParameters = true;
        toolConfig.parameters = data.parameters;
      }

      const toolNode: any = await this.apiClient.post(
        `/v2.0/flows/${flowId}/chart/nodes`,
        {
          type: 'aiAgentJobTool',
          extension: '@cognigy/basic-nodes',
          mode: 'appendChild',
          target: jobNode._id,
          label: data.name,
          config: toolConfig,
        },
      );
      const toolNodeId = toolNode._id || toolNode.id;
      createdNodeIds.push(toolNodeId);

      // Step 2: Optionally create pre-process Code node
      let preProcessNodeId: string | undefined;
      if (data.preProcessCode) {
        const preNode: any = await this.apiClient.post(
          `/v2.0/flows/${flowId}/chart/nodes`,
          {
            type: 'code',
            extension: '@cognigy/basic-nodes',
            mode: 'appendChild',
            target: toolNodeId,
            label: `${data.name} - Pre-Process`,
            config: { code: data.preProcessCode },
          },
        );
        preProcessNodeId = preNode._id || preNode.id;
        if (preProcessNodeId) createdNodeIds.push(preProcessNodeId);
      }

      // Step 3: Create the HTTP Request node
      // The Cognigy httpRequest descriptor uses `type` for the HTTP method,
      // `payloadType`+`payloadJSON`/`payloadText` for the body, and
      // `headers` as a JSON string — NOT `method`, `body`, or object headers.
      const httpMethod = data.http.method || 'GET';
      const httpConfig: any = {
        url: data.http.url,
        type: httpMethod,
      };
      if (data.http.headers) {
        httpConfig.headers = JSON.stringify(data.http.headers);
      }
      if (data.http.body) {
        try {
          const parsed = JSON.parse(data.http.body);
          httpConfig.payloadType = 'json';
          httpConfig.payloadJSON = parsed;
        } catch {
          httpConfig.payloadType = 'text';
          httpConfig.payloadText = data.http.body;
        }
      }

      const appendTarget = preProcessNodeId ?? toolNodeId;
      const httpNode: any = await this.apiClient.post(
        `/v2.0/flows/${flowId}/chart/nodes`,
        {
          type: 'httpRequest',
          extension: '@cognigy/basic-nodes',
          mode: preProcessNodeId ? 'append' : 'appendChild',
          target: appendTarget,
          label: `${data.name} - HTTP Request`,
          config: httpConfig,
        },
      );
      const httpNodeId = httpNode._id || httpNode.id;
      createdNodeIds.push(httpNodeId);

      // Step 4: Optionally create post-process Code node
      let postProcessNodeId: string | undefined;
      if (data.postProcessCode) {
        const postNode: any = await this.apiClient.post(
          `/v2.0/flows/${flowId}/chart/nodes`,
          {
            type: 'code',
            extension: '@cognigy/basic-nodes',
            mode: 'append',
            target: httpNodeId,
            label: `${data.name} - Post-Process`,
            config: { code: data.postProcessCode },
          },
        );
        postProcessNodeId = postNode._id || postNode.id;
        if (postProcessNodeId) createdNodeIds.push(postProcessNodeId);
      }

      return {
        toolId: toolNodeId,
        name: data.name,
        toolType: 'custom_http',
        childNodes: {
          ...(preProcessNodeId ? { preProcessNodeId } : {}),
          httpNodeId,
          ...(postProcessNodeId ? { postProcessNodeId } : {}),
        },
      };
    } catch (error: any) {
      // Rollback in reverse order
      for (const nodeId of createdNodeIds.reverse()) {
        try { await this.apiClient.delete(`/v2.0/flows/${flowId}/chart/nodes/${nodeId}`); } catch { /* swallow */ }
      }
      return withHints(
        { error: error.message },
        {
          resource: 'cognigy://guide/tools-setup',
          action: 'Check HTTP config and code snippets, then retry.',
        },
      );
    }
  }

  // =========================================================================
  // Tool 11: update_tool
  // =========================================================================
  async handleUpdateTool(args: any): Promise<any> {
    const data = schemas.updateToolSchema.parse(args);

    const resolved = await resolveFlowForAgent(this.apiClient, data.aiAgentId);
    if (!resolved) {
      return withHints(
        { error: 'Could not find a flow associated with this agent.' },
        {
          likely_cause: 'update_tool requires an agent created via create_ai_agent.',
          resource: 'cognigy://guide/tools-setup',
          action: 'Ensure agent was created via create_ai_agent, then retry.',
        },
      );
    }
    const { flowId } = resolved;

    const hasToolNodeUpdate = data.name || data.config;
    const hasChildUpdates = data.http || data.preProcessCode !== undefined || data.postProcessCode !== undefined;

    if (!hasToolNodeUpdate && !hasChildUpdates) {
      return withHints(
        { error: 'Nothing to update. Provide at least name, config, http, preProcessCode, or postProcessCode.' },
        { action: 'Include fields to update in the request.' },
      );
    }

    // Step 1: Update the tool node itself (label and/or config)
    const updatedFields: string[] = [];

    if (hasToolNodeUpdate) {
      const patchPayload: any = {};
      if (data.name) patchPayload.label = data.name;

      if (data.config) {
        const nodeConfig: any = {};
        const cfg = data.config;
        const toolType = data.toolType;

        if (toolType === 'tool' || !toolType) {
          if (cfg.toolId) nodeConfig.toolId = cfg.toolId;
          if (cfg.description) nodeConfig.description = cfg.description;
          if (cfg.parameters) {
            nodeConfig.useParameters = true;
            nodeConfig.parameters = cfg.parameters;
          }
        }
        if (toolType === 'knowledge') {
          if (cfg.knowledgeStoreId) nodeConfig.knowledgeStoreId = cfg.knowledgeStoreId;
          if (cfg.toolId) nodeConfig.toolId = cfg.toolId;
          if (cfg.description) nodeConfig.description = cfg.description;
          if (cfg.topK) nodeConfig.topK = cfg.topK;
        }
        if (toolType === 'send_email') {
          if (cfg.toolId) nodeConfig.toolId = cfg.toolId;
          if (cfg.description) nodeConfig.description = cfg.description;
          if (cfg.recipient) nodeConfig.recipient = cfg.recipient;
        }
        if (toolType === 'mcp') {
          if (cfg.mcpName) nodeConfig.name = cfg.mcpName;
          if (cfg.mcpServerUrl) nodeConfig.mcpServerUrl = cfg.mcpServerUrl;
          if (cfg.timeout) nodeConfig.timeout = cfg.timeout;
        }

        if (Object.keys(nodeConfig).length > 0) {
          patchPayload.config = nodeConfig;
        }
      }

      if (Object.keys(patchPayload).length > 0) {
        await this.apiClient.patch(
          `/v2.0/flows/${flowId}/chart/nodes/${data.toolNodeId}`,
          patchPayload,
        );
        if (data.name) updatedFields.push('name');
        if (patchPayload.config) updatedFields.push('config');
      }
    }

    // Step 2: Update child nodes for custom HTTP tools (http, code nodes)
    if (hasChildUpdates) {
      const nodes: any = await this.apiClient.get(`/v2.0/flows/${flowId}/chart/nodes`, {
        params: { limit: 100 },
      });
      const allNodes = nodes.items ?? nodes;
      const childNodes = (Array.isArray(allNodes) ? allNodes : []).filter(
        (n: any) => n.parentId === data.toolNodeId || n.parent === data.toolNodeId,
      );

      if (data.http) {
        const httpNode = childNodes.find((n: any) => n.type === 'httpRequest');
        if (httpNode) {
          const httpPatch: any = {};
          if (data.http.url) httpPatch.url = data.http.url;
          if (data.http.method) httpPatch.type = data.http.method;
          if (data.http.headers) httpPatch.headers = JSON.stringify(data.http.headers);
          if (data.http.body) {
            try {
              const parsed = JSON.parse(data.http.body);
              httpPatch.payloadType = 'json';
              httpPatch.payloadJSON = parsed;
            } catch {
              httpPatch.payloadType = 'text';
              httpPatch.payloadText = data.http.body;
            }
          }
          await this.apiClient.patch(
            `/v2.0/flows/${flowId}/chart/nodes/${httpNode._id || httpNode.id}`,
            { config: httpPatch },
          );
          updatedFields.push('http');
        }
      }

      if (data.preProcessCode !== undefined) {
        const codeNodes = childNodes.filter((n: any) => n.type === 'code');
        const preNode = codeNodes.find((n: any) =>
          n.label?.includes('Pre-Process') || n.label?.includes('pre-process'),
        ) ?? codeNodes[0];
        if (preNode) {
          await this.apiClient.patch(
            `/v2.0/flows/${flowId}/chart/nodes/${preNode._id || preNode.id}`,
            { config: { code: data.preProcessCode } },
          );
          updatedFields.push('preProcessCode');
        }
      }

      if (data.postProcessCode !== undefined) {
        const codeNodes = childNodes.filter((n: any) => n.type === 'code');
        const postNode = codeNodes.find((n: any) =>
          n.label?.includes('Post-Process') || n.label?.includes('post-process'),
        ) ?? (codeNodes.length > 1 ? codeNodes[codeNodes.length - 1] : undefined);
        if (postNode) {
          await this.apiClient.patch(
            `/v2.0/flows/${flowId}/chart/nodes/${postNode._id || postNode.id}`,
            { config: { code: data.postProcessCode } },
          );
          updatedFields.push('postProcessCode');
        }
      }
    }

    return {
      toolId: data.toolNodeId,
      name: data.name ?? undefined,
      updated: true,
      updatedFields,
    };
  }

  // =========================================================================
  // Main dispatcher
  // =========================================================================
  async handleToolCall(toolName: string, args: any): Promise<any> {
    logger.info(`Handling tool call: ${toolName}`, { args });

    try {
      let result: any;
      switch (toolName) {
        case 'create_ai_agent':
          result = await this.handleCreateAiAgent(args);
          break;
        case 'update_ai_agent':
          result = await this.handleUpdateAiAgent(args);
          break;
        case 'setup_llm':
          result = await this.handleSetupLlm(args);
          break;
        case 'talk_to_agent':
          result = await this.handleTalkToAgent(args);
          break;
        case 'list_resources':
          result = await this.handleListResources(args);
          break;
        case 'get_resource':
          result = await this.handleGetResource(args);
          break;
        case 'delete_resource':
          result = await this.handleDeleteResource(args);
          break;
        case 'manage_knowledge':
          result = await this.handleManageKnowledge(args);
          break;
        case 'create_tool':
          result = await this.handleCreateTool(args);
          break;
        case 'create_custom_http_tool':
          result = await this.handleCreateCustomHttpTool(args);
          break;
        case 'update_tool':
          result = await this.handleUpdateTool(args);
          break;
        default:
          throw new Error(`Unknown tool: ${toolName}`);
      }
      logger.info(`Tool call successful: ${toolName}`);
      return result;
    } catch (error: any) {
      logger.error(`Tool call failed: ${toolName}`, { error: error.message });
      throw error;
    }
  }
}

// get_resource uses slightly different filters for detail views
const RESOURCE_FILTERS_GET: Record<string, (raw: any) => any> = {};
