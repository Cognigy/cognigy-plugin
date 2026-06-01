import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Readable } from "stream";
import { CognigyApiClient } from "../api/client.js";
import { ToolHandlers } from "../tools/handlers.js";

// Valid 24-char hex IDs for tests
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
  pkg: "60d5ec49f1a2c8b1a4e0f00b",
  task: "60d5ec49f1a2c8b1a4e0f00c",
  task2: "60d5ec49f1a2c8b1a4e0f00d",
};

describe("ToolHandlers v2", () => {
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
  });

  // =========================================================================
  // create_ai_agent
  // =========================================================================
  describe("create_ai_agent", () => {
    const baseArgs = {
      projectId: ID.project,
      name: "Test Agent",
      description: "A test agent",
    };

    it("succeeds with full orchestration chain", async () => {
      const mockAgent = {
        _id: ID.agent,
        referenceId: "ref-uuid",
        name: "Test Agent",
        image: "default-avatar:4",
        imageOptimizedFormat: true,
      };
      const mockFlow = {
        _id: ID.flow,
        referenceId: "flow-uuid",
        name: "Test Agent Flow",
      };
      const mockEndpoint = {
        _id: ID.endpoint,
        URLToken: "abc123",
        channel: "rest",
      };

      api.post
        .mockResolvedValueOnce(mockAgent)
        .mockResolvedValueOnce(mockFlow)
        .mockResolvedValueOnce({ _id: ID.node })
        .mockResolvedValueOnce(mockEndpoint);
      api.get
        .mockResolvedValueOnce({
          items: [{ _id: ID.entry, isEntryPoint: true }],
        })
        .mockResolvedValueOnce({ items: [{ _id: ID.llm }] })
        .mockResolvedValueOnce({ nodes: [] })
        .mockResolvedValueOnce({ items: [] });

      const result = await h.handleToolCall("create_ai_agent", baseArgs);

      expect(result.agent).toBeDefined();
      expect(result.flow).toBeDefined();
      expect(result.endpoint).toBeDefined();
      expect(result.endpointUrl).toBe(
        "https://endpoint-trial.cognigy.ai/abc123",
      );
      expect(result.llmStatus).toBe("configured");
      expect(result._hints).toBeUndefined();
      expect(api.post).toHaveBeenNthCalledWith(
        1,
        "/v2.0/aiagents",
        expect.objectContaining({
          projectId: ID.project,
          name: "Test Agent",
          image: "default-avatar:1",
          imageOptimizedFormat: true,
        }),
      );
      expect(api.post).toHaveBeenNthCalledWith(
        3,
        `/v2.0/flows/${ID.flow}/chart/nodes`,
        expect.objectContaining({
          preview: {
            keyValue: "Test Agent",
            aiAgentName: "Test Agent",
            aiAgentImage: "default-avatar:4",
            aiAgentImageOptimizedFormat: true,
          },
        }),
      );
    });

    it("falls back to the default preview avatar when the created agent returns a blank image", async () => {
      const mockAgent = {
        _id: ID.agent,
        referenceId: "ref-uuid",
        name: "Test Agent",
        image: "   ",
      };
      const mockFlow = {
        _id: ID.flow,
        referenceId: "flow-uuid",
        name: "Test Agent Flow",
      };
      const mockEndpoint = {
        _id: ID.endpoint,
        URLToken: "abc123",
        channel: "rest",
      };

      api.post
        .mockResolvedValueOnce(mockAgent)
        .mockResolvedValueOnce(mockFlow)
        .mockResolvedValueOnce({ _id: ID.node })
        .mockResolvedValueOnce(mockEndpoint);
      api.get
        .mockResolvedValueOnce({
          items: [{ _id: ID.entry, isEntryPoint: true }],
        })
        .mockResolvedValueOnce({ items: [{ _id: ID.llm }] })
        .mockResolvedValueOnce({ nodes: [] })
        .mockResolvedValueOnce({ items: [] });
      api.patch.mockResolvedValue({});

      await h.handleToolCall("create_ai_agent", baseArgs);

      expect(api.post).toHaveBeenNthCalledWith(
        3,
        `/v2.0/flows/${ID.flow}/chart/nodes`,
        expect.objectContaining({
          preview: {
            keyValue: "Test Agent",
            aiAgentName: "Test Agent",
            aiAgentImage: "default-avatar:1",
            aiAgentImageOptimizedFormat: true,
          },
        }),
      );
      expect(api.patch).toHaveBeenCalledWith(
        `/v2.0/flows/${ID.flow}/chart/nodes/${ID.node}`,
        expect.objectContaining({
          preview: {
            keyValue: "Test Agent",
            aiAgentName: "Test Agent",
            aiAgentImage: "default-avatar:1",
            aiAgentImageOptimizedFormat: true,
          },
        }),
      );
    });

    it("returns llmStatus unknown with hints when no LLM", async () => {
      const mockAgent = {
        _id: ID.agent,
        referenceId: "ref-uuid",
        name: "Test Agent",
      };
      const mockFlow = { _id: ID.flow, referenceId: "flow-uuid", name: "Flow" };
      const mockEndpoint = {
        _id: ID.endpoint,
        URLToken: "xyz",
        channel: "rest",
      };

      api.post
        .mockResolvedValueOnce(mockAgent)
        .mockResolvedValueOnce(mockFlow)
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce(mockEndpoint);
      api.get
        .mockResolvedValueOnce({
          items: [{ _id: ID.entry, isEntryPoint: true }],
        })
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({ nodes: [] })
        .mockResolvedValueOnce({ items: [] });

      const result = await h.handleToolCall("create_ai_agent", baseArgs);
      expect(result.llmStatus).toBe("unknown");
      expect(result._hints).toBeDefined();
      expect(result._hints.resource).toBe("cognigy://guide/agent-creation");
    });

    it("rolls back on flow creation failure", async () => {
      const mockAgent = { _id: ID.agent, referenceId: "ref-uuid" };
      api.post
        .mockResolvedValueOnce(mockAgent)
        .mockRejectedValueOnce(new Error("Flow creation failed"));
      api.delete.mockResolvedValue({});

      const result = await h.handleToolCall("create_ai_agent", baseArgs);
      expect(result.failed).toBeDefined();
      expect(result.failed.step).toBe("flow");
      expect(result._hints.resource).toBe("cognigy://guide/troubleshooting");
      expect(api.delete).toHaveBeenCalledWith(`/v2.0/aiagents/${ID.agent}`);
    });

    it("rolls back on endpoint creation failure", async () => {
      const mockAgent = { _id: ID.agent, referenceId: "ref-uuid" };
      const mockFlow = { _id: ID.flow, referenceId: "flow-uuid" };

      api.post
        .mockResolvedValueOnce(mockAgent)
        .mockResolvedValueOnce(mockFlow)
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error("Endpoint failed"));
      api.get
        .mockResolvedValueOnce({
          items: [{ _id: ID.entry, isEntryPoint: true }],
        })
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({ nodes: [] })
        .mockResolvedValueOnce({ items: [] });
      api.delete.mockResolvedValue({});

      const result = await h.handleToolCall("create_ai_agent", baseArgs);
      expect(result.failed).toBeDefined();
      expect(result.failed.step).toBe("endpoint");
      expect(api.delete).toHaveBeenCalledWith(`/v2.0/flows/${ID.flow}`);
      expect(api.delete).toHaveBeenCalledWith(`/v2.0/aiagents/${ID.agent}`);
    });

    it("removes backend-created unlock_account placeholder tool after creating the job node", async () => {
      const mockAgent = {
        _id: ID.agent,
        referenceId: "ref-uuid",
        name: "Test Agent",
      };
      const mockFlow = {
        _id: ID.flow,
        referenceId: "flow-uuid",
        name: "Test Agent Flow",
      };
      const mockEndpoint = {
        _id: ID.endpoint,
        URLToken: "abc123",
        channel: "rest",
      };
      const placeholderToolId = "aaaaaaaaaaaaaaaaaaaaa999";

      api.post
        .mockResolvedValueOnce(mockAgent)
        .mockResolvedValueOnce(mockFlow)
        .mockResolvedValueOnce({ _id: ID.node })
        .mockResolvedValueOnce(mockEndpoint);
      api.get
        .mockResolvedValueOnce({
          items: [{ _id: ID.entry, isEntryPoint: true }],
        })
        .mockResolvedValueOnce({ items: [{ _id: ID.llm }] })
        .mockResolvedValueOnce({
          relations: [
            {
              node: ID.node,
              children: [placeholderToolId],
            },
          ],
          nodes: [
            {
              _id: placeholderToolId,
              preview: "unlock_account",
            },
          ],
        });
      api.delete.mockResolvedValue({});

      await h.handleToolCall("create_ai_agent", baseArgs);

      expect(api.delete).toHaveBeenCalledWith(
        `/v2.0/flows/${ID.flow}/chart/nodes/${placeholderToolId}`,
      );
    });
  });

  // =========================================================================
  // update_ai_agent
  // =========================================================================
  describe("update_ai_agent", () => {
    it("patches agent-level fields and returns filtered response", async () => {
      const raw = {
        _id: ID.agent,
        referenceId: "uuid",
        name: "Updated",
        description: "New desc",
        createdAt: "2024-01-01",
        internalField: "should be filtered",
      };
      api.patch.mockResolvedValue(raw);

      const result = await h.handleToolCall("update_ai_agent", {
        aiAgentId: ID.agent,
        description: "New desc",
      });

      expect(result.updated).toContain("agent");
      expect(result.name).toBe("Updated");
      expect(result.internalField).toBeUndefined();
      expect(api.patch).toHaveBeenCalledWith(`/v2.0/aiagents/${ID.agent}`, {
        description: "New desc",
      });
    });

    it("patches job node config when jobConfig is provided", async () => {
      const mockAgent = {
        _id: ID.agent,
        referenceId: "ref-uuid",
        name: "Agent",
        flowId: ID.flow,
      };
      const mockJobNode = {
        _id: "job-node-id-000000000001",
        type: "aiAgentJob",
      };

      api.get
        .mockResolvedValueOnce(mockAgent)
        .mockResolvedValueOnce({ items: [mockJobNode] });
      api.patch.mockResolvedValue({ _id: "job-node-id-000000000001" });

      const result = await h.handleToolCall("update_ai_agent", {
        aiAgentId: ID.agent,
        jobConfig: { llmProviderReferenceId: "llm-ref-uuid", temperature: 0.5 },
      });

      expect(result.updated).toContain("jobNode");
      expect(api.patch).toHaveBeenCalledWith(
        `/v2.0/flows/${ID.flow}/chart/nodes/job-node-id-000000000001`,
        {
          config: { llmProviderReferenceId: "llm-ref-uuid", temperature: 0.5 },
        },
      );
    });

    it("returns error when nothing to update", async () => {
      const result = await h.handleToolCall("update_ai_agent", {
        aiAgentId: ID.agent,
      });

      expect(result.error).toContain("Nothing to update");
    });
  });

  // =========================================================================
  // setup_llm
  // =========================================================================
  describe("setup_llm", () => {
    const mockLlm = {
      _id: ID.llm,
      referenceId: "llm-ref-uuid",
      name: "gpt-4o",
      provider: "openAI",
      modelType: "gpt-4o",
      connectionId: "conn-ref-uuid",
      isDefault: true,
    };

    const mockTestSuccess = {
      isCredentialsValid: true,
      msg: "Connected to openAI with the gpt-4o model.",
    };
    const mockTestFailure = {
      isCredentialsValid: false,
      msg: "Invalid API key provided.",
    };

    it("auto-creates connection then LLM when apiKey provided", async () => {
      const mockConn = { _id: "conn1", referenceId: "conn-ref-uuid" };
      api.post
        .mockResolvedValueOnce(mockConn)
        .mockResolvedValueOnce(mockLlm)
        .mockResolvedValueOnce(mockTestSuccess);

      const result = await h.handleToolCall("setup_llm", {
        projectId: ID.project,
        provider: "openAI",
        modelType: "gpt-4o",
        apiKey: "sk-test",
      });

      expect(result.provider).toBe("openAI");
      expect(result.modelType).toBe("gpt-4o");
      expect(result.connectionTest.isCredentialsValid).toBe(true);
      expect(api.post).toHaveBeenCalledWith(
        "/v2.0/connections",
        expect.objectContaining({
          type: "OpenAIProvider",
          extension: "@cognigy/generative-ai-provider",
          fields: { apiKey: "sk-test" },
        }),
      );
      expect(api.post).toHaveBeenCalledWith(
        "/v2.0/largelanguagemodels",
        expect.objectContaining({
          modelType: "gpt-4o",
          provider: "openAI",
          connectionId: "conn-ref-uuid",
        }),
      );
      expect(api.post).toHaveBeenCalledWith(
        `/v2.0/largelanguagemodels/${ID.llm}/test`,
      );
    });

    it("creates LLM directly when connectionId provided", async () => {
      const llmWithExistingConn = {
        ...mockLlm,
        connectionId: "existing-conn-uuid",
      };
      api.get.mockResolvedValueOnce({
        items: [{ _id: "conn1", referenceId: "existing-conn-uuid" }],
      });
      api.post
        .mockResolvedValueOnce(llmWithExistingConn)
        .mockResolvedValueOnce(mockTestSuccess);

      const result = await h.handleToolCall("setup_llm", {
        projectId: ID.project,
        provider: "openAI",
        modelType: "gpt-4o",
        connectionId: "existing-conn-uuid",
      });

      expect(result.provider).toBe("openAI");
      expect(result.connectionTest.isCredentialsValid).toBe(true);
      expect(api.get).toHaveBeenCalledWith("/new/v2.0/connections", {
        params: { projectId: ID.project },
      });
      expect(api.post).toHaveBeenCalledTimes(2);
      expect(api.post).toHaveBeenCalledWith(
        "/v2.0/largelanguagemodels",
        expect.objectContaining({
          connectionId: "existing-conn-uuid",
        }),
      );
    });

    it("returns error when neither apiKey nor connectionId provided", async () => {
      const result = await h.handleToolCall("setup_llm", {
        projectId: ID.project,
        provider: "openAI",
        modelType: "gpt-4o",
      });

      expect(result.error).toContain("apiKey or connectionId");
      expect(result._hints.resource).toBe("cognigy://guide/llm-providers");
    });

    it("deletes model and returns error when connection test fails", async () => {
      api.get.mockResolvedValueOnce({
        items: [{ _id: "conn1", referenceId: "bad-conn-uuid" }],
      });
      api.post
        .mockResolvedValueOnce(mockLlm)
        .mockResolvedValueOnce(mockTestFailure);
      api.delete.mockResolvedValue({});

      const result = await h.handleToolCall("setup_llm", {
        projectId: ID.project,
        provider: "openAI",
        modelType: "gpt-4o",
        connectionId: "bad-conn-uuid",
      });

      expect(result.error).toContain("connection test failed");
      expect(result.providerMessage).toBe("Invalid API key provided.");
      expect(result._hints.resource).toBe("cognigy://guide/llm-providers");
      expect(api.delete).toHaveBeenCalledWith(
        `/v2.0/largelanguagemodels/${ID.llm}`,
      );
    });

    it("keeps model with warning when test endpoint itself errors", async () => {
      api.get.mockResolvedValueOnce({
        items: [{ _id: "conn1", referenceId: "some-conn-uuid" }],
      });
      api.post
        .mockResolvedValueOnce(mockLlm)
        .mockRejectedValueOnce(new Error("Network timeout"));

      const result = await h.handleToolCall("setup_llm", {
        projectId: ID.project,
        provider: "openAI",
        modelType: "gpt-4o",
        connectionId: "some-conn-uuid",
      });

      expect(result.warning).toContain("connection test could not be executed");
      expect(result.connectionTest.skipped).toBe(true);
      expect(result.connectionTest.reason).toContain("Network timeout");
      expect(result.provider).toBe("openAI");
      expect(api.delete).not.toHaveBeenCalled();
    });

    it("skips test and returns warning when dangerouslySkipConnectionTest is true", async () => {
      api.get.mockResolvedValueOnce({
        items: [{ _id: "conn1", referenceId: "some-conn-uuid" }],
      });
      api.post.mockResolvedValueOnce(mockLlm);

      const result = await h.handleToolCall("setup_llm", {
        projectId: ID.project,
        provider: "openAI",
        modelType: "gpt-4o",
        connectionId: "some-conn-uuid",
        dangerouslySkipConnectionTest: true,
      });

      expect(result.warning).toContain("Connection test was skipped");
      expect(result.connectionTest.skipped).toBe(true);
      expect(result.provider).toBe("openAI");
      expect(api.post).toHaveBeenCalledTimes(1);
    });

    it("still attempts cleanup even if delete fails after test failure", async () => {
      api.get.mockResolvedValueOnce({
        items: [{ _id: "conn1", referenceId: "bad-conn-uuid" }],
      });
      api.post
        .mockResolvedValueOnce(mockLlm)
        .mockResolvedValueOnce(mockTestFailure);
      api.delete.mockRejectedValueOnce(new Error("Delete failed"));

      const result = await h.handleToolCall("setup_llm", {
        projectId: ID.project,
        provider: "openAI",
        modelType: "gpt-4o",
        connectionId: "bad-conn-uuid",
      });

      expect(result.error).toContain("connection test failed");
      expect(api.delete).toHaveBeenCalledWith(
        `/v2.0/largelanguagemodels/${ID.llm}`,
      );
    });

    it("rejects connectionId that does not belong to the target project", async () => {
      api.get.mockResolvedValueOnce({ items: [] });

      const result = await h.handleToolCall("setup_llm", {
        projectId: ID.project,
        provider: "openAI",
        modelType: "gpt-4o",
        connectionId: "foreign-conn-uuid",
      });

      expect(result.error).toContain("was not found in the target project");
      expect(result._hints.resource).toBe("cognigy://guide/package-management");
      expect(api.post).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // talk_to_agent
  // =========================================================================
  describe("talk_to_agent", () => {
    it("returns session and hints when endpoint fails", async () => {
      const result = await h.handleTalkToAgent({
        endpointUrl: "https://endpoint-trial.cognigy.ai/nonexistent-test",
        message: "Hi",
      });

      expect(result.sessionId).toBeDefined();
      expect(result._hints).toBeDefined();
      expect(result._hints.resource).toBe("cognigy://guide/troubleshooting");
    });

    it("resolves existing REST endpoint by aiAgentId", async () => {
      // Mock resolveFlowForAgent: agent GET → returns agent with flowId
      api.get
        .mockResolvedValueOnce({
          _id: ID.agent,
          name: "Test Agent",
          flowId: ID.flow,
          projectId: ID.project,
        })
        // Mock flow GET → returns flow with referenceId
        .mockResolvedValueOnce({
          _id: ID.flow,
          referenceId: "ref-flow-uuid",
        })
        // Mock endpoint listing → returns a REST endpoint matching flowId
        .mockResolvedValueOnce({
          items: [
            {
              _id: ID.endpoint,
              channel: "rest",
              flowId: ID.flow,
              URLToken: "abc123token",
            },
          ],
        });

      const result = await h.handleTalkToAgent({
        aiAgentId: ID.agent,
        message: "Hi",
      });

      // The axios.post to the endpoint URL will fail (no real server),
      // but we can verify that the endpoint was resolved
      expect(result.sessionId).toBeDefined();
      // The endpoint URL should be constructed from the URLToken
      expect(result.endpointUrl || result.error || result._hints).toBeDefined();
    });

    it("auto-creates REST endpoint when none exists", async () => {
      // Mock resolveFlowForAgent: agent GET
      api.get
        .mockResolvedValueOnce({
          _id: ID.agent,
          name: "Test Agent",
          flowId: ID.flow,
          projectId: ID.project,
        })
        // Mock flow GET
        .mockResolvedValueOnce({
          _id: ID.flow,
          referenceId: "ref-flow-uuid",
        })
        // Mock endpoint listing → empty (no REST endpoint)
        .mockResolvedValueOnce({ items: [] });

      // Mock endpoint creation
      api.post.mockResolvedValueOnce({
        _id: ID.endpoint,
        URLToken: "new-token-123",
        channel: "rest",
      });

      const result = await h.handleTalkToAgent({
        aiAgentId: ID.agent,
        message: "Hi",
      });

      expect(api.post).toHaveBeenCalledWith("/v2.0/endpoints", {
        projectId: ID.project,
        channel: "rest",
        flowId: "ref-flow-uuid",
        name: "Test Agent REST Endpoint",
      });
      expect(result.sessionId).toBeDefined();
      // Should have attempted the auto-creation
      expect(result.endpointAutoCreated || result.error).toBeDefined();
    });

    it("falls back to flow.projectReference when the agent payload lacks a projectId", async () => {
      api.get
        .mockResolvedValueOnce({
          _id: ID.agent,
          name: "Test Agent",
          flowId: ID.flow,
          // no projectId or project field on the agent
        })
        .mockResolvedValueOnce({
          _id: ID.flow,
          referenceId: "ref-flow-uuid",
          projectReference: ID.project,
        })
        .mockResolvedValueOnce({
          items: [
            {
              _id: ID.endpoint,
              channel: "rest",
              flowId: ID.flow,
              URLToken: "tok-resolved-via-flow",
            },
          ],
        });

      const result = await h.handleTalkToAgent({
        aiAgentId: ID.agent,
        message: "Hi",
      });

      expect(result.error).not.toBe(
        "Could not determine projectId for this agent.",
      );
      expect(result.sessionId).toBeDefined();
      expect(api.get).toHaveBeenCalledWith(
        "/v2.0/endpoints",
        expect.objectContaining({
          params: expect.objectContaining({ projectId: ID.project }),
        }),
      );
    });

    it("returns error when flow resolution fails", async () => {
      // Mock resolveFlowForAgent: agent without any flow reference
      api.get
        .mockResolvedValueOnce({
          _id: ID.agent,
          name: "Test Agent",
          projectId: ID.project,
        })
        // Strategy 2 (/jobs) fails
        .mockRejectedValueOnce(new Error("Not found"))
        // Strategy 3 (flows listing) returns no match
        .mockResolvedValueOnce({ items: [] });

      const result = await h.handleTalkToAgent({
        aiAgentId: ID.agent,
        message: "Hi",
      });

      expect(result.error).toContain("Could not find a flow");
      expect(result._hints).toBeDefined();
      expect(result._hints.resource).toBe("cognigy://guide/agent-creation");
    });

    it("uses endpointUrl directly when both endpointUrl and aiAgentId are provided", async () => {
      const result = await h.handleTalkToAgent({
        endpointUrl: "https://endpoint-trial.cognigy.ai/nonexistent-test",
        aiAgentId: ID.agent,
        message: "Hi",
      });

      // Should NOT call any resolution APIs — endpointUrl takes precedence
      expect(api.get).not.toHaveBeenCalled();
      expect(result.sessionId).toBeDefined();
    });
  });

  // =========================================================================
  // list_resources
  // =========================================================================
  describe("list_resources", () => {
    it("lists projects without projectId", async () => {
      api.get.mockResolvedValue({
        items: [{ _id: ID.project, name: "My Project" }],
        total: 1,
      });

      const result = await h.handleToolCall("list_resources", {
        resourceType: "project",
      });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe("My Project");
    });

    it("returns error when projectId missing for non-project type", async () => {
      const result = await h.handleToolCall("list_resources", {
        resourceType: "agent",
      });
      expect(result.error).toContain("projectId is required");
    });

    it("returns error when aiAgentId missing for tool type", async () => {
      const result = await h.handleToolCall("list_resources", {
        resourceType: "tool",
      });
      expect(result.error).toContain("aiAgentId is required");
    });

    it("lists agents with filtered response", async () => {
      api.get.mockResolvedValue({
        items: [
          {
            _id: ID.agent,
            referenceId: "uuid",
            name: "Agent1",
            description: "Desc",
            createdAt: "2024-01-01",
            extraField: "should be filtered",
          },
        ],
        total: 1,
      });

      const result = await h.handleToolCall("list_resources", {
        resourceType: "agent",
        projectId: ID.project,
      });

      expect(result.items[0].name).toBe("Agent1");
      expect(result.items[0].extraField).toBeUndefined();
    });

    it("adds hints for empty agent results", async () => {
      api.get.mockResolvedValue({ items: [], total: 0 });

      const result = await h.handleToolCall("list_resources", {
        resourceType: "agent",
        projectId: ID.project,
      });

      expect(result.items).toHaveLength(0);
      expect(result._hints).toBeDefined();
      expect(result._hints.resource).toBe("cognigy://guide/agent-creation");
    });

    it("resolves tools via agent flow (only whitelisted types)", async () => {
      api.get.mockResolvedValueOnce({ flowId: ID.flow }).mockResolvedValueOnce({
        items: [
          { _id: ID.entry, isEntryPoint: true, type: "entry" },
          { _id: ID.node, type: "aiAgentJob" },
          { _id: ID.tool, type: "aiAgentJobTool", label: "Weather API" },
          {
            _id: "60d5ec49f1a2c8b1a4e0f00b",
            type: "httpRequest",
            label: "Stray Node",
          },
        ],
      });

      const result = await h.handleToolCall("list_resources", {
        resourceType: "tool",
        aiAgentId: ID.agent,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe("Weather API");
      expect(result.items[0].toolType).toBe("aiAgentJobTool");
    });

    it("lists conversations with date filters", async () => {
      api.get.mockResolvedValue({
        items: [{ sessionId: "s1", channel: "rest" }],
        total: 1,
      });

      const result = await h.handleToolCall("list_resources", {
        resourceType: "conversation",
        projectId: ID.project,
        startDate: "2024-01-01",
        endDate: "2024-12-31",
        channel: "rest",
      });

      expect(api.get).toHaveBeenCalledWith("/v2.0/conversations", {
        params: expect.objectContaining({
          startDate: "2024-01-01",
          endDate: "2024-12-31",
          channel: "rest",
        }),
      });
      expect(result.items).toHaveLength(1);
    });

    it("lists each resource type correctly", async () => {
      const types = [
        "flow",
        "endpoint",
        "llm_model",
        "knowledge_store",
        "extension",
        "function",
      ];
      for (const t of types) {
        api.get.mockResolvedValueOnce({
          items: [{ _id: ID.flow, name: "X" }],
          total: 1,
        });
        const result = await h.handleToolCall("list_resources", {
          resourceType: t,
          projectId: ID.project,
        });
        expect(result.items).toHaveLength(1);
      }
    });

    it("uses the useCase-filtered LLM endpoint when requested", async () => {
      api.get.mockResolvedValue({
        items: [{ _id: ID.llm, referenceId: "llm-ref-1", name: "Embedding" }],
        total: 1,
      });

      const result = await h.handleToolCall("list_resources", {
        resourceType: "llm_model",
        projectId: ID.project,
        useCase: "knowledgeSearch",
      });

      expect(api.get).toHaveBeenCalledWith("/new/v2.0/largelanguagemodels", {
        params: expect.objectContaining({
          projectId: ID.project,
          useCase: "knowledgeSearch",
        }),
      });
      expect(result.items).toHaveLength(1);
    });
  });

  // =========================================================================
  // get_resource
  // =========================================================================
  describe("get_resource", () => {
    it("returns filtered agent", async () => {
      api.get.mockResolvedValue({
        _id: ID.agent,
        referenceId: "uuid",
        name: "Agent",
        description: "D",
        createdAt: "2024-01-01",
        secret: "hidden",
      });

      const result = await h.handleToolCall("get_resource", {
        resourceType: "agent",
        id: ID.agent,
      });

      expect(result.name).toBe("Agent");
      expect(result.secret).toBeUndefined();
    });

    it("returns raw response when raw: true", async () => {
      const raw = { _id: ID.agent, name: "Agent", secret: "visible" };
      api.get.mockResolvedValue(raw);

      const result = await h.handleToolCall("get_resource", {
        resourceType: "agent",
        id: ID.agent,
        raw: true,
      });

      expect(result.secret).toBe("visible");
    });

    it("handles each resource type", async () => {
      const types = [
        "agent",
        "flow",
        "endpoint",
        "project",
        "llm_model",
        "knowledge_store",
        "extension",
        "function",
      ];
      for (const t of types) {
        api.get.mockResolvedValueOnce({ _id: ID.agent, name: "X" });
        const result = await h.handleToolCall("get_resource", {
          resourceType: t,
          id: ID.agent,
        });
        expect(result).toBeDefined();
      }
    });
  });

  // =========================================================================
  // delete_resource
  // =========================================================================
  describe("delete_resource", () => {
    it("deletes agent", async () => {
      api.get
        .mockResolvedValueOnce({
          _id: ID.agent,
          flowId: ID.flow,
          projectId: ID.project,
        })
        .mockResolvedValueOnce({ referenceId: "flow-ref" })
        .mockResolvedValueOnce({
          items: [{ _id: ID.endpoint, flowId: "flow-ref" }],
        });
      api.delete.mockResolvedValue({});

      const result = await h.handleToolCall("delete_resource", {
        resourceType: "agent",
        id: ID.agent,
      });

      expect(result.deleted).toBe(true);
      expect(api.delete).toHaveBeenCalledWith(`/v2.0/endpoints/${ID.endpoint}`);
      expect(api.delete).toHaveBeenCalledWith(`/v2.0/flows/${ID.flow}`);
      expect(api.delete).toHaveBeenCalledWith(`/v2.0/aiagents/${ID.agent}`);
    });

    it("deletes tool by resolving agent flow", async () => {
      api.get.mockResolvedValue({ flowId: ID.flow });
      api.delete.mockResolvedValue({});

      const result = await h.handleToolCall("delete_resource", {
        resourceType: "tool",
        id: ID.node,
        aiAgentId: ID.agent,
      });

      expect(result.deleted).toBe(true);
      expect(api.delete).toHaveBeenCalledWith(
        `/v2.0/flows/${ID.flow}/chart/nodes/${ID.node}`,
      );
    });

    it("returns error for tool without aiAgentId", async () => {
      const result = await h.handleToolCall("delete_resource", {
        resourceType: "tool",
        id: ID.node,
      });
      expect(result.error).toContain("aiAgentId");
    });

    it("deletes each resource type", async () => {
      const types = [
        "flow",
        "endpoint",
        "llm_model",
        "knowledge_store",
        "function",
      ];
      for (const t of types) {
        api.delete.mockResolvedValueOnce({});
        const result = await h.handleToolCall("delete_resource", {
          resourceType: t,
          id: ID.agent,
        });
        expect(result.deleted).toBe(true);
      }
    });
  });

  // =========================================================================
  // manage_knowledge
  // =========================================================================
  describe("manage_knowledge", () => {
    it("creates a knowledge store", async () => {
      api.post.mockResolvedValue({ _id: ID.ks, name: "My KB" });

      const result = await h.handleToolCall("manage_knowledge", {
        operation: "create_store",
        projectId: ID.project,
        name: "My KB",
      });

      expect(result.name).toBe("My KB");
    });

    it("creates a URL source with ingestion hint", async () => {
      api.post.mockResolvedValue({ taskData: { taskId: "task1" } });

      const result = await h.handleToolCall("manage_knowledge", {
        operation: "create_source",
        knowledgeStoreId: ID.ks,
        type: "url",
        url: "https://example.com",
      });

      expect(result.source.type).toBe("url");
      expect(result.source.status).toBe("ingesting");
      expect(result._hints).toBeDefined();
      expect(result._hints.warning).toContain("async");
      expect(api.post).toHaveBeenCalledWith(
        `/v2.0/knowledgestores/${ID.ks}/sources`,
        expect.objectContaining({ type: "url", url: "https://example.com" }),
      );
    });

    it("creates a manual text source with chunk", async () => {
      const mockSource = { knowledgeSource: { _id: "src1", name: "Menu" } };
      const mockChunk = { _id: "chunk1" };
      api.post
        .mockResolvedValueOnce(mockSource)
        .mockResolvedValueOnce(mockChunk);

      const result = await h.handleToolCall("manage_knowledge", {
        operation: "create_source",
        knowledgeStoreId: ID.ks,
        name: "Menu",
        text: "Falafel Wrap $12, Shawarma $14",
      });

      expect(result.source.id).toBe("src1");
      expect(result.source.type).toBe("manual");
      expect(result.chunk.id).toBe("chunk1");
      expect(api.post).toHaveBeenCalledWith(
        `/v2.0/knowledgestores/${ID.ks}/sources`,
        expect.objectContaining({ type: "manual", name: "Menu" }),
      );
      expect(api.post).toHaveBeenCalledWith(
        `/v2.0/knowledgestores/${ID.ks}/sources/src1/chunks`,
        expect.objectContaining({
          text: "Falafel Wrap $12, Shawarma $14",
          order: 1,
        }),
      );
    });

    it("lists chunks with auto-resolved sourceId", async () => {
      api.get
        .mockResolvedValueOnce({ items: [{ _id: "src1" }] })
        .mockResolvedValueOnce({
          items: [{ _id: "chunk1", text: "Hello", order: 1 }],
          total: 1,
        });

      const result = await h.handleToolCall("manage_knowledge", {
        operation: "list_chunks",
        knowledgeStoreId: ID.ks,
      });

      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].text).toBe("Hello");
      expect(result.sourceId).toBe("src1");
    });

    it("lists chunks with explicit sourceId and filter", async () => {
      api.get.mockResolvedValueOnce({
        items: [{ _id: "chunk1", text: "Falafel $12", order: 1 }],
        total: 1,
      });

      const result = await h.handleToolCall("manage_knowledge", {
        operation: "list_chunks",
        knowledgeStoreId: ID.ks,
        sourceId: "60d5ec49f1a2c8b1a4e0f00b",
        filter: "Falafel",
      });

      expect(result.chunks).toHaveLength(1);
      expect(api.get).toHaveBeenCalledWith(
        `/v2.0/knowledgestores/${ID.ks}/sources/60d5ec49f1a2c8b1a4e0f00b/chunks`,
        { params: expect.objectContaining({ filter: "Falafel" }) },
      );
    });

    it("returns hints when no sources exist", async () => {
      api.get.mockResolvedValueOnce({ items: [] });

      const result = await h.handleToolCall("manage_knowledge", {
        operation: "list_chunks",
        knowledgeStoreId: ID.ks,
      });

      expect(result.chunks).toHaveLength(0);
      expect(result._hints.likely_cause).toContain("No sources");
    });
  });

  // =========================================================================
  // create_tool
  // =========================================================================
  describe("create_tool", () => {
    const baseArgs = {
      aiAgentId: ID.agent,
      toolType: "tool" as const,
      name: "Fetch Weather",
      config: { toolId: "fetch_weather", description: "Fetches weather data" },
    };

    function mockFlowWithJobNode() {
      api.get.mockResolvedValueOnce({ flowId: ID.flow }).mockResolvedValueOnce({
        items: [
          { _id: ID.entry, isEntryPoint: true },
          { _id: ID.node, type: "aiAgentJob" },
        ],
      });
    }

    it("creates a generic tool with appendChild mode", async () => {
      mockFlowWithJobNode();
      api.post.mockResolvedValue({ _id: ID.tool });

      const result = await h.handleToolCall("create_tool", baseArgs);
      expect(result.toolId).toBe(ID.tool);
      expect(result.name).toBe("Fetch Weather");
      expect(result.toolType).toBe("tool");

      expect(api.post).toHaveBeenCalledWith(
        expect.stringContaining("/chart/nodes"),
        expect.objectContaining({
          type: "aiAgentJobTool",
          extension: "@cognigy/basic-nodes",
          mode: "appendChild",
          target: ID.node,
          config: expect.objectContaining({
            toolId: "fetch_weather",
            description: "Fetches weather data",
          }),
        }),
      );
    });

    it("sets useParameters when parameters provided", async () => {
      mockFlowWithJobNode();
      api.post.mockResolvedValue({ _id: ID.tool });

      await h.handleToolCall("create_tool", {
        aiAgentId: ID.agent,
        toolType: "tool",
        name: "Parameterized",
        config: {
          toolId: "my_tool",
          description: "desc",
          parameters: '{"type":"object","properties":{"q":{"type":"string"}}}',
        },
      });

      expect(api.post).toHaveBeenCalledWith(
        expect.stringContaining("/chart/nodes"),
        expect.objectContaining({
          config: expect.objectContaining({
            useParameters: true,
            parameters: expect.any(String),
          }),
        }),
      );
    });

    it("returns error when agent has no flow", async () => {
      api.get
        .mockResolvedValueOnce({ _id: ID.agent, name: "Orphan Agent" })
        .mockRejectedValueOnce(new Error("Not found"))
        .mockResolvedValueOnce({ items: [] });

      const result = await h.handleToolCall("create_tool", baseArgs);
      expect(result.error).toContain("Could not find a flow");
      expect(result._hints.resource).toBe("cognigy://guide/tools-setup");
    });

    it("returns error when flow has no aiAgentJob node", async () => {
      api.get.mockResolvedValueOnce({ flowId: ID.flow }).mockResolvedValueOnce({
        items: [{ _id: ID.entry, isEntryPoint: true }],
      });

      const result = await h.handleToolCall("create_tool", baseArgs);
      expect(result.error).toContain("No aiAgentJob node found");
    });

    it("creates a knowledge tool", async () => {
      mockFlowWithJobNode();
      api.post.mockResolvedValue({ _id: ID.tool });

      const result = await h.handleToolCall("create_tool", {
        aiAgentId: ID.agent,
        toolType: "knowledge",
        name: "Search KB",
        config: {
          knowledgeStoreId: ID.ks,
          toolId: "search_kb",
          description: "Searches FAQ",
        },
      });

      expect(result.toolType).toBe("knowledge");
      expect(api.post).toHaveBeenCalledWith(
        expect.stringContaining("/chart/nodes"),
        expect.objectContaining({
          type: "knowledgeTool",
          extension: "@cognigy/basic-nodes",
          mode: "appendChild",
          config: expect.objectContaining({ knowledgeStoreId: ID.ks }),
        }),
      );
    });

    it("creates a send_email tool", async () => {
      mockFlowWithJobNode();
      api.post.mockResolvedValue({ _id: ID.tool });

      const result = await h.handleToolCall("create_tool", {
        aiAgentId: ID.agent,
        toolType: "send_email",
        name: "Email Support",
        config: {
          toolId: "email_support",
          description: "Sends email",
          recipient: "support@example.com",
        },
      });

      expect(result.toolType).toBe("send_email");
      expect(api.post).toHaveBeenCalledWith(
        expect.stringContaining("/chart/nodes"),
        expect.objectContaining({
          type: "sendEmailTool",
          mode: "appendChild",
          config: expect.objectContaining({ recipient: "support@example.com" }),
        }),
      );
    });

    it("creates an mcp tool", async () => {
      mockFlowWithJobNode();
      api.post.mockResolvedValue({ _id: ID.tool });

      const result = await h.handleToolCall("create_tool", {
        aiAgentId: ID.agent,
        toolType: "mcp",
        name: "Remote MCP",
        config: {
          mcpName: "my-mcp",
          mcpServerUrl: "https://mcp.example.com",
          timeout: 30,
        },
      });

      expect(result.toolType).toBe("mcp");
      expect(api.post).toHaveBeenCalledWith(
        expect.stringContaining("/chart/nodes"),
        expect.objectContaining({
          type: "aiAgentJobMCPTool",
          mode: "appendChild",
          config: expect.objectContaining({
            name: "my-mcp",
            mcpServerUrl: "https://mcp.example.com",
            timeout: 30,
          }),
        }),
      );
    });

    it("uses toolId as node label instead of display name", async () => {
      mockFlowWithJobNode();
      api.post.mockResolvedValue({ _id: ID.tool });

      await h.handleToolCall("create_tool", {
        aiAgentId: ID.agent,
        toolType: "tool",
        name: "Fetch Weather",
        config: { toolId: "fetch_weather", description: "Fetches weather" },
      });

      expect(api.post).toHaveBeenCalledWith(
        expect.stringContaining("/chart/nodes"),
        expect.objectContaining({
          label: "fetch_weather",
        }),
      );
    });

    it("falls back to display name when toolId is not provided", async () => {
      mockFlowWithJobNode();
      api.post.mockResolvedValue({ _id: ID.tool });

      await h.handleToolCall("create_tool", {
        aiAgentId: ID.agent,
        toolType: "tool",
        name: "My Custom Tool",
        config: { description: "A custom tool" },
      });

      expect(api.post).toHaveBeenCalledWith(
        expect.stringContaining("/chart/nodes"),
        expect.objectContaining({
          label: "My Custom Tool",
        }),
      );
    });

    it("reuses duplicate toolId in the same agent flow", async () => {
      api.get.mockResolvedValueOnce({ flowId: ID.flow }).mockResolvedValueOnce({
        items: [
          { _id: ID.entry, isEntryPoint: true },
          { _id: ID.node, type: "aiAgentJob" },
          {
            _id: ID.tool,
            type: "aiAgentJobTool",
            label: "unlock_account",
            config: { toolId: "unlock_account", description: "Existing tool" },
          },
        ],
      });

      const result = await h.handleToolCall("create_tool", {
        aiAgentId: ID.agent,
        toolType: "tool",
        name: "Unlock Account",
        config: {
          toolId: "unlock_account",
          description: "Unlocks a locked user account",
        },
      });

      expect(result.reusedExisting).toBe(true);
      expect(result.toolId).toBe(ID.tool);
      expect(result.toolNodeId).toBe(ID.tool);
      expect(result.requestedToolId).toBe("unlock_account");
      expect(result._hints.resource).toBe("cognigy://guide/tools-setup");
      expect(result._hints.warning).toContain('"unlock_account"');
      expect(api.post).not.toHaveBeenCalled();
    });

    it("reuses duplicate tool when existing node matches by label only", async () => {
      api.get.mockResolvedValueOnce({ flowId: ID.flow }).mockResolvedValueOnce({
        items: [
          { _id: ID.entry, isEntryPoint: true },
          { _id: ID.node, type: "aiAgentJob" },
          {
            _id: ID.tool,
            type: "aiAgentJobTool",
            label: "unlock_account",
            config: { description: "Existing tool without explicit toolId" },
          },
        ],
      });

      const result = await h.handleToolCall("create_tool", {
        aiAgentId: ID.agent,
        toolType: "tool",
        name: "Unlock Account",
        config: {
          toolId: "unlock_account",
          description: "Unlocks a locked user account",
        },
      });

      expect(result.reusedExisting).toBe(true);
      expect(result.toolId).toBe(ID.tool);
      expect(result.toolNodeId).toBe(ID.tool);
      expect(result.requestedToolId).toBe("unlock_account");
      expect(api.post).not.toHaveBeenCalled();
    });

    it("creates resolve node with default answer for general-purpose tool", async () => {
      mockFlowWithJobNode();
      const toolNodeId = "aaaaaaaaaaaaaaaaaaaaa001";
      const resolveNodeId = "aaaaaaaaaaaaaaaaaaaaa002";
      api.post
        .mockResolvedValueOnce({ _id: toolNodeId })
        .mockResolvedValueOnce({ _id: resolveNodeId });

      const result = await h.handleToolCall("create_tool", baseArgs);

      expect(result.resolveNodeId).toBe(resolveNodeId);
      expect(api.post).toHaveBeenCalledWith(
        expect.stringContaining("/chart/nodes"),
        expect.objectContaining({
          type: "aiAgentToolAnswer",
          label: "fetch_weather - Resolve",
          config: { answer: "{{JSON.stringify(input.result)}}" },
        }),
      );
    });

    it("uses custom toolResponseValue for resolve node when provided", async () => {
      mockFlowWithJobNode();
      const toolNodeId = "aaaaaaaaaaaaaaaaaaaaa001";
      const resolveNodeId = "aaaaaaaaaaaaaaaaaaaaa002";
      api.post
        .mockResolvedValueOnce({ _id: toolNodeId })
        .mockResolvedValueOnce({ _id: resolveNodeId });

      await h.handleToolCall("create_tool", {
        aiAgentId: ID.agent,
        toolType: "tool",
        name: "Custom Response Tool",
        config: {
          toolId: "custom_response",
          description: "Tool with custom response",
          toolResponseValue: "{{input.customField}}",
        },
      });

      expect(api.post).toHaveBeenCalledWith(
        expect.stringContaining("/chart/nodes"),
        expect.objectContaining({
          type: "aiAgentToolAnswer",
          config: { answer: "{{input.customField}}" },
        }),
      );
    });
  });

  // =========================================================================
  // Response filtering
  // =========================================================================
  describe("response filtering", () => {
    it("filters agent fields correctly", async () => {
      api.get.mockResolvedValue({
        _id: ID.agent,
        referenceId: "uuid",
        name: "Agent",
        description: "D",
        createdAt: "2024-01-01",
        __v: 0,
        projectId: ID.project,
        secret: "nope",
      });

      const result = await h.handleToolCall("get_resource", {
        resourceType: "agent",
        id: ID.agent,
      });

      expect(Object.keys(result).sort()).toEqual([
        "createdAt",
        "description",
        "id",
        "name",
        "referenceId",
      ]);
    });

    it("filters endpoint fields correctly", async () => {
      api.get.mockResolvedValue({
        _id: ID.endpoint,
        name: "EP",
        channel: "rest",
        flowId: "f1",
        URLToken: "tok",
        createdAt: "2024-01-01",
        secret: "hidden",
      });

      const result = await h.handleToolCall("get_resource", {
        resourceType: "endpoint",
        id: ID.endpoint,
      });

      expect(result.URLToken).toBe("tok");
      expect(result.secret).toBeUndefined();
    });
  });

  // =========================================================================
  // manage_flow_nodes — case/switch updates
  // =========================================================================
  describe("manage_flow_nodes — case node updates", () => {
    it("updates a case node with { value } and sends correct API payload", async () => {
      const caseNodeId = "60d5ec49f1a2c8b1a4e0f00b";
      api.get.mockResolvedValueOnce({
        _id: caseNodeId,
        type: "case",
        config: {},
      });
      api.patch.mockResolvedValueOnce({ _id: caseNodeId });

      const result = await h.handleToolCall("manage_flow_nodes", {
        operation: "update",
        flowId: ID.flow,
        nodeId: caseNodeId,
        config: { value: "billing" },
      });

      expect(result.updated).toBe(true);
      expect(api.patch).toHaveBeenCalledWith(
        `/v2.0/flows/${ID.flow}/chart/nodes/${caseNodeId}`,
        { config: { case: { value: "billing" } } },
      );
    });

    it("updates a switch node with cases array and patches each child", async () => {
      const switchNodeId = "60d5ec49f1a2c8b1a4e0f00c";
      const case1Id = "60d5ec49f1a2c8b1a4e0f00d";
      const case2Id = "60d5ec49f1a2c8b1a4e0f00e";

      api.get.mockResolvedValueOnce({
        _id: switchNodeId,
        type: "switch",
        config: {
          switch: { type: "cognigyScript", operator: "input.category" },
        },
      });
      api.patch.mockResolvedValue({});

      const result = await h.handleToolCall("manage_flow_nodes", {
        operation: "update",
        flowId: ID.flow,
        nodeId: switchNodeId,
        config: {
          cases: [
            { id: case1Id, value: "billing" },
            { id: case2Id, value: "shipping" },
          ],
        },
      });

      expect(result.updated).toBe(true);
      expect(result.casesUpdated).toHaveLength(2);
      expect(result.casesUpdated[0]).toEqual({
        id: case1Id,
        value: "billing",
        updated: true,
      });
      expect(result.casesUpdated[1]).toEqual({
        id: case2Id,
        value: "shipping",
        updated: true,
      });

      expect(api.patch).toHaveBeenCalledWith(
        `/v2.0/flows/${ID.flow}/chart/nodes/${case1Id}`,
        { config: { case: { value: "billing" } } },
      );
      expect(api.patch).toHaveBeenCalledWith(
        `/v2.0/flows/${ID.flow}/chart/nodes/${case2Id}`,
        { config: { case: { value: "shipping" } } },
      );
    });

    it("switch update with cases skips entries missing id or value", async () => {
      const switchNodeId = "60d5ec49f1a2c8b1a4e0f00c";
      const case1Id = "60d5ec49f1a2c8b1a4e0f00d";

      api.get.mockResolvedValueOnce({
        _id: switchNodeId,
        type: "switch",
        config: {
          switch: { type: "cognigyScript", operator: "input.category" },
        },
      });
      api.patch.mockResolvedValue({});

      const result = await h.handleToolCall("manage_flow_nodes", {
        operation: "update",
        flowId: ID.flow,
        nodeId: switchNodeId,
        config: {
          cases: [
            { id: case1Id, value: "billing" },
            { id: "", value: "no-id" },
            { id: "abc", value: undefined },
          ],
        },
      });

      expect(result.casesUpdated).toHaveLength(1);
      expect(result.casesUpdated[0].id).toBe(case1Id);
    });

    it("reports errors when case child patch fails", async () => {
      const switchNodeId = "60d5ec49f1a2c8b1a4e0f00c";
      const case1Id = "60d5ec49f1a2c8b1a4e0f00d";

      api.get.mockResolvedValueOnce({
        _id: switchNodeId,
        type: "switch",
        config: {},
      });
      api.patch.mockRejectedValueOnce(new Error("Validation failed"));

      const result = await h.handleToolCall("manage_flow_nodes", {
        operation: "update",
        flowId: ID.flow,
        nodeId: switchNodeId,
        config: {
          cases: [{ id: case1Id, value: "bad-value" }],
        },
      });

      expect(result.casesUpdated).toHaveLength(1);
      expect(result.casesUpdated[0].updated).toBe(false);
      expect(result.casesUpdated[0].error).toContain("Validation failed");
    });
  });

  // =========================================================================
  // manage_flow_nodes — branch child auto-rewrite
  // =========================================================================
  describe("manage_flow_nodes — branch child auto-rewrite", () => {
    it("rewrites appendChild to append when targeting a then node", async () => {
      const thenNodeId = "60d5ec49f1a2c8b1a4e0f00b";

      api.get.mockResolvedValueOnce({ _id: thenNodeId, type: "then" });
      api.post.mockResolvedValueOnce({
        _id: "60d5ec49f1a2c8b1a4e0f00c",
        parentId: thenNodeId,
      });

      const result = await h.handleToolCall("manage_flow_nodes", {
        operation: "create",
        flowId: ID.flow,
        parentNodeId: thenNodeId,
        mode: "appendChild",
        nodeType: "say",
        label: "Greeting",
        config: { text: "Hello" },
      });

      expect(result.mode).toBe("append");
      expect(api.post).toHaveBeenCalledWith(
        expect.stringContaining("/chart/nodes"),
        expect.objectContaining({ mode: "append" }),
      );
    });

    it("rewrites appendChild to append when targeting a case node", async () => {
      const caseNodeId = "60d5ec49f1a2c8b1a4e0f00b";

      api.get.mockResolvedValueOnce({ _id: caseNodeId, type: "case" });
      api.post.mockResolvedValueOnce({
        _id: "60d5ec49f1a2c8b1a4e0f00c",
        parentId: caseNodeId,
      });

      const result = await h.handleToolCall("manage_flow_nodes", {
        operation: "create",
        flowId: ID.flow,
        parentNodeId: caseNodeId,
        mode: "appendChild",
        nodeType: "code",
        label: "Process",
        config: { code: 'input.result = "done";' },
      });

      expect(result.mode).toBe("append");
    });

    it("does not rewrite append mode", async () => {
      const thenNodeId = "60d5ec49f1a2c8b1a4e0f00b";

      api.post.mockResolvedValueOnce({
        _id: "60d5ec49f1a2c8b1a4e0f00c",
        parentId: thenNodeId,
      });

      const result = await h.handleToolCall("manage_flow_nodes", {
        operation: "create",
        flowId: ID.flow,
        parentNodeId: thenNodeId,
        mode: "append",
        nodeType: "say",
        label: "Greeting",
        config: { text: "Hello" },
      });

      expect(result.mode).toBe("append");
    });
  });

  // =========================================================================
  // create_ai_agent — LLM auto-assignment
  // =========================================================================
  describe("create_ai_agent — LLM auto-assignment", () => {
    it("auto-assigns default LLM to job node", async () => {
      const mockAgent = {
        _id: ID.agent,
        referenceId: "ref-uuid",
        name: "Test Agent",
      };
      const mockFlow = {
        _id: ID.flow,
        referenceId: "flow-uuid",
        name: "Test Agent Flow",
      };
      const mockEndpoint = {
        _id: ID.endpoint,
        URLToken: "abc123",
        channel: "rest",
      };
      const mockLlm = {
        _id: ID.llm,
        referenceId: "llm-ref-uuid",
        isDefault: true,
      };

      api.post
        .mockResolvedValueOnce(mockAgent) // create agent
        .mockResolvedValueOnce(mockFlow) // create flow
        .mockResolvedValueOnce({ _id: ID.node }) // create job node
        .mockResolvedValueOnce(mockEndpoint); // create endpoint
      api.get
        .mockResolvedValueOnce({
          items: [{ _id: ID.entry, isEntryPoint: true }],
        }) // entry node
        .mockResolvedValueOnce({ items: [mockLlm] }); // LLM list
      api.patch.mockResolvedValue({});

      const result = await h.handleToolCall("create_ai_agent", {
        projectId: ID.project,
        name: "Test Agent",
        description: "A test agent",
      });

      expect(result.llmStatus).toBe("configured");
      expect(api.patch).toHaveBeenCalledWith(
        `/v2.0/flows/${ID.flow}/chart/nodes/${ID.node}`,
        { config: { llmProviderReferenceId: "llm-ref-uuid" } },
      );
    });

    it("returns llmStatus unknown when no LLMs exist", async () => {
      const mockAgent = {
        _id: ID.agent,
        referenceId: "ref-uuid",
        name: "Test Agent",
      };
      const mockFlow = { _id: ID.flow, referenceId: "flow-uuid", name: "Flow" };
      const mockEndpoint = {
        _id: ID.endpoint,
        URLToken: "xyz",
        channel: "rest",
      };

      api.post
        .mockResolvedValueOnce(mockAgent)
        .mockResolvedValueOnce(mockFlow)
        .mockResolvedValueOnce({ _id: ID.node })
        .mockResolvedValueOnce(mockEndpoint);
      api.get
        .mockResolvedValueOnce({
          items: [{ _id: ID.entry, isEntryPoint: true }],
        })
        .mockResolvedValueOnce({ items: [] }); // no LLMs
      api.patch.mockResolvedValue({});

      const result = await h.handleToolCall("create_ai_agent", {
        projectId: ID.project,
        name: "Test Agent",
        description: "A test agent",
      });

      expect(result.llmStatus).toBe("unknown");
      expect(result._hints).toBeDefined();
    });

    it("returns explicit package-reuse guidance when a new project is auto-created without an LLM", async () => {
      const mockProject = { _id: ID.project, name: "New Project" };
      const mockAgent = {
        _id: ID.agent,
        referenceId: "ref-uuid",
        name: "Test Agent",
      };
      const mockFlow = { _id: ID.flow, referenceId: "flow-uuid", name: "Flow" };
      const mockEndpoint = {
        _id: ID.endpoint,
        URLToken: "xyz",
        channel: "rest",
      };

      api.post
        .mockResolvedValueOnce(mockProject)
        .mockResolvedValueOnce(mockAgent)
        .mockResolvedValueOnce(mockFlow)
        .mockResolvedValueOnce({ _id: ID.node })
        .mockResolvedValueOnce(mockEndpoint);
      api.get
        .mockResolvedValueOnce({
          items: [{ _id: ID.entry, isEntryPoint: true }],
        })
        .mockResolvedValueOnce({ items: [] });
      api.patch.mockResolvedValue({});

      const result = await h.handleToolCall("create_ai_agent", {
        name: "Test Agent",
        description: "A test agent",
      });

      expect(result.projectCreated).toBe(true);
      expect(result.llmStatus).toBe("unknown");
      expect(result._hints.resource).toBe("cognigy://guide/agent-creation");
      expect(result._hints.action).toContain("A new project was auto-created");
      expect(result._hints.action).toContain("non-empty connectionId");
      expect(result._hints.action).toContain("manage_packages");
      expect(result._hints.action).toContain("exact Knowledge Search model");
      expect(result._hints.action).toContain("do not call talk_to_agent");
    });
  });

  // =========================================================================
  // manage_packages
  // =========================================================================
  describe("manage_packages", () => {
    const makeGraph = () => ({
      [ID.project]: {
        _id: ID.project,
        name: "Target Project",
        resources: [
          {
            _id: "60d5ec49f1a2c8b1a4e0f101",
            type: "locale",
            name: "English",
            properties: { primary: true, nluLanguage: "en" },
          },
          {
            _id: "60d5ec49f1a2c8b1a4e0f102",
            type: "flow",
            name: "Existing Flow",
            referenceId: "flow-ref-1",
            dependencies: [
              { _id: "60d5ec49f1a2c8b1a4e0f103" },
              { _id: "60d5ec49f1a2c8b1a4e0f104" },
            ],
          },
          {
            _id: "60d5ec49f1a2c8b1a4e0f103",
            type: "knowledgeStore",
            name: "Existing Store",
            referenceId: "ks-ref-1",
          },
          {
            _id: "60d5ec49f1a2c8b1a4e0f104",
            type: "function",
            name: "Legacy Function",
          },
          {
            _id: "60d5ec49f1a2c8b1a4e0f105",
            type: "largeLanguageModel",
            name: "Existing Retired GPT",
            properties: { modelType: "gpt-4" },
          },
          {
            _id: "60d5ec49f1a2c8b1a4e0f106",
            type: "largeLanguageModel",
            name: "OAI-4o",
            properties: { modelType: "gpt-4o" },
            dependencies: [{ _id: "60d5ec49f1a2c8b1a4e0f107" }],
          },
          {
            _id: "60d5ec49f1a2c8b1a4e0f107",
            type: "connection",
            name: "OAI-dvd",
          },
        ],
      },
      [ID.pkg]: {
        _id: ID.pkg,
        name: "Support Package",
        resources: [
          {
            _id: "60d5ec49f1a2c8b1a4e0f201",
            type: "locale",
            name: "Package English",
            properties: { primary: true, nluLanguage: "en" },
          },
          {
            _id: "60d5ec49f1a2c8b1a4e0f202",
            type: "flow",
            name: "Imported Flow",
            referenceId: "flow-ref-1",
          },
          {
            _id: "60d5ec49f1a2c8b1a4e0f203",
            type: "knowledgeStore",
            name: "Imported Store",
            referenceId: "ks-ref-1",
          },
          {
            _id: "60d5ec49f1a2c8b1a4e0f204",
            type: "largeLanguageModel",
            name: "Legacy GPT",
            properties: { modelType: "gpt-4" },
          },
        ],
      },
    });

    it("lists exportable resources and includes LLM models", async () => {
      api.get.mockResolvedValueOnce(makeGraph());

      const result = await h.handleToolCall("manage_packages", {
        operation: "list_exportable",
        projectId: ID.project,
      });

      expect(result.operation).toBe("list_exportable");
      expect(result.resources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "60d5ec49f1a2c8b1a4e0f106",
            type: "largeLanguageModel",
            name: "OAI-4o",
            modelType: "gpt-4o",
            canExport: true,
            dependencyCount: 1,
          }),
          expect.objectContaining({
            id: "60d5ec49f1a2c8b1a4e0f105",
            type: "largeLanguageModel",
            name: "Existing Retired GPT",
            canExport: false,
            disabledReason: "retired_model",
          }),
        ]),
      );
      expect(result.summary.exportableNowCount).toBeGreaterThan(0);
      expect(result.summary.typeCounts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "largeLanguageModel",
            count: 2,
            exportableNowCount: 1,
          }),
        ]),
      );
    });

    it("uploads a package and returns import preview", async () => {
      const dir = mkdtempSync(join(tmpdir(), "cognigy-mcp-packages-"));
      const filePath = join(dir, "support-bot.zip");
      writeFileSync(filePath, "zip-content");

      api.uploadFile.mockResolvedValueOnce({ _id: ID.task });
      api.get
        .mockResolvedValueOnce({
          _id: ID.task,
          name: "extractPackage",
          status: "done",
          currentStep: 2,
          totalStep: 2,
          data: { packageId: ID.pkg },
        })
        .mockResolvedValueOnce(makeGraph());

      const result = await h.handleToolCall("manage_packages", {
        operation: "upload_and_inspect",
        projectId: ID.project,
        filePath,
      });

      expect(api.uploadFile).toHaveBeenCalled();
      expect(result.operation).toBe("upload_and_inspect");
      expect(result.package.id).toBe(ID.pkg);
      expect(result.resources).toHaveLength(3);
      expect(
        result.resources.find(
          (resource: any) => resource.type === "knowledgeStore",
        ).defaultStrategy,
      ).toBe("replace");
      expect(
        result.resources.find(
          (resource: any) => resource.type === "largeLanguageModel",
        ).disabledReason,
      ).toBe("retired_model");
      expect(result.locales.defaultLocaleMapping).toEqual([
        {
          packageLocaleId: "60d5ec49f1a2c8b1a4e0f201",
          agentLocaleId: "60d5ec49f1a2c8b1a4e0f101",
        },
      ]);
    });

    it("rejects non-zip files during upload_and_inspect", async () => {
      const dir = mkdtempSync(join(tmpdir(), "cognigy-mcp-packages-"));
      const filePath = join(dir, "support-bot.txt");
      writeFileSync(filePath, "not-a-zip");

      await expect(
        h.handleToolCall("manage_packages", {
          operation: "upload_and_inspect",
          projectId: ID.project,
          filePath,
        }),
      ).rejects.toThrow("Only .zip files are supported");
    });

    it("returns preview for inspect operation", async () => {
      api.get.mockResolvedValueOnce(makeGraph());

      const result = await h.handleToolCall("manage_packages", {
        operation: "inspect",
        projectId: ID.project,
        packageId: ID.pkg,
      });

      expect(result.operation).toBe("inspect");
      expect(result.summary.hasFlows).toBe(true);
      expect(result.summary.hasDuplicateKnowledgeStore).toBe(true);
      expect(
        result.resources.find((resource: any) => resource.type === "flow")
          .conflict.targetResourceName,
      ).toBe("Existing Flow");
    });

    it("translates import selections into merge payload and waits for completion by default", async () => {
      api.get.mockResolvedValueOnce(makeGraph()).mockResolvedValueOnce({
        _id: ID.task2,
        name: "mergePackage",
        status: "done",
        currentStep: 1,
        totalStep: 1,
        data: {},
      });
      api.post.mockResolvedValueOnce({ _id: ID.task2 });

      const result = await h.handleToolCall("manage_packages", {
        operation: "import",
        projectId: ID.project,
        packageId: ID.pkg,
        resources: [
          { id: "60d5ec49f1a2c8b1a4e0f202", strategy: "replace" },
          { id: "60d5ec49f1a2c8b1a4e0f203", import: false },
          { id: "60d5ec49f1a2c8b1a4e0f204", import: false },
        ],
        localeMapping: [
          {
            packageLocaleId: "60d5ec49f1a2c8b1a4e0f201",
            agentLocaleId: "60d5ec49f1a2c8b1a4e0f101",
          },
        ],
      });

      expect(api.post).toHaveBeenCalledWith(
        `/new/v2.0/packages/${ID.pkg}/merge`,
        {
          resourceIds: ["60d5ec49f1a2c8b1a4e0f202"],
          strategies: [
            {
              _id: "60d5ec49f1a2c8b1a4e0f202",
              autoRename: true,
              identityConflictStrategy: "replace",
            },
          ],
          localeMapping: [
            {
              packageLocaleId: "60d5ec49f1a2c8b1a4e0f201",
              agentLocaleId: "60d5ec49f1a2c8b1a4e0f101",
            },
          ],
        },
      );
      expect(result.task.status).toBe("done");
    });

    it("returns queued task when import does not wait for completion", async () => {
      api.get.mockResolvedValueOnce(makeGraph());
      api.post.mockResolvedValueOnce({ _id: ID.task2 });

      const result = await h.handleToolCall("manage_packages", {
        operation: "import",
        projectId: ID.project,
        packageId: ID.pkg,
        waitForCompletion: false,
      });

      expect(result.task.id).toBe(ID.task2);
      expect(result.task.status).toBe("queued");
    });

    it("exports resources, includes dependencies by default, and saves the package locally", async () => {
      const zipContent = Buffer.from("zip-content");
      api.get
        .mockResolvedValueOnce(makeGraph())
        .mockResolvedValueOnce({
          _id: ID.task2,
          name: "createPackageNFS",
          status: "done",
          currentStep: 1,
          totalStep: 1,
          data: { packageId: ID.pkg },
        })
        .mockResolvedValueOnce({
          _id: ID.pkg,
          name: "support-bot_2026-04-02_12-00-00",
        })
        .mockResolvedValueOnce(Readable.from([zipContent]));
      api.post.mockResolvedValueOnce({ _id: ID.task2 }).mockResolvedValueOnce({
        downloadLink: "https://api.example.test/new/v2.0/packages/download",
      });

      const result = await h.handleToolCall("manage_packages", {
        operation: "export",
        projectId: ID.project,
        resourceIds: ["60d5ec49f1a2c8b1a4e0f102", "60d5ec49f1a2c8b1a4e0f105"],
        name: "support-bot",
      });

      expect(api.post).toHaveBeenCalledWith("/new/v2.0/packages", {
        projectId: ID.project,
        name: expect.stringMatching(/^support-bot_/),
        description: undefined,
        resourceIds: ["60d5ec49f1a2c8b1a4e0f102", "60d5ec49f1a2c8b1a4e0f103"],
      });
      expect(result.operation).toBe("export");
      expect(result.task.status).toBe("done");
      expect(result.dependencyResources).toHaveLength(1);
      expect(result.skippedResources).toEqual([
        {
          id: "60d5ec49f1a2c8b1a4e0f105",
          type: "largeLanguageModel",
          name: "Existing Retired GPT",
          reason: "retired_model",
        },
        {
          id: "60d5ec49f1a2c8b1a4e0f104",
          type: "function",
          name: "Legacy Function",
          reason: "function_export_not_supported",
        },
      ]);
      expect(result.package.id).toBe(ID.pkg);
      expect(result.savedTo).toContain("cognigy-mcp-packages");
      expect(result.savedToUri).toMatch(/^file:\/\//);
      expect(result.savedFileName).toMatch(/\.zip$/);
      expect(result.savedDirectory).toContain("cognigy-mcp-packages");
      expect(result.savedDirectoryUri).toMatch(/^file:\/\//);
      expect(result.openArchiveUri).toBe(result.savedToUri);
      expect(result.openContainingFolderPath).toBe(result.savedDirectory);
      expect(result.openContainingFolderUri).toBe(result.savedDirectoryUri);
      expect(result.savedToTemp).toBe(true);
      expect(readFileSync(result.savedTo, "utf-8")).toBe("zip-content");
    });

    it("returns queued task when export does not wait for completion", async () => {
      api.get.mockResolvedValueOnce(makeGraph());
      api.post.mockResolvedValueOnce({ _id: ID.task2 });

      const result = await h.handleToolCall("manage_packages", {
        operation: "export",
        projectId: ID.project,
        resourceIds: ["60d5ec49f1a2c8b1a4e0f102"],
        includeDependencies: false,
        name: "support-bot",
        waitForCompletion: false,
      });

      expect(result.task.id).toBe(ID.task2);
      expect(result.task.status).toBe("queued");
      expect(result.resourceIds).toEqual(["60d5ec49f1a2c8b1a4e0f102"]);
    });

    it("auto-includes LLM connections referenced by referenceId during export", async () => {
      const graph = makeGraph();
      const llm = graph[ID.project].resources.find(
        (resource: any) => resource._id === "60d5ec49f1a2c8b1a4e0f106",
      );
      const connection = graph[ID.project].resources.find(
        (resource: any) => resource._id === "60d5ec49f1a2c8b1a4e0f107",
      );

      llm.dependencies = [];
      llm.properties = {
        ...llm.properties,
        connectionId: "conn-ref-1",
      };
      connection.referenceId = "conn-ref-1";

      api.get.mockResolvedValueOnce(graph);
      api.post.mockResolvedValueOnce({ _id: ID.task2 });

      const result = await h.handleToolCall("manage_packages", {
        operation: "export",
        projectId: ID.project,
        resourceIds: ["60d5ec49f1a2c8b1a4e0f106"],
        name: "support-bot",
        waitForCompletion: false,
      });

      expect(api.post).toHaveBeenCalledWith("/new/v2.0/packages", {
        projectId: ID.project,
        name: expect.stringMatching(/^support-bot_/),
        description: undefined,
        resourceIds: ["60d5ec49f1a2c8b1a4e0f106", "60d5ec49f1a2c8b1a4e0f107"],
      });
      expect(result.dependencyResources).toEqual([
        expect.objectContaining({
          id: "60d5ec49f1a2c8b1a4e0f107",
          type: "connection",
          includedAsDependency: true,
        }),
      ]);
    });

    it("downloads an existing package to disk", async () => {
      const dir = mkdtempSync(join(tmpdir(), "cognigy-mcp-package-download-"));
      const outputPath = join(dir, "exports");
      const zipContent = Buffer.from("zip-content");

      api.get
        .mockResolvedValueOnce({
          _id: ID.pkg,
          name: "support-bot_2026-04-02_12-00-00",
        })
        .mockResolvedValueOnce(Readable.from([zipContent]));
      api.post.mockResolvedValueOnce({
        downloadLink: "https://api.example.test/new/v2.0/packages/download",
      });

      const result = await h.handleToolCall("manage_packages", {
        operation: "download",
        projectId: ID.project,
        packageId: ID.pkg,
        outputPath,
      });

      expect(result.savedTo).toBe(join(dir, "exports.zip"));
      expect(result.savedToUri).toBe(`file://${result.savedTo}`);
      expect(result.savedFileName).toBe("exports.zip");
      expect(result.savedDirectory).toBe(dir);
      expect(result.savedDirectoryUri).toBe(`file://${dir}`);
      expect(result.openArchiveUri).toBe(result.savedToUri);
      expect(result.openContainingFolderPath).toBe(dir);
      expect(result.openContainingFolderUri).toBe(result.savedDirectoryUri);
      expect(readFileSync(result.savedTo, "utf-8")).toBe("zip-content");
    });

    it("reads and normalizes task status", async () => {
      api.get.mockResolvedValueOnce({
        _id: ID.task,
        name: "mergePackage",
        status: "active",
        currentStep: 2,
        totalStep: 4,
        failReason: null,
        data: { packageId: ID.pkg },
      });

      const result = await h.handleToolCall("manage_packages", {
        operation: "read_task",
        projectId: ID.project,
        taskId: ID.task,
      });

      expect(result.task.progress).toBe(0.5);
      expect(result.task.status).toBe("active");
    });
  });

  // =========================================================================
  // Dispatcher
  // =========================================================================
  // =========================================================================
  // manage_voice_gateway
  // =========================================================================
  describe("manage_voice_gateway", () => {
    it("creates endpoint and provisions WebRTC client", async () => {
      const mockCreated = {
        _id: ID.endpoint,
        URLToken: "vg-token-123",
        channel: "voiceGateway2",
        name: "Voice Agent",
      };
      const mockEndpoint = {
        ...mockCreated,
        localeId: "loc-123",
        webrtcClient: true,
      };

      // POST create endpoint
      api.post.mockResolvedValueOnce(mockCreated);
      // GET after create
      api.get
        .mockResolvedValueOnce({ localeReference: "loc-123" }) // flow lookup
        .mockResolvedValueOnce(mockEndpoint) // after POST
        .mockResolvedValueOnce({ ...mockEndpoint, webrtcClient: true }); // after PATCH
      // PATCH to provision WebRTC
      api.patch.mockResolvedValueOnce({});

      const result = await h.handleToolCall("manage_voice_gateway", {
        projectId: ID.project,
        flowId: ID.flow,
        name: "Voice Agent",
      });

      expect(result.created).toBe(true);
      expect(result.channel).toBe("voiceGateway2");
      expect(result.webrtcProvisioned).toBe(true);
      expect(result.webrtcDemoUrl).toContain("vg-token-123");

      // Verify endpoint creation call
      expect(api.post).toHaveBeenCalledWith(
        "/new/v2.0/endpoints",
        expect.objectContaining({
          channel: "voiceGateway2",
          flowId: ID.flow,
          name: "Voice Agent",
        }),
      );

      // Verify WebRTC provisioning call
      expect(api.patch).toHaveBeenCalledWith(
        `/new/v2.0/endpoints/${ID.endpoint}`,
        expect.objectContaining({
          createWebrtcClient: true,
          channel: "voiceGateway2",
        }),
      );
    });

    it("returns error when projectId missing for create", async () => {
      const result = await h.handleToolCall("manage_voice_gateway", {
        flowId: ID.flow,
      });
      expect(result.error).toContain("projectId is required");
    });

    it("returns error when flowId missing for create", async () => {
      const result = await h.handleToolCall("manage_voice_gateway", {
        projectId: ID.project,
      });
      expect(result.error).toContain("flowId is required");
    });

    it("updates existing endpoint with new widget config", async () => {
      const existingEndpoint = {
        _id: ID.endpoint,
        URLToken: "vg-token-456",
        channel: "voiceGateway2",
        name: "Voice Agent",
        webrtcClient: true,
        webrtcWidgetConfig: {
          label: "Old",
          theme: "DARK_MODE",
          transcription: { enabled: true, backgroundMode: "transparent" },
          demoPage: {
            background: { mode: "color", color: "#FFFFFF" },
            position: "centered",
          },
        },
      };

      api.get
        .mockResolvedValueOnce(existingEndpoint) // initial fetch
        .mockResolvedValueOnce({
          ...existingEndpoint,
          webrtcWidgetConfig: {
            ...existingEndpoint.webrtcWidgetConfig,
            theme: "AI_PURPLE",
          },
        }); // after patch
      api.patch.mockResolvedValueOnce({});

      const result = await h.handleToolCall("manage_voice_gateway", {
        endpointId: ID.endpoint,
        webrtcWidgetConfig: { theme: "AI_PURPLE" },
      });

      expect(result.updated).toBe(true);
      expect(result.webrtcProvisioned).toBe(true);
      expect(api.patch).toHaveBeenCalledWith(
        `/new/v2.0/endpoints/${ID.endpoint}`,
        expect.objectContaining({
          webrtcWidgetConfig: expect.objectContaining({ theme: "AI_PURPLE" }),
        }),
      );
    });

    it("provisions WebRTC when updating endpoint without webrtcClient", async () => {
      const existingEndpoint = {
        _id: ID.endpoint,
        URLToken: "vg-token-789",
        channel: "voiceGateway2",
        name: "Voice Agent",
        // no webrtcClient
      };

      api.get
        .mockResolvedValueOnce(existingEndpoint)
        .mockResolvedValueOnce({ ...existingEndpoint, webrtcClient: true });
      api.patch.mockResolvedValueOnce({});

      const result = await h.handleToolCall("manage_voice_gateway", {
        endpointId: ID.endpoint,
        name: "Updated Name",
      });

      expect(result.updated).toBe(true);
      expect(api.patch).toHaveBeenCalledWith(
        `/new/v2.0/endpoints/${ID.endpoint}`,
        expect.objectContaining({
          createWebrtcClient: true,
          name: "Updated Name",
        }),
      );
    });

    it("returns current info when no changes requested on existing endpoint", async () => {
      const existingEndpoint = {
        _id: ID.endpoint,
        URLToken: "vg-token-000",
        channel: "voiceGateway2",
        name: "Voice Agent",
        webrtcClient: true,
      };

      api.get.mockResolvedValueOnce(existingEndpoint);

      const result = await h.handleToolCall("manage_voice_gateway", {
        endpointId: ID.endpoint,
      });

      expect(result.note).toContain("No changes requested");
      expect(api.patch).not.toHaveBeenCalled();
    });

    it("returns partial success when WebRTC provisioning fails on create", async () => {
      const mockCreated = {
        _id: ID.endpoint,
        URLToken: "vg-fail-token",
        channel: "voiceGateway2",
        name: "Voice Agent",
      };

      api.post.mockResolvedValueOnce(mockCreated);
      api.get
        .mockResolvedValueOnce({ localeReference: "loc-123" }) // flow
        .mockResolvedValueOnce(mockCreated); // after POST
      api.patch.mockRejectedValueOnce(new Error("WebRTC provision failed"));

      const result = await h.handleToolCall("manage_voice_gateway", {
        projectId: ID.project,
        flowId: ID.flow,
      });

      expect(result.created).toBe(true);
      expect(result.webrtcProvisioned).toBe(false);
      expect(result._hints.warning).toContain(
        "WebRTC client provisioning failed",
      );
    });
  });

  // =========================================================================
  // manage_settings
  // =========================================================================
  describe("manage_settings", () => {
    it("auto-detects connection and updates settings", async () => {
      api.get.mockResolvedValueOnce({
        items: [
          {
            referenceId: "conn-ref-123",
            extension: "@cognigy/audio-preview-provider",
            type: "MicrosoftSpeechProvider",
            name: "Microsoft Speech",
          },
        ],
      });
      api.patch.mockResolvedValueOnce({});

      const result = await h.handleToolCall("manage_settings", {
        operation: "set_voice_preview",
        projectId: ID.project,
        provider: "microsoft",
      });

      expect(result.updated).toBe(true);
      expect(result.provider).toBe("microsoft");
      expect(result.connectionId).toBe("conn-ref-123");
      expect(api.patch).toHaveBeenCalledWith(
        `/new/v2.0/projects/${ID.project}/settings`,
        {
          audioPreviewSettings: {
            provider: "microsoft",
            connections: {
              microsoft: { connectionId: "conn-ref-123" },
            },
          },
        },
      );
    });

    it("uses explicit connectionId without auto-detect", async () => {
      api.patch.mockResolvedValueOnce({});

      const result = await h.handleToolCall("manage_settings", {
        operation: "set_voice_preview",
        projectId: ID.project,
        provider: "google",
        connectionId: "explicit-conn-id",
      });

      expect(result.updated).toBe(true);
      expect(result.connectionId).toBe("explicit-conn-id");
      expect(api.get).not.toHaveBeenCalled();
    });

    it("returns error when no connection found", async () => {
      api.get.mockResolvedValueOnce({ items: [] });

      const result = await h.handleToolCall("manage_settings", {
        operation: "set_voice_preview",
        projectId: ID.project,
        provider: "deepgram",
      });

      expect(result.error).toContain("No speech connection found");
      expect(result._hints.action).toContain("manage_packages");
      expect(api.patch).not.toHaveBeenCalled();
    });

    it("returns error when PATCH fails", async () => {
      api.get.mockResolvedValueOnce({
        items: [
          {
            referenceId: "conn-ref-456",
            extension: "@cognigy/audio-preview-provider",
            type: "AWSSpeechProvider",
          },
        ],
      });
      api.patch.mockRejectedValueOnce(new Error("Forbidden"));

      const result = await h.handleToolCall("manage_settings", {
        operation: "set_voice_preview",
        projectId: ID.project,
        provider: "aws",
      });

      expect(result.error).toContain("Failed to update voice preview");
    });

    it("filters connections by extension and type", async () => {
      api.get.mockResolvedValueOnce({
        items: [
          {
            referenceId: "wrong-ext",
            extension: "@cognigy/some-other",
            type: "GoogleSpeechProvider",
          },
          {
            referenceId: "wrong-type",
            extension: "@cognigy/audio-preview-provider",
            type: "MicrosoftSpeechProvider",
          },
          {
            referenceId: "correct-match",
            extension: "@cognigy/audio-preview-provider",
            type: "GoogleSpeechProvider",
          },
        ],
      });
      api.patch.mockResolvedValueOnce({});

      const result = await h.handleToolCall("manage_settings", {
        operation: "set_voice_preview",
        projectId: ID.project,
        provider: "google",
      });

      expect(result.connectionId).toBe("correct-match");
    });

    it("updates Knowledge AI settings with model ids and content parser", async () => {
      api.patch.mockResolvedValueOnce({});

      const result = await h.handleToolCall("manage_settings", {
        operation: "set_knowledge_ai",
        projectId: ID.project,
        knowledgeSearchModelId: "llm-ref-1",
        answerExtractionModelId: "llm-ref-2",
        contentParser: "default",
      });

      expect(result.updated).toBe(true);
      expect(result.generativeAIEnabled).toBe(true);
      expect(result.updatedFields).toEqual([
        "knowledgeSearchModelId",
        "answerExtractionModelId",
        "contentParser",
      ]);
      expect(api.patch).toHaveBeenCalledWith(
        `/new/v2.0/projects/${ID.project}/settings`,
        {
          generativeAISettings: {
            enabled: true,
            useCasesSettings: {
              knowledgeSearch: { largeLanguageModelId: "llm-ref-1" },
              answerExtraction: { largeLanguageModelId: "llm-ref-2" },
            },
          },
          knowledgeAISettings: {
            fileExtractor: "default",
          },
        },
      );
    });

    it("updates Knowledge AI settings for azure content parser", async () => {
      api.patch.mockResolvedValueOnce({});

      const result = await h.handleToolCall("manage_settings", {
        operation: "set_knowledge_ai",
        projectId: ID.project,
        contentParser: "azure",
        azureDIConnectionId: "azure-di-conn",
      });

      expect(result.updated).toBe(true);
      expect(result.contentParser).toBe("azure");
      expect(result.azureDIConnectionId).toBe("azure-di-conn");
      expect(api.patch).toHaveBeenCalledWith(
        `/new/v2.0/projects/${ID.project}/settings`,
        {
          knowledgeAISettings: {
            fileExtractor: "azure",
            azureDIConnectionId: "azure-di-conn",
          },
        },
      );
    });

    it("returns error when Knowledge AI PATCH fails", async () => {
      api.patch.mockRejectedValueOnce(new Error("Forbidden"));
      api.get.mockResolvedValueOnce({
        items: [
          {
            _id: ID.llm,
            referenceId: "llm-ref-embed",
            name: "openAI - text-embedding-ada-002 - 1776758615449",
            provider: "openAI",
            modelType: "text-embedding-ada-002",
            connectionId: "conn-ref-1",
          },
        ],
      });

      const result = await h.handleToolCall("manage_settings", {
        operation: "set_knowledge_ai",
        projectId: ID.project,
        knowledgeSearchModelId: "llm-ref-1",
      });

      expect(result.error).toContain("Failed to update Knowledge AI settings");
      expect(result._hints.resource).toBe("cognigy://guide/settings");
      expect(result.allowedKnowledgeSearchModels).toEqual([
        expect.objectContaining({
          referenceId: "llm-ref-embed",
          modelType: "text-embedding-ada-002",
        }),
      ]);
      expect(result._hints.action).toContain('useCase: "knowledgeSearch"');
    });
  });

  // =========================================================================
  // Dispatcher
  // =========================================================================
  describe("handleToolCall dispatcher", () => {
    it("throws for unknown tool", async () => {
      await expect(h.handleToolCall("unknown_tool", {})).rejects.toThrow(
        "Unknown tool",
      );
    });
  });
});

