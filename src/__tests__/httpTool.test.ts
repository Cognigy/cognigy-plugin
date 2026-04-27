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

const MOCK_IDS = {
  toolNode: 'aaaaaaaaaaaaaaaaaaaaa001',
  resolveNode: 'aaaaaaaaaaaaaaaaaaaaa002',
  preNode: 'aaaaaaaaaaaaaaaaaaaaa003',
  httpNode: 'aaaaaaaaaaaaaaaaaaaaa004',
  postNode: 'aaaaaaaaaaaaaaaaaaaaa005',
};

describe('create_tool – HTTP tool path', () => {
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
    h = new ToolHandlers(api, 'https://endpoint-trial.cognigy.ai');
  });

  function mockFlowWithJobNode() {
    api.get
      .mockResolvedValueOnce({ flowId: ID.flow })
      .mockResolvedValueOnce({
        items: [
          { _id: ID.entry, isEntryPoint: true },
          { _id: ID.node, type: 'aiAgentJob' },
        ],
      });
  }

  function baseArgs(configOverrides: Record<string, any> = {}) {
    return {
      aiAgentId: ID.agent,
      toolType: 'http',
      name: 'My HTTP Tool',
      config: { url: 'https://api.example.com/data', ...configOverrides },
    };
  }

  // Mocks post calls for: toolNode, resolveNode, then any extras
  function mockPostSequence(...ids: string[]) {
    let chain = api.post.mockResolvedValueOnce({ _id: ids[0] });
    for (let i = 1; i < ids.length; i++) {
      chain = chain.mockResolvedValueOnce({ _id: ids[i] });
    }
  }

  it('creates HTTP tool with basic GET request (url only)', async () => {
    mockFlowWithJobNode();
    mockPostSequence(MOCK_IDS.toolNode, MOCK_IDS.resolveNode, MOCK_IDS.httpNode);

    const result = await h.handleToolCall('create_tool', baseArgs());

    expect(result.toolId).toBe(MOCK_IDS.toolNode);
    expect(result.toolType).toBe('http');
    expect(result.childNodes.httpNodeId).toBe(MOCK_IDS.httpNode);
    expect(result.childNodes.resolveNodeId).toBe(MOCK_IDS.resolveNode);
    expect(result.childNodes.preProcessNodeId).toBeUndefined();
    expect(result.childNodes.postProcessNodeId).toBeUndefined();

    const httpCallBody = api.post.mock.calls[2][1];
    expect(httpCallBody.config.url).toBe('https://api.example.com/data');
    expect(httpCallBody.config.type).toBe('GET');
  });

  it('creates HTTP tool with POST method, headers, and JSON body', async () => {
    mockFlowWithJobNode();
    mockPostSequence(MOCK_IDS.toolNode, MOCK_IDS.resolveNode, MOCK_IDS.httpNode);

    const result = await h.handleToolCall('create_tool', baseArgs({
      method: 'POST',
      headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
      body: '{"key":"value"}',
    }));

    expect(result.toolType).toBe('http');
    const httpCallBody = api.post.mock.calls[2][1];
    expect(httpCallBody.config.type).toBe('POST');
    expect(httpCallBody.config.url).toBe('https://api.example.com/data');
    expect(JSON.parse(httpCallBody.config.headers)).toEqual({
      Authorization: 'Bearer tok',
      'Content-Type': 'application/json',
    });
    expect(httpCallBody.config.payloadType).toBe('json');
    expect(httpCallBody.config.payloadJSON).toEqual({ key: 'value' });
  });

  it('creates HTTP tool with non-JSON body (text fallback)', async () => {
    mockFlowWithJobNode();
    mockPostSequence(MOCK_IDS.toolNode, MOCK_IDS.resolveNode, MOCK_IDS.httpNode);

    const result = await h.handleToolCall('create_tool', baseArgs({
      method: 'POST',
      body: 'plain text body that is not JSON',
    }));

    expect(result.toolType).toBe('http');
    const httpCallBody = api.post.mock.calls[2][1];
    expect(httpCallBody.config.payloadType).toBe('text');
    expect(httpCallBody.config.payloadText).toBe('plain text body that is not JSON');
    expect(httpCallBody.config.payloadJSON).toBeUndefined();
  });

  it('creates HTTP tool with pre-process code node', async () => {
    mockFlowWithJobNode();
    mockPostSequence(
      MOCK_IDS.toolNode, MOCK_IDS.resolveNode, MOCK_IDS.preNode, MOCK_IDS.httpNode,
    );

    const result = await h.handleToolCall('create_tool', baseArgs({
      preProcessCode: 'input.data = { transformed: true };',
    }));

    expect(result.childNodes.preProcessNodeId).toBe(MOCK_IDS.preNode);
    expect(result.childNodes.httpNodeId).toBe(MOCK_IDS.httpNode);
    expect(result.childNodes.postProcessNodeId).toBeUndefined();

    const preCallBody = api.post.mock.calls[2][1];
    expect(preCallBody.type).toBe('code');
    expect(preCallBody.config.code).toBe('input.data = { transformed: true };');
    expect(preCallBody.label).toBe('My HTTP Tool - Pre-Process');
  });

  it('creates HTTP tool with post-process code node', async () => {
    mockFlowWithJobNode();
    mockPostSequence(
      MOCK_IDS.toolNode, MOCK_IDS.resolveNode, MOCK_IDS.httpNode, MOCK_IDS.postNode,
    );

    const result = await h.handleToolCall('create_tool', baseArgs({
      postProcessCode: 'input.result = input.httprequest.data;',
    }));

    expect(result.childNodes.preProcessNodeId).toBeUndefined();
    expect(result.childNodes.httpNodeId).toBe(MOCK_IDS.httpNode);
    expect(result.childNodes.postProcessNodeId).toBe(MOCK_IDS.postNode);

    const postCallBody = api.post.mock.calls[3][1];
    expect(postCallBody.type).toBe('code');
    expect(postCallBody.config.code).toBe('input.result = input.httprequest.data;');
    expect(postCallBody.label).toBe('My HTTP Tool - Post-Process');
  });

  it('creates HTTP tool with both pre and post-process code nodes', async () => {
    mockFlowWithJobNode();
    mockPostSequence(
      MOCK_IDS.toolNode, MOCK_IDS.resolveNode,
      MOCK_IDS.preNode, MOCK_IDS.httpNode, MOCK_IDS.postNode,
    );

    const result = await h.handleToolCall('create_tool', baseArgs({
      preProcessCode: 'input.pre = true;',
      postProcessCode: 'input.post = true;',
    }));

    expect(result.childNodes.preProcessNodeId).toBe(MOCK_IDS.preNode);
    expect(result.childNodes.httpNodeId).toBe(MOCK_IDS.httpNode);
    expect(result.childNodes.postProcessNodeId).toBe(MOCK_IDS.postNode);
    expect(result.childNodes.resolveNodeId).toBe(MOCK_IDS.resolveNode);
  });

  it('returns error when URL is missing for http tool type', async () => {
    mockFlowWithJobNode();

    const result = await h.handleToolCall('create_tool', {
      aiAgentId: ID.agent,
      toolType: 'http',
      name: 'Bad HTTP Tool',
      config: {},
    });

    expect(result.error).toBe('url is required in config for http tool type.');
    expect(result._hints.resource).toBe('cognigy://guide/tools-setup');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('rolls back all created nodes on failure', async () => {
    mockFlowWithJobNode();
    api.post
      .mockResolvedValueOnce({ _id: MOCK_IDS.toolNode })
      .mockResolvedValueOnce({ _id: MOCK_IDS.resolveNode })
      .mockRejectedValueOnce(new Error('HTTP node creation failed'));
    api.delete.mockResolvedValue({});

    const result = await h.handleToolCall('create_tool', baseArgs());

    expect(result.error).toBe('HTTP node creation failed');
    expect(api.delete).toHaveBeenCalledTimes(2);
    expect(api.delete).toHaveBeenCalledWith(
      `/v2.0/flows/${ID.flow}/chart/nodes/${MOCK_IDS.resolveNode}`,
    );
    expect(api.delete).toHaveBeenCalledWith(
      `/v2.0/flows/${ID.flow}/chart/nodes/${MOCK_IDS.toolNode}`,
    );
  });

  it('reports partial rollback failure when some deletes fail', async () => {
    mockFlowWithJobNode();
    api.post
      .mockResolvedValueOnce({ _id: MOCK_IDS.toolNode })
      .mockResolvedValueOnce({ _id: MOCK_IDS.resolveNode })
      .mockRejectedValueOnce(new Error('HTTP node creation failed'));
    api.delete
      .mockRejectedValueOnce(new Error('delete failed'))
      .mockResolvedValueOnce({});

    const result = await h.handleToolCall('create_tool', baseArgs());

    expect(result.error).toBe('HTTP node creation failed');
    expect(result._hints.action).toContain('Rollback partially failed');
    expect(result._hints.action).toContain(MOCK_IDS.resolveNode);
  });

  it('HTTP node target is pre-process node when pre-process code exists', async () => {
    mockFlowWithJobNode();
    mockPostSequence(
      MOCK_IDS.toolNode, MOCK_IDS.resolveNode, MOCK_IDS.preNode, MOCK_IDS.httpNode,
    );

    await h.handleToolCall('create_tool', baseArgs({
      preProcessCode: 'input.x = 1;',
    }));

    const httpCallBody = api.post.mock.calls[3][1];
    expect(httpCallBody.type).toBe('httpRequest');
    expect(httpCallBody.target).toBe(MOCK_IDS.preNode);
  });

  it('resolve node has the correct answer config', async () => {
    mockFlowWithJobNode();
    mockPostSequence(MOCK_IDS.toolNode, MOCK_IDS.resolveNode, MOCK_IDS.httpNode);

    await h.handleToolCall('create_tool', baseArgs());

    const resolveCallBody = api.post.mock.calls[1][1];
    expect(resolveCallBody.type).toBe('aiAgentToolAnswer');
    expect(resolveCallBody.config.answer).toBe('{{JSON.stringify(input.httprequest)}}');
  });

  it('uses toolId as node label for HTTP tool and child nodes', async () => {
    mockFlowWithJobNode();
    mockPostSequence(
      MOCK_IDS.toolNode, MOCK_IDS.resolveNode,
      MOCK_IDS.preNode, MOCK_IDS.httpNode, MOCK_IDS.postNode,
    );

    await h.handleToolCall('create_tool', {
      aiAgentId: ID.agent,
      toolType: 'http',
      name: 'Fetch User Posts',
      config: {
        toolId: 'fetch_user_posts',
        url: 'https://api.example.com/posts',
        preProcessCode: 'input.x = 1;',
        postProcessCode: 'input.y = 2;',
      },
    });

    const toolCallBody = api.post.mock.calls[0][1];
    expect(toolCallBody.label).toBe('fetch_user_posts');

    const resolveCallBody = api.post.mock.calls[1][1];
    expect(resolveCallBody.label).toBe('fetch_user_posts - Resolve');

    const preCallBody = api.post.mock.calls[2][1];
    expect(preCallBody.label).toBe('fetch_user_posts - Pre-Process');

    const httpCallBody = api.post.mock.calls[3][1];
    expect(httpCallBody.label).toBe('fetch_user_posts - HTTP Request');

    const postCallBody = api.post.mock.calls[4][1];
    expect(postCallBody.label).toBe('fetch_user_posts - Post-Process');
  });

  it('uses custom toolResponseValue for HTTP resolve node', async () => {
    mockFlowWithJobNode();
    mockPostSequence(MOCK_IDS.toolNode, MOCK_IDS.resolveNode, MOCK_IDS.httpNode);

    await h.handleToolCall('create_tool', {
      aiAgentId: ID.agent,
      toolType: 'http',
      name: 'Custom HTTP',
      config: {
        url: 'https://api.example.com/data',
        toolResponseValue: '{{JSON.stringify(input.customResult)}}',
      },
    });

    const resolveCallBody = api.post.mock.calls[1][1];
    expect(resolveCallBody.config.answer).toBe('{{JSON.stringify(input.customResult)}}');
  });
});

