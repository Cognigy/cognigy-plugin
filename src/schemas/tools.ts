import { z } from 'zod';

const idSchema = z.string().regex(/^[a-f0-9]{24}$/, 'Must be a 24-char hex ID');

const paginationSchema = {
  limit: z.number().int().min(1).max(100).optional(),
  skip: z.number().int().min(0).optional(),
};

// Tool 1: create_ai_agent
export const createAiAgentSchema = z.object({
  projectId: idSchema.optional(),
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  knowledgeReferenceId: z.string().uuid().optional(),
});

// Tool 2: update_ai_agent
export const updateAiAgentSchema = z.object({
  aiAgentId: idSchema,
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  instructions: z.string().optional(),
  knowledgeReferenceId: z.string().optional().nullable(),
  jobConfig: z.object({
    llmProviderReferenceId: z.string().optional(),
    jobName: z.string().optional(),
    jobDescription: z.string().optional(),
    jobInstructions: z.string().optional(),
    temperature: z.number().min(0).max(1).optional(),
    maxTokens: z.number().int().min(100).max(8000).optional(),
  }).optional(),
});

// Tool 3: setup_llm
export const setupLlmSchema = z.object({
  projectId: idSchema,
  provider: z.enum(['openAI', 'azureOpenAI', 'anthropic', 'google', 'mistral']),
  modelType: z.string().min(1),
  name: z.string().optional(),
  apiKey: z.string().optional(),
  connectionId: z.string().optional(),
  isDefault: z.boolean().optional(),
});

// Tool 4: talk_to_agent
export const talkToAgentSchema = z.object({
  endpointUrl: z.string().url(),
  message: z.string().min(1),
  sessionId: z.string().optional(),
  userId: z.string().optional(),
  data: z.record(z.any()).optional(),
  verbose: z.boolean().optional(),
});

// Tool 5: list_resources
export const listResourcesSchema = z.object({
  resourceType: z.enum([
    'project', 'agent', 'flow', 'endpoint', 'llm_model',
    'knowledge_store', 'conversation', 'extension', 'function', 'tool',
  ]),
  projectId: idSchema.optional(),
  aiAgentId: idSchema.optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  channel: z.string().optional(),
  ...paginationSchema,
});

// Tool 6: get_resource
export const getResourceSchema = z.object({
  resourceType: z.enum([
    'agent', 'flow', 'endpoint', 'project', 'conversation',
    'session_state', 'llm_model', 'knowledge_store', 'extension', 'function',
  ]),
  id: z.string().min(1),
  projectId: idSchema.optional(),
  raw: z.boolean().optional(),
});

// Tool 7: delete_resource
export const deleteResourceSchema = z.object({
  resourceType: z.enum([
    'agent', 'flow', 'endpoint', 'llm_model', 'knowledge_store', 'function', 'tool',
  ]),
  id: z.string().min(1),
  projectId: idSchema.optional(),
  aiAgentId: idSchema.optional(),
});

// Tool 8: manage_knowledge
export const manageKnowledgeSchema = z.object({
  operation: z.enum(['create_store', 'create_source', 'list_chunks']),
  projectId: idSchema.optional(),
  knowledgeStoreId: idSchema.optional(),
  sourceId: idSchema.optional(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  type: z.enum(['url', 'manual']).optional(),
  url: z.string().url().optional(),
  text: z.string().optional(),
  filter: z.string().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

// Tool 9: create_tool
export const createToolSchema = z.object({
  aiAgentId: idSchema,
  toolType: z.enum(['tool', 'knowledge', 'send_email', 'mcp']),
  name: z.string().min(1).max(200),
  config: z.object({
    toolId: z.string().optional(),
    description: z.string().optional(),
    parameters: z.string().optional(),
    knowledgeStoreId: z.string().optional(),
    topK: z.number().int().min(1).max(50).optional(),
    recipient: z.string().optional(),
    mcpServerUrl: z.string().optional(),
    mcpName: z.string().optional(),
    timeout: z.number().optional(),
  }),
});

// Tool 10: create_custom_http_tool
export const createCustomHttpToolSchema = z.object({
  aiAgentId: idSchema,
  name: z.string().min(1).max(200),
  toolId: z.string().min(1).max(200),
  description: z.string().min(1),
  parameters: z.string().optional(),
  http: z.object({
    url: z.string().min(1),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
    headers: z.record(z.string()).optional(),
    body: z.string().optional(),
  }),
  preProcessCode: z.string().optional(),
  postProcessCode: z.string().optional(),
});

// Tool 11: update_tool
export const updateToolSchema = z.object({
  aiAgentId: idSchema,
  toolNodeId: idSchema,
  name: z.string().min(1).max(200).optional(),
  toolType: z.enum(['tool', 'knowledge', 'send_email', 'mcp']).optional(),
  config: z.object({
    toolId: z.string().optional(),
    description: z.string().optional(),
    parameters: z.string().optional(),
    knowledgeStoreId: z.string().optional(),
    topK: z.number().int().min(1).max(50).optional(),
    recipient: z.string().optional(),
    mcpServerUrl: z.string().optional(),
    mcpName: z.string().optional(),
    timeout: z.number().optional(),
  }).optional(),
  http: z.object({
    url: z.string().min(1).optional(),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
    headers: z.record(z.string()).optional(),
    body: z.string().optional(),
  }).optional(),
  preProcessCode: z.string().optional(),
  postProcessCode: z.string().optional(),
});
