/**
 * Tests for the project-log read surface: list_resources / get_resource
 * { resourceType: 'log' } and the traceId that talk_to_agent returns.
 * Entry shapes are taken from a live trial tenant (Cognigy 2026.23).
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";

// talk_to_agent posts with a bare axios call, so mock the module.
const post = jest.fn<(...args: any[]) => Promise<any>>();
jest.unstable_mockModule("axios", () => ({ default: { post } }));

const { ToolHandlers } = await import("../tools/handlers.js");

const PROJECT = "507f1f77bcf86cd799439011";
const ENTRY_ID = "6aff25711c641dc9023fbcfb";
const SESSION = "mcp-session-4511c5e5-58cb-4002-aa98-814d920efcb0";
const TRACE =
  "endpoint-httpIncomingMessage-26c67db6-bbf8-4613-a3bd-16875862a3d5";
const URL_TOKEN = "80fe00ead7a1";

const entry = (
  id: string,
  timestamp: string,
  type: string,
  msg: string,
  meta: Record<string, unknown> = {},
) => ({ _id: id, timestamp, type, msg, traceId: TRACE, meta });

// Newest first, as the API returns them.
const sessionEntries = [
  entry(
    "6aff00000000000000000003",
    "2026-11-19T16:36:00.003Z",
    "error",
    "Error during message processing",
    {
      sessionId: SESSION,
      traceId: TRACE,
      flowName: "Spike Logs Flow",
      text: "trigger errors",
      error: "Error while executing node of type 'code'",
    },
  ),
  entry(
    "6aff00000000000000000002",
    "2026-11-19T16:36:00.002Z",
    "error",
    "Flow Node - spike: deliberate error",
    {
      sessionId: SESSION,
      traceId: TRACE,
      function: "actions.log()",
    },
  ),
  entry(
    "6aff00000000000000000001",
    "2026-11-19T16:36:00.001Z",
    "info",
    "Received message from user",
    {
      sessionId: SESSION,
      traceId: TRACE,
      text: "trigger errors",
    },
  ),
];

// The node error carries no sessionId: only a traceId read finds it.
const nodeError = entry(
  ENTRY_ID,
  "2026-11-19T16:36:00.0025Z",
  "error",
  "Error while executing node of type 'code' with id 'ce47' and label 'Code throws'. Error was: Cannot read property 'boom' of undefined or null",
  {
    flowName: "Spike Logs Flow",
    nodeId: "ce47d468-8a0e-4c25-9e7f-8294d090e632",
    nodeLabel: "Code throws",
    URLToken: URL_TOKEN,
    originalError: {
      message: "Cannot read property 'boom'",
      stack: "Error: …\n at /app/build/x.js",
    },
  },
);

const httpError = (status: number) => {
  const err: any = new Error(`Request failed with status code ${status}`);
  err.status = status;
  return err;
};

describe("project logs", () => {
  let api: any;
  let h: InstanceType<typeof ToolHandlers>;

  beforeEach(() => {
    post.mockReset();
    api = {
      get: jest.fn(),
      post: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
      put: jest.fn(),
      uploadFile: jest.fn(),
    };
    h = new ToolHandlers(
      api,
      "https://endpoint-trial.cognigy.ai",
      "",
      "https://static-trial.cognigy.ai",
    );
  });

  it("requires a projectId", async () => {
    const result = await h.handleToolCall("list_resources", {
      resourceType: "log",
      sessionId: SESSION,
    });
    expect(result.error).toMatch(/projectId is required/);
    expect(api.get).not.toHaveBeenCalled();
  });

  it("reads a session from the tail route, oldest first, without the conversation text", async () => {
    api.get.mockResolvedValue({
      items: sessionEntries,
      total: -1,
      nextCursor: null,
    });

    const result = await h.handleToolCall("list_resources", {
      resourceType: "log",
      projectId: PROJECT,
      sessionId: SESSION,
    });

    // Without lastTimeWindow the tail reads only the cluster's cutoff.
    expect(api.get).toHaveBeenCalledWith(
      `/v2.1/projects/${PROJECT}/logs/tail`,
      {
        params: { sessionId: SESSION, lastTimeWindow: 12 },
        headers: { "x-cognigy-log-model-version": "v2" },
      },
    );
    expect(result.items.map((e: any) => e.message)).toEqual([
      "Received message from user",
      "Flow Node - spike: deliberate error",
      "Error during message processing",
    ]);
    expect(result.items[2]).toEqual({
      id: "6aff00000000000000000003",
      timestamp: "2026-11-19T16:36:00.003Z",
      level: "error",
      message: "Error during message processing",
      traceId: TRACE,
      flowName: "Spike Logs Flow",
      error: "Error while executing node of type 'code'",
    });
    // -1 is the tail route's "not counted", not a count.
    expect(result.total).toBe(3);
    expect(JSON.stringify(result)).not.toContain("trigger errors");
  });

  it("drops entries of another session the platform did not filter out", async () => {
    api.get.mockResolvedValue({
      items: [
        ...sessionEntries,
        entry(
          "6aff00000000000000000009",
          "2026-11-19T16:30:00.000Z",
          "info",
          "other",
          {
            sessionId: "someone-else",
          },
        ),
      ],
    });

    const result = await h.handleToolCall("list_resources", {
      resourceType: "log",
      projectId: PROJECT,
      sessionId: SESSION,
    });

    expect(result.items).toHaveLength(3);
  });

  it("reads a whole turn by traceId, including entries without a sessionId", async () => {
    api.get.mockResolvedValue({
      items: [
        sessionEntries[0],
        nodeError,
        sessionEntries[1],
        sessionEntries[2],
      ],
      total: 4,
    });

    const result = await h.handleToolCall("list_resources", {
      resourceType: "log",
      projectId: PROJECT,
      traceId: TRACE,
      level: ["error"],
    });

    expect(api.get).toHaveBeenCalledWith(`/v2.1/projects/${PROJECT}/logs`, {
      params: expect.objectContaining({
        filter: TRACE,
        type: ["error"],
        limit: 100,
        skip: 0,
        startDate: expect.any(String),
        endDate: expect.any(String),
      }),
    });
    const { startDate, endDate } = (api.get.mock.calls[0][1] as any).params;
    // Logs are kept 24 hours, so a turn is looked for in the whole window.
    expect(Date.parse(endDate) - Date.parse(startDate)).toBe(24 * 3600e3);
    // The info entry the mock returns despite level: ["error"] is dropped too.
    expect(result.items).toHaveLength(3);
    expect(result.items[1]).toEqual({
      id: ENTRY_ID,
      timestamp: "2026-11-19T16:36:00.0025Z",
      level: "error",
      message: nodeError.msg,
      flowName: "Spike Logs Flow",
      nodeLabel: "Code throws",
    });
    // Every entry shares the requested traceId, so it is not repeated.
    expect(result.items.some((e: any) => "traceId" in e)).toBe(false);
  });

  it("drops entries that only mention the traceId in their message", async () => {
    api.get.mockResolvedValue({
      items: [
        nodeError,
        {
          ...entry(
            "6aff00000000000000000008",
            "2026-11-19T16:37:00.000Z",
            "info",
            `see ${TRACE}`,
          ),
          traceId: "other-trace",
        },
      ],
    });

    const result = await h.handleToolCall("list_resources", {
      resourceType: "log",
      projectId: PROJECT,
      traceId: TRACE,
    });

    expect(result.items.map((e: any) => e.id)).toEqual([ENTRY_ID]);
  });

  it("lists a time window newest first with paging, level and dates passed through", async () => {
    api.get.mockResolvedValue({ items: sessionEntries, total: 42 });

    const result = await h.handleToolCall("list_resources", {
      resourceType: "log",
      projectId: PROJECT,
      level: ["error", "warn"],
      startDate: "2026-11-19T10:00:00.000Z",
      endDate: "2026-11-19T12:00:00.000Z",
      limit: 10,
    });

    expect(api.get).toHaveBeenCalledWith(`/v2.1/projects/${PROJECT}/logs`, {
      params: {
        limit: 10,
        skip: 0,
        type: ["error", "warn"],
        startDate: "2026-11-19T10:00:00.000Z",
        endDate: "2026-11-19T12:00:00.000Z",
      },
    });
    expect(result.items[0].message).toBe("Error during message processing");
    expect(result.total).toBe(42);
  });

  it("falls back to v2.0 on platforms without the v2.1 logs routes", async () => {
    api.get
      .mockRejectedValueOnce(httpError(404))
      .mockResolvedValueOnce({ items: sessionEntries });

    const result = await h.handleToolCall("list_resources", {
      resourceType: "log",
      projectId: PROJECT,
      sessionId: SESSION,
    });

    expect(api.get).toHaveBeenLastCalledWith(
      `/v2.0/projects/${PROJECT}/logs/tail`,
      {
        params: { sessionId: SESSION, lastTimeWindow: 12 },
        headers: { "x-cognigy-log-model-version": "v2" },
      },
    );
    expect(result.items).toHaveLength(3);
  });

  it("on an old platform, also drops the 12-hour window that v2.0 refuses", async () => {
    api.get
      .mockRejectedValueOnce(httpError(404)) // v2.1 tail
      .mockRejectedValueOnce(httpError(400)) // v2.0 tail + lastTimeWindow
      .mockRejectedValueOnce(httpError(404)) // v2.1 tail, no window
      .mockResolvedValueOnce({ items: sessionEntries }); // v2.0 tail

    const result = await h.handleToolCall("list_resources", {
      resourceType: "log",
      projectId: PROJECT,
      sessionId: SESSION,
    });

    expect(api.get).toHaveBeenLastCalledWith(
      `/v2.0/projects/${PROJECT}/logs/tail`,
      { params: { sessionId: SESSION } },
    );
    expect(result.items).toHaveLength(3);
    expect(result._hints.warning).toMatch(/refused the 12-hour window/);
  });

  it("retries a session read without the 12-hour window when the platform refuses it", async () => {
    api.get
      .mockRejectedValueOnce(httpError(400))
      .mockResolvedValueOnce({ items: [] });

    const result = await h.handleToolCall("list_resources", {
      resourceType: "log",
      projectId: PROJECT,
      sessionId: SESSION,
    });

    expect(api.get).toHaveBeenLastCalledWith(
      `/v2.1/projects/${PROJECT}/logs/tail`,
      { params: { sessionId: SESSION } },
    );
    expect(result._hints.warning).toMatch(/default window/);
    expect(result._hints.hint).toMatch(/in the default window/);
  });

  it("explains a 404 that v2.0 cannot answer either", async () => {
    api.get
      .mockRejectedValueOnce(httpError(404))
      .mockRejectedValueOnce(httpError(404));

    const result = await h.handleToolCall("list_resources", {
      resourceType: "log",
      projectId: PROJECT,
    });

    expect(result.error).toMatch(/404/);
    expect(result._hints.action).toMatch(/2026\.7\.0/);
  });

  it("rethrows errors it has no advice for", async () => {
    const original = httpError(500);
    api.get.mockRejectedValueOnce(original);

    await expect(
      h.handleToolCall("list_resources", {
        resourceType: "log",
        projectId: PROJECT,
        level: ["error"],
      }),
    ).rejects.toBe(original);
  });

  it("keeps the role advice when v2.0 answers 403 after a v2.1 404", async () => {
    api.get
      .mockRejectedValueOnce(httpError(404))
      .mockRejectedValueOnce(httpError(403));

    const result = await h.handleToolCall("list_resources", {
      resourceType: "log",
      projectId: PROJECT,
    });

    expect(result.error).toMatch(/403/);
    expect(result._hints.action).toMatch(/'logs' or 'developer'/);
  });

  it("warns that an old platform's session read may cover only the latest entries, and applies level itself", async () => {
    api.get
      .mockRejectedValueOnce(httpError(404)) // v2.1 tail
      .mockResolvedValueOnce({ items: sessionEntries }); // v2.0 ignores type

    const result = await h.handleToolCall("list_resources", {
      resourceType: "log",
      projectId: PROJECT,
      sessionId: SESSION,
      level: ["error"],
    });

    expect(result.items.map((e: any) => e.level)).toEqual(["error", "error"]);
    expect(result._hints.warning).toMatch(/no v2\.1 logs API/);
  });

  it("says when a turn has more entries than one read returned", async () => {
    api.get.mockResolvedValue({
      items: [sessionEntries[0], nodeError],
      total: 7,
    });

    const result = await h.handleToolCall("list_resources", {
      resourceType: "log",
      projectId: PROJECT,
      traceId: TRACE,
      limit: 2,
    });

    expect(result._hints.warning).toMatch(/Read on with skip: 2/);
  });

  it("accepts the trace level", async () => {
    api.get.mockResolvedValue({ items: [], total: 0 });

    await h.handleToolCall("list_resources", {
      resourceType: "log",
      projectId: PROJECT,
      level: ["trace"],
    });

    expect((api.get.mock.calls[0][1] as any).params.type).toEqual(["trace"]);
  });

  it("rejects an unparsable date before calling the API", async () => {
    const result = await h.handleToolCall("list_resources", {
      resourceType: "log",
      projectId: PROJECT,
      startDate: "yesterday",
    });

    expect(result.error).toMatch(/startDate is not a valid ISO 8601 date/);
    expect(api.get).not.toHaveBeenCalled();
  });

  it("says an empty list without dates covered only the last hour", async () => {
    api.get.mockResolvedValue({ items: [], total: 0 });

    const result = await h.handleToolCall("list_resources", {
      resourceType: "log",
      projectId: PROJECT,
      level: ["error"],
    });

    expect(result._hints.hint).toMatch(/last hour/);
  });

  it("keeps a session's newest `limit` entries, oldest first", async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      entry(
        `6aff000000000000000000${String(99 - i).padStart(2, "0")}`,
        new Date(Date.UTC(2026, 10, 19, 16, 0, 59 - i)).toISOString(),
        "info",
        `entry ${29 - i}`,
        { sessionId: SESSION },
      ),
    );
    api.get.mockResolvedValue({ items: many });

    const result = await h.handleToolCall("list_resources", {
      resourceType: "log",
      projectId: PROJECT,
      sessionId: SESSION,
      limit: 5,
    });

    expect(result.items.map((e: any) => e.message)).toEqual([
      "entry 25",
      "entry 26",
      "entry 27",
      "entry 28",
      "entry 29",
    ]);
    expect(result.total).toBe(30);
    expect(result._hints.warning).toMatch(/newest 5 entries/);
  });

  it("names the roles that can read logs on a 403", async () => {
    api.get.mockRejectedValue(httpError(403));

    const result = await h.handleToolCall("list_resources", {
      resourceType: "log",
      projectId: PROJECT,
      sessionId: SESSION,
    });

    expect(result.error).toMatch(/403/);
    expect(result._hints.action).toMatch(/'logs' or 'developer'/);
  });

  it("explains an empty session read: entries arrive a few seconds late", async () => {
    api.get.mockResolvedValue({ items: [], total: -1 });

    const result = await h.handleToolCall("list_resources", {
      resourceType: "log",
      projectId: PROJECT,
      sessionId: SESSION,
    });

    expect(result.items).toEqual([]);
    expect(result._hints.hint).toMatch(/few seconds/);
  });

  it("warns when a session has more entries than one read returns", async () => {
    api.get.mockResolvedValue({
      items: sessionEntries,
      nextCursor: "6aff00000000000000000001",
    });

    const result = await h.handleToolCall("list_resources", {
      resourceType: "log",
      projectId: PROJECT,
      sessionId: SESSION,
    });

    expect(result._hints.warning).toMatch(/newest 3 entries/);
  });

  it("truncates very long messages", async () => {
    api.get.mockResolvedValue({
      items: [
        entry(ENTRY_ID, "2026-11-19T16:36:00.000Z", "info", "x".repeat(5000)),
      ],
    });

    const result = await h.handleToolCall("list_resources", {
      resourceType: "log",
      projectId: PROJECT,
    });

    expect(result.items[0].message.length).toBeLessThanOrEqual(1001);
  });

  describe("get_resource", () => {
    it("returns one entry with its meta, minus the stack trace and the endpoint's URLToken", async () => {
      api.get.mockResolvedValue(nodeError);

      const result = await h.handleToolCall("get_resource", {
        resourceType: "log",
        id: ENTRY_ID,
        projectId: PROJECT,
      });

      expect(api.get).toHaveBeenCalledWith(
        `/v2.1/projects/${PROJECT}/logs/${ENTRY_ID}`,
        { params: undefined },
      );
      expect(result.nodeLabel).toBe("Code throws");
      expect(result.meta.nodeId).toBe("ce47d468-8a0e-4c25-9e7f-8294d090e632");
      expect(JSON.stringify(result)).not.toContain(URL_TOKEN);
      expect(JSON.stringify(result)).not.toContain("/app/build");
    });

    it("returns the complete entry with raw: true", async () => {
      api.get.mockResolvedValue(nodeError);

      const result = await h.handleToolCall("get_resource", {
        resourceType: "log",
        id: ENTRY_ID,
        projectId: PROJECT,
        raw: true,
      });

      expect(result).toEqual(nodeError);
    });

    it("requires a projectId", async () => {
      const result = await h.handleToolCall("get_resource", {
        resourceType: "log",
        id: ENTRY_ID,
      });

      expect(result.error).toMatch(/projectId is required/);
      expect(api.get).not.toHaveBeenCalled();
    });

    it("encodes the id and explains an expired entry", async () => {
      api.get.mockRejectedValue(httpError(404));

      const result = await h.handleToolCall("get_resource", {
        resourceType: "log",
        id: "../x",
        projectId: PROJECT,
      });

      expect(api.get).toHaveBeenCalledWith(
        `/v2.1/projects/${PROJECT}/logs/..%2Fx`,
        { params: undefined },
      );
      expect(result._hints.action).toMatch(/kept 24 hours/);
    });
  });

  describe("talk_to_agent", () => {
    it("returns the turn's traceId so its log entries can be read", async () => {
      post.mockResolvedValueOnce({
        data: {
          text: "before middle",
          outputStack: [
            { text: "before", traceId: TRACE },
            { text: "middle", traceId: TRACE },
          ],
        },
      });

      const result = await h.handleTalkToAgent({
        endpointUrl: "https://endpoint-trial.cognigy.ai/abc123token",
        message: "Hi",
      });

      expect(result.traceId).toBe(TRACE);
    });

    it("points an empty reply with a traceId at that turn's log entries", async () => {
      // A data-only output before a crash: no text, but a traceId.
      post.mockResolvedValueOnce({
        data: { text: "", outputStack: [{ data: { x: 1 }, traceId: TRACE }] },
      });

      const result = await h.handleTalkToAgent({
        endpointUrl: "https://endpoint-trial.cognigy.ai/abc123token",
        message: "Hi",
        sessionId: SESSION,
      });

      expect(result._hints.action).toContain(
        `list_resources { resourceType: 'log', projectId, traceId: '${TRACE}' }`,
      );
    });

    it("points an empty reply at the session's log entries", async () => {
      post.mockResolvedValueOnce({ data: { text: "", outputStack: [] } });

      const result = await h.handleTalkToAgent({
        endpointUrl: "https://endpoint-trial.cognigy.ai/abc123token",
        message: "Hi",
        sessionId: SESSION,
      });

      expect(result.traceId).toBeUndefined();
      expect(result._hints.action).toContain(
        `list_resources { resourceType: 'log', projectId, sessionId: '${SESSION}' }`,
      );
    });
  });
});
