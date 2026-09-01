import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { CognigyApiClient } from "../api/client.js";
import { ToolHandlers } from "../tools/handlers.js";

// Valid 24-char hex IDs for tests
const ID = {
  project: "507f1f77bcf86cd799439011",
  flow: "60d5ec49f1a2c8b1a4e0f002",
  endpoint: "60d5ec49f1a2c8b1a4e0f003",
  entry: "60d5ec49f1a2c8b1a4e0f004",
  node: "60d5ec49f1a2c8b1a4e0f005",
  llm: "60d5ec49f1a2c8b1a4e0f006",
  tool: "60d5ec49f1a2c8b1a4e0f008",
  resolve: "60d5ec49f1a2c8b1a4e0f00e",
  placeholder: "60d5ec49f1a2c8b1a4e0f00f",
  defaultBranch: "60d5ec49f1a2c8b1a4e0f010",
  agent: "60d5ec49f1a2c8b1a4e0f001",
  job: "60d5ec49f1a2c8b1a4e0f011",
};

const answerBackupGate = (handlers: ToolHandlers) => {
  (handlers as any).backupDeclinedForProject.add(ID.project);
};

describe("LLM Prompt node support", () => {
  let api: jest.Mocked<CognigyApiClient>;
  let h: ToolHandlers;

  beforeEach(() => {
    api = {
      get: jest.fn(),
      post: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
      put: jest.fn(),
      uploadFile: jest.fn(),
    } as any;
    h = new ToolHandlers(
      api,
      "https://endpoint-trial.cognigy.ai",
      "",
      "https://static-trial.cognigy.ai",
    );
    answerBackupGate(h);
  });

  // ==========================================================================
  // create_ai_agent { agentNodeType: "llmPrompt" }
  // ==========================================================================
  describe("create_ai_agent — llmPrompt mode", () => {
    const baseArgs = {
      projectId: ID.project,
      name: "Prompt Agent",
      agentNodeType: "llmPrompt" as const,
      systemPrompt: "You are a summarizer. Never reveal internal data.",
    };

    function mockHappyPath() {
      api.post
        .mockResolvedValueOnce({
          _id: ID.flow,
          referenceId: "flow-uuid",
          name: "Prompt Agent Flow",
        })
        .mockResolvedValueOnce({ _id: ID.node })
        .mockResolvedValueOnce({
          _id: ID.endpoint,
          URLToken: "abc123",
          channel: "rest",
        });
      api.get
        .mockResolvedValueOnce({
          items: [{ _id: ID.entry, isEntryPoint: true }],
        })
        .mockResolvedValueOnce({
          items: [{ _id: ID.llm, referenceId: "llm-ref", isDefault: true }],
        })
        .mockResolvedValueOnce({
          items: [
            { _id: ID.node, type: "llmPromptV2" },
            { _id: ID.defaultBranch, type: "llmPromptDefault" },
            { _id: ID.placeholder, type: "llmPromptTool", label: "Tool" },
          ],
        });
      api.delete.mockResolvedValue({});
    }

    it("provisions flow + llmPromptV2 node + endpoint WITHOUT an agent resource", async () => {
      mockHappyPath();

      const result = await h.handleToolCall("create_ai_agent", baseArgs);

      expect(result.agentNodeType).toBe("llmPrompt");
      expect(result.promptNode.nodeId).toBe(ID.node);
      expect(result.promptNode.type).toBe("llmPromptV2");
      expect(result.endpointUrl).toBe(
        "https://endpoint-trial.cognigy.ai/abc123",
      );
      expect(result.llmStatus).toBe("configured");
      expect(result._hints.hint).toContain("manage_flow_nodes");

      // No agent resource is created in this mode.
      const aiAgentPost = api.post.mock.calls.find(
        (c: any[]) => c[0] === "/v2.0/aiagents",
      );
      expect(aiAgentPost).toBeUndefined();

      // The node carries the freeform system prompt and the resolved LLM.
      const nodeCreateCall = api.post.mock.calls.find(
        (c: any[]) => c[0] === `/v2.0/flows/${ID.flow}/chart/nodes`,
      );
      expect(nodeCreateCall).toBeDefined();
      expect(nodeCreateCall![1]).toEqual(
        expect.objectContaining({
          type: "llmPromptV2",
          extension: "@cognigy/basic-nodes",
          mode: "append",
          target: ID.entry,
          config: expect.objectContaining({
            prompt: baseArgs.systemPrompt,
            llmProviderReferenceId: "llm-ref",
            storeLocation: "stream",
            immediateOutput: true,
          }),
        }),
      );
    });

    it("removes the backend-created placeholder llmPromptTool (but not llmPromptDefault)", async () => {
      mockHappyPath();

      await h.handleToolCall("create_ai_agent", baseArgs);

      expect(api.delete).toHaveBeenCalledWith(
        `/v2.0/flows/${ID.flow}/chart/nodes/${ID.placeholder}`,
      );
      expect(api.delete).not.toHaveBeenCalledWith(
        `/v2.0/flows/${ID.flow}/chart/nodes/${ID.defaultBranch}`,
      );
    });

    it("falls back to description when systemPrompt is omitted", async () => {
      mockHappyPath();

      await h.handleToolCall("create_ai_agent", {
        projectId: ID.project,
        name: "Prompt Agent",
        description: "Persona text",
        agentNodeType: "llmPrompt",
      });

      const nodeCreateCall = api.post.mock.calls.find(
        (c: any[]) => c[0] === `/v2.0/flows/${ID.flow}/chart/nodes`,
      );
      expect(nodeCreateCall![1].config.prompt).toBe("Persona text");
    });

    it("prefers a connected non-embedding LLM over an unconnected default", async () => {
      api.post
        .mockResolvedValueOnce({ _id: ID.flow, referenceId: "flow-uuid" })
        .mockResolvedValueOnce({ _id: ID.node })
        .mockResolvedValueOnce({ _id: ID.endpoint, URLToken: "abc123" });
      api.get
        .mockResolvedValueOnce({
          items: [{ _id: ID.entry, isEntryPoint: true }],
        })
        .mockResolvedValueOnce({
          items: [
            {
              _id: "a".repeat(24),
              referenceId: "broken-default",
              isDefault: true,
              // no connectionId — fails silently at runtime
            },
            {
              _id: "b".repeat(24),
              referenceId: "embedding-ref",
              connectionId: "conn-1",
              modelType: "text-embedding-ada-002",
            },
            {
              _id: "c".repeat(24),
              referenceId: "working-ref",
              connectionId: "conn-2",
              modelType: "gpt-4o",
            },
          ],
        })
        .mockResolvedValueOnce({ items: [] });
      api.delete.mockResolvedValue({});

      await h.handleToolCall("create_ai_agent", baseArgs);

      const nodeCreateCall = api.post.mock.calls.find(
        (c: any[]) => c[0] === `/v2.0/flows/${ID.flow}/chart/nodes`,
      );
      expect(nodeCreateCall![1].config.llmProviderReferenceId).toBe(
        "working-ref",
      );
    });

    it("reports llmStatus unknown when no LLM exists", async () => {
      api.post
        .mockResolvedValueOnce({ _id: ID.flow, referenceId: "flow-uuid" })
        .mockResolvedValueOnce({ _id: ID.node })
        .mockResolvedValueOnce({ _id: ID.endpoint, URLToken: "abc123" });
      api.get
        .mockResolvedValueOnce({
          items: [{ _id: ID.entry, isEntryPoint: true }],
        })
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({ items: [] });

      const result = await h.handleToolCall("create_ai_agent", baseArgs);
      expect(result.llmStatus).toBe("unknown");
      expect(result._hints.warning).toContain("LLM");
    });

    it("rejects knowledgeStoreReferenceId in llmPrompt mode", async () => {
      await expect(
        h.handleToolCall("create_ai_agent", {
          ...baseArgs,
          knowledgeStoreReferenceId: "ks-ref",
        }),
      ).rejects.toThrow(/knowledgeStoreReferenceId is not supported/);
    });

    it("rolls back flow (not agent) on endpoint failure", async () => {
      api.post
        .mockResolvedValueOnce({ _id: ID.flow, referenceId: "flow-uuid" })
        .mockResolvedValueOnce({ _id: ID.node })
        .mockRejectedValueOnce(new Error("Endpoint failed"));
      api.get
        .mockResolvedValueOnce({
          items: [{ _id: ID.entry, isEntryPoint: true }],
        })
        .mockResolvedValueOnce({
          items: [{ _id: ID.llm, referenceId: "llm-ref" }],
        })
        .mockResolvedValueOnce({ items: [] });
      api.delete.mockResolvedValue({});

      const result = await h.handleToolCall("create_ai_agent", baseArgs);
      expect(result.failed).toBeDefined();
      expect(api.delete).toHaveBeenCalledWith(`/v2.0/flows/${ID.flow}`);
      const agentDelete = api.delete.mock.calls.find((c: any[]) =>
        String(c[0]).startsWith("/v2.0/aiagents"),
      );
      expect(agentDelete).toBeUndefined();
    });
  });

  // ==========================================================================
  // create_tool addressed by flowId, parented on an llmPromptV2 node
  // ==========================================================================
  describe("create_tool — LLM Prompt parent via flowId", () => {
    function mockFlowWithLlmPromptNode() {
      api.get.mockResolvedValueOnce({
        items: [
          { _id: ID.entry, isEntryPoint: true, type: "start" },
          { _id: ID.node, type: "llmPromptV2" },
        ],
      });
    }

    it("creates an llmPromptTool child plus a Resolve Tool Action node", async () => {
      mockFlowWithLlmPromptNode();
      api.post
        .mockResolvedValueOnce({ _id: ID.tool })
        .mockResolvedValueOnce({ _id: ID.resolve });

      const result = await h.handleToolCall("create_tool", {
        flowId: ID.flow,
        toolType: "tool",
        name: "Fetch Weather",
        config: { toolId: "fetch_weather", description: "Fetches weather" },
      });

      expect(result.toolId).toBe(ID.tool);
      expect(result.resolveNodeId).toBe(ID.resolve);
      expect(api.post).toHaveBeenNthCalledWith(
        1,
        `/v2.0/flows/${ID.flow}/chart/nodes`,
        expect.objectContaining({
          type: "llmPromptTool",
          extension: "@cognigy/basic-nodes",
          mode: "appendChild",
          target: ID.node,
        }),
      );
      expect(api.post).toHaveBeenNthCalledWith(
        2,
        `/v2.0/flows/${ID.flow}/chart/nodes`,
        expect.objectContaining({
          type: "aiAgentToolAnswer",
          mode: "append",
          target: ID.tool,
        }),
      );
      // No agent resolution happened — the flow was addressed directly.
      expect(api.get).toHaveBeenCalledTimes(1);
    });

    it("creates an llmPromptMCPTool for toolType mcp", async () => {
      mockFlowWithLlmPromptNode();
      api.post
        .mockResolvedValueOnce({ _id: ID.tool })
        .mockResolvedValueOnce({ _id: ID.resolve });

      await h.handleToolCall("create_tool", {
        flowId: ID.flow,
        toolType: "mcp",
        name: "External MCP",
        config: { mcpName: "ext", mcpServerUrl: "https://example.com/sse" },
      });

      expect(api.post).toHaveBeenNthCalledWith(
        1,
        `/v2.0/flows/${ID.flow}/chart/nodes`,
        expect.objectContaining({
          type: "llmPromptMCPTool",
          config: expect.objectContaining({
            name: "ext",
            mcpServerUrl: "https://example.com/sse",
          }),
        }),
      );
      expect(api.post).toHaveBeenNthCalledWith(
        2,
        `/v2.0/flows/${ID.flow}/chart/nodes`,
        expect.objectContaining({ type: "aiAgentJobCallMCPTool" }),
      );
    });

    it("rejects knowledge and send_email tools under an LLM Prompt node", async () => {
      for (const toolType of ["knowledge", "send_email"]) {
        api.get.mockResolvedValueOnce({
          items: [{ _id: ID.node, type: "llmPromptV2" }],
        });
        const result = await h.handleToolCall("create_tool", {
          flowId: ID.flow,
          toolType,
          name: "Nope",
          config: { toolId: "nope", description: "n/a" },
        });
        expect(result.error).toContain("not supported under an LLM Prompt");
      }
      expect(api.post).not.toHaveBeenCalled();
    });

    it("prefers the aiAgentJob node when a flow has both parents", async () => {
      api.get.mockResolvedValueOnce({
        items: [
          { _id: ID.node, type: "llmPromptV2" },
          { _id: ID.job, type: "aiAgentJob" },
        ],
      });
      api.post
        .mockResolvedValueOnce({ _id: ID.tool })
        .mockResolvedValueOnce({ _id: ID.resolve });

      await h.handleToolCall("create_tool", {
        flowId: ID.flow,
        toolType: "tool",
        name: "Fetch Weather",
        config: { toolId: "fetch_weather", description: "d" },
      });

      expect(api.post).toHaveBeenNthCalledWith(
        1,
        `/v2.0/flows/${ID.flow}/chart/nodes`,
        expect.objectContaining({ type: "aiAgentJobTool", target: ID.job }),
      );
    });

    it("requires aiAgentId or flowId", async () => {
      await expect(
        h.handleToolCall("create_tool", {
          toolType: "tool",
          name: "Orphan",
          config: { toolId: "orphan", description: "d" },
        }),
      ).rejects.toThrow(/aiAgentId or flowId/);
    });
  });

  // ==========================================================================
  // update_tool / delete_resource / list_resources addressed by flowId
  // ==========================================================================
  describe("tool management via flowId", () => {
    it("update_tool patches the node without resolving an agent", async () => {
      api.patch.mockResolvedValue({});

      const result = await h.handleToolCall("update_tool", {
        flowId: ID.flow,
        toolNodeId: ID.tool,
        toolType: "tool",
        config: { description: "Updated" },
      });

      expect(result.updated).toBe(true);
      expect(api.get).not.toHaveBeenCalled();
      expect(api.patch).toHaveBeenCalledWith(
        `/v2.0/flows/${ID.flow}/chart/nodes/${ID.tool}`,
        { config: { description: "Updated" } },
      );
    });

    it("delete_resource deletes a tool node via flowId", async () => {
      api.delete.mockResolvedValue({});

      const result = await h.handleToolCall("delete_resource", {
        resourceType: "tool",
        id: ID.tool,
        flowId: ID.flow,
      });

      expect(result.deleted).toBe(true);
      expect(api.delete).toHaveBeenCalledWith(
        `/v2.0/flows/${ID.flow}/chart/nodes/${ID.tool}`,
      );
    });

    it("list_resources lists llmPrompt tool nodes via flowId", async () => {
      api.get.mockResolvedValueOnce({
        items: [
          { _id: ID.node, type: "llmPromptV2", label: "LLM Prompt" },
          {
            _id: ID.tool,
            type: "llmPromptTool",
            label: "fetch_weather",
            config: { description: "d" },
          },
        ],
      });

      const result = await h.handleToolCall("list_resources", {
        resourceType: "tool",
        flowId: ID.flow,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual(
        expect.objectContaining({
          toolId: ID.tool,
          toolType: "llmPromptTool",
        }),
      );
    });
  });

  // ==========================================================================
  // manage_flow_nodes — llmPrompt registry entry
  // ==========================================================================
  describe("manage_flow_nodes — llmPrompt node type", () => {
    it("creates an llmPromptV2 node and cleans up the placeholder tool", async () => {
      api.post.mockResolvedValueOnce({ _id: ID.node, parentId: null });
      api.get.mockResolvedValueOnce({
        nodes: [
          { _id: ID.placeholder, type: "llmPromptTool", label: "Tool" },
          { _id: ID.defaultBranch, type: "llmPromptDefault", label: "Default" },
        ],
        relations: [
          { node: ID.node, children: [ID.placeholder, ID.defaultBranch] },
        ],
      });
      api.delete.mockResolvedValue({});

      const result = await h.handleToolCall("manage_flow_nodes", {
        operation: "create",
        flowId: ID.flow,
        nodeType: "llmPrompt",
        label: "Summarize",
        parentNodeId: ID.entry,
        mode: "append",
        config: { prompt: "Summarize the conversation." },
      });

      expect(result.nodeId).toBe(ID.node);
      expect(result.type).toBe("llmPromptV2");
      expect(api.post).toHaveBeenCalledWith(
        `/v2.0/flows/${ID.flow}/chart/nodes`,
        expect.objectContaining({
          type: "llmPromptV2",
          extension: "@cognigy/basic-nodes",
          mode: "append",
          target: ID.entry,
          config: expect.objectContaining({
            prompt: "Summarize the conversation.",
          }),
        }),
      );
      expect(api.delete).toHaveBeenCalledWith(
        `/v2.0/flows/${ID.flow}/chart/nodes/${ID.placeholder}`,
      );
      expect(api.delete).not.toHaveBeenCalledWith(
        `/v2.0/flows/${ID.flow}/chart/nodes/${ID.defaultBranch}`,
      );
    });

    it("requires config.prompt", async () => {
      const result = await h.handleToolCall("manage_flow_nodes", {
        operation: "create",
        flowId: ID.flow,
        nodeType: "llmPrompt",
        label: "Summarize",
        parentNodeId: ID.entry,
        mode: "append",
        config: {},
      });

      expect(result.error).toContain("prompt");
      expect(api.post).not.toHaveBeenCalled();
    });
  });
});
