import { describe, it, expect, beforeEach, jest } from "@jest/globals";

// talk_to_agent posts to the endpoint with a bare axios call (not the
// CognigyApiClient), so mock the module to observe which URL it targets.
const post = jest.fn<(...args: any[]) => Promise<any>>();
jest.unstable_mockModule("axios", () => ({
  default: { post },
}));

const { ToolHandlers } = await import("../tools/handlers.js");

const PROD = "https://endpoint-trial.cognigy.ai/abc123token";
const TEST = "https://endpoint-trial.cognigy.ai/test/abc123token";

const httpError = (status: number, error = "nope") => {
  const err: any = new Error(`Request failed with status code ${status}`);
  err.response = { status, data: { error } };
  return err;
};

describe("talk_to_agent — endpoint test mode", () => {
  let h: InstanceType<typeof ToolHandlers>;

  beforeEach(() => {
    post.mockReset();
    h = new ToolHandlers(
      {
        get: jest.fn(),
        post: jest.fn(),
        patch: jest.fn(),
        delete: jest.fn(),
      } as any,
      "https://endpoint-trial.cognigy.ai",
      "",
      "https://static-trial.cognigy.ai",
    );
  });

  it("sends to the /test/ URL variant by default", async () => {
    post.mockResolvedValueOnce({ data: { text: "hello" } });

    const result = await h.handleTalkToAgent({
      endpointUrl: PROD,
      message: "Hi",
    });

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe(TEST);
    expect(result.agentResponse).toBe("hello");
    expect(result.endpointUrl).toBe(TEST);
    expect(result.testMode).toBe(true);
    expect(result.testModeFallback).toBeUndefined();
    expect(result._hints).toBeUndefined();
  });

  it("does not double-prefix an endpointUrl that is already in test mode", async () => {
    post.mockResolvedValueOnce({ data: { text: "hello" } });

    await h.handleTalkToAgent({ endpointUrl: TEST, message: "Hi" });

    expect(post.mock.calls[0][0]).toBe(TEST);
  });

  it("falls back to the regular endpoint when the platform rejects test mode, and warns", async () => {
    post
      .mockRejectedValueOnce(httpError(404, "Endpoint not found"))
      .mockResolvedValueOnce({ data: { text: "billed hello" } });

    const result = await h.handleTalkToAgent({
      endpointUrl: PROD,
      message: "Hi",
    });

    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0][0]).toBe(TEST);
    expect(post.mock.calls[1][0]).toBe(PROD);
    // Same payload both times.
    expect(post.mock.calls[1][1]).toEqual(post.mock.calls[0][1]);

    expect(result.agentResponse).toBe("billed hello");
    expect(result.endpointUrl).toBe(PROD);
    expect(result.testMode).toBe(false);
    expect(result.testModeFallback).toEqual({
      status: 404,
      detail: "Endpoint not found",
      testModeUrl: TEST,
    });
    expect(result._hints.warning).toMatch(/billable/i);
    expect(result._hints.warning).toContain("404");
  });

  it("keeps the fallback warning alongside the empty-response hints", async () => {
    post
      .mockRejectedValueOnce(httpError(429))
      .mockResolvedValueOnce({ data: { text: "" } });

    const result = await h.handleTalkToAgent({
      endpointUrl: PROD,
      message: "Hi",
    });

    expect(result._hints.warning).toContain("429");
    expect(result._hints.likely_cause).toContain("no text");
  });

  it("does not fall back on network-level failures", async () => {
    const netErr: any = new Error("timeout of 30000ms exceeded");
    netErr.code = "ECONNABORTED";
    post.mockRejectedValueOnce(netErr);

    const result = await h.handleTalkToAgent({
      endpointUrl: PROD,
      message: "Hi",
    });

    expect(post).toHaveBeenCalledTimes(1);
    expect(result.error).toBe("Request failed with status unknown");
    expect(result.detail).toContain("timeout");
    expect(result.endpointUrl).toBe(TEST);
  });

  it("reports the fallback when the regular endpoint fails too", async () => {
    post
      .mockRejectedValueOnce(httpError(404))
      .mockRejectedValueOnce(httpError(500, "boom"));

    const result = await h.handleTalkToAgent({
      endpointUrl: PROD,
      message: "Hi",
    });

    expect(post).toHaveBeenCalledTimes(2);
    expect(result.error).toBe("Request failed with status 500");
    expect(result.endpointUrl).toBe(PROD);
    expect(result.testModeFallback.status).toBe(404);
  });

  it("testMode: false sends straight to the regular endpoint and never retries", async () => {
    post.mockRejectedValueOnce(httpError(404));

    const result = await h.handleTalkToAgent({
      endpointUrl: PROD,
      message: "Hi",
      testMode: false,
    });

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe(PROD);
    expect(result.error).toBe("Request failed with status 404");
    expect(result.testModeFallback).toBeUndefined();
  });

  it("builds the test-mode URL from a resolved endpoint's URLToken", async () => {
    const api = (h as any).apiClient;
    api.get
      .mockResolvedValueOnce({
        _id: "60d5ec49f1a2c8b1a4e0f001",
        name: "Test Agent",
        flowId: "60d5ec49f1a2c8b1a4e0f002",
        projectId: "507f1f77bcf86cd799439011",
      })
      .mockResolvedValueOnce({
        _id: "60d5ec49f1a2c8b1a4e0f002",
        referenceId: "ref-flow-uuid",
      })
      .mockResolvedValueOnce({
        items: [
          {
            _id: "60d5ec49f1a2c8b1a4e0f003",
            channel: "rest",
            flowId: "60d5ec49f1a2c8b1a4e0f002",
            URLToken: "abc123token",
          },
        ],
      });
    post.mockResolvedValueOnce({ data: { text: "hi" } });

    const result = await h.handleTalkToAgent({
      aiAgentId: "60d5ec49f1a2c8b1a4e0f001",
      message: "Hi",
    });

    expect(post.mock.calls[0][0]).toBe(TEST);
    expect(result.endpointResolved).toBe(true);
    expect(result.testMode).toBe(true);
  });
});
