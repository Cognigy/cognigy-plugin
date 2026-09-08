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
const SESSION = "sess-fixed-1";

const httpError = (status: number, error = "nope") => {
  const err: any = new Error(`Request failed with status code ${status}`);
  err.response = { status, data: { error } };
  return err;
};

const mockApi = () =>
  ({
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  }) as any;

describe("talk_to_agent — endpoint test mode", () => {
  let h: InstanceType<typeof ToolHandlers>;

  beforeEach(() => {
    post.mockReset();
    h = new ToolHandlers(
      mockApi(),
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
    expect(result._hints).toBeUndefined();
  });

  it("does not double-prefix an endpointUrl that is already in test mode", async () => {
    post.mockResolvedValueOnce({ data: { text: "hello" } });

    await h.handleTalkToAgent({ endpointUrl: TEST, message: "Hi" });

    expect(post.mock.calls[0][0]).toBe(TEST);
  });

  it("keeps the empty-response hints in test mode", async () => {
    post.mockResolvedValueOnce({ data: { text: "" } });

    const result = await h.handleTalkToAgent({
      endpointUrl: PROD,
      message: "Hi",
    });

    expect(result.testMode).toBe(true);
    expect(result._hints.likely_cause).toContain("no text");
  });

  it("testMode: false sends straight to the regular endpoint", async () => {
    post.mockResolvedValueOnce({ data: { text: "billed hello" } });

    const result = await h.handleTalkToAgent({
      endpointUrl: PROD,
      message: "Hi",
      testMode: false,
    });

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe(PROD);
    expect(result.endpointUrl).toBe(PROD);
    expect(result.testMode).toBe(false);
  });

  it("testMode: false strips a /test/ segment from a supplied URL", async () => {
    post.mockResolvedValueOnce({ data: { text: "billed hello" } });

    await h.handleTalkToAgent({
      endpointUrl: TEST,
      message: "Hi",
      testMode: false,
    });

    expect(post.mock.calls[0][0]).toBe(PROD);
  });

  // No status is ever replayed on the billable URL: an Execution Finished
  // transformer can set any status after the flow ran, so even a 404 does not
  // prove nothing was processed. Every failure must come back as an error
  // after a single request, and every hint must put the outcome check first.
  describe("never replays a failed test-mode request", () => {
    const outcomeCheck = new RegExp(
      `FIRST establish whether the original message was processed: get_resource \\{ resourceType: 'conversation', id: '${SESSION}' \\}`,
    );

    const expectSingleUnreplayedAttempt = (
      result: any,
      statusLabel: string,
    ) => {
      expect(post).toHaveBeenCalledTimes(1);
      expect(post.mock.calls[0][0]).toBe(TEST);
      expect(result.error).toBe(`Request failed with status ${statusLabel}`);
      expect(result.endpointUrl).toBe(TEST);
      expect(result.testMode).toBe(true);
      expect(result.sessionId).toBe(SESSION);
      expect(result.testModeFallback).toBeUndefined();
      expect(result._hints.warning).toMatch(/does not prove/i);
      expect(result._hints.warning).toMatch(/Execution Finished transformer/);
      expect(result._hints.warning).toMatch(/reusing the sessionId does not/i);
      expect(result._hints.action).toMatch(outcomeCheck);
      // The outcome check comes before any retry advice.
      expect(result._hints.action.indexOf("FIRST establish")).toBe(0);
    };

    const send = (status: number, error?: string) => {
      post.mockRejectedValueOnce(httpError(status, error));
      return h.handleTalkToAgent({
        endpointUrl: PROD,
        message: "Hi",
        sessionId: SESSION,
      });
    };

    it("404: names all three meanings and demands independent confirmation of route absence", async () => {
      const result = await send(404, "Not Found");

      expectSingleUnreplayedAttempt(result, "404");
      expect(result.detail).toBe("Not Found");
      expect(result._hints.likely_cause).toMatch(/three possible meanings/i);
      expect(result._hints.likely_cause).toMatch(/older than Cognigy 4\.27/);
      expect(result._hints.likely_cause).toMatch(/AFTER the flow ran/);
      expect(result._hints.action).toMatch(
        /confirm route absence independently/i,
      );
      expect(result._hints.action).toMatch(
        /no Execution Finished transformer is enabled/,
      );
      expect(result._hints.action).toMatch(/testMode: false.*explicit consent/);
    });

    it("504 gateway timeout: retry advice only after the outcome check", async () => {
      const result = await send(504, "Gateway Time-out");

      expectSingleUnreplayedAttempt(result, "504");
      expect(result._hints.likely_cause).toMatch(/may have reached the flow/i);
      expect(result._hints.action).toMatch(
        /Only if it was not processed, retry/,
      );
    });

    it("500: same treatment as any other 5xx", async () => {
      const result = await send(500, "boom");

      expectSingleUnreplayedAttempt(result, "500");
      expect(result._hints.likely_cause).toMatch(/may have reached the flow/i);
    });

    it("400: points at the endpoint/payload, not at test mode", async () => {
      const result = await send(400, "Bad Request");

      expectSingleUnreplayedAttempt(result, "400");
      expect(result._hints.likely_cause).toMatch(/unknown URL token/i);
      expect(result._hints.likely_cause).toMatch(/does NOT by itself mean/);
      expect(result._hints.action).toContain("list_resources");
    });

    it("429: asks to pause, never to switch to billable", async () => {
      const result = await send(429, "Too Many Requests");

      expectSingleUnreplayedAttempt(result, "429");
      expect(result._hints.likely_cause).toMatch(/throttling/i);
      expect(result._hints.likely_cause).toMatch(/does not document/i);
      expect(result._hints.action).toMatch(/pause/i);
      expect(result._hints.action).toMatch(/Do not switch to testMode: false/);
    });

    it("403: does not equate it with an exhausted test budget", async () => {
      const result = await send(403, "Forbidden");

      expectSingleUnreplayedAttempt(result, "403");
      expect(result._hints.likely_cause).toMatch(
        /Do not read it as an exhausted/,
      );
    });

    it("network-level failure: outcome check first, no billable suggestion", async () => {
      const netErr: any = new Error("timeout of 30000ms exceeded");
      netErr.code = "ECONNABORTED";
      post.mockRejectedValueOnce(netErr);

      const result = await h.handleTalkToAgent({
        endpointUrl: PROD,
        message: "Hi",
        sessionId: SESSION,
      });

      expectSingleUnreplayedAttempt(result, "unknown");
      expect(result.detail).toContain("timeout");
      expect(result._hints.likely_cause).toMatch(/not a test-mode rejection/i);
      expect(result._hints.action).not.toContain("testMode: false");
    });
  });

  it("testMode: false failures get the same outcome-first hints without test-mode talk", async () => {
    post.mockRejectedValueOnce(httpError(404));

    const result = await h.handleTalkToAgent({
      endpointUrl: PROD,
      message: "Hi",
      testMode: false,
      sessionId: SESSION,
    });

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe(PROD);
    expect(result.error).toBe("Request failed with status 404");
    expect(result.testMode).toBe(false);
    expect(result.testModeFallback).toBeUndefined();
    expect(result._hints.action.indexOf("FIRST establish")).toBe(0);
    expect(result._hints.likely_cause).not.toMatch(/\/test\//);
    expect(result._hints.action).not.toContain("testMode: false");
  });

  it("returns a structured error instead of throwing when the endpoint base URL is malformed", async () => {
    const broken = new ToolHandlers(
      mockApi(),
      "endpoint-trial.cognigy.ai", // no scheme → not an absolute URL
      "",
      "https://static-trial.cognigy.ai",
    );
    const api = (broken as any).apiClient;
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

    const result = await broken.handleTalkToAgent({
      aiAgentId: "60d5ec49f1a2c8b1a4e0f001",
      message: "Hi",
    });

    expect(post).not.toHaveBeenCalled();
    expect(result.error).toBe("Endpoint URL is not a valid absolute URL.");
    expect(result.endpointUrl).toBe("endpoint-trial.cognigy.ai/abc123token");
    expect(result._hints.likely_cause).toContain("COGNIGY_ENDPOINT_BASE_URL");
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
