import { describe, it, expect, beforeAll } from '@jest/globals';
import { CognigyApiClient } from '../api/client.js';
import { ToolHandlers } from '../tools/handlers.js';

const INTEGRATION_TEST = process.env.INTEGRATION_TEST === 'true';
const API_KEY = process.env.COGNIGY_API_KEY || 'test-key';
const API_BASE_URL = process.env.COGNIGY_API_BASE_URL || 'https://api-trial.cognigy.ai';
const ENDPOINT_BASE_URL = process.env.COGNIGY_ENDPOINT_BASE_URL || 'https://endpoint-trial.cognigy.ai';

describe.skip('Integration Tests (v2)', () => {
  let toolHandlers: ToolHandlers;

  beforeAll(() => {
    if (!INTEGRATION_TEST) return;
    const apiClient = new CognigyApiClient({ baseUrl: API_BASE_URL, apiKey: API_KEY });
    toolHandlers = new ToolHandlers(apiClient, ENDPOINT_BASE_URL);
  });

  it('should list projects', async () => {
    if (!INTEGRATION_TEST) return;
    const result = await toolHandlers.handleToolCall('list_resources', { resourceType: 'project' });
    expect(result.items).toBeDefined();
  });

  it('should run full create-talk-update-delete cycle', async () => {
    if (!INTEGRATION_TEST) return;
    const projects = await toolHandlers.handleToolCall('list_resources', { resourceType: 'project' });
    const projectId = projects.items?.[0]?.id;
    if (!projectId) return;

    const created = await toolHandlers.handleToolCall('create_ai_agent', {
      projectId,
      name: `Integration Test Agent ${Date.now()}`,
      description: 'Created by integration test',
    });
    expect(created.agent).toBeDefined();

    if (created.endpointUrl && created.endpointUrl !== 'URL not available') {
      const talked = await toolHandlers.handleToolCall('talk_to_agent', {
        endpointUrl: created.endpointUrl,
        message: 'Hello',
      });
      expect(talked.sessionId).toBeDefined();
    }

    await toolHandlers.handleToolCall('delete_resource', {
      resourceType: 'endpoint',
      id: created.endpoint?.id,
    });
    await toolHandlers.handleToolCall('delete_resource', {
      resourceType: 'flow',
      id: created.flow?.id,
    });
    await toolHandlers.handleToolCall('delete_resource', {
      resourceType: 'agent',
      id: created.agent?.id,
    });
  });
});
