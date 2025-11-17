/**
 * Zod schemas for MCP tool inputs
 */

import { z } from 'zod';

// Common schemas
const idSchema = z.string().regex(/^[a-z0-9]{24}$/, 'Invalid ID format');
const paginationSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  skip: z.number().int().min(0).optional(),
});

// 1. AI Agent Management
export const aiAgentCreateSchema = z.object({
  projectId: idSchema,
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  // Note: "job description" is configured via AI Agent Job Node in Flow, not here
  knowledgeReferenceId: z.string().uuid().optional(),
  image: z.string().optional(),
  speakingStyle: z.object({
    completeness: z.string().optional(),
    formality: z.string().optional(),
  }).optional(),
});

export const aiAgentUpdateSchema = z.object({
  aiAgentId: idSchema,
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  job: z.string().optional(),
  tools: z.array(z.string()).optional(),
});

export const aiAgentListSchema = z.object({
  projectId: idSchema,
  ...paginationSchema.shape,
});

export const aiAgentGetSchema = z.object({
  aiAgentId: idSchema,
});

export const aiAgentDeleteSchema = z.object({
  aiAgentId: idSchema,
});

export const aiAgentHireSchema = z.object({
  aiAgentId: idSchema,
  templateId: z.string().optional(),
});

// 2. Knowledge Management
export const knowledgeStoreCreateSchema = z.object({
  projectId: idSchema,
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  embeddingModel: z.string().optional(),
});

export const knowledgeSourceCreateSchema = z.object({
  knowledgeStoreId: idSchema,
  type: z.enum(['url', 'file', 'text']),
  content: z.string(),
  metadata: z.record(z.any()).optional(),
});

export const knowledgeChunkSearchSchema = z.object({
  knowledgeStoreId: idSchema,
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional(),
});

// 3. Conversation Management
export const conversationListSchema = z.object({
  projectId: idSchema,
  ...paginationSchema.shape,
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  channel: z.string().optional(),
});

export const conversationGetSchema = z.object({
  sessionId: z.string(),
});

export const sessionStateGetSchema = z.object({
  sessionId: z.string(),
});

// 4. Flow Management
export const flowCreateSchema = z.object({
  projectId: idSchema,
  name: z.string().min(1).max(200),
  description: z.string().optional(),
});

export const flowUpdateSchema = z.object({
  flowId: idSchema,
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
});

export const flowListSchema = z.object({
  projectId: idSchema,
  ...paginationSchema.shape,
});

export const flowNodeCreateSchema = z.object({
  flowId: z.string(), // Can be either MongoDB _id OR UUID - accept both
  type: z.string(),
  label: z.string().optional(),
  config: z.record(z.any()).optional(),
  mode: z.string().optional(),
});

// 5. Intent & NLU Management
export const intentCreateSchema = z.object({
  flowId: idSchema,
  name: z.string().min(1).max(200),
  sentences: z.array(z.string()).optional(),
});

export const intentUpdateSchema = z.object({
  intentId: idSchema,
  name: z.string().min(1).max(200).optional(),
  sentences: z.array(z.string()).optional(),
});

export const intentListSchema = z.object({
  flowId: idSchema,
  ...paginationSchema.shape,
});

export const intentTrainSchema = z.object({
  flowId: idSchema,
  localeId: idSchema.optional(),
});

// 6. Analytics & Monitoring
export const analyticsConversationCountSchema = z.object({
  projectId: idSchema,
  year: z.number().int().min(2020),
  month: z.number().int().min(1).max(12).optional(),
  channel: z.string().optional(),
});

export const analyticsCallCountSchema = z.object({
  projectId: idSchema,
  year: z.number().int().min(2020),
  month: z.number().int().min(1).max(12).optional(),
});

export const logsListSchema = z.object({
  projectId: idSchema,
  ...paginationSchema.shape,
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
});

export const auditEventsListSchema = z.object({
  projectId: idSchema,
  ...paginationSchema.shape,
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  userId: idSchema.optional(),
});

// 7. Project & Endpoint Management
export const projectCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  defaultLocale: z.string().optional(),
});

export const projectListSchema = z.object({
  ...paginationSchema.shape,
});

export const endpointCreateSchema = z.object({
  projectId: idSchema,
  channel: z.string(), // e.g., "rest", "webchat3", "voiceGateway2"
  flowId: z.string().uuid(), // Flow uses UUID (referenceId), not MongoDB _id
  name: z.string().min(1).max(200).optional(),
  localeId: idSchema.optional(),
  settings: z.record(z.any()).optional(),
});

export const endpointListSchema = z.object({
  projectId: idSchema,
  ...paginationSchema.shape,
});

// 8. Extension Management
export const extensionListSchema = z.object({
  projectId: idSchema,
  ...paginationSchema.shape,
});

export const functionCreateSchema = z.object({
  projectId: idSchema,
  name: z.string().min(1).max(200),
  code: z.string(),
  description: z.string().optional(),
});

export const functionUpdateSchema = z.object({
  functionId: idSchema,
  name: z.string().min(1).max(200).optional(),
  code: z.string().optional(),
  description: z.string().optional(),
});

export const functionListSchema = z.object({
  projectId: idSchema,
  ...paginationSchema.shape,
});

