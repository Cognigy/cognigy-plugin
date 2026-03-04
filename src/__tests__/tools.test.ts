/**
 * Tests for MCP tool handlers
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { CognigyApiClient } from '../api/client.js';
import { ToolHandlers } from '../tools/handlers.js';

describe('ToolHandlers', () => {
  let mockApiClient: jest.Mocked<CognigyApiClient>;
  let toolHandlers: ToolHandlers;

  beforeEach(() => {
    mockApiClient = {
      get: jest.fn(),
      post: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
      put: jest.fn(),
    } as any;

    toolHandlers = new ToolHandlers(mockApiClient, 'https://endpoint-trial.cognigy.ai');
  });

  describe('handleAiAgents', () => {
    it('should create an AI agent with automatic setup', async () => {
      const mockAgent = { _id: '507f1f77bcf86cd799439011', name: 'Test Agent', referenceId: 'ref-uuid' };
      const mockFlow = { _id: 'flow123', referenceId: 'flow-ref-uuid', name: 'Test Agent Flow' };
      const mockEndpoint = { _id: 'ep123', URLToken: 'abc123' };

      mockApiClient.post
        .mockResolvedValueOnce(mockAgent)
        .mockResolvedValueOnce(mockFlow)
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce(mockEndpoint);

      mockApiClient.get.mockResolvedValueOnce({
        items: [{ _id: 'node1', isEntryPoint: true }],
      });

      const result = await toolHandlers.handleAiAgents({
        operation: 'create',
        projectId: '507f1f77bcf86cd799439011',
        name: 'Test Agent',
        description: 'A test agent',
      });

      expect(result.agent).toEqual(mockAgent);
      expect(result.flow).toEqual(mockFlow);
      expect(result.endpoint).toEqual(mockEndpoint);
      expect(mockApiClient.post).toHaveBeenCalledWith('/v2.0/aiagents', {
        projectId: '507f1f77bcf86cd799439011',
        name: 'Test Agent',
        description: 'A test agent',
      });
    });

    it('should get an AI agent', async () => {
      const mockResponse = { _id: '507f1f77bcf86cd799439011', name: 'Test Agent' };
      mockApiClient.get.mockResolvedValue(mockResponse);

      const result = await toolHandlers.handleAiAgents({
        operation: 'get',
        aiAgentId: '507f1f77bcf86cd799439011',
      });

      expect(result).toEqual(mockResponse);
      expect(mockApiClient.get).toHaveBeenCalledWith('/v2.0/aiagents/507f1f77bcf86cd799439011');
    });

    it('should list AI agents', async () => {
      const mockResponse = { items: [], total: 0 };
      mockApiClient.get.mockResolvedValue(mockResponse);

      const result = await toolHandlers.handleAiAgents({
        operation: 'list',
        projectId: '507f1f77bcf86cd799439011',
        limit: 10,
      });

      expect(result).toEqual(mockResponse);
    });
  });

  describe('handleKnowledge', () => {
    it('should create a knowledge store', async () => {
      const mockResponse = { _id: '507f1f77bcf86cd799439011', name: 'Test Store' };
      mockApiClient.post.mockResolvedValue(mockResponse);

      const result = await toolHandlers.handleKnowledge({
        operation: 'create_store',
        projectId: '507f1f77bcf86cd799439011',
        name: 'Test Store',
      });

      expect(result).toEqual(mockResponse);
      expect(mockApiClient.post).toHaveBeenCalledWith('/v2.0/knowledgestores', {
        projectId: '507f1f77bcf86cd799439011',
        name: 'Test Store',
      });
    });

    it('should search knowledge chunks', async () => {
      const mockResponse = { results: [], total: 0 };
      mockApiClient.post.mockResolvedValue(mockResponse);

      const result = await toolHandlers.handleKnowledge({
        operation: 'search_chunks',
        knowledgeStoreId: '507f1f77bcf86cd799439011',
        query: 'test query',
      });

      expect(result).toEqual(mockResponse);
    });
  });

  describe('handleConversations', () => {
    it('should list conversations', async () => {
      const mockResponse = { items: [], total: 0 };
      mockApiClient.get.mockResolvedValue(mockResponse);

      const result = await toolHandlers.handleConversations({
        operation: 'list',
        projectId: '507f1f77bcf86cd799439011',
      });

      expect(result).toEqual(mockResponse);
    });
  });

  describe('handleFlows', () => {
    it('should create a flow', async () => {
      const mockResponse = { _id: '507f1f77bcf86cd799439011', name: 'Test Flow' };
      mockApiClient.post.mockResolvedValue(mockResponse);

      const result = await toolHandlers.handleFlows({
        operation: 'create',
        projectId: '507f1f77bcf86cd799439011',
        name: 'Test Flow',
      });

      expect(result).toEqual(mockResponse);
    });

    it('should create a flow node', async () => {
      const mockResponse = { _id: '507f1f77bcf86cd799439012', type: 'say' };
      mockApiClient.post.mockResolvedValue(mockResponse);

      const result = await toolHandlers.handleFlows({
        operation: 'create_node',
        flowId: '507f1f77bcf86cd799439011',
        type: 'say',
        label: 'Welcome',
      });

      expect(result).toEqual(mockResponse);
    });
  });

  describe('handleAnalytics', () => {
    it('should get conversation count', async () => {
      const mockResponse = { count: 100 };
      mockApiClient.get.mockResolvedValue(mockResponse);

      const result = await toolHandlers.handleAnalytics({
        operation: 'conversation_count',
        projectId: '507f1f77bcf86cd799439011',
        year: 2024,
        month: 11,
      });

      expect(result).toEqual(mockResponse);
    });
  });

  describe('handleToolCall', () => {
    it('should dispatch to correct handler', async () => {
      const mockResponse = { success: true };
      mockApiClient.get.mockResolvedValue(mockResponse);

      const result = await toolHandlers.handleToolCall('manage_ai_agents', {
        operation: 'get',
        aiAgentId: '507f1f77bcf86cd799439011',
      });

      expect(result).toEqual(mockResponse);
    });

    it('should throw error for unknown tool', async () => {
      await expect(
        toolHandlers.handleToolCall('unknown_tool', {})
      ).rejects.toThrow('Unknown tool: unknown_tool');
    });
  });
});

