import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { CognigyApiClient } from '../api/client.js';
import { ToolHandlers } from '../tools/handlers.js';

const ID = {
  project: '507f1f77bcf86cd799439011',
  agent: '60d5ec49f1a2c8b1a4e0f001',
  flow: '60d5ec49f1a2c8b1a4e0f002',
  endpoint: '60d5ec49f1a2c8b1a4e0f003',
  entry: '60d5ec49f1a2c8b1a4e0f004',
  node: '60d5ec49f1a2c8b1a4e0f005',
  llm: '60d5ec49f1a2c8b1a4e0f006',
  ks: '60d5ec49f1a2c8b1a4e0f007',
  tool: '60d5ec49f1a2c8b1a4e0f008',
  func: '60d5ec49f1a2c8b1a4e0f009',
  ext: '60d5ec49f1a2c8b1a4e0f00a',
};

describe('manage_webchat', () => {
  let api: jest.Mocked<CognigyApiClient>;
  let h: ToolHandlers;

  beforeEach(() => {
    api = {
      get: jest.fn(),
      post: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
      put: jest.fn(),
    } as any;
    h = new ToolHandlers(api, 'https://endpoint-trial.cognigy.ai', 'https://webchat-trial.cognigy.ai');
  });

  const mockEndpoint = {
    _id: ID.endpoint,
    name: 'Webchat',
    channel: 'webchat3',
    URLToken: 'tok-abc123',
    settings: {},
  };

  it('creates new webchat endpoint when projectId and flowId provided', async () => {
    api.get
      .mockResolvedValueOnce({ localeReference: 'en-US' }) // flow locale
      .mockResolvedValueOnce(mockEndpoint); // re-fetch after create
    api.post.mockResolvedValueOnce({ _id: ID.endpoint });

    const result = await h.handleToolCall('manage_webchat', {
      projectId: ID.project,
      flowId: ID.flow,
      name: 'Webchat',
    });

    expect(result.created).toBe(true);
    expect(result.endpointId).toBe(ID.endpoint);
    expect(api.post).toHaveBeenCalledWith('/v2.0/endpoints', expect.objectContaining({
      projectId: ID.project,
      flowId: ID.flow,
      channel: 'webchat3',
      name: 'Webchat',
    }));
  });

  it('returns error when no projectId provided for creation', async () => {
    const result = await h.handleToolCall('manage_webchat', {
      flowId: ID.flow,
    });

    expect(result.error).toContain('projectId is required');
    expect(result._hints.resource).toBe('cognigy://guide/webchat-setup');
  });

  it('returns error when no flowId and no endpointId provided', async () => {
    const result = await h.handleToolCall('manage_webchat', {
      projectId: ID.project,
    });

    expect(result.error).toContain('flowId is required');
    expect(result._hints.resource).toBe('cognigy://guide/webchat-setup');
  });

  it('creates new endpoint even when existing webchat3 endpoints exist in project', async () => {
    api.get
      .mockResolvedValueOnce({ localeReference: 'en-US' }) // flow locale
      .mockResolvedValueOnce(mockEndpoint); // re-fetch after create
    api.post.mockResolvedValueOnce({ _id: ID.endpoint });

    const result = await h.handleToolCall('manage_webchat', {
      projectId: ID.project,
      flowId: ID.flow,
      name: 'New Webchat',
    });

    expect(result.created).toBe(true);
    expect(api.post).toHaveBeenCalledWith('/v2.0/endpoints', expect.objectContaining({
      projectId: ID.project,
      flowId: ID.flow,
      channel: 'webchat3',
      name: 'New Webchat',
    }));
  });

  it('updates existing endpoint with settings when endpointId provided', async () => {
    api.get
      .mockResolvedValueOnce({ ...mockEndpoint, settings: {} }) // full fetch
      .mockResolvedValueOnce(mockEndpoint); // re-fetch after patch
    api.patch.mockResolvedValue({});

    const result = await h.handleToolCall('manage_webchat', {
      endpointId: ID.endpoint,
      name: 'My Chat',
      layout: { title: 'Support Bot', chatWindowWidth: 500 },
      behavior: { renderMarkdown: true },
    });

    expect(result.updated).toBe(true);
    expect(result.settingsApplied).toBeDefined();
    expect(api.patch).toHaveBeenCalledWith(
      `/v2.0/endpoints/${ID.endpoint}`,
      expect.objectContaining({
        name: 'My Chat',
        settings: expect.objectContaining({
          layout: expect.objectContaining({ title: 'Support Bot' }),
          behavior: expect.objectContaining({ renderMarkdown: true }),
        }),
      }),
    );
  });

  it('returns error when no endpointId and no flowId provided', async () => {
    const result = await h.handleToolCall('manage_webchat', {
      projectId: ID.project,
    });

    expect(result.error).toContain('flowId is required');
  });

  it('returns error when update fails', async () => {
    api.get.mockRejectedValueOnce(new Error('Server error')); // full fetch fails

    const result = await h.handleToolCall('manage_webchat', {
      endpointId: ID.endpoint,
      name: 'Fail Update',
    });

    expect(result.error).toContain('Failed to update webchat endpoint');
    expect(result._hints.resource).toBe('cognigy://guide/webchat-setup');
  });

  it('returns error when creation fails', async () => {
    api.get.mockResolvedValueOnce({ localeReference: 'en-US' });
    api.post.mockRejectedValueOnce(new Error('Quota exceeded'));

    const result = await h.handleToolCall('manage_webchat', {
      projectId: ID.project,
      flowId: ID.flow,
    });

    expect(result.error).toContain('Failed to create webchat endpoint');
    expect(result._hints.resource).toBe('cognigy://guide/webchat-setup');
  });

  it('handles settings patch failure on create (partial success)', async () => {
    api.get
      .mockResolvedValueOnce({ localeReference: 'en-US' }) // flow locale
      .mockResolvedValueOnce(mockEndpoint); // re-fetch after create
    api.post.mockResolvedValueOnce({ _id: ID.endpoint });
    api.patch.mockRejectedValueOnce(new Error('Settings validation failed'));

    const result = await h.handleToolCall('manage_webchat', {
      projectId: ID.project,
      flowId: ID.flow,
      layout: { title: 'Bot' },
    });

    expect(result.created).toBe(true);
    expect(result._hints).toBeDefined();
    expect(result._hints.warning).toContain('settings failed to apply');
  });

  it('builds correct demoWebchatUrl and configUrl', async () => {
    api.get
      .mockResolvedValueOnce(mockEndpoint) // full fetch
      .mockResolvedValueOnce(mockEndpoint); // re-fetch after patch
    api.patch.mockResolvedValue({});

    const result = await h.handleToolCall('manage_webchat', {
      endpointId: ID.endpoint,
      name: 'URL Test',
    });

    expect(result.demoWebchatUrl).toBe('https://webchat-trial.cognigy.ai/v3/tok-abc123');
    expect(result._integration.configUrl).toBe('https://endpoint-trial.cognigy.ai/tok-abc123');
  });

  it('updates with endpointId directly provided', async () => {
    api.get
      .mockResolvedValueOnce(mockEndpoint) // full fetch before merge
      .mockResolvedValueOnce(mockEndpoint); // re-fetch after patch
    api.patch.mockResolvedValue({});

    const result = await h.handleToolCall('manage_webchat', {
      endpointId: ID.endpoint,
      name: 'Direct Update',
    });

    expect(result.updated).toBe(true);
    expect(result.endpointId).toBe(ID.endpoint);
    expect(api.patch).toHaveBeenCalledWith(
      `/v2.0/endpoints/${ID.endpoint}`,
      expect.objectContaining({ name: 'Direct Update' }),
    );
  });
});
