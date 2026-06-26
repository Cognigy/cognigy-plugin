import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { CognigyApiClient } from "../api/client.js";
import { ToolHandlers } from "../tools/handlers.js";

const ID = {
  project: "507f1f77bcf86cd799439011",
  agent: "60d5ec49f1a2c8b1a4e0f001",
  flow: "60d5ec49f1a2c8b1a4e0f002",
  endpoint: "60d5ec49f1a2c8b1a4e0f003",
  entry: "60d5ec49f1a2c8b1a4e0f004",
  node: "60d5ec49f1a2c8b1a4e0f005",
  llm: "60d5ec49f1a2c8b1a4e0f006",
  ks: "60d5ec49f1a2c8b1a4e0f007",
  tool: "60d5ec49f1a2c8b1a4e0f008",
  func: "60d5ec49f1a2c8b1a4e0f009",
  ext: "60d5ec49f1a2c8b1a4e0f00a",
};

describe("update_tool", () => {
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
    h = new ToolHandlers(
      api,
      "https://endpoint-trial.cognigy.ai",
      "https://webchat-trial.cognigy.ai",
    );
  });

  function mockAgentWithFlow() {
    api.get.mockResolvedValueOnce({ flowId: ID.flow });
  }

  function mockAgentWithoutFlow() {
    api.get
      .mockResolvedValueOnce({ _id: ID.agent, name: "Orphan Agent" })
      .mockRejectedValueOnce(new Error("Not found"))
      .mockResolvedValueOnce({ items: [] });
  }

  it("updates tool node name only", async () => {
    mockAgentWithFlow();
    api.patch.mockResolvedValue({});

    const result = await h.handleToolCall("update_tool", {
      aiAgentId: ID.agent,
      toolNodeId: ID.tool,
      name: "Renamed Tool",
    });

    expect(result.updated).toBe(true);
    expect(result.updatedFields).toContain("name");
    expect(api.patch).toHaveBeenCalledWith(
      `/v2.0/flows/${ID.flow}/chart/nodes/${ID.tool}`,
      { label: "Renamed Tool" },
    );
  });

  it("updates config for generic tool type (toolId, description)", async () => {
    mockAgentWithFlow();
    api.patch.mockResolvedValue({});

    const result = await h.handleToolCall("update_tool", {
      aiAgentId: ID.agent,
      toolNodeId: ID.tool,
      toolType: "tool",
      config: { toolId: "new_tool_id", description: "Updated description" },
    });

    expect(result.updated).toBe(true);
    expect(result.updatedFields).toContain("config");
    expect(api.patch).toHaveBeenCalledWith(
      `/v2.0/flows/${ID.flow}/chart/nodes/${ID.tool}`,
      { config: { toolId: "new_tool_id", description: "Updated description" } },
    );
  });

  it("updates config for knowledge type (knowledgeStoreId, topK)", async () => {
    mockAgentWithFlow();
    api.patch.mockResolvedValue({});

    const result = await h.handleToolCall("update_tool", {
      aiAgentId: ID.agent,
      toolNodeId: ID.tool,
      toolType: "knowledge",
      config: { knowledgeStoreId: ID.ks, topK: 10 },
    });

    expect(result.updated).toBe(true);
    expect(result.updatedFields).toContain("config");
    expect(api.patch).toHaveBeenCalledWith(
      `/v2.0/flows/${ID.flow}/chart/nodes/${ID.tool}`,
      { config: { knowledgeStoreId: ID.ks, topK: 10 } },
    );
  });

  it("updates config for send_email type (recipient)", async () => {
    mockAgentWithFlow();
    api.patch.mockResolvedValue({});

    const result = await h.handleToolCall("update_tool", {
      aiAgentId: ID.agent,
      toolNodeId: ID.tool,
      toolType: "send_email",
      config: { recipient: "team@example.com" },
    });

    expect(result.updated).toBe(true);
    expect(result.updatedFields).toContain("config");
    expect(api.patch).toHaveBeenCalledWith(
      `/v2.0/flows/${ID.flow}/chart/nodes/${ID.tool}`,
      { config: { recipient: "team@example.com" } },
    );
  });

  it("updates config for mcp type (mcpName, mcpServerUrl, timeout)", async () => {
    mockAgentWithFlow();
    api.patch.mockResolvedValue({});

    const result = await h.handleToolCall("update_tool", {
      aiAgentId: ID.agent,
      toolNodeId: ID.tool,
      toolType: "mcp",
      config: {
        mcpName: "remote-mcp",
        mcpServerUrl: "https://mcp.example.com",
        timeout: 60,
      },
    });

    expect(result.updated).toBe(true);
    expect(result.updatedFields).toContain("config");
    expect(api.patch).toHaveBeenCalledWith(
      `/v2.0/flows/${ID.flow}/chart/nodes/${ID.tool}`,
      {
        config: {
          name: "remote-mcp",
          mcpServerUrl: "https://mcp.example.com",
          timeout: 60,
        },
      },
    );
  });

  it("returns error when no flow found for agent", async () => {
    mockAgentWithoutFlow();

    const result = await h.handleToolCall("update_tool", {
      aiAgentId: ID.agent,
      toolNodeId: ID.tool,
      name: "Rename",
    });

    expect(result.error).toContain("Could not find a flow");
  });

  it("returns error when nothing to update", async () => {
    mockAgentWithFlow();

    const result = await h.handleToolCall("update_tool", {
      aiAgentId: ID.agent,
      toolNodeId: ID.tool,
    });

    expect(result.error).toContain("Nothing to update");
  });

  it("updates HTTP child node when http config fields present", async () => {
    mockAgentWithFlow();
    api.patch.mockResolvedValue({});
    api.get.mockResolvedValueOnce({
      items: [
        { _id: ID.tool, type: "aiAgentJobTool", label: "fetch_data" },
        {
          _id: "http-node-001",
          type: "httpRequest",
          label: "fetch_data - HTTP Request",
        },
      ],
    });

    const result = await h.handleToolCall("update_tool", {
      aiAgentId: ID.agent,
      toolNodeId: ID.tool,
      config: {
        url: "https://api.example.com",
        method: "POST",
        headers: { "X-Key": "val" },
        body: "{}",
      },
    });

    expect(result.updated).toBe(true);
    expect(result.updatedFields).toContain("http");
    expect(api.patch).toHaveBeenCalledWith(
      `/v2.0/flows/${ID.flow}/chart/nodes/http-node-001`,
      {
        config: expect.objectContaining({
          url: "https://api.example.com",
          type: "POST",
        }),
      },
    );
  });

  it("skips HTTP update with warning when no httpRequest child node found", async () => {
    mockAgentWithFlow();
    api.patch.mockResolvedValue({});
    api.get.mockResolvedValueOnce({ items: [] });

    const result = await h.handleToolCall("update_tool", {
      aiAgentId: ID.agent,
      toolNodeId: ID.tool,
      config: { url: "https://api.example.com" },
    });

    expect(result._hints).toBeDefined();
    expect(result._hints.warning).toContain("HTTP node not found");
  });

  it("updates pre-process Code node", async () => {
    mockAgentWithFlow();
    api.patch.mockResolvedValue({});
    api.get.mockResolvedValueOnce({
      items: [
        { _id: ID.tool, type: "aiAgentJobTool", label: "fetch_data" },
        {
          _id: "code-pre-001",
          type: "code",
          label: "fetch_data - Pre-Process",
        },
      ],
    });

    const result = await h.handleToolCall("update_tool", {
      aiAgentId: ID.agent,
      toolNodeId: ID.tool,
      config: { preProcessCode: "input.newField = true;" },
    });

    expect(result.updated).toBe(true);
    expect(result.updatedFields).toContain("preProcessCode");
    expect(api.patch).toHaveBeenCalledWith(
      `/v2.0/flows/${ID.flow}/chart/nodes/code-pre-001`,
      { config: { code: "input.newField = true;" } },
    );
  });

  it("updates post-process Code node", async () => {
    mockAgentWithFlow();
    api.patch.mockResolvedValue({});
    api.get.mockResolvedValueOnce({
      items: [
        { _id: ID.tool, type: "aiAgentJobTool", label: "fetch_data" },
        {
          _id: "code-pre-001",
          type: "code",
          label: "fetch_data - Pre-Process",
        },
        {
          _id: "code-post-001",
          type: "code",
          label: "fetch_data - Post-Process",
        },
      ],
    });

    const result = await h.handleToolCall("update_tool", {
      aiAgentId: ID.agent,
      toolNodeId: ID.tool,
      config: { postProcessCode: 'output.result = "done";' },
    });

    expect(result.updated).toBe(true);
    expect(result.updatedFields).toContain("postProcessCode");
    expect(api.patch).toHaveBeenCalledWith(
      `/v2.0/flows/${ID.flow}/chart/nodes/code-post-001`,
      { config: { code: 'output.result = "done";' } },
    );
  });

  it("skips code node provisioning with warning when anchor nodes are missing", async () => {
    mockAgentWithFlow();
    api.patch.mockResolvedValue({});
    api.get.mockResolvedValueOnce({ items: [] });

    const result = await h.handleToolCall("update_tool", {
      aiAgentId: ID.agent,
      toolNodeId: ID.tool,
      config: { preProcessCode: "x = 1;", postProcessCode: "y = 2;" },
    });

    expect(result._hints).toBeDefined();
    expect(result._hints.warning).toContain("Tool node not found");
    expect(result._hints.warning).toContain("HTTP Request node not found");
    expect(api.post).not.toHaveBeenCalled();
  });
});
