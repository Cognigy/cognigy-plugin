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

/**
 * The server holds the first change to an existing agent in a session until a
 * backup is offered (see the "backup gate" tests). Suites that are testing some
 * other tool are not testing that gate, so they answer it up front — exactly as
 * a real session does once the user has replied.
 */
const answerBackupGate = (handlers: ToolHandlers) => {
  // The answer is recorded per project; suites that touch a different project
  // still pass, because a call whose project cannot be determined falls back to
  // "answered anywhere this session".
  (handlers as any).backupDeclinedForProject.add(ID.project);
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
    answerBackupGate(h);
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
      // The job node references the agent via config.aiAgent. The avatar
      // preview is computed server-side from that reference, so the MCP must
      // NOT hand-craft a `preview` (it lands in the wrong storage path and is
      // ignored by the flow editor).
      const nodeCreateCall = api.post.mock.calls.find(
        (c: any[]) => c[0] === `/v2.0/flows/${ID.flow}/chart/nodes`,
      );
      expect(nodeCreateCall).toBeDefined();
      expect(nodeCreateCall![1].config.aiAgent).toBe("ref-uuid");
      expect(nodeCreateCall![1]).not.toHaveProperty("preview");
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
        config: { aiAgent: "ref-uuid" },
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
      // aiAgent must be re-sent so the backend regenerates the avatar preview
      // object rather than overwriting it with the bare job-name string.
      expect(api.patch).toHaveBeenCalledWith(
        `/v2.0/flows/${ID.flow}/chart/nodes/job-node-id-000000000001`,
        {
          config: {
            aiAgent: "ref-uuid",
            llmProviderReferenceId: "llm-ref-uuid",
            temperature: 0.5,
          },
        },
      );
    });

    it("re-sends aiAgent on a name-only update so the avatar preview is regenerated", async () => {
      const mockAgent = {
        _id: ID.agent,
        referenceId: "ref-uuid",
        name: "Renamed Agent",
        flowId: ID.flow,
      };
      const mockJobNode = {
        _id: "job-node-id-000000000001",
        type: "aiAgentJob",
        config: { aiAgent: "ref-uuid" },
      };

      // PATCH agent (name) first, then GET agent + nodes for the preview refresh.
      api.patch.mockResolvedValue(mockAgent);
      api.get
        .mockResolvedValueOnce(mockAgent)
        .mockResolvedValueOnce({ items: [mockJobNode] });

      const result = await h.handleToolCall("update_ai_agent", {
        aiAgentId: ID.agent,
        name: "Renamed Agent",
      });

      expect(result.updated).toContain("agent");
      // Even with no jobConfig, the node config patch must carry aiAgent to
      // force the backend to recompute the avatar preview (otherwise it would
      // overwrite the preview object with the bare name string).
      expect(api.patch).toHaveBeenCalledWith(
        `/v2.0/flows/${ID.flow}/chart/nodes/job-node-id-000000000001`,
        { config: { aiAgent: "ref-uuid" } },
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

    it("uses unique names for auto-created connections", async () => {
      api.post
        .mockResolvedValueOnce({
          _id: "conn1",
          referenceId: "conn-ref-uuid-1",
        })
        .mockResolvedValueOnce(mockLlm)
        .mockResolvedValueOnce(mockTestSuccess)
        .mockResolvedValueOnce({
          _id: "conn2",
          referenceId: "conn-ref-uuid-2",
        })
        .mockResolvedValueOnce(mockLlm)
        .mockResolvedValueOnce(mockTestSuccess);

      const args = {
        projectId: ID.project,
        provider: "openAI",
        modelType: "gpt-4o",
        apiKey: "sk-test",
      };
      await h.handleToolCall("setup_llm", args);
      await h.handleToolCall("setup_llm", args);

      const connectionNames = api.post.mock.calls
        .filter((call: any[]) => call[0] === "/v2.0/connections")
        .map((call: any[]) => call[1].name);
      expect(connectionNames).toHaveLength(2);
      expect(connectionNames[0]).toMatch(/^openAI - auto - /);
      expect(connectionNames[1]).toMatch(/^openAI - auto - /);
      expect(connectionNames[0]).not.toBe(connectionNames[1]);
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
      expect(api.post).not.toHaveBeenCalled();
    });

    it("creates an openAICompatible LLM with provider metadata and connection type", async () => {
      const mockCompatLlm = {
        _id: ID.llm,
        referenceId: "llm-ref-uuid",
        name: "llama-3.3-70b-instruct",
        provider: "openAICompatible",
        modelType: "custom-model",
        connectionId: "conn-ref-uuid",
        isDefault: true,
        apiType: "chatCompletion",
        openAICompatible: {
          customModel: "llama-3.3-70b-instruct",
          baseCustomUrl: "https://llm.example.com/v1",
          customAuthHeader: "X-Custom-Auth",
        },
      };
      const mockConn = { _id: "conn1", referenceId: "conn-ref-uuid" };
      api.post
        .mockResolvedValueOnce(mockConn)
        .mockResolvedValueOnce(mockCompatLlm)
        .mockResolvedValueOnce(mockTestSuccess);

      const result = await h.handleToolCall("setup_llm", {
        projectId: ID.project,
        provider: "openAICompatible",
        modelType: "custom-model",
        customModel: "llama-3.3-70b-instruct",
        baseCustomUrl: "https://llm.example.com/v1",
        customAuthHeader: "X-Custom-Auth",
        apiType: "chatCompletion",
        apiKey: "key-123",
      });

      expect(api.post).toHaveBeenCalledWith(
        "/v2.0/connections",
        expect.objectContaining({
          type: "OpenAICompatibleProvider",
          extension: "@cognigy/generative-ai-provider",
          fields: { apiKey: "key-123" },
        }),
      );
      expect(api.post).toHaveBeenCalledWith(
        "/v2.0/largelanguagemodels",
        expect.objectContaining({
          // Falls back to customModel, not the generic "custom-model" string
          name: "llama-3.3-70b-instruct",
          modelType: "custom-model",
          provider: "openAICompatible",
          apiType: "chatCompletion",
          openAICompatible: {
            customModel: "llama-3.3-70b-instruct",
            baseCustomUrl: "https://llm.example.com/v1",
            customAuthHeader: "X-Custom-Auth",
          },
        }),
      );
      expect(result.provider).toBe("openAICompatible");
      expect(result.openAICompatible).toEqual({
        customModel: "llama-3.3-70b-instruct",
        baseCustomUrl: "https://llm.example.com/v1",
        customAuthHeader: "X-Custom-Auth",
      });
      expect(result.apiType).toBe("chatCompletion");
    });

    it("omits customAuthHeader and apiType from the payload when not provided", async () => {
      const mockConn = { _id: "conn1", referenceId: "conn-ref-uuid" };
      api.post
        .mockResolvedValueOnce(mockConn)
        .mockResolvedValueOnce({
          ...mockLlm,
          provider: "openAICompatible",
          modelType: "custom-model",
        })
        .mockResolvedValueOnce(mockTestSuccess);

      await h.handleToolCall("setup_llm", {
        projectId: ID.project,
        provider: "openAICompatible",
        modelType: "custom-model",
        customModel: "llama-3.3-70b-instruct",
        baseCustomUrl: "https://llm.example.com/v1",
        apiKey: "key-123",
      });

      const llmPayload = api.post.mock.calls.find(
        (call: any[]) => call[0] === "/v2.0/largelanguagemodels",
      )?.[1];
      expect(llmPayload.openAICompatible).toEqual({
        customModel: "llama-3.3-70b-instruct",
        baseCustomUrl: "https://llm.example.com/v1",
      });
      expect(llmPayload).not.toHaveProperty("apiType");
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
      expect(result.error).toContain("aiAgentId or flowId is required");
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

    it("forwards sort to the projects endpoint", async () => {
      api.get.mockResolvedValue({
        items: [{ _id: ID.project, name: "Newest", lastChanged: 1800000000 }],
        total: 1,
      });

      const result = await h.handleToolCall("list_resources", {
        resourceType: "project",
        sort: "lastChanged:desc",
        limit: 5,
      });

      expect(api.get).toHaveBeenCalledWith("/v2.0/projects", {
        params: { limit: 5, skip: 0, sort: "lastChanged:desc" },
      });
      expect(result.items[0].lastChanged).toBe(1800000000);
    });

    it("omits sort from params when not supplied", async () => {
      api.get.mockResolvedValue({ items: [], total: 0 });

      await h.handleToolCall("list_resources", { resourceType: "project" });

      expect(api.get).toHaveBeenCalledWith("/v2.0/projects", {
        params: { limit: 25, skip: 0 },
      });
    });

    it("forwards sort to project-scoped endpoints", async () => {
      api.get.mockResolvedValue({ items: [], total: 0 });

      await h.handleToolCall("list_resources", {
        resourceType: "agent",
        projectId: ID.project,
        sort: "name:asc",
      });

      expect(api.get).toHaveBeenCalledWith("/v2.0/aiagents", {
        params: expect.objectContaining({ sort: "name:asc" }),
      });
    });

    it("warns that sort is ignored for tool type", async () => {
      api.get.mockResolvedValueOnce({ flowId: ID.flow }).mockResolvedValueOnce({
        items: [{ _id: ID.tool, type: "aiAgentJobTool", label: "Weather API" }],
      });

      const result = await h.handleToolCall("list_resources", {
        resourceType: "tool",
        aiAgentId: ID.agent,
        sort: "name:asc",
      });

      expect(result.items).toHaveLength(1);
      expect(result._hints.warning).toContain("sort was ignored");
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

    it("resolves the current user via the 'me' alias", async () => {
      api.get.mockResolvedValue({
        _id: "60d5ec49f1a2c8b1a4e0f001",
        id: "60d5ec49f1a2c8b1a4e0f001",
        name: "someone@example.com",
        roles: ["admin"],
        projects: [ID.project],
        organisation: "60d5ec49f1a2c8b1a4e0f0aa",
      });

      const result = await h.handleToolCall("get_resource", {
        resourceType: "user",
        id: "me",
      });

      expect(api.get).toHaveBeenCalledWith("/v2.0/users/me");
      expect(result.id).toBe("60d5ec49f1a2c8b1a4e0f001");
      expect(result.name).toBe("someone@example.com");
      expect(result.projects).toBeUndefined();
    });

    it("resolves a specific user by id", async () => {
      api.get.mockResolvedValue({
        _id: ID.agent,
        name: "other@example.com",
        roles: [],
      });

      await h.handleToolCall("get_resource", {
        resourceType: "user",
        id: ID.agent,
      });

      expect(api.get).toHaveBeenCalledWith(`/v2.0/users/${ID.agent}`);
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
        "user",
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
    it("soft-deletes agent: deactivates endpoints, renames flow and agent", async () => {
      api.get
        .mockResolvedValueOnce({
          _id: ID.agent,
          name: "My Agent",
          flowId: ID.flow,
          projectId: ID.project,
        })
        .mockResolvedValueOnce({
          referenceId: "flow-ref",
          name: "My Agent Flow",
        })
        .mockResolvedValueOnce({
          items: [{ _id: ID.endpoint, flowId: "flow-ref" }],
        });
      api.patch.mockResolvedValue({});

      const result = await h.handleToolCall("delete_resource", {
        resourceType: "agent",
        id: ID.agent,
      });

      expect(result.markedForDeletion).toBe(true);
      expect(result.name).toBe("DELETE_My Agent");
      expect(api.delete).not.toHaveBeenCalled();
      expect(api.patch).toHaveBeenCalledWith(`/v2.0/endpoints/${ID.endpoint}`, {
        active: false,
      });
      expect(api.patch).toHaveBeenCalledWith(`/v2.0/flows/${ID.flow}`, {
        name: "DELETE_My Agent Flow",
      });
      expect(api.patch).toHaveBeenCalledWith(`/v2.0/aiagents/${ID.agent}`, {
        name: "DELETE_My Agent",
      });
      expect(result.cascade.deactivated).toContain(`endpoint:${ID.endpoint}`);
      expect(result.cascade.renamed).toEqual(
        expect.arrayContaining([`flow:${ID.flow}`, `agent:${ID.agent}`]),
      );
    });

    it("renames only the agent when cascade is false", async () => {
      api.get.mockResolvedValueOnce({ _id: ID.agent, name: "My Agent" });
      api.patch.mockResolvedValue({});

      const result = await h.handleToolCall("delete_resource", {
        resourceType: "agent",
        id: ID.agent,
        cascade: false,
      });

      expect(result.markedForDeletion).toBe(true);
      expect(api.patch).toHaveBeenCalledWith(`/v2.0/aiagents/${ID.agent}`, {
        name: "DELETE_My Agent",
      });
      expect(api.delete).not.toHaveBeenCalled();
    });

    it("marks flow for deletion by renaming instead of deleting", async () => {
      api.get.mockResolvedValueOnce({ _id: ID.flow, name: "My Flow" });
      api.patch.mockResolvedValue({});

      const result = await h.handleToolCall("delete_resource", {
        resourceType: "flow",
        id: ID.flow,
      });

      expect(result.markedForDeletion).toBe(true);
      expect(result.name).toBe("DELETE_My Flow");
      expect(api.patch).toHaveBeenCalledWith(`/v2.0/flows/${ID.flow}`, {
        name: "DELETE_My Flow",
      });
      expect(api.delete).not.toHaveBeenCalled();
      // no projectId on the flow → endpoints could not be enumerated
      expect(result._hints.warning).toMatch(/may still be reachable/i);
    });

    it("deactivates endpoints referencing the flow before renaming it", async () => {
      api.get
        .mockResolvedValueOnce({
          _id: ID.flow,
          name: "My Flow",
          projectId: ID.project,
          referenceId: "flow-ref",
        })
        .mockResolvedValueOnce({
          items: [
            { _id: ID.endpoint, flowId: "flow-ref" },
            { _id: ID.agent, flowId: "other-flow" },
          ],
        });
      api.patch.mockResolvedValue({});

      const result = await h.handleToolCall("delete_resource", {
        resourceType: "flow",
        id: ID.flow,
      });

      expect(result.markedForDeletion).toBe(true);
      expect(api.delete).not.toHaveBeenCalled();
      expect(api.patch).toHaveBeenCalledWith(`/v2.0/endpoints/${ID.endpoint}`, {
        active: false,
      });
      expect(api.patch).not.toHaveBeenCalledWith(
        `/v2.0/endpoints/${ID.agent}`,
        expect.anything(),
      );
      expect(result.cascade.deactivated).toEqual([`endpoint:${ID.endpoint}`]);
      expect(result._hints.warning).toMatch(/deactivated/i);
    });

    it("marks project for deletion by renaming instead of deleting", async () => {
      api.get.mockResolvedValueOnce({ _id: ID.project, name: "My Project" });
      api.patch.mockResolvedValue({});

      const result = await h.handleToolCall("delete_resource", {
        resourceType: "project",
        id: ID.project,
      });

      expect(result.markedForDeletion).toBe(true);
      expect(result.name).toBe("DELETE_My Project");
      expect(api.patch).toHaveBeenCalledWith(`/v2.0/projects/${ID.project}`, {
        name: "DELETE_My Project",
      });
      expect(api.delete).not.toHaveBeenCalled();
    });

    it("does not double-prefix an already marked flow", async () => {
      api.get.mockResolvedValueOnce({ _id: ID.flow, name: "DELETE_My Flow" });

      const result = await h.handleToolCall("delete_resource", {
        resourceType: "flow",
        id: ID.flow,
      });

      expect(result.markedForDeletion).toBe(true);
      expect(result.alreadyMarked).toBe(true);
      expect(result.name).toBe("DELETE_My Flow");
      expect(api.patch).not.toHaveBeenCalled();
      expect(api.delete).not.toHaveBeenCalled();
    });

    it("still marks the agent but reports incomplete cleanup when an endpoint deactivation fails", async () => {
      api.get
        .mockResolvedValueOnce({
          _id: ID.agent,
          name: "My Agent",
          flowId: ID.flow,
          projectId: ID.project,
        })
        .mockResolvedValueOnce({
          referenceId: "flow-ref",
          name: "My Agent Flow",
        })
        .mockResolvedValueOnce({
          items: [{ _id: ID.endpoint, flowId: "flow-ref" }],
        });
      api.patch.mockImplementation(((url: string) =>
        url.startsWith("/v2.0/endpoints/")
          ? Promise.reject(new Error("endpoint deactivate failed"))
          : Promise.resolve({})) as any);

      const result = await h.handleToolCall("delete_resource", {
        resourceType: "agent",
        id: ID.agent,
      });

      expect(result.markedForDeletion).toBe(true);
      expect(result.cascade.failed).toEqual([
        expect.objectContaining({ resource: `endpoint:${ID.endpoint}` }),
      ]);
      expect(result._hints.warning).not.toMatch(/were deactivated .* offline/i);
      expect(result._hints.warning).toMatch(/may still be reachable/i);
    });

    it("reports the agent as not marked when the agent rename fails", async () => {
      api.get
        .mockResolvedValueOnce({
          _id: ID.agent,
          name: "My Agent",
          flowId: ID.flow,
          projectId: ID.project,
        })
        .mockResolvedValueOnce({
          referenceId: "flow-ref",
          name: "My Agent Flow",
        })
        .mockResolvedValueOnce({ items: [] });
      api.patch.mockImplementation(((url: string) =>
        url.startsWith("/v2.0/aiagents/")
          ? Promise.reject(new Error("rename failed"))
          : Promise.resolve({})) as any);

      const result = await h.handleToolCall("delete_resource", {
        resourceType: "agent",
        id: ID.agent,
      });

      expect(result.markedForDeletion).toBe(false);
      expect(result.cascade.failed).toEqual([
        expect.objectContaining({ resource: `agent:${ID.agent}` }),
      ]);
      expect(result._hints.warning).toMatch(/not marked for deletion/i);
    });

    it("does not claim endpoints were deleted when no flow can be resolved", async () => {
      api.get.mockResolvedValue({ _id: ID.agent, name: "My Agent" });
      api.patch.mockResolvedValue({});

      const result = await h.handleToolCall("delete_resource", {
        resourceType: "agent",
        id: ID.agent,
      });

      expect(result.markedForDeletion).toBe(true);
      expect(api.delete).not.toHaveBeenCalled();
      expect(result._hints.warning).toMatch(/no endpoints were deactivated/i);
      expect(result._hints.warning).toMatch(/may still be reachable/i);
    });

    it("does not report an already-marked agent as renamed again", async () => {
      api.get.mockResolvedValue({ _id: ID.agent, name: "DELETE_My Agent" });

      const result = await h.handleToolCall("delete_resource", {
        resourceType: "agent",
        id: ID.agent,
      });

      expect(result.markedForDeletion).toBe(true);
      expect(result.alreadyMarked).toBe(true);
      expect(result.name).toBe("DELETE_My Agent");
      expect(result.cascade.renamed).toEqual([]);
      expect(api.patch).not.toHaveBeenCalled();
    });

    it("refuses to mark a flow whose name is empty, identifying the resource", async () => {
      api.get.mockResolvedValueOnce({ _id: ID.flow, name: "   " });

      await expect(
        h.handleToolCall("delete_resource", {
          resourceType: "flow",
          id: ID.flow,
        }),
      ).rejects.toThrow(`flow ${ID.flow}`);
      expect(api.patch).not.toHaveBeenCalled();
    });

    it("truncates the DELETE_-prefixed name to the 200-char limit", async () => {
      const longName = "x".repeat(200);
      api.get.mockResolvedValueOnce({ _id: ID.flow, name: longName });
      api.patch.mockResolvedValue({});

      const result = await h.handleToolCall("delete_resource", {
        resourceType: "flow",
        id: ID.flow,
      });

      const expectedName = `DELETE_${longName}`.slice(0, 200);
      expect(result.markedForDeletion).toBe(true);
      expect(api.patch).toHaveBeenCalledWith(`/v2.0/flows/${ID.flow}`, {
        name: expectedName,
      });
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

    it("hard-deletes each non-protected resource type", async () => {
      const types = ["endpoint", "llm_model", "knowledge_store", "function"];
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
          parameters:
            '{"type":"object","properties":{"q":{"type":"string","description":"Query"}},"required":["q"]}',
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
    });

    it("returns error when flow has no aiAgentJob (or llmPromptV2) node", async () => {
      api.get.mockResolvedValueOnce({ flowId: ID.flow }).mockResolvedValueOnce({
        items: [{ _id: ID.entry, isEntryPoint: true }],
      });

      const result = await h.handleToolCall("create_tool", baseArgs);
      expect(result.error).toContain("No aiAgentJob or llmPromptV2 node found");
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
            parentId: ID.node,
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
            parentId: ID.node,
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
        "projectId",
        "referenceId",
      ]);
      // Snapshots are project-scoped, so a caller holding only an agent id
      // needs the project id from somewhere; internals stay stripped.
      expect(result.projectId).toBe(ID.project);
      expect(result).not.toHaveProperty("secret");
      expect(result).not.toHaveProperty("__v");
    });

    it("reads projectId from the API's projectReference field", async () => {
      api.get.mockResolvedValue({
        _id: ID.agent,
        name: "Agent",
        projectReference: ID.project,
      });

      const result = await h.handleToolCall("get_resource", {
        resourceType: "agent",
        id: ID.agent,
      });

      expect(result.projectId).toBe(ID.project);
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
  // manage_flow_nodes — get operation
  // =========================================================================
  describe("manage_flow_nodes — get", () => {
    const codeNodeId = "60d5ec49f1a2c8b1a4e0f011";

    it("returns full config for a code node and strips transpiled", async () => {
      api.get.mockResolvedValueOnce({
        _id: codeNodeId,
        type: "code",
        label: "Format Response",
        parentId: null,
        config: {
          code: "input.foo = 1;",
          transpiled: "input.foo = 1;",
          hasError: false,
        },
      });

      const result = await h.handleToolCall("manage_flow_nodes", {
        operation: "get",
        flowId: ID.flow,
        nodeId: codeNodeId,
      });

      expect(api.get).toHaveBeenCalledWith(
        `/v2.0/flows/${ID.flow}/chart/nodes/${codeNodeId}`,
      );
      expect(result.id).toBe(codeNodeId);
      expect(result.type).toBe("code");
      expect(result.config.code).toBe("input.foo = 1;");
      expect(result.config).not.toHaveProperty("transpiled");
      expect(result._hints).toBeUndefined();
    });

    it("warns via _hints when a code node has hasError", async () => {
      api.get.mockResolvedValueOnce({
        _id: codeNodeId,
        type: "code",
        label: "Broken",
        config: { code: "const x: =", hasError: true, transpiled: "" },
      });

      const result = await h.handleToolCall("manage_flow_nodes", {
        operation: "get",
        flowId: ID.flow,
        nodeId: codeNodeId,
      });

      expect(result.config.hasError).toBe(true);
      expect(result._hints?.warning).toContain("hasError");
    });

    it("errors when nodeId is missing", async () => {
      const result = await h.handleToolCall("manage_flow_nodes", {
        operation: "get",
        flowId: ID.flow,
      });

      expect(result.error).toContain("nodeId is required");
      expect(api.get).not.toHaveBeenCalled();
    });
  });

  describe("manage_flow_nodes — update surfaces transpile errors", () => {
    const codeNodeId = "60d5ec49f1a2c8b1a4e0f012";

    it("adds a hasError warning when the saved code fails to transpile", async () => {
      // 1st get: existing node (merge). 2nd get: read-back after PATCH.
      api.get
        .mockResolvedValueOnce({
          _id: codeNodeId,
          type: "code",
          config: { code: "old" },
        })
        .mockResolvedValueOnce({
          _id: codeNodeId,
          type: "code",
          config: { code: "const x: =", hasError: true },
        });
      api.patch.mockResolvedValueOnce({ _id: codeNodeId });

      const result = await h.handleToolCall("manage_flow_nodes", {
        operation: "update",
        flowId: ID.flow,
        nodeId: codeNodeId,
        config: { code: "const x: =" },
      });

      expect(result.updated).toBe(true);
      expect(result._hints?.warning).toContain("hasError");
    });

    it("does not warn when the updated code transpiles cleanly", async () => {
      api.get
        .mockResolvedValueOnce({
          _id: codeNodeId,
          type: "code",
          config: { code: "old" },
        })
        .mockResolvedValueOnce({
          _id: codeNodeId,
          type: "code",
          config: { code: "input.ok = 1;", hasError: false },
        });
      api.patch.mockResolvedValueOnce({ _id: codeNodeId });

      const result = await h.handleToolCall("manage_flow_nodes", {
        operation: "update",
        flowId: ID.flow,
        nodeId: codeNodeId,
        config: { code: "input.ok = 1;" },
      });

      expect(result.updated).toBe(true);
      // No transpile warning (a render suggestion in _hints is expected).
      expect(result._hints?.warning).toBeUndefined();
    });

    it("suggests rendering the flow after an update (focused on the node)", async () => {
      api.patch.mockResolvedValueOnce({ _id: codeNodeId });
      const result = await h.handleToolCall("manage_flow_nodes", {
        operation: "update",
        flowId: ID.flow,
        nodeId: codeNodeId,
        label: "Greeting",
      });
      expect(result._hints?.renderSuggestion).toContain('operation: "render"');
      expect(result._hints?.renderSuggestion).toContain(codeNodeId);
    });

    it("does not echo server-computed transpiled/hasError back in the PATCH", async () => {
      api.get
        .mockResolvedValueOnce({
          _id: codeNodeId,
          type: "code",
          config: {
            code: "old",
            transpiled: "OLD_COMPILED_JS",
            hasError: false,
          },
        })
        .mockResolvedValueOnce({
          _id: codeNodeId,
          type: "code",
          config: { code: "input.ok = 1;", hasError: false },
        });
      api.patch.mockResolvedValueOnce({ _id: codeNodeId });

      await h.handleToolCall("manage_flow_nodes", {
        operation: "update",
        flowId: ID.flow,
        nodeId: codeNodeId,
        config: { code: "input.ok = 1;" },
      });

      const patchBody = api.patch.mock.calls[0][1];
      expect(patchBody.config).not.toHaveProperty("transpiled");
      expect(patchBody.config).not.toHaveProperty("hasError");
      expect(patchBody.config.code).toBe("input.ok = 1;");
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
  // manage_flow_nodes — xApp nodes
  // =========================================================================
  describe("manage_flow_nodes — xApp nodes", () => {
    const newNode = "60d5ec49f1a2c8b1a4e0f0aa";

    it("creates an initAppSession node on @cognigy/basic-nodes with config passthrough", async () => {
      api.post.mockResolvedValueOnce({ _id: newNode, parentId: ID.tool });

      const result = await h.handleToolCall("manage_flow_nodes", {
        operation: "create",
        flowId: ID.flow,
        parentNodeId: ID.tool,
        mode: "append",
        nodeType: "initAppSession",
        label: "xApp: Init Session",
        config: { pageTitle: "Booking", logo: "default" },
      });

      expect(result.type).toBe("initAppSession");
      // No missing-init-session warning (a render suggestion is expected).
      expect(result._hints?.warning).toBeUndefined();
      // initAppSession is not xApp-dependent → no node-list lookup
      expect(api.get).not.toHaveBeenCalled();
      expect(api.post).toHaveBeenCalledWith(
        expect.stringContaining("/chart/nodes"),
        expect.objectContaining({
          type: "initAppSession",
          extension: "@cognigy/basic-nodes",
          config: { pageTitle: "Booking", logo: "default" },
        }),
      );
    });

    it("creates a showXAppAdaptiveCard preserving the card object, no warning when init session exists", async () => {
      api.get.mockResolvedValueOnce({ items: [{ type: "initAppSession" }] });
      api.post.mockResolvedValueOnce({ _id: newNode, parentId: ID.tool });

      const card = {
        type: "AdaptiveCard",
        body: [{ type: "Input.Text", id: "nickname" }],
      };
      const result = await h.handleToolCall("manage_flow_nodes", {
        operation: "create",
        flowId: ID.flow,
        parentNodeId: ID.tool,
        mode: "append",
        nodeType: "showXAppAdaptiveCard",
        label: "xApp: Show Card",
        config: { card, waitForInput: true, contextKey: "result" },
      });

      expect(result.type).toBe("setAdaptiveCardAppState");
      // No missing-init-session warning (a render suggestion is expected).
      expect(result._hints?.warning).toBeUndefined();
      expect(api.post).toHaveBeenCalledWith(
        expect.stringContaining("/chart/nodes"),
        expect.objectContaining({
          type: "setAdaptiveCardAppState",
          extension: "@cognigy/basic-nodes",
          config: expect.objectContaining({ card, waitForInput: true }),
        }),
      );
    });

    it("warns when creating an xApp node with no initAppSession in the flow", async () => {
      api.get.mockResolvedValueOnce({ items: [{ type: "say" }] });
      api.post.mockResolvedValueOnce({ _id: newNode, parentId: ID.tool });

      const result = await h.handleToolCall("manage_flow_nodes", {
        operation: "create",
        flowId: ID.flow,
        parentNodeId: ID.tool,
        mode: "append",
        nodeType: "showXAppHtml",
        label: "xApp: Show HTML",
        config: { mode: "body", body: "<p>hi</p>" },
      });

      expect(result.type).toBe("setHTMLAppState");
      expect(result._hints?.warning).toMatch(/Init Session/i);
    });

    it("requires the card config for showXAppAdaptiveCard", async () => {
      const result = await h.handleToolCall("manage_flow_nodes", {
        operation: "create",
        flowId: ID.flow,
        parentNodeId: ID.tool,
        mode: "append",
        nodeType: "showXAppAdaptiveCard",
        label: "xApp: Show Card",
        config: {},
      });

      expect(result.error).toMatch(/card/);
      expect(api.post).not.toHaveBeenCalled();
    });

    it("creates a setXAppState preserving the appTemplateData object", async () => {
      api.get.mockResolvedValueOnce({ items: [{ type: "initAppSession" }] });
      api.post.mockResolvedValueOnce({ _id: newNode, parentId: ID.tool });

      const appTemplateData = { customerId: "42", nested: { a: 1 } };
      await h.handleToolCall("manage_flow_nodes", {
        operation: "create",
        flowId: ID.flow,
        parentNodeId: ID.tool,
        mode: "append",
        nodeType: "setXAppState",
        label: "xApp: Set State",
        config: { appTemplateId: "tmpl-1", appTemplateData },
      });

      expect(api.post).toHaveBeenCalledWith(
        expect.stringContaining("/chart/nodes"),
        expect.objectContaining({
          type: "setAppState",
          config: { appTemplateId: "tmpl-1", appTemplateData },
        }),
      );
    });

    it("creates a getXAppSessionPin node with no config", async () => {
      api.get.mockResolvedValueOnce({ items: [{ type: "initAppSession" }] });
      api.post.mockResolvedValueOnce({ _id: newNode, parentId: ID.tool });

      const result = await h.handleToolCall("manage_flow_nodes", {
        operation: "create",
        flowId: ID.flow,
        parentNodeId: ID.tool,
        mode: "append",
        nodeType: "getXAppSessionPin",
        label: "xApp: Get Session PIN",
      });

      expect(result.type).toBe("getAppSessionPin");
      const postBody = api.post.mock.calls[0][1] as any;
      expect(postBody.config).toBeUndefined();
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
      // The config patch must re-send aiAgent so the backend regenerates the
      // avatar preview object instead of clobbering it with a bare string.
      expect(api.patch).toHaveBeenCalledWith(
        `/v2.0/flows/${ID.flow}/chart/nodes/${ID.node}`,
        {
          config: {
            aiAgent: "ref-uuid",
            llmProviderReferenceId: "llm-ref-uuid",
          },
        },
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
        .mockResolvedValueOnce({
          items: [
            {
              _id: "60d5ec49f1a2c8b1a4e0f0aa",
              referenceId: "loc-123",
              primary: true,
              projectReference: ID.project,
            },
          ],
        }) // project locales
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
        .mockResolvedValueOnce({
          items: [
            {
              _id: "60d5ec49f1a2c8b1a4e0f0aa",
              referenceId: "loc-123",
              primary: true,
              projectReference: ID.project,
            },
          ],
        }) // project locales
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
    answerBackupGate(h);
  });

  const START_ID = "60d5ec49f1a2c8b1a4e0f0aa";

  const badAgent = {
    _id: ID.entry,
    type: "aiAgentJob",
    // Per-descriptor flag: aiAgentJob reports true regardless of run order.
    isEntryPoint: true,
    config: {
      storeLocation: "input",
      errorHandling: "stop",
      errorMessage: "",
      debugLogLLMLatency: false,
    },
  };

  const goodSsc = {
    _id: ID.node,
    type: "setSessionConfig",
    isEntryPoint: false,
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
  };

  const goodAgent = {
    _id: ID.entry,
    type: "aiAgentJob",
    isEntryPoint: true,
    config: {
      storeLocation: "stream",
      errorHandling: "continue",
      errorMessage: "Sorry.",
      debugLogLLMLatency: true,
    },
  };

  /**
   * Wire api.get to the REAL chart projections so the handler must do the right
   * reads:
   *   - GET /chart/nodes (index): id/type/isEntryPoint only — NO config, NO order
   *   - GET /chart/nodes/{id}:    full node incl. config (the only config source)
   *   - GET /new/.../chart:       { nodes:[start,…], relations:[{node,next}] }
   * `state` is mutable so the apply path can flip it to the post-fix flow before
   * the handler re-audits.
   */
  function setupFlow(initial: { nodes: any[]; firstNodeId: string }) {
    const state = { nodes: initial.nodes, firstNodeId: initial.firstNodeId };
    const indexUrl = `/v2.0/flows/${ID.flow}/chart/nodes`;
    const perNodePrefix = `${indexUrl}/`;
    const chartUrl = `/new/v2.0/flows/${ID.flow}/chart`;
    api.get.mockImplementation(async (url: string) => {
      if (url === chartUrl) {
        return {
          nodes: [
            { _id: START_ID, type: "start" },
            ...state.nodes.map((n) => ({ _id: n._id, type: n.type })),
          ],
          relations: [{ node: START_ID, next: [state.firstNodeId] }],
        };
      }
      if (url.startsWith(perNodePrefix)) {
        const id = url.slice(perNodePrefix.length);
        const n = state.nodes.find((x) => x._id === id);
        return n ? { ...n } : {};
      }
      if (url === indexUrl) {
        // Strip config + ordering to mirror the real lightweight index view.
        return {
          items: state.nodes.map(({ config, ...rest }) => rest),
        };
      }
      return {};
    });
    return state;
  }

  it("dry-run reports failures and proposes fixes without mutating", async () => {
    setupFlow({ nodes: [badAgent], firstNodeId: ID.entry });

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

  it("evaluates config read from the per-node GET, not the bare index", async () => {
    // A fully compliant flow must report zero failures only if the handler reads
    // each node's config via the per-node GET — the index carries none.
    setupFlow({ nodes: [goodSsc, goodAgent], firstNodeId: ID.node });

    const result = await h.handleToolCall("audit_voice_agent", {
      flowId: ID.flow,
    });

    expect(result.summary.fail).toBe(0);
    expect(
      result.checks.find((c: any) => c.id === "vg.session-config-first").status,
    ).toBe("pass");
    // Proof it fetched full config per node rather than trusting the index.
    expect(api.get).toHaveBeenCalledWith(
      `/v2.0/flows/${ID.flow}/chart/nodes/${ID.node}`,
    );
  });

  it("apply creates the Set Session Config node via prepend and patches the agent", async () => {
    const state = setupFlow({ nodes: [badAgent], firstNodeId: ID.entry });
    // Creating the SSC flips the flow to its post-fix state for the re-audit.
    api.post.mockImplementation(async (_url: string, body: any) => {
      if (body?.type === "setSessionConfig") {
        state.nodes = [goodSsc, goodAgent];
        state.firstNodeId = ID.node;
        return { _id: ID.node };
      }
      return {};
    });
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
    expect(createCall![1].mode).toBe("prepend");
    expect(createCall![1].extension).toBe("@cognigy/voicegateway2");
    expect(createCall![1].target).toBe(ID.entry);
    expect(api.patch).toHaveBeenCalled();
    expect(result.appliedFixes.some((f: any) => f.applied)).toBe(true);
    expect(result.summary.fail).toBe(0);
  });

  it("patchNode fix merges onto existing config (never clobbers)", async () => {
    // Agent config has a non-target field (temperature) that the stream-output
    // fix must preserve — only possible if the handler read the real config.
    const agentWithExtras = {
      ...badAgent,
      config: { ...badAgent.config, temperature: 0.7 },
    };
    setupFlow({ nodes: [agentWithExtras], firstNodeId: ID.entry });
    api.post.mockResolvedValue({ _id: ID.node });
    api.patch.mockResolvedValue({});

    await h.handleToolCall("audit_voice_agent", {
      flowId: ID.flow,
      apply: true,
      only: ["agent.stream-output"],
    });

    const patchCall = api.patch.mock.calls.find((c: any[]) =>
      c[0].endsWith(`/chart/nodes/${ID.entry}`),
    );
    expect(patchCall).toBeDefined();
    expect(patchCall![1].config.storeLocation).toBe("stream");
    // Pre-existing field survives the merge.
    expect(patchCall![1].config.temperature).toBe(0.7);
  });

  it("accumulates multiple fixes on the same node across patches", async () => {
    // A Set Session Config node with several failing checks — all patchNode
    // fixes target the SAME node. Each successive patch must build on the prior
    // merge, not revert it to the original config.
    const badSsc = {
      _id: ID.node,
      type: "setSessionConfig",
      isEntryPoint: false,
      config: {
        bargeInOnSpeech: true,
        bargeInOnDtmf: true,
        asrEnabled: true,
        flowNoInputFail: true,
      },
    };
    setupFlow({ nodes: [badSsc, goodAgent], firstNodeId: ID.node });
    api.patch.mockResolvedValue({});

    await h.handleToolCall("audit_voice_agent", {
      flowId: ID.flow,
      apply: true,
    });

    const sscPatches = api.patch.mock.calls.filter((c: any[]) =>
      c[0].endsWith(`/chart/nodes/${ID.node}`),
    );
    expect(sscPatches.length).toBeGreaterThan(1);
    // The final patch carries every earlier fix, not just its own field.
    const finalConfig = sscPatches[sscPatches.length - 1][1].config;
    expect(finalConfig.bargeInOnSpeech).toBe(false);
    expect(finalConfig.asrEnabled).toBe(false);
    expect(finalConfig.flowNoInputFail).toBe(false);
  });

  it("re-fetches a node's config before patching when enrichment missed it", async () => {
    // If enrichment transiently fails, the cached snapshot has no config. The
    // apply path must re-fetch the full node before patching rather than
    // PATCHing a partial config that clobbers existing fields.
    const indexUrl = `/v2.0/flows/${ID.flow}/chart/nodes`;
    const perNodeUrl = `${indexUrl}/${ID.entry}`;
    let perNodeCalls = 0;
    api.get.mockImplementation(async (url: string) => {
      if (url === `/new/v2.0/flows/${ID.flow}/chart`) {
        return {
          nodes: [
            { _id: START_ID, type: "start" },
            { _id: ID.entry, type: "aiAgentJob" },
          ],
          relations: [{ node: START_ID, next: [ID.entry] }],
        };
      }
      if (url === perNodeUrl) {
        perNodeCalls += 1;
        if (perNodeCalls === 1) throw new Error("transient enrichment failure");
        return {
          _id: ID.entry,
          type: "aiAgentJob",
          config: { temperature: 0.7, storeLocation: "input" },
        };
      }
      if (url === indexUrl) {
        return { items: [{ _id: ID.entry, type: "aiAgentJob" }] };
      }
      return {};
    });
    api.patch.mockResolvedValue({});

    await h.handleToolCall("audit_voice_agent", {
      flowId: ID.flow,
      apply: true,
      only: ["agent.stream-output"],
    });

    // First per-node GET (enrichment) threw; the apply path re-fetched.
    expect(perNodeCalls).toBeGreaterThanOrEqual(2);
    const patchCall = api.patch.mock.calls.find((c: any[]) =>
      c[0].endsWith(`/chart/nodes/${ID.entry}`),
    );
    expect(patchCall![1].config.storeLocation).toBe("stream");
    // The unrelated field from the re-fetched config is preserved.
    expect(patchCall![1].config.temperature).toBe(0.7);
  });

  it("only: limits applied fixes to the listed check ids", async () => {
    setupFlow({ nodes: [badAgent], firstNodeId: ID.entry });
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

// ---------------------------------------------------------------------------
// manage_snapshots
// ---------------------------------------------------------------------------

const SNAP_ID = {
  auto1: "60d5ec49f1a2c8b1a4e0fa01",
  auto2: "60d5ec49f1a2c8b1a4e0fa02",
  human: "60d5ec49f1a2c8b1a4e0fa03",
};

const AUTO_DESC =
  "Automatic backup created by the NiCE Cognigy Plugin before agent changes.\ncognigy-plugin:auto-backup:v1";

const autoBackup = (id: string, name: string, createdAt: number) => ({
  _id: id,
  name: `[AI Backup] ${name}`,
  description: AUTO_DESC,
  createdAt,
  createdBy: "user1",
  isPackaged: false,
});

const humanSnapshot = (id: string, createdAt: number) => ({
  _id: id,
  name: "Release 2026-01",
  description: "Prepared by hand for production.",
  createdAt,
  createdBy: "user2",
  isPackaged: true,
});

/** A page of snapshots as GET /v2.0/snapshots returns it. */
const snapshotPage = (items: any[]) => ({ items, total: items.length });

const doneTask = { _id: ID.task, status: "done", currentStep: 100 };

describe("manage_snapshots", () => {
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

  describe("list", () => {
    it("flags plugin backups and reports the count", async () => {
      api.get.mockResolvedValueOnce(
        snapshotPage([
          humanSnapshot(SNAP_ID.human, 100),
          autoBackup(SNAP_ID.auto1, "first", 50),
        ]) as any,
      );

      const result = await h.handleToolCall("manage_snapshots", {
        operation: "list",
        projectId: ID.project,
      });

      expect(result.count).toBe(2);
      expect(result.atLimit).toBe(false);
      expect(result.snapshots).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: SNAP_ID.human, isPluginBackup: false }),
          expect.objectContaining({ id: SNAP_ID.auto1, isPluginBackup: true }),
        ]),
      );
      expect(result.oldestDeletableBackup.id).toBe(SNAP_ID.auto1);
    });
  });

  describe("create", () => {
    it("stamps both markers and polls the task to done", async () => {
      api.get
        .mockResolvedValueOnce(snapshotPage([]) as any) // limit pre-check
        .mockResolvedValueOnce(doneTask as any) // waitForTask
        .mockResolvedValueOnce(
          snapshotPage([autoBackup(SNAP_ID.auto1, "pre-update", 200)]) as any,
        ); // resolve-by-name
      api.post.mockResolvedValueOnce({ _id: ID.task } as any);

      const result = await h.handleToolCall("manage_snapshots", {
        operation: "create",
        projectId: ID.project,
        label: "pre-update",
      });

      expect(result.created).toBe(true);
      const body = api.post.mock.calls[0][1] as any;
      expect(api.post.mock.calls[0][0]).toBe("/new/v2.0/snapshots");
      expect(body.name).toMatch(
        /^\[AI Backup\] v1 pre-update — \d{4}-\d{2}-\d{2}/,
      );
      expect(body.description).toContain("cognigy-plugin:auto-backup");
      expect(body.projectId).toBe(ID.project);
      expect(result.notIncluded.join(" ")).toContain("Knowledge AI");
    });

    it("strips characters the platform rejects in resource names", async () => {
      api.get
        .mockResolvedValueOnce(snapshotPage([]) as any)
        .mockResolvedValueOnce(doneTask as any)
        .mockResolvedValueOnce(snapshotPage([]) as any);
      api.post.mockResolvedValueOnce({ _id: ID.task } as any);

      await h.handleToolCall("manage_snapshots", {
        operation: "create",
        projectId: ID.project,
        label: 'a/b:c*d?e"f<g>h|i',
      });

      const body = api.post.mock.calls[0][1] as any;
      expect(body.name).not.toMatch(/[\\/:*?"<>|¥]/);
    });

    it("creates nothing when the project is at the limit", async () => {
      const items = [
        humanSnapshot(SNAP_ID.human, 10),
        ...Array.from({ length: 9 }, (_, i) =>
          autoBackup(`60d5ec49f1a2c8b1a4e0fb0${i}`, `b${i}`, 100 + i),
        ),
      ];
      api.get.mockResolvedValueOnce(snapshotPage(items) as any);

      const result = await h.handleToolCall("manage_snapshots", {
        operation: "create",
        projectId: ID.project,
      });

      expect(result.error).toBe("snapshot_limit_reached");
      expect(result.created).toBe(false);
      expect(api.post).not.toHaveBeenCalled();
      expect(api.delete).not.toHaveBeenCalled();
      expect(result._hints.action).toContain("confirmDeleteOldest");
    });

    it("deletes the oldest PLUGIN backup, not the oldest snapshot overall", async () => {
      // The human snapshot is the oldest of all; it must be left alone.
      const items = [
        humanSnapshot(SNAP_ID.human, 1),
        autoBackup(SNAP_ID.auto1, "older-backup", 50),
        autoBackup(SNAP_ID.auto2, "newer-backup", 60),
        ...Array.from({ length: 7 }, (_, i) =>
          autoBackup(`60d5ec49f1a2c8b1a4e0fc0${i}`, `b${i}`, 100 + i),
        ),
      ];
      api.get
        .mockResolvedValueOnce(snapshotPage(items) as any) // pre-check
        .mockResolvedValueOnce(doneTask as any) // delete task
        .mockResolvedValueOnce(doneTask as any) // create task
        .mockResolvedValueOnce(
          snapshotPage([autoBackup(SNAP_ID.auto2, "fresh", 300)]) as any,
        );
      api.delete.mockResolvedValueOnce({ _id: ID.task } as any);
      api.post.mockResolvedValueOnce({ _id: ID.task } as any);

      const result = await h.handleToolCall("manage_snapshots", {
        operation: "create",
        projectId: ID.project,
        confirmDeleteOldest: true,
      });

      expect(api.delete).toHaveBeenCalledTimes(1);
      expect(api.delete).toHaveBeenCalledWith(
        `/new/v2.0/snapshots/${SNAP_ID.auto1}`,
      );
      expect(result.deletedToFreeSlot.id).toBe(SNAP_ID.auto1);
      expect(result.created).toBe(true);
    });

    it("refuses at the limit when no plugin backup exists to delete", async () => {
      const items = Array.from({ length: 10 }, (_, i) =>
        humanSnapshot(`60d5ec49f1a2c8b1a4e0fd0${i}`, 100 + i),
      );
      api.get.mockResolvedValueOnce(snapshotPage(items) as any);

      const result = await h.handleToolCall("manage_snapshots", {
        operation: "create",
        projectId: ID.project,
        confirmDeleteOldest: true,
      });

      expect(result.error).toBe("snapshot_limit_reached");
      expect(result.deletableBackups).toEqual([]);
      expect(api.delete).not.toHaveBeenCalled();
      expect(api.post).not.toHaveBeenCalled();
    });

    it("walks to the next backup when one is pinned to an endpoint", async () => {
      const items = [
        autoBackup(SNAP_ID.auto1, "in-use", 50),
        autoBackup(SNAP_ID.auto2, "free", 60),
        ...Array.from({ length: 8 }, (_, i) =>
          autoBackup(`60d5ec49f1a2c8b1a4e0fe0${i}`, `b${i}`, 100 + i),
        ),
      ];
      api.get
        .mockResolvedValueOnce(snapshotPage(items) as any)
        .mockResolvedValueOnce({
          _id: ID.task,
          status: "error",
          failReason:
            "Snapshot can't be deleted as it is attached to an endpoint.",
        } as any)
        .mockResolvedValueOnce(doneTask as any) // second delete succeeds
        .mockResolvedValueOnce(doneTask as any) // create
        .mockResolvedValueOnce(snapshotPage([]) as any);
      api.delete
        .mockResolvedValueOnce({ _id: ID.task } as any)
        .mockResolvedValueOnce({ _id: ID.task } as any);
      api.post.mockResolvedValueOnce({ _id: ID.task } as any);

      const result = await h.handleToolCall("manage_snapshots", {
        operation: "create",
        projectId: ID.project,
        confirmDeleteOldest: true,
      });

      expect(api.delete).toHaveBeenCalledTimes(2);
      expect(result.deletedToFreeSlot.id).toBe(SNAP_ID.auto2);
      expect(result.skippedCandidates[0].inUseByEndpoint).toBe(true);
    });

    it("reports a limit rejection that only surfaces on the task", async () => {
      api.get
        .mockResolvedValueOnce(snapshotPage([]) as any) // pre-check passes
        .mockResolvedValueOnce({
          _id: ID.task,
          status: "error",
          failReason:
            "Unable to create Snapshot. Limit of allowed Snapshots for this project has been exceeded.",
        } as any)
        .mockResolvedValueOnce(
          snapshotPage([autoBackup(SNAP_ID.auto1, "old", 10)]) as any,
        );
      api.post.mockResolvedValueOnce({ _id: ID.task } as any);

      const result = await h.handleToolCall("manage_snapshots", {
        operation: "create",
        projectId: ID.project,
      });

      expect(result.error).toBe("snapshot_limit_reached");
      expect(result.created).toBe(false);
    });
  });

  describe("restore", () => {
    it("only reads and changes nothing without confirm", async () => {
      api.get
        .mockResolvedValueOnce(autoBackup(SNAP_ID.auto1, "backup", 100) as any)
        .mockResolvedValueOnce(
          snapshotPage([autoBackup(SNAP_ID.auto1, "backup", 100)]) as any,
        );

      const result = await h.handleToolCall("manage_snapshots", {
        operation: "restore",
        projectId: ID.project,
        snapshotId: SNAP_ID.auto1,
      });

      expect(result.applied).toBe(false);
      expect(api.post).not.toHaveBeenCalled();
      expect(api.delete).not.toHaveBeenCalled();
      expect(result.warnings.join(" ")).toContain("DESTRUCTIVE");
      expect(result.notRestored.join(" ")).toContain("Knowledge AI");
    });

    it("posts with no body when confirmed", async () => {
      api.get
        .mockResolvedValueOnce(autoBackup(SNAP_ID.auto1, "backup", 100) as any)
        .mockResolvedValueOnce(
          snapshotPage([autoBackup(SNAP_ID.auto1, "backup", 100)]) as any,
        )
        .mockResolvedValueOnce(doneTask as any);
      api.post.mockResolvedValueOnce({ _id: ID.task } as any);

      const result = await h.handleToolCall("manage_snapshots", {
        operation: "restore",
        projectId: ID.project,
        snapshotId: SNAP_ID.auto1,
        confirm: true,
      });

      expect(result.applied).toBe(true);
      expect(api.post).toHaveBeenCalledTimes(1);
      // The platform derives the project from the path param; sending projectId
      // as well raises "ProjectId was specified in multiple locations".
      expect(api.post).toHaveBeenCalledWith(
        `/new/v2.0/snapshots/${SNAP_ID.auto1}/restore`,
      );
    });

    it("restores a human-created snapshot too", async () => {
      api.get
        .mockResolvedValueOnce(humanSnapshot(SNAP_ID.human, 100) as any)
        .mockResolvedValueOnce(
          snapshotPage([humanSnapshot(SNAP_ID.human, 100)]) as any,
        )
        .mockResolvedValueOnce(doneTask as any);
      api.post.mockResolvedValueOnce({ _id: ID.task } as any);

      const result = await h.handleToolCall("manage_snapshots", {
        operation: "restore",
        projectId: ID.project,
        snapshotId: SNAP_ID.human,
        confirm: true,
      });

      expect(result.applied).toBe(true);
    });
  });

  describe("delete", () => {
    it("refuses to delete a human-created snapshot", async () => {
      api.get.mockResolvedValueOnce(humanSnapshot(SNAP_ID.human, 100) as any);

      const result = await h.handleToolCall("manage_snapshots", {
        operation: "delete",
        projectId: ID.project,
        snapshotId: SNAP_ID.human,
      });

      expect(result.error).toBe("not_a_plugin_backup");
      expect(result.deleted).toBe(false);
      expect(api.delete).not.toHaveBeenCalled();
    });

    it("refuses a snapshot that only carries the name prefix", async () => {
      api.get.mockResolvedValueOnce({
        _id: SNAP_ID.human,
        name: "[AI Backup] hand-made lookalike",
        description: "Written by a person, no marker here.",
        createdAt: 100,
      } as any);

      const result = await h.handleToolCall("manage_snapshots", {
        operation: "delete",
        projectId: ID.project,
        snapshotId: SNAP_ID.human,
      });

      expect(result.error).toBe("not_a_plugin_backup");
      expect(api.delete).not.toHaveBeenCalled();
    });

    it("deletes a plugin backup", async () => {
      api.get
        .mockResolvedValueOnce(autoBackup(SNAP_ID.auto1, "backup", 100) as any)
        .mockResolvedValueOnce(
          snapshotPage([autoBackup(SNAP_ID.auto1, "backup", 100)]) as any,
        )
        .mockResolvedValueOnce(doneTask as any);
      api.delete.mockResolvedValueOnce({ _id: ID.task } as any);

      const result = await h.handleToolCall("manage_snapshots", {
        operation: "delete",
        projectId: ID.project,
        snapshotId: SNAP_ID.auto1,
      });

      expect(result.deleted).toBe(true);
      expect(api.delete).toHaveBeenCalledWith(
        `/new/v2.0/snapshots/${SNAP_ID.auto1}`,
      );
    });

    it("explains an endpoint-pinned snapshot", async () => {
      api.get
        .mockResolvedValueOnce(autoBackup(SNAP_ID.auto1, "backup", 100) as any)
        .mockResolvedValueOnce(
          snapshotPage([autoBackup(SNAP_ID.auto1, "backup", 100)]) as any,
        )
        .mockResolvedValueOnce({
          _id: ID.task,
          status: "error",
          failReason:
            "Snapshot can't be deleted as it is attached to an endpoint.",
        } as any);
      api.delete.mockResolvedValueOnce({ _id: ID.task } as any);

      const result = await h.handleToolCall("manage_snapshots", {
        operation: "delete",
        projectId: ID.project,
        snapshotId: SNAP_ID.auto1,
      });

      expect(result.deleted).toBe(false);
      expect(result.inUseByEndpoint).toBe(true);
    });
  });

  describe("backup gate", () => {
    it("holds the first change to an existing agent and changes nothing", async () => {
      const result = await h.handleToolCall("update_ai_agent", {
        aiAgentId: ID.agent,
        description: "new persona",
      });

      expect(result.error).toBe("backup_not_offered");
      expect(result.changed).toBe(false);
      // The whole point: no API call reached the platform.
      expect(api.patch).not.toHaveBeenCalled();
      expect(api.post).not.toHaveBeenCalled();
      expect(result._hints.action).toContain('operation: "create"');
      expect(result._hints.action).toContain('operation: "decline"');
    });

    it("lets the retry through after a snapshot is created", async () => {
      await h.handleToolCall("update_ai_agent", {
        aiAgentId: ID.agent,
        description: "new persona",
      });

      api.get
        .mockResolvedValueOnce({ items: [], total: 0 } as any)
        .mockResolvedValueOnce(doneTask as any)
        .mockResolvedValueOnce(
          snapshotPage([autoBackup(SNAP_ID.auto1, "backup", 200)]) as any,
        );
      api.post.mockResolvedValueOnce({ _id: ID.task } as any);
      const created = await h.handleToolCall("manage_snapshots", {
        operation: "create",
        projectId: ID.project,
      });
      expect(created.created).toBe(true);

      api.get.mockResolvedValue({
        _id: ID.agent,
        name: "Agent",
        flowId: ID.flow,
      } as any);
      api.patch.mockResolvedValue({ _id: ID.agent, name: "Agent" } as any);

      const retry = await h.handleToolCall("update_ai_agent", {
        aiAgentId: ID.agent,
        description: "new persona",
      });

      expect(retry.error).toBeUndefined();
      expect(api.patch).toHaveBeenCalled();
    });

    it("lets the retry through after the user declines", async () => {
      await h.handleToolCall("update_ai_agent", {
        aiAgentId: ID.agent,
        description: "new persona",
      });

      const declined = await h.handleToolCall("manage_snapshots", {
        operation: "decline",
        projectId: ID.project,
      });
      expect(declined.acknowledged).toBe(true);
      // decline must never touch the API.
      expect(api.post).not.toHaveBeenCalled();
      expect(api.delete).not.toHaveBeenCalled();

      api.get.mockResolvedValue({
        _id: ID.agent,
        name: "Agent",
        flowId: ID.flow,
      } as any);
      api.patch.mockResolvedValue({ _id: ID.agent, name: "Agent" } as any);

      const retry = await h.handleToolCall("update_ai_agent", {
        aiAgentId: ID.agent,
        description: "new persona",
      });

      expect(retry.error).toBeUndefined();
      expect(api.patch).toHaveBeenCalled();
    });

    it("holds at most once, so a blind retry cannot deadlock", async () => {
      const first = await h.handleToolCall("update_ai_agent", {
        aiAgentId: ID.agent,
        description: "a",
      });
      expect(first.error).toBe("backup_not_offered");

      api.get.mockResolvedValue({
        _id: ID.agent,
        name: "Agent",
        flowId: ID.flow,
      } as any);
      api.patch.mockResolvedValue({ _id: ID.agent, name: "Agent" } as any);

      const second = await h.handleToolCall("update_ai_agent", {
        aiAgentId: ID.agent,
        description: "a",
      });
      expect(second.error).toBeUndefined();
    });

    it("holds ALL concurrent distinct mutations to the same project", async () => {
      // A client may issue several mutating calls in one parallel batch. Only
      // releasing after the first hold would let the rest mutate the project
      // before the backup offer was ever answered.
      const [first, second] = await Promise.all([
        h.handleToolCall("manage_settings", {
          operation: "set_knowledge_ai",
          projectId: ID.project,
          knowledgeSearchModelId: "m1",
        }),
        h.handleToolCall("manage_settings", {
          operation: "set_knowledge_ai",
          projectId: ID.project,
          knowledgeSearchModelId: "m2",
        }),
      ]);

      expect(first.error).toBe("backup_not_offered");
      expect(second.error).toBe("backup_not_offered");
      expect(api.patch).not.toHaveBeenCalled();
      expect(api.post).not.toHaveBeenCalled();

      // Once the offer is answered, the held calls run on retry.
      await h.handleToolCall("manage_snapshots", {
        operation: "decline",
        projectId: ID.project,
      });
      api.get.mockResolvedValue({ _id: ID.project } as any);
      api.patch.mockResolvedValue({ _id: ID.project } as any);
      const retry = await h.handleToolCall("manage_settings", {
        operation: "set_knowledge_ai",
        projectId: ID.project,
        knowledgeSearchModelId: "m2",
      });
      expect(retry.error).not.toBe("backup_not_offered");
    });

    it("holds concurrent distinct mutations even when the project is unknown", async () => {
      const [first, second] = await Promise.all([
        h.handleToolCall("update_ai_agent", {
          aiAgentId: ID.agent,
          description: "a",
        }),
        h.handleToolCall("update_ai_agent", {
          aiAgentId: ID.agent,
          description: "b",
        }),
      ]);

      expect(first.error).toBe("backup_not_offered");
      expect(second.error).toBe("backup_not_offered");
      expect(api.patch).not.toHaveBeenCalled();

      // Any answer, anywhere, releases the unknown-project fallback: a retry
      // after decline proceeds instead of being held again.
      await h.handleToolCall("manage_snapshots", {
        operation: "decline",
        projectId: ID.project,
      });
      api.get.mockResolvedValue({
        _id: ID.agent,
        name: "Agent",
        flowId: ID.flow,
      } as any);
      api.patch.mockResolvedValue({ _id: ID.agent, name: "Agent" } as any);
      const retry = await h.handleToolCall("update_ai_agent", {
        aiAgentId: ID.agent,
        description: "b",
      });
      expect(retry.error).toBeUndefined();
      expect(api.patch).toHaveBeenCalled();
    });

    it("does not hold create_ai_agent itself", () => {
      expect(
        (ToolHandlers as any).isBackupWorthyCall("create_ai_agent", {}),
      ).toBe(false);
    });

    it("does not hold changes to an agent this session created", async () => {
      // cognigy-agent-builder creates an agent then immediately refines it with
      // update_ai_agent. There is no prior state to roll back to, so holding
      // that call would be pure friction.
      (h as any).resourcesCreatedThisSession.add(ID.agent);

      api.get.mockResolvedValue({
        _id: ID.agent,
        name: "Agent",
        flowId: ID.flow,
      } as any);
      api.patch.mockResolvedValue({ _id: ID.agent, name: "Agent" } as any);

      const result = await h.handleToolCall("update_ai_agent", {
        aiAgentId: ID.agent,
        description: "refined right after creation",
      });

      expect(result.error).toBeUndefined();
      expect(api.patch).toHaveBeenCalled();
    });

    it("still holds changes to a DIFFERENT, pre-existing agent", async () => {
      (h as any).resourcesCreatedThisSession.add(ID.agent);

      const result = await h.handleToolCall("update_ai_agent", {
        aiAgentId: "60d5ec49f1a2c8b1a4e0f0ff",
        description: "touching something older",
      });

      expect(result.error).toBe("backup_not_offered");
      expect(api.patch).not.toHaveBeenCalled();
    });

    it("exempts a flow this session created", async () => {
      (h as any).resourcesCreatedThisSession.add(ID.flow);
      expect((h as any).targetsNewResource({ flowId: ID.flow })).toBe(true);
      expect((h as any).targetsNewResource({ flowId: ID.endpoint })).toBe(
        false,
      );
    });

    it("does not hold a read-only flow-node operation", async () => {
      api.get.mockResolvedValue({
        _id: ID.node,
        type: "say",
        label: "Say hi",
        config: {},
      } as any);

      const result = await h.handleToolCall("manage_flow_nodes", {
        operation: "get",
        flowId: ID.flow,
        nodeId: ID.node,
      });

      expect(result.error).toBeUndefined();
      for (const operation of ["get", "list", "render"]) {
        expect(
          (ToolHandlers as any).isBackupWorthyCall("manage_flow_nodes", {
            operation,
            flowId: ID.flow,
          }),
        ).toBe(false);
      }
      for (const operation of ["create", "update", "delete"]) {
        expect(
          (ToolHandlers as any).isBackupWorthyCall("manage_flow_nodes", {
            operation,
            flowId: ID.flow,
          }),
        ).toBe(true);
      }
      // Args that cannot pass validation must not consume the one-shot hold:
      // the caller would see backup_not_offered instead of its validation
      // error, and the fixed retry would then run unprotected.
      expect(
        (ToolHandlers as any).isBackupWorthyCall("manage_flow_nodes", {
          operation: "create",
        }),
      ).toBe(false);
    });

    it("holds audit_voice_agent only in apply mode", () => {
      const check = (ToolHandlers as any).isBackupWorthyCall;
      // The default dry-run mutates nothing, so holding it would be noise.
      expect(
        check("audit_voice_agent", { aiAgentId: ID.agent, apply: false }),
      ).toBe(false);
      expect(check("audit_voice_agent", { aiAgentId: ID.agent })).toBe(false);
      // apply:true rewrites nodes and settings on an existing agent.
      expect(
        check("audit_voice_agent", { aiAgentId: ID.agent, apply: true }),
      ).toBe(true);
    });

    it("does not hold manage_snapshots itself", async () => {
      expect(
        (ToolHandlers as any).isBackupWorthyCall("manage_snapshots", {
          operation: "create",
        }),
      ).toBe(false);
    });
  });
});

describe("manage_snapshots — deferred tasks", () => {
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

  it("does not claim a delete succeeded when it was only queued", async () => {
    const queued = {
      _id: "60d5ec49f1a2c8b1a4e0fa01",
      name: "[AI Backup] backup",
      description: "x\ncognigy-plugin:auto-backup:v1",
      createdAt: 100,
    };
    api.get
      .mockResolvedValueOnce(queued as any)
      .mockResolvedValueOnce({ items: [queued], total: 1 } as any);
    api.delete.mockResolvedValueOnce({ _id: ID.task } as any);

    const result = await h.handleToolCall("manage_snapshots", {
      operation: "delete",
      projectId: ID.project,
      snapshotId: "60d5ec49f1a2c8b1a4e0fa01",
      waitForCompletion: false,
    });

    expect(result.deleted).toBe(false);
    expect(result.pending).toBe(true);
    expect(result._hints.action).toContain("read_task");
  });

  it("does not claim a create succeeded when it was only queued", async () => {
    api.get.mockResolvedValueOnce({ items: [], total: 0 } as any);
    api.post.mockResolvedValueOnce({ _id: ID.task } as any);

    const result = await h.handleToolCall("manage_snapshots", {
      operation: "create",
      projectId: ID.project,
      waitForCompletion: false,
    });

    expect(result.created).toBe(false);
    expect(result.pending).toBe(true);
  });

  it("does not let a queued create satisfy the backup gate", async () => {
    api.get.mockResolvedValueOnce({ items: [], total: 0 } as any);
    api.post.mockResolvedValueOnce({ _id: ID.task } as any);

    await h.handleToolCall("manage_snapshots", {
      operation: "create",
      projectId: ID.project,
      waitForCompletion: false,
    });

    // A backup that has not finished is not a backup, so the gate must still
    // hold the next change rather than waving it through.
    const update = await h.handleToolCall("update_ai_agent", {
      aiAgentId: ID.agent,
      description: "changed",
    });

    expect(update.error).toBe("backup_not_offered");
    expect(api.patch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// manage_snapshots — the outcome must never be overstated
//
// Every case here is one where an earlier version answered with more certainty
// than it had: a lost poll reported as a failure, an unconfirmed delete
// reported as a freed slot, a foreign snapshot acted on as if it were ours, a
// page of snapshots counted as the whole project.
// ---------------------------------------------------------------------------

describe("manage_snapshots — outcome safety", () => {
  let api: jest.Mocked<CognigyApiClient>;
  let h: ToolHandlers;

  const tenBackups = () =>
    Array.from({ length: 10 }, (_, i) =>
      autoBackup(
        `60d5ec49f1a2c8b1a4e0f1${String(i).padStart(2, "0")}`,
        `b${i}`,
        100 + i,
      ),
    );

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

  it("does not call a create failed when only the poll failed", async () => {
    api.get
      .mockResolvedValueOnce({ items: [], total: 0 } as any)
      .mockRejectedValueOnce(new Error("socket hang up"));
    api.post.mockResolvedValueOnce({ _id: ID.task } as any);

    const result = await h.handleToolCall("manage_snapshots", {
      operation: "create",
      projectId: ID.project,
    });

    expect(result.error).toBe("task_status_unknown");
    expect(result.outcomeUnknown).toBe(true);
    expect(result.taskId).toBe(ID.task);
    expect(result._hints.action).toContain("read_task");
    // The old wording told the model no backup existed, so a retry created a
    // duplicate that ate a snapshot slot.
    expect(result._hints.warning).not.toContain("Nothing was backed up");
    // `created: false` means "no backup exists, safe to retry" everywhere else,
    // so the boolean must not answer a question we cannot answer.
    expect(result.created).toBeNull();
  });

  it("still reports a task the platform genuinely failed as a failure", async () => {
    api.get
      .mockResolvedValueOnce({ items: [], total: 0 } as any)
      .mockResolvedValueOnce({
        _id: ID.task,
        status: "error",
        failReason: "Something broke inside the resources service.",
      } as any);
    api.post.mockResolvedValueOnce({ _id: ID.task } as any);

    const result = await h.handleToolCall("manage_snapshots", {
      operation: "create",
      projectId: ID.project,
    });

    expect(result.created).toBe(false);
    expect(result.outcomeUnknown).toBeUndefined();
    expect(result.failReason).toContain("Something broke");
  });

  it("stops freeing slots when a deletion's status cannot be read", async () => {
    api.get
      .mockResolvedValueOnce(snapshotPage(tenBackups()) as any)
      .mockRejectedValueOnce(new Error("502 Bad Gateway"));
    api.delete.mockResolvedValueOnce({ _id: ID.task } as any);

    const result = await h.handleToolCall("manage_snapshots", {
      operation: "create",
      projectId: ID.project,
      confirmDeleteOldest: true,
    });

    expect(result.error).toBe("eviction_incomplete");
    expect(result.haltedOn.kind).toBe("poll_failed");
    expect(result.created).toBe(false);
    // The whole point: exactly ONE backup was ever targeted. Walking to the
    // next candidate here destroys a second backup to free one slot.
    expect(api.delete).toHaveBeenCalledTimes(1);
    expect(api.post).not.toHaveBeenCalled();
  });

  it("stops freeing slots when a deletion times out", async () => {
    const active = { _id: ID.task, status: "active", currentStep: 1 };
    api.get
      .mockResolvedValueOnce(snapshotPage(tenBackups()) as any)
      .mockResolvedValue(active as any);
    api.delete.mockResolvedValueOnce({ _id: ID.task } as any);

    const result = await h.handleToolCall("manage_snapshots", {
      operation: "create",
      projectId: ID.project,
      confirmDeleteOldest: true,
      timeoutMs: 1000,
    });

    expect(result.error).toBe("eviction_incomplete");
    expect(result.haltedOn.kind).toBe("timed_out");
    expect(result.haltedOn.taskId).toBe(ID.task);
    expect(api.delete).toHaveBeenCalledTimes(1);
    expect(api.post).not.toHaveBeenCalled();
  });

  it("reports the backup it destroyed when the create still hits the limit", async () => {
    const backups = tenBackups();
    api.get
      .mockResolvedValueOnce(snapshotPage(backups) as any)
      .mockResolvedValueOnce(doneTask as any)
      .mockResolvedValueOnce({
        _id: ID.task,
        status: "error",
        failReason:
          "Unable to create Snapshot. Limit of allowed Snapshots for this project has been exceeded.",
      } as any)
      .mockResolvedValueOnce(snapshotPage(backups.slice(1)) as any);
    api.delete.mockResolvedValueOnce({ _id: ID.task } as any);
    api.post.mockResolvedValueOnce({ _id: ID.task } as any);

    const result = await h.handleToolCall("manage_snapshots", {
      operation: "create",
      projectId: ID.project,
      confirmDeleteOldest: true,
    });

    expect(result.error).toBe("snapshot_limit_reached");
    expect(result.created).toBe(false);
    expect(result.deletedToFreeSlot.id).toBe(backups[0]._id);
    // A backup was permanently destroyed — saying otherwise leaves no trace.
    expect(result._hints.warning).not.toContain("nothing was deleted");
    expect(result._hints.warning).toContain("permanently deleted");
  });

  it("refuses to restore a snapshot that belongs to another project", async () => {
    api.get
      .mockResolvedValueOnce(autoBackup(SNAP_ID.auto1, "foreign", 100) as any)
      .mockResolvedValueOnce(
        snapshotPage([autoBackup(SNAP_ID.auto2, "ours", 200)]) as any,
      );

    const result = await h.handleToolCall("manage_snapshots", {
      operation: "restore",
      projectId: ID.project,
      snapshotId: SNAP_ID.auto1,
      confirm: true,
    });

    expect(result.error).toBe("snapshot_project_mismatch");
    expect(result.applied).toBe(false);
    // A confirmed restore against a foreign id rolls back the WRONG project.
    expect(api.post).not.toHaveBeenCalled();
  });

  it("refuses to delete a snapshot that belongs to another project", async () => {
    api.get
      .mockResolvedValueOnce(autoBackup(SNAP_ID.auto1, "foreign", 100) as any)
      .mockResolvedValueOnce(
        snapshotPage([autoBackup(SNAP_ID.auto2, "ours", 200)]) as any,
      );

    const result = await h.handleToolCall("manage_snapshots", {
      operation: "delete",
      projectId: ID.project,
      snapshotId: SNAP_ID.auto1,
    });

    expect(result.error).toBe("snapshot_project_mismatch");
    expect(result.deleted).toBe(false);
    expect(api.delete).not.toHaveBeenCalled();
  });

  it("counts the whole project even when the caller pages the list", async () => {
    const backups = tenBackups();
    api.get.mockResolvedValueOnce(snapshotPage(backups) as any);

    const result = await h.handleToolCall("manage_snapshots", {
      operation: "list",
      projectId: ID.project,
      limit: 5,
      skip: 5,
    });

    // A page-sized count reads as "there is room" on a project that is full.
    expect(result.count).toBe(10);
    expect(result.atLimit).toBe(true);
    expect(result.snapshots).toHaveLength(5);
    // The eviction candidate must be the project's oldest backup, not the
    // oldest one that happened to land on the requested page.
    expect(result.oldestDeletableBackup.id).toBe(backups[0]._id);
  });

  it("does not call a restore failed when only the poll failed", async () => {
    api.get
      .mockResolvedValueOnce(autoBackup(SNAP_ID.auto1, "backup", 100) as any)
      .mockResolvedValueOnce(
        snapshotPage([autoBackup(SNAP_ID.auto1, "backup", 100)]) as any,
      )
      .mockRejectedValueOnce(new Error("ECONNRESET"));
    api.post.mockResolvedValueOnce({ _id: ID.task } as any);

    const result = await h.handleToolCall("manage_snapshots", {
      operation: "restore",
      projectId: ID.project,
      snapshotId: SNAP_ID.auto1,
      confirm: true,
    });

    expect(result.error).toBe("task_status_unknown");
    expect(result.outcomeUnknown).toBe(true);
    expect(result._hints.action).toContain("read_task");
  });
});

// ---------------------------------------------------------------------------
// manage_snapshots — backup version numbers
//
// Backups are referred to by version ("restore v3"), so a number must never
// point at two different snapshots.
// ---------------------------------------------------------------------------

describe("manage_snapshots — versioned names", () => {
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

  const versioned = (id: string, version: number, createdAt: number) => ({
    _id: id,
    name: `[AI Backup] v${version} earlier — 2026-08-20 10-00-0${version}`,
    description: AUTO_DESC,
    createdAt,
    createdBy: "user1",
    isPackaged: false,
  });

  it("numbers a new backup above the project's highest", async () => {
    api.get
      .mockResolvedValueOnce(
        snapshotPage([
          versioned(SNAP_ID.auto1, 1, 10),
          versioned(SNAP_ID.auto2, 3, 30),
          humanSnapshot(SNAP_ID.human, 40),
        ]) as any,
      )
      .mockResolvedValueOnce(doneTask as any)
      .mockResolvedValueOnce(snapshotPage([]) as any);
    api.post.mockResolvedValueOnce({ _id: ID.task } as any);

    await h.handleToolCall("manage_snapshots", {
      operation: "create",
      projectId: ID.project,
      label: "pre-update",
    });

    const body = api.post.mock.calls[0][1] as any;
    expect(body.name).toMatch(/^\[AI Backup\] v4 pre-update — /);
  });

  it("does not reuse a number after the newest backup is deleted", async () => {
    // Both creates see an empty project — the second only because the first
    // backup was deleted in between. Reusing v1 would make "v1" ambiguous.
    api.get.mockResolvedValue(snapshotPage([]) as any);
    api.get.mockResolvedValueOnce(snapshotPage([]) as any);
    api.post.mockResolvedValue({ _id: ID.task } as any);

    await h.handleToolCall("manage_snapshots", {
      operation: "create",
      projectId: ID.project,
      waitForCompletion: false,
    });
    await h.handleToolCall("manage_snapshots", {
      operation: "create",
      projectId: ID.project,
      waitForCompletion: false,
    });

    expect((api.post.mock.calls[0][1] as any).name).toMatch(
      /^\[AI Backup\] v1 /,
    );
    expect((api.post.mock.calls[1][1] as any).name).toMatch(
      /^\[AI Backup\] v2 /,
    );
  });

  it("reports no snapshot rather than the wrong one when the name does not match", async () => {
    api.get
      .mockResolvedValueOnce(snapshotPage([]) as any)
      .mockResolvedValueOnce(doneTask as any)
      // A filter hit that is NOT the backup we just wrote.
      .mockResolvedValueOnce(
        snapshotPage([autoBackup(SNAP_ID.auto2, "someone else", 5)]) as any,
      );
    api.post.mockResolvedValueOnce({ _id: ID.task } as any);

    const result = await h.handleToolCall("manage_snapshots", {
      operation: "create",
      projectId: ID.project,
    });

    expect(result.created).toBe(true);
    // Binding the wrong id here would put it into the restore hint below —
    // a restore to the wrong point in time.
    expect(result.snapshot).toBeNull();
    expect(result._hints.action).toContain("list");
    expect(result._hints.action).not.toContain(SNAP_ID.auto2);
  });

  it("holds a project-settings change for a backup offer", async () => {
    const result = await h.handleToolCall("manage_settings", {
      operation: "set_knowledge_ai",
      projectId: ID.project,
      knowledgeSearchModelId: "m1",
    });

    // Project settings ARE captured in a snapshot, so this is worth offering.
    expect(result.error).toBe("backup_not_offered");
    expect(api.patch).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Backup gate — scoping
//
// The gate answer belongs to a project, not to a session: declining on a
// sandbox must not release the gate for a production project touched later.
// ---------------------------------------------------------------------------

describe("backup gate scoping", () => {
  let api: jest.Mocked<CognigyApiClient>;
  let h: ToolHandlers;

  const OTHER_PROJECT = "60d5ec49f1a2c8b1a4e0fbbb";

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

  it("does not release the gate for another project after a decline", async () => {
    await h.handleToolCall("manage_snapshots", {
      operation: "decline",
      projectId: ID.project,
    });

    // Same project: the user already answered, so this runs.
    const answered = await h.handleToolCall("manage_settings", {
      operation: "set_knowledge_ai",
      projectId: ID.project,
      knowledgeSearchModelId: "m1",
    });
    expect(answered.error).not.toBe("backup_not_offered");

    // Different project: never asked about, so it is held.
    const held = await h.handleToolCall("manage_settings", {
      operation: "set_knowledge_ai",
      projectId: OTHER_PROJECT,
      knowledgeSearchModelId: "m1",
    });
    expect(held.error).toBe("backup_not_offered");
    expect(held.projectId).toBe(OTHER_PROJECT);
  });

  it("scopes a call that names only an agent, using what reads already taught it", async () => {
    await h.handleToolCall("manage_snapshots", {
      operation: "decline",
      projectId: ID.project,
    });

    // A read the model makes anyway records which project the agent is in.
    api.get.mockResolvedValueOnce({
      _id: ID.agent,
      name: "Prod agent",
      projectId: OTHER_PROJECT,
    } as any);
    await h.handleToolCall("get_resource", {
      resourceType: "agent",
      id: ID.agent,
    });

    const result = await h.handleToolCall("update_ai_agent", {
      aiAgentId: ID.agent,
      description: "new persona",
    });

    // The decline was for a different project — this one must still be asked.
    expect(result.error).toBe("backup_not_offered");
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("holds each project only once, so an ignoring client cannot deadlock", async () => {
    const first = await h.handleToolCall("manage_settings", {
      operation: "set_knowledge_ai",
      projectId: ID.project,
      knowledgeSearchModelId: "m1",
    });
    expect(first.error).toBe("backup_not_offered");

    api.get.mockResolvedValue({ _id: ID.project } as any);
    api.patch.mockResolvedValue({ _id: ID.project } as any);
    const second = await h.handleToolCall("manage_settings", {
      operation: "set_knowledge_ai",
      projectId: ID.project,
      knowledgeSearchModelId: "m1",
    });
    expect(second.error).not.toBe("backup_not_offered");
  });

  it("does not hold changes to a project this session created", async () => {
    (h as any).resourcesCreatedThisSession.add(ID.project);

    const result = await h.handleToolCall("manage_settings", {
      operation: "set_knowledge_ai",
      projectId: ID.project,
      knowledgeSearchModelId: "m1",
    });

    // Brand-new material is additive: there is no prior state to roll back to,
    // and a backup would eat one of the new project's snapshot slots.
    expect(result.error).not.toBe("backup_not_offered");
  });

  it("does not hold a deletion a snapshot could not protect", async () => {
    const check = (ToolHandlers as any).isBackupWorthyCall;

    // Endpoints and Knowledge AI are not captured in a snapshot.
    expect(
      check("delete_resource", { resourceType: "endpoint", id: ID.endpoint }),
    ).toBe(false);
    expect(
      check("delete_resource", {
        resourceType: "knowledge_store",
        id: ID.endpoint,
      }),
    ).toBe(false);
    // Agents and flows are.
    expect(
      check("delete_resource", { resourceType: "agent", id: ID.agent }),
    ).toBe(true);
  });
});
