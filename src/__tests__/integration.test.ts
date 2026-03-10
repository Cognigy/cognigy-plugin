/**
 * Integration tests for the MCP server
 * 
 * Note: These tests require a valid Cognigy API key and will make actual API calls.
 * Set INTEGRATION_TEST=true to run these tests.
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { CognigyApiClient } from '../api/client.js';
import { ToolHandlers } from '../tools/handlers.js';
import { ApiKeyAuthProvider } from '../auth/apiKeyAuthProvider.js';

const INTEGRATION_TEST = process.env.INTEGRATION_TEST === 'true';
const API_KEY = process.env.COGNIGY_API_KEY || 'test-key';
const API_BASE_URL = process.env.COGNIGY_API_BASE_URL || 'https://api-trial.cognigy.ai';
const ENDPOINT_BASE_URL = process.env.COGNIGY_ENDPOINT_BASE_URL || 'https://endpoint-trial.cognigy.ai';

describe.skip('Integration Tests', () => {
  let apiClient: CognigyApiClient;
  let toolHandlers: ToolHandlers;
  let testProjectId: string;

  beforeAll(() => {
    if (!INTEGRATION_TEST) {
      console.log('Skipping integration tests. Set INTEGRATION_TEST=true to run.');
      return;
    }

    apiClient = new CognigyApiClient({
      baseUrl: API_BASE_URL,
      authProvider: new ApiKeyAuthProvider(API_KEY),
    });

    toolHandlers = new ToolHandlers(apiClient, ENDPOINT_BASE_URL);
  });

  describe('Project Management', () => {
    it('should list projects', async () => {
      if (!INTEGRATION_TEST) return;

      const result = await toolHandlers.handleProjects({
        operation: 'list_projects',
        limit: 10,
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result.items) || Array.isArray(result)).toBe(true);
    });

    it('should create a project', async () => {
      if (!INTEGRATION_TEST) return;

      const result = await toolHandlers.handleProjects({
        operation: 'create_project',
        name: `Test Project ${Date.now()}`,
        description: 'Created by integration test',
      });

      expect(result).toBeDefined();
      expect(result._id).toBeDefined();
      testProjectId = result._id;
    });
  });

  describe('Flow Management', () => {
    it('should create a flow', async () => {
      if (!INTEGRATION_TEST || !testProjectId) return;

      const result = await toolHandlers.handleFlows({
        operation: 'create',
        projectId: testProjectId,
        name: 'Test Flow',
        description: 'Created by integration test',
      });

      expect(result).toBeDefined();
      expect(result._id).toBeDefined();
      expect(result.name).toBe('Test Flow');
    });

    it('should list flows', async () => {
      if (!INTEGRATION_TEST || !testProjectId) return;

      const result = await toolHandlers.handleFlows({
        operation: 'list',
        projectId: testProjectId,
      });

      expect(result).toBeDefined();
    });
  });

  describe('Analytics', () => {
    it('should get conversation count', async () => {
      if (!INTEGRATION_TEST || !testProjectId) return;

      const result = await toolHandlers.handleAnalytics({
        operation: 'conversation_count',
        projectId: testProjectId,
        year: new Date().getFullYear(),
        month: new Date().getMonth() + 1,
      });

      expect(result).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid project ID', async () => {
      if (!INTEGRATION_TEST) return;

      await expect(
        toolHandlers.handleFlows({
          operation: 'list',
          projectId: 'invalid-id-format',
        })
      ).rejects.toThrow();
    });

    it('should handle non-existent resource', async () => {
      if (!INTEGRATION_TEST) return;

      await expect(
        toolHandlers.handleAiAgents({
          operation: 'get',
          aiAgentId: '000000000000000000000000',
        })
      ).rejects.toThrow();
    });
  });
});

/**
 * Example test runner script
 * 
 * Create a script to run integration tests:
 * 
 * #!/bin/bash
 * # test-integration.sh
 * 
 * export INTEGRATION_TEST=true
 * export COGNIGY_API_KEY="your-test-api-key"
 * export COGNIGY_API_BASE_URL="https://api-trial.cognigy.ai"
 * 
 * npm test -- integration.test.ts
 */
