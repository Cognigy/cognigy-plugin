/**
 * Tool handlers for executing API operations
 */

import { CognigyApiClient } from '../api/client.js';
import { logger } from '../utils/logger.js';
import * as schemas from '../schemas/tools.js';

export class ToolHandlers {
  constructor(
    private apiClient: CognigyApiClient,
    private endpointBaseUrl: string,
  ) {}

  /**
   * 1. AI Agent Management (with automatic flow + endpoint creation)
   */
  async handleAiAgents(args: any): Promise<any> {
    const { operation, ...params } = args;

    switch (operation) {
      case 'create':
        const createData = schemas.aiAgentCreateSchema.parse(params);
        
        // Create the AI Agent resource (only send defined fields)
        const agentPayload: any = {
          projectId: createData.projectId,
          name: createData.name,
        };
        if (createData.description) agentPayload.description = createData.description;
        if (createData.knowledgeReferenceId) agentPayload.knowledgeReferenceId = createData.knowledgeReferenceId;
        if (createData.image) agentPayload.image = createData.image;
        if (createData.speakingStyle) agentPayload.speakingStyle = createData.speakingStyle;
        
        const agent = await this.apiClient.post(`/v2.0/aiagents`, agentPayload);
        
        // Automatically create flow and endpoint (always do this)
        try {
          // Create a flow for this agent
          const flow = await this.apiClient.post(`/v2.0/flows`, {
            projectId: createData.projectId,
            name: `${createData.name} Flow`,
            description: `Auto-generated flow for ${createData.name}`,
          });
          
          // Get the flow's entry point node to attach our AI Agent Job node
          const flowNodes = await this.apiClient.get(`/v2.0/flows/${flow._id}/chart/nodes`, {
            params: { limit: 10 },
          });
          const entryNode = flowNodes.items?.find((n: any) => n.isEntryPoint) || flowNodes.items?.[0];
          
          if (!entryNode) {
            throw new Error('Could not find entry node in flow');
          }
          
          // Create AI Agent Job Node in the flow
          await this.apiClient.post(`/v2.0/flows/${flow._id}/chart/nodes`, {
            mode: 'append',
            target: entryNode._id,
            type: 'aiAgentJob', // Correct type!
            extension: '@cognigy/basic-nodes',
            label: 'AI Agent',
            config: {
              aiAgent: agent.referenceId, // Reference to the AI Agent UUID
            },
          });
          
          // Create REST endpoint pointing to the flow
          const endpoint = await this.apiClient.post(`/v2.0/endpoints`, {
            projectId: createData.projectId,
            channel: 'rest',
            flowId: flow.referenceId, // Use UUID
            name: `${createData.name} REST Endpoint`,
          });
          
          // Return everything
          return {
            agent,
            flow,
            endpoint,
            endpointUrl: endpoint.URLToken 
              ? `${this.endpointBaseUrl}/${endpoint.URLToken}`
              : 'URL not available',
            message: '🎉 COMPLETE! Created AI Agent, Flow, AI Agent Job Node, and REST Endpoint! Ready to use!',
            instructions: `The agent is ready to use with talk_to_agent tool!
            
To test: Use talk_to_agent with the endpointUrl above
To improve: Configure job description in Cognigy UI → Flow: ${flow.name} → AI Agent Job Node
To iterate: Update job description, then talk_to_agent again to compare responses`,
          };
        } catch (error: any) {
          // If automatic setup fails, return the agent anyway
          return {
            agent,
            error: `Agent created but automatic setup failed: ${error.message}`,
            message: 'AI Agent created, but you may need to manually create flow and endpoint',
          };
        }

      case 'get':
        const getData = schemas.aiAgentGetSchema.parse(params);
        return await this.apiClient.get(`/v2.0/aiagents/${getData.aiAgentId}`);

      case 'update':
        const updateData = schemas.aiAgentUpdateSchema.parse(params);
        const { aiAgentId, ...updatePayload } = updateData;
        return await this.apiClient.patch(
          `/v2.0/aiagents/${aiAgentId}`,
          updatePayload
        );

      case 'delete':
        const deleteData = schemas.aiAgentDeleteSchema.parse(params);
        return await this.apiClient.delete(`/v2.0/aiagents/${deleteData.aiAgentId}`);

      case 'list':
        const listData = schemas.aiAgentListSchema.parse(params);
        return await this.apiClient.get(`/v2.0/aiagents`, {
          params: { projectId: listData.projectId, limit: listData.limit, skip: listData.skip },
        });

      case 'hire':
        const hireData = schemas.aiAgentHireSchema.parse(params);
        return await this.apiClient.post(`/v2.0/aiagents/${hireData.aiAgentId}/hire`, {
          templateId: hireData.templateId,
        });

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }

  /**
   * 2. Knowledge Management
   */
  async handleKnowledge(args: any): Promise<any> {
    const { operation, ...params } = args;

    switch (operation) {
      case 'create_store':
        const createStoreData = schemas.knowledgeStoreCreateSchema.parse(params);
        return await this.apiClient.post(`/v2.0/knowledgestores`, createStoreData);

      case 'create_source':
        const createSourceData = schemas.knowledgeSourceCreateSchema.parse(params);
        const { knowledgeStoreId, ...sourcePayload } = createSourceData;
        return await this.apiClient.post(
          `/v2.0/knowledgestores/${knowledgeStoreId}/sources`,
          sourcePayload
        );

      case 'search_chunks':
        const searchData = schemas.knowledgeChunkSearchSchema.parse(params);
        return await this.apiClient.post(
          `/v2.0/knowledgestores/${searchData.knowledgeStoreId}/chunks/search`,
          { query: searchData.query, limit: searchData.limit }
        );

      case 'list_stores':
        return await this.apiClient.get(`/v2.0/knowledgestores`, {
          params: { projectId: params.projectId },
        });

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }

  /**
   * 3. Conversation Management
   */
  async handleConversations(args: any): Promise<any> {
    const { operation, ...params } = args;

    switch (operation) {
      case 'list':
        const listData = schemas.conversationListSchema.parse(params);
        return await this.apiClient.get(`/v2.0/conversations`, { params: listData });

      case 'get':
        const getData = schemas.conversationGetSchema.parse(params);
        return await this.apiClient.get(`/v2.0/conversations/${getData.sessionId}`);

      case 'get_session_state':
        const stateData = schemas.sessionStateGetSchema.parse(params);
        return await this.apiClient.get(`/v2.0/sessions/${stateData.sessionId}/state`);

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }

  /**
   * 4. Flow Management
   */
  async handleFlows(args: any): Promise<any> {
    const { operation, ...params } = args;

    switch (operation) {
      case 'create':
        const createData = schemas.flowCreateSchema.parse(params);
        return await this.apiClient.post(`/v2.0/flows`, createData);

      case 'update':
        const updateData = schemas.flowUpdateSchema.parse(params);
        const { flowId, ...updatePayload } = updateData;
        return await this.apiClient.patch(`/v2.0/flows/${flowId}`, updatePayload);

      case 'list':
        const listData = schemas.flowListSchema.parse(params);
        return await this.apiClient.get(`/v2.0/flows`, { params: listData });

      case 'create_node':
        const nodeData = schemas.flowNodeCreateSchema.parse(params);
        const { flowId: nodeFlowId, type, label, config } = nodeData;
        // Build payload with required fields
        const nodePayload: any = {
          type,
          extension: '@cognigy/basic-nodes',
          mode: 'simple', // Required field - try 'simple'
        };
        if (label) nodePayload.label = label;
        if (config) nodePayload.config = config;
        // API uses /chart/nodes, and flowId must be MongoDB _id (not UUID)
        return await this.apiClient.post(`/v2.0/flows/${nodeFlowId}/chart/nodes`, nodePayload);

      case 'get_node':
        const getNodeData = schemas.flowNodeGetSchema.parse(params);
        const getParams: any = {};
        if (getNodeData.localeId) getParams.preferredLocaleId = getNodeData.localeId;
        return await this.apiClient.get(
          `/v2.0/flows/${getNodeData.flowId}/chart/nodes/${getNodeData.nodeId}`,
          { params: getParams }
        );

      case 'update_node':
        const updateNodeData = schemas.flowNodeUpdateSchema.parse(params);
        const { flowId: updateFlowId, nodeId, ...updateNodePayload } = updateNodeData;
        // Build the payload - only include fields that are provided
        const patchPayload: any = {};
        if (updateNodePayload.localeId) patchPayload.localeId = updateNodePayload.localeId;
        if (updateNodePayload.config) patchPayload.config = updateNodePayload.config;
        if (updateNodePayload.label) patchPayload.label = updateNodePayload.label;
        if (updateNodePayload.comment !== undefined) patchPayload.comment = updateNodePayload.comment;
        return await this.apiClient.patch(
          `/v2.0/flows/${updateFlowId}/chart/nodes/${nodeId}`,
          patchPayload
        );

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }

  /**
   * 5. Intent & NLU Management
   */
  async handleIntents(args: any): Promise<any> {
    const { operation, ...params } = args;

    switch (operation) {
      case 'create':
        const createData = schemas.intentCreateSchema.parse(params);
        const { flowId, ...intentPayload } = createData;
        return await this.apiClient.post(`/v2.0/flows/${flowId}/intents`, intentPayload);

      case 'update':
        const updateData = schemas.intentUpdateSchema.parse(params);
        const { intentId, ...updatePayload } = updateData;
        return await this.apiClient.patch(`/v2.0/intents/${intentId}`, updatePayload);

      case 'list':
        const listData = schemas.intentListSchema.parse(params);
        return await this.apiClient.get(`/v2.0/flows/${listData.flowId}/intents`, {
          params: { limit: listData.limit, skip: listData.skip },
        });

      case 'train':
        const trainData = schemas.intentTrainSchema.parse(params);
        return await this.apiClient.post(`/v2.0/flows/${trainData.flowId}/train`, {
          localeId: trainData.localeId,
        });

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }

  /**
   * 6. Analytics & Monitoring
   */
  async handleAnalytics(args: any): Promise<any> {
    const { operation, projectId, ...params } = args;

    switch (operation) {
      case 'conversation_count':
        const convData = schemas.analyticsConversationCountSchema.parse({ projectId, ...params });
        return await this.apiClient.get(`/v2.0/analytics/projects/${projectId}/conversationcount`, {
          params: { year: convData.year, month: convData.month, channel: convData.channel },
        });

      case 'call_count':
        const callData = schemas.analyticsCallCountSchema.parse({ projectId, ...params });
        return await this.apiClient.get(`/v2.0/analytics/projects/${projectId}/callcount`, {
          params: { year: callData.year, month: callData.month },
        });

      case 'logs':
        const logsData = schemas.logsListSchema.parse({ projectId, ...params });
        return await this.apiClient.get(`/v2.0/logs`, { params: logsData });

      case 'audit_events':
        const auditData = schemas.auditEventsListSchema.parse({ projectId, ...params });
        return await this.apiClient.get(`/v2.0/auditevents`, { params: auditData });

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }

  /**
   * 7. Project & Endpoint Management
   */
  async handleProjects(args: any): Promise<any> {
    const { operation, ...params } = args;

    switch (operation) {
      case 'create_project':
        const createData = schemas.projectCreateSchema.parse(params);
        return await this.apiClient.post(`/v2.0/projects`, createData);

      case 'list_projects':
        const listData = schemas.projectListSchema.parse(params);
        return await this.apiClient.get(`/v2.0/projects`, { params: listData });

      case 'create_endpoint':
        const createEndpointData = schemas.endpointCreateSchema.parse(params);
        // API expects projectId in the body, flowId is the flow's referenceId (UUID)
        return await this.apiClient.post(`/v2.0/endpoints`, {
          projectId: createEndpointData.projectId,
          channel: createEndpointData.channel,
          flowId: createEndpointData.flowId,
          name: createEndpointData.name,
          localeId: createEndpointData.localeId,
          settings: createEndpointData.settings,
        });

      case 'list_endpoints':
        const listEndpointsData = schemas.endpointListSchema.parse(params);
        return await this.apiClient.get(`/v2.0/projects/${listEndpointsData.projectId}/endpoints`, {
          params: { limit: listEndpointsData.limit, skip: listEndpointsData.skip },
        });

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }

  /**
   * 8. Extension Management
   */
  async handleExtensions(args: any): Promise<any> {
    const { operation, projectId, ...params } = args;

    switch (operation) {
      case 'list_extensions':
        const listExtData = schemas.extensionListSchema.parse({ projectId, ...params });
        return await this.apiClient.get(`/v2.0/projects/${projectId}/extensions`, {
          params: { limit: listExtData.limit, skip: listExtData.skip },
        });

      case 'create_function':
        const createData = schemas.functionCreateSchema.parse({ projectId, ...params });
        const { projectId: pid, ...funcPayload } = createData;
        return await this.apiClient.post(`/v2.0/projects/${pid}/functions`, funcPayload);

      case 'update_function':
        const updateData = schemas.functionUpdateSchema.parse(params);
        const { functionId, ...updatePayload } = updateData;
        return await this.apiClient.patch(`/v2.0/functions/${functionId}`, updatePayload);

      case 'list_functions':
        const listFuncData = schemas.functionListSchema.parse({ projectId, ...params });
        return await this.apiClient.get(`/v2.0/projects/${projectId}/functions`, {
          params: { limit: listFuncData.limit, skip: listFuncData.skip },
        });

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }

  /**
   * 9. Talk to AI Agent (Iterative Improvement)
   */
  async handleTalkToAgent(args: any): Promise<any> {
    const { endpointUrl, message, sessionId, userId, data } = args;

    // Generate session ID if not provided
    const finalSessionId = sessionId || `mcp-session-${Date.now()}`;
    const finalUserId = userId || 'mcp-user';

    // Construct the payload in Cognigy REST endpoint format
    const payload: any = {
      userId: finalUserId,
      sessionId: finalSessionId,
      text: message,
    };

    if (data) {
      payload.data = data;
    }

    // Make the request to the Cognigy endpoint
    // Note: Using axios directly here since this goes to a different URL
    const axios = (await import('axios')).default;
    
    try {
      const response = await axios.post(endpointUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        timeout: 30000,
      });

      // Extract the agent's response text from multiple possible locations
      let agentResponse = response.data.text || '';
      
      // Also check outputStack for text responses
      const outputStack = response.data.outputStack || [];
      const textOutputs = outputStack
        .filter((output: any) => output.text && output.text.trim())
        .map((output: any) => output.text)
        .filter(Boolean);
      
      if (textOutputs.length > 0) {
        agentResponse = textOutputs.join(' ');
      }

      return {
        success: true,
        agentResponse: agentResponse || 'No text response from agent',
        rawResponse: response.data,
        sessionId: finalSessionId,
        userId: finalUserId,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        details: error.response?.data || {},
        sessionId: finalSessionId,
      };
    }
  }

  /**
   * Main dispatcher for all tool calls
   */
  async handleToolCall(toolName: string, args: any): Promise<any> {
    logger.info(`Handling tool call: ${toolName}`, { args });

    try {
      let result;
      switch (toolName) {
        case 'manage_ai_agents':
          result = await this.handleAiAgents(args);
          break;
        case 'manage_knowledge':
          result = await this.handleKnowledge(args);
          break;
        case 'manage_conversations':
          result = await this.handleConversations(args);
          break;
        case 'manage_flows':
          result = await this.handleFlows(args);
          break;
        case 'manage_intents':
          result = await this.handleIntents(args);
          break;
        case 'get_analytics':
          result = await this.handleAnalytics(args);
          break;
        case 'manage_projects':
          result = await this.handleProjects(args);
          break;
        case 'manage_extensions':
          result = await this.handleExtensions(args);
          break;
        case 'talk_to_agent':
          result = await this.handleTalkToAgent(args);
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