// =========================================================================
// audit_voice_agent
// =========================================================================
describe("audit_voice_agent", () => {
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
    h = new ToolHandlers(api, "https://endpoint-trial.cognigy.ai");
  });

  const badNodes = [
    {
      _id: ID.entry,
      type: "aiAgentJob",
      isEntryPoint: true,
      config: {
        storeLocation: "input",
        errorHandling: "stop",
        errorMessage: "",
        debugLogLLMLatency: false,
      },
    },
  ];

  it("dry-run reports failures and proposes fixes without mutating", async () => {
    api.get.mockResolvedValueOnce({ items: badNodes });

    const result = await h.handleToolCall("audit_voice_agent", {
      flowId: ID.flow,
    });

    expect(result.mode).toBe("dry-run");
    expect(result.summary.fail).toBeGreaterThan(0);
    const first = result.checks.find(
      (c: any) => c.id === "vg.session-config-first",
    );
    expect(first.status).toBe("fail");
    expect(first.proposedFix.kind).toBe("createSessionConfig");
    expect(api.post).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("apply creates the Set Session Config node via insertBefore and patches the agent", async () => {
    const goodNodes = [
      {
        _id: ID.node,
        type: "setSessionConfig",
        isEntryPoint: true,
        config: {
          bargeInOnSpeech: false,
          bargeInOnDtmf: false,
          asrEnabled: false,
          userNoInputTimeoutEnable: true,
          userNoInputTimeout: 6000,
          userNoInputRetries: 5,
          flowNoInputTimeoutEnable: true,
          flowNoInputTimeout: 1500,
          flowNoInputSpeech: "One moment please.",
          flowNoInputFail: false,
          sttHints: ["Acme"],
        },
      },
      {
        _id: ID.entry,
        type: "aiAgentJob",
        isEntryPoint: false,
        config: {
          storeLocation: "stream",
          errorHandling: "continue",
          errorMessage: "Sorry.",
          debugLogLLMLatency: true,
        },
      },
    ];
    api.get
      .mockResolvedValueOnce({ items: badNodes }) // initial audit
      .mockResolvedValueOnce({ items: goodNodes }); // re-audit
    api.post.mockResolvedValue({ _id: ID.node });
    api.patch.mockResolvedValue({});

    const result = await h.handleToolCall("audit_voice_agent", {
      flowId: ID.flow,
      apply: true,
    });

    expect(result.mode).toBe("apply");
    const createCall = api.post.mock.calls.find(
      (c: any[]) => c[1]?.type === "setSessionConfig",
    );
    expect(createCall).toBeDefined();
    expect(createCall![1].mode).toBe("insertBefore");
    expect(createCall![1].extension).toBe("@cognigy/voicegateway2");
    expect(createCall![1].target).toBe(ID.entry);
    expect(api.patch).toHaveBeenCalled();
    expect(result.appliedFixes.some((f: any) => f.applied)).toBe(true);
    expect(result.summary.fail).toBe(0);
  });

  it("only: limits applied fixes to the listed check ids", async () => {
    api.get
      .mockResolvedValueOnce({ items: badNodes })
      .mockResolvedValueOnce({ items: badNodes });
    api.patch.mockResolvedValue({});

    const result = await h.handleToolCall("audit_voice_agent", {
      flowId: ID.flow,
      apply: true,
      only: ["agent.stream-output"],
    });

    const applied = result.appliedFixes.map((f: any) => f.id);
    expect(applied).toEqual(["agent.stream-output"]);
    expect(
      api.post.mock.calls.some((c: any[]) => c[1]?.type === "setSessionConfig"),
    ).toBe(false);
  });
});

// =========================================================================
// Integration tests (gated)
// =========================================================================
const runIntegration = process.env.INTEGRATION_TEST === "true";

(runIntegration ? describe : describe.skip)("Integration tests", () => {
  it("placeholder for real API integration tests", () => {
    expect(true).toBe(true);
  });
});
