import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type { CognigyApiClient } from "../api/client.js";

const axiosGet = jest.fn();
jest.unstable_mockModule("axios", () => ({
  default: { get: axiosGet },
}));

const { ToolHandlers } = await import("../tools/handlers.js");

const ID = {
  project: "507f1f77bcf86cd799439011",
  flow: "60d5ec49f1a2c8b1a4e0f002",
  endpoint: "60d5ec49f1a2c8b1a4e0f003",
};

describe("manage_a2a_server", () => {
  let api: jest.Mocked<CognigyApiClient>;
  let h: InstanceType<typeof ToolHandlers>;

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
    axiosGet.mockReset();
  });

  const mockEndpoint = {
    _id: ID.endpoint,
    name: "Flights Agent A2A Server",
    channel: "a2aServer",
    URLToken: "tok-abc123",
    settings: {},
  };

  it("creates an endpoint and reports liveCheck when the Agent Card is reachable", async () => {
    api.get
      .mockResolvedValueOnce({}) // flow lookup (no localeReference)
      .mockResolvedValueOnce({ items: [] }) // locale fallback list (empty)
      .mockResolvedValueOnce(mockEndpoint) // re-fetch after create
      .mockResolvedValueOnce(mockEndpoint); // re-fetch after settings patch
    api.post.mockResolvedValueOnce({ _id: ID.endpoint });
    axiosGet.mockResolvedValueOnce({
      data: { name: "Flights Agent", skills: [{ id: "book-flight" }] },
    });

    const result = await h.handleToolCall("manage_a2a_server", {
      projectId: ID.project,
      flowId: ID.flow,
      name: "Flights Agent A2A Server",
      agentName: "Flights Agent",
    });

    expect(result.created).toBe(true);
    expect(result.agentBaseUrl).toBe(
      "https://endpoint-trial.cognigy.ai/a2a/v1/tok-abc123",
    );
    expect(result.agentCardUrl).toBe(
      "https://endpoint-trial.cognigy.ai/a2a/v1/tok-abc123/.well-known/agent.json",
    );
    expect(result.liveCheck).toEqual({
      reachable: true,
      agentName: "Flights Agent",
      skills: ["book-flight"],
    });
    expect(axiosGet).toHaveBeenCalledWith(
      "https://endpoint-trial.cognigy.ai/a2a/v1/tok-abc123/.well-known/agent.json",
      { timeout: 5000 },
    );
  });

  it("skips the live check when the endpoint requires authentication", async () => {
    const authEndpoint = {
      ...mockEndpoint,
      settings: {
        a2aServerEndpointAuthentication: { authenticationType: "apiKey" },
      },
    };
    api.get
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce(authEndpoint)
      .mockResolvedValueOnce(authEndpoint);
    api.post.mockResolvedValueOnce({ _id: ID.endpoint });

    const result = await h.handleToolCall("manage_a2a_server", {
      projectId: ID.project,
      flowId: ID.flow,
      authenticationType: "apiKey",
    });

    expect(result.created).toBe(true);
    expect(result.liveCheck).toEqual({
      skipped: true,
      reason: expect.stringContaining("authentication"),
    });
    expect(axiosGet).not.toHaveBeenCalled();
  });

  it("reports unreachable when the Agent Card fetch fails", async () => {
    api.get
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce(mockEndpoint);
    api.post.mockResolvedValueOnce({ _id: ID.endpoint });
    axiosGet.mockRejectedValueOnce({ response: { status: 404 } });

    const result = await h.handleToolCall("manage_a2a_server", {
      projectId: ID.project,
      flowId: ID.flow,
    });

    expect(result.liveCheck).toEqual({ reachable: false, error: "HTTP 404" });
  });

  it("applies a flowId-only update instead of treating it as a no-op", async () => {
    api.get
      .mockResolvedValueOnce(mockEndpoint) // full endpoint fetch before patch
      .mockResolvedValueOnce({ ...mockEndpoint, flowId: "new-flow-ref" }); // re-fetch after patch
    axiosGet.mockResolvedValueOnce({ data: {} });

    const result = await h.handleToolCall("manage_a2a_server", {
      endpointId: ID.endpoint,
      flowId: "new-flow-ref",
    });

    expect(result.updated).toBe(true);
    expect(api.patch).toHaveBeenCalledWith(
      `/v2.0/endpoints/${ID.endpoint}`,
      expect.objectContaining({ flowId: "new-flow-ref" }),
    );
  });

  it("returns current info with a note when nothing is requested to change", async () => {
    api.get.mockResolvedValueOnce(mockEndpoint);
    axiosGet.mockResolvedValueOnce({ data: {} });

    const result = await h.handleToolCall("manage_a2a_server", {
      endpointId: ID.endpoint,
    });

    expect(result.note).toContain("No changes requested");
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("handles settings patch failure on create (partial success)", async () => {
    api.get
      .mockResolvedValueOnce({}) // flow lookup (no localeReference)
      .mockResolvedValueOnce({ items: [] }) // locale fallback list (empty)
      .mockResolvedValueOnce(mockEndpoint); // re-fetch after create
    api.post.mockResolvedValueOnce({ _id: ID.endpoint });
    api.patch.mockRejectedValueOnce(new Error("Settings validation failed"));
    axiosGet.mockResolvedValueOnce({ data: {} });

    const result = await h.handleToolCall("manage_a2a_server", {
      projectId: ID.project,
      flowId: ID.flow,
      agentName: "Flights Agent",
    });

    expect(result.created).toBe(true);
    expect(result._hints).toBeDefined();
    expect(result._hints.warning).toContain("settings failed to apply");
  });

  it("returns error when creation fails", async () => {
    api.get.mockResolvedValueOnce({}).mockResolvedValueOnce({ items: [] });
    api.post.mockRejectedValueOnce(new Error("Quota exceeded"));

    const result = await h.handleToolCall("manage_a2a_server", {
      projectId: ID.project,
      flowId: ID.flow,
    });

    expect(result.error).toContain("Failed to create A2A server endpoint");
  });

  it("returns error when update fails", async () => {
    api.get.mockRejectedValueOnce(new Error("Server error")); // full fetch fails

    const result = await h.handleToolCall("manage_a2a_server", {
      endpointId: ID.endpoint,
      name: "Fail Update",
    });

    expect(result.error).toContain("Failed to update A2A server endpoint");
  });
});