describe('update_tool – HTTP child-node resolution', () => {
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
    h = new ToolHandlers(api, 'https://endpoint-trial.cognigy.ai');
  });

  // Real /chart/nodes responses do NOT include parentId on nodes — the tree
  // relationship lives in the chart's separate `relations` array. These
  // fixtures mirror that shape: tool node + child nodes share no parent link.
  function mockFlowAndChildren() {
    api.get
      .mockResolvedValueOnce({ flowId: ID.flow })
      .mockResolvedValueOnce({
        items: [
          { _id: ID.node, type: 'aiAgentJob', label: 'AI Agent Job' },
          { _id: MOCK_IDS.toolNode, type: 'aiAgentJobTool', label: 'search_recipes' },
          { _id: MOCK_IDS.resolveNode, type: 'aiAgentToolAnswer', label: 'Resolve Tool Action' },
          { _id: MOCK_IDS.httpNode, type: 'httpRequest', label: 'search_recipes - HTTP Request' },
          { _id: MOCK_IDS.postNode, type: 'code', label: 'search_recipes - Post-Process' },
        ],
      });
  }

  it('resolves post-process Code node by label prefix', async () => {
    mockFlowAndChildren();
    api.patch.mockResolvedValue({});

    const result = await h.handleToolCall('update_tool', {
      aiAgentId: ID.agent,
      toolNodeId: MOCK_IDS.toolNode,
      toolType: 'http',
      config: { postProcessCode: 'input.x = 1;' },
    });

    expect(result.updatedFields).toContain('postProcessCode');
    expect(api.patch).toHaveBeenCalledWith(
      `/v2.0/flows/${ID.flow}/chart/nodes/${MOCK_IDS.postNode}`,
      { config: { code: 'input.x = 1;' } },
    );
  });

  it('resolves HTTP node by label prefix and patches url/method', async () => {
    mockFlowAndChildren();
    api.patch.mockResolvedValue({});

    const result = await h.handleToolCall('update_tool', {
      aiAgentId: ID.agent,
      toolNodeId: MOCK_IDS.toolNode,
      toolType: 'http',
      config: { url: 'https://api.example.com/v2', method: 'POST' },
    });

    expect(result.updatedFields).toContain('http');
    expect(api.patch).toHaveBeenCalledWith(
      `/v2.0/flows/${ID.flow}/chart/nodes/${MOCK_IDS.httpNode}`,
      { config: { url: 'https://api.example.com/v2', type: 'POST' } },
    );
  });

  it('resolves singleton Resolve Tool Action node', async () => {
    mockFlowAndChildren();
    api.patch.mockResolvedValue({});

    const result = await h.handleToolCall('update_tool', {
      aiAgentId: ID.agent,
      toolNodeId: MOCK_IDS.toolNode,
      toolType: 'http',
      config: { toolResponseValue: '{{JSON.stringify(input.recipes)}}' },
    });

    expect(result.updatedFields).toContain('toolResponseValue');
    expect(api.patch).toHaveBeenCalledWith(
      `/v2.0/flows/${ID.flow}/chart/nodes/${MOCK_IDS.resolveNode}`,
      { config: { answer: '{{JSON.stringify(input.recipes)}}' } },
    );
  });

  // New tools created on or after this PR carry per-tool Resolve labels —
  // update_tool can disambiguate without an explicit resolveNodeId.
  it('resolves Resolve node by per-tool label even when multiple Resolve nodes exist', async () => {
    const otherResolveId = 'bbbbbbbbbbbbbbbbbbbbb001';
    api.get
      .mockResolvedValueOnce({ flowId: ID.flow })
      .mockResolvedValueOnce({
        items: [
          { _id: MOCK_IDS.toolNode, type: 'aiAgentJobTool', label: 'search_recipes' },
          { _id: MOCK_IDS.resolveNode, type: 'aiAgentToolAnswer', label: 'search_recipes - Resolve' },
          { _id: otherResolveId, type: 'aiAgentToolAnswer', label: 'other_tool - Resolve' },
        ],
      });
    api.patch.mockResolvedValue({});

    const result = await h.handleToolCall('update_tool', {
      aiAgentId: ID.agent,
      toolNodeId: MOCK_IDS.toolNode,
      toolType: 'http',
      config: { toolResponseValue: '{{JSON.stringify(input.recipes)}}' },
    });

    expect(result.updatedFields).toContain('toolResponseValue');
    expect(api.patch).toHaveBeenCalledWith(
      `/v2.0/flows/${ID.flow}/chart/nodes/${MOCK_IDS.resolveNode}`,
      { config: { answer: '{{JSON.stringify(input.recipes)}}' } },
    );
  });

  it('honors explicit resolveNodeId when multiple Resolve nodes exist', async () => {
    const otherResolveId = 'bbbbbbbbbbbbbbbbbbbbb001';
    api.get
      .mockResolvedValueOnce({ flowId: ID.flow })
      .mockResolvedValueOnce({
        items: [
          { _id: MOCK_IDS.toolNode, type: 'aiAgentJobTool', label: 'search_recipes' },
          { _id: MOCK_IDS.resolveNode, type: 'aiAgentToolAnswer', label: 'Resolve Tool Action' },
          { _id: otherResolveId, type: 'aiAgentToolAnswer', label: 'Resolve Tool Action' },
        ],
      });
    api.patch.mockResolvedValue({});

    const result = await h.handleToolCall('update_tool', {
      aiAgentId: ID.agent,
      toolNodeId: MOCK_IDS.toolNode,
      toolType: 'http',
      config: {
        toolResponseValue: '{{JSON.stringify(input.recipes)}}',
        resolveNodeId: MOCK_IDS.resolveNode,
      },
    });

    expect(result.updatedFields).toContain('toolResponseValue');
    expect(api.patch).toHaveBeenCalledWith(
      `/v2.0/flows/${ID.flow}/chart/nodes/${MOCK_IDS.resolveNode}`,
      { config: { answer: '{{JSON.stringify(input.recipes)}}' } },
    );
  });

  it('warns when multiple Resolve nodes exist and no resolveNodeId provided', async () => {
    const otherResolveId = 'bbbbbbbbbbbbbbbbbbbbb001';
    api.get
      .mockResolvedValueOnce({ flowId: ID.flow })
      .mockResolvedValueOnce({
        items: [
          { _id: MOCK_IDS.toolNode, type: 'aiAgentJobTool', label: 'search_recipes' },
          { _id: MOCK_IDS.resolveNode, type: 'aiAgentToolAnswer', label: 'Resolve Tool Action' },
          { _id: otherResolveId, type: 'aiAgentToolAnswer', label: 'Resolve Tool Action' },
        ],
      });

    const result = await h.handleToolCall('update_tool', {
      aiAgentId: ID.agent,
      toolNodeId: MOCK_IDS.toolNode,
      toolType: 'http',
      config: { toolResponseValue: '{{x}}' },
    });

    expect(result.updatedFields).not.toContain('toolResponseValue');
    expect(result._hints?.warning).toContain('Multiple Resolve Tool Action nodes');
  });

  it('honors explicit child node IDs over label-based lookup', async () => {
    mockFlowAndChildren();
    api.patch.mockResolvedValue({});

    await h.handleToolCall('update_tool', {
      aiAgentId: ID.agent,
      toolNodeId: MOCK_IDS.toolNode,
      toolType: 'http',
      config: {
        postProcessCode: 'input.y = 2;',
        postProcessNodeId: MOCK_IDS.postNode,
      },
    });

    expect(api.patch).toHaveBeenCalledWith(
      `/v2.0/flows/${ID.flow}/chart/nodes/${MOCK_IDS.postNode}`,
      { config: { code: 'input.y = 2;' } },
    );
  });

  // Tool was created without postProcessCode → no post Code child exists.
  // Calling update_tool with postProcessCode should provision the missing node.
  it('auto-provisions a post-process Code node when one does not exist', async () => {
    api.get
      .mockResolvedValueOnce({ flowId: ID.flow })
      .mockResolvedValueOnce({
        items: [
          { _id: MOCK_IDS.toolNode, type: 'aiAgentJobTool', label: 'search_recipes' },
          { _id: MOCK_IDS.resolveNode, type: 'aiAgentToolAnswer', label: 'Resolve Tool Action' },
          { _id: MOCK_IDS.httpNode, type: 'httpRequest', label: 'search_recipes - HTTP Request' },
        ],
      });
    api.post.mockResolvedValueOnce({ _id: MOCK_IDS.postNode });

    const result = await h.handleToolCall('update_tool', {
      aiAgentId: ID.agent,
      toolNodeId: MOCK_IDS.toolNode,
      toolType: 'http',
      config: { postProcessCode: 'input.recipes = input.httprequest.body.meals;' },
    });

    expect(result.updatedFields).toContain('postProcessCode');
    expect(result._hints?.warning).toBeUndefined();
    expect(api.post).toHaveBeenCalledWith(
      `/v2.0/flows/${ID.flow}/chart/nodes`,
      expect.objectContaining({
        type: 'code',
        mode: 'append',
        target: MOCK_IDS.httpNode,
        label: 'search_recipes - Post-Process',
        config: { code: 'input.recipes = input.httprequest.body.meals;' },
      }),
    );
  });

  it('auto-provisions a pre-process Code node when one does not exist', async () => {
    api.get
      .mockResolvedValueOnce({ flowId: ID.flow })
      .mockResolvedValueOnce({
        items: [
          { _id: MOCK_IDS.toolNode, type: 'aiAgentJobTool', label: 'search_recipes' },
          { _id: MOCK_IDS.resolveNode, type: 'aiAgentToolAnswer', label: 'Resolve Tool Action' },
          { _id: MOCK_IDS.httpNode, type: 'httpRequest', label: 'search_recipes - HTTP Request' },
        ],
      });
    api.post.mockResolvedValueOnce({ _id: MOCK_IDS.preNode });

    const result = await h.handleToolCall('update_tool', {
      aiAgentId: ID.agent,
      toolNodeId: MOCK_IDS.toolNode,
      toolType: 'http',
      config: { preProcessCode: 'input.normalized = String(input.aiAgent.toolArgs.q || "").trim();' },
    });

    expect(result.updatedFields).toContain('preProcessCode');
    expect(api.post).toHaveBeenCalledWith(
      `/v2.0/flows/${ID.flow}/chart/nodes`,
      expect.objectContaining({
        type: 'code',
        mode: 'append',
        target: MOCK_IDS.toolNode,
        label: 'search_recipes - Pre-Process',
      }),
    );
  });

  // If the caller explicitly says "use this preProcessNodeId" but the ID does
  // not exist, do NOT silently auto-provision — they identified a specific
  // target, and a stale ID is more likely a bug to surface than to paper over.
  it('does not auto-provision when an explicit preProcessNodeId is provided but missing', async () => {
    api.get
      .mockResolvedValueOnce({ flowId: ID.flow })
      .mockResolvedValueOnce({
        items: [
          { _id: MOCK_IDS.toolNode, type: 'aiAgentJobTool', label: 'search_recipes' },
        ],
      });

    const result = await h.handleToolCall('update_tool', {
      aiAgentId: ID.agent,
      toolNodeId: MOCK_IDS.toolNode,
      toolType: 'http',
      config: {
        preProcessCode: 'input.x = 1;',
        preProcessNodeId: 'aaaaaaaaaaaaaaaaaaaaadea',
      },
    });

    expect(result.updatedFields).not.toContain('preProcessCode');
    expect(api.post).not.toHaveBeenCalled();
    expect(result._hints?.warning).toContain('Pre-process Code node with the provided preProcessNodeId was not found');
  });

  it('skips post-process auto-provision and warns when no HTTP Request anchor exists', async () => {
    api.get
      .mockResolvedValueOnce({ flowId: ID.flow })
      .mockResolvedValueOnce({
        items: [
          { _id: MOCK_IDS.toolNode, type: 'aiAgentJobTool', label: 'search_recipes' },
        ],
      });

    const result = await h.handleToolCall('update_tool', {
      aiAgentId: ID.agent,
      toolNodeId: MOCK_IDS.toolNode,
      toolType: 'http',
      config: { postProcessCode: 'input.x = 1;' },
    });

    expect(result.updatedFields).not.toContain('postProcessCode');
    expect(api.post).not.toHaveBeenCalled();
    expect(result._hints?.warning).toContain('HTTP Request node not found');
  });
});
