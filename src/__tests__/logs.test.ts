/**
 * Tests for the log read surface on list_resources / get_resource.
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";

import { CognigyApiClient } from "../api/client.js";
import { ToolHandlers } from "../tools/handlers.js";

const PROJECT = "507f1f77bcf86cd799439011";
const LOG_ID = "60d5ec49f1a2c8b1a4e0f0a1";
const V2_HEADER = { "x-cognigy-log-model-version": "v2" };

const v2Entry = (overrides: Record<string, unknown> = {}) => ({
  _id: LOG_ID,
  timestamp: "2026-11-19T10:00:00.000Z",
  msg: "Flow execution failed",
  traceId: "endpoint-rest-1",
  metadata: { organizationId: "org1", projectId: PROJECT, type: "error" },
  meta: { sessionId: "abc", userId: "u1" },
  ...overrides,
});

describe("logs", () => {
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

  const list = (args: Record<string, unknown> = {}) =>
    h.handleToolCall("list_resources", {
      resourceType: "log",
      projectId: PROJECT,
      ...args,
    });

  it("lists logs from /v2.1/projects/{id}/logs with the v2 header", async () => {
    api.get.mockResolvedValue({
      items: [v2Entry()],
      total: 1,
      nextCursor: null,
    } as never);

    const result = await list();

    expect(api.get).toHaveBeenCalledWith(`/v2.1/projects/${PROJECT}/logs`, {
      params: { limit: 25, skip: 0 },
      headers: V2_HEADER,
    });
    expect(result.items).toEqual([
      {
        id: LOG_ID,
        timestamp: "2026-11-19T10:00:00.000Z",
        level: "error",
        msg: "Flow execution failed",
        traceId: "endpoint-rest-1",
        meta: { sessionId: "abc", userId: "u1" },
      },
    ]);
    expect(result.total).toBe(1);
  });

  it("maps level, flowName, userId and dates to query params", async () => {
    api.get.mockResolvedValue({ items: [], total: 0 } as never);

    await list({
      level: ["error", "warn"],
      flowName: "Main",
      userId: "u1",
      startDate: "2026-11-19T09:00:00Z",
      endDate: "2026-11-19T10:00:00Z",
      limit: 10,
      skip: 5,
      sort: "timestamp:desc",
    });

    expect(api.get).toHaveBeenCalledWith(`/v2.1/projects/${PROJECT}/logs`, {
      params: {
        limit: 10,
        skip: 5,
        sort: "timestamp:desc",
        type: ["error", "warn"],
        flowName: "Main",
        userId: "u1",
        startDate: "2026-11-19T09:00:00Z",
        endDate: "2026-11-19T10:00:00Z",
      },
      headers: V2_HEADER,
    });
  });

  it("reads /logs/tail for a sessionId and never sends it to /logs", async () => {
    api.get.mockResolvedValue({
      items: [v2Entry(), v2Entry({ _id: "60d5ec49f1a2c8b1a4e0f0a2" })],
      total: -1,
      nextCursor: null,
    } as never);

    const result = await list({ sessionId: "abc", limit: 1 });

    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith(
      `/v2.1/projects/${PROJECT}/logs/tail`,
      {
        params: { sessionId: "abc", lastTimeWindow: 12 },
        headers: V2_HEADER,
      },
    );
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(2);
    expect(result._hints?.hint).toMatch(/limit/);
  });

  it("passes level to /logs/tail as type", async () => {
    api.get.mockResolvedValue({ items: [], total: -1 } as never);

    await list({ sessionId: "abc", level: ["error"], flowName: "Main" });

    expect(api.get).toHaveBeenCalledWith(
      `/v2.1/projects/${PROJECT}/logs/tail`,
      {
        params: {
          sessionId: "abc",
          lastTimeWindow: 12,
          type: ["error"],
          flowName: "Main",
        },
        headers: V2_HEADER,
      },
    );
  });

  it("normalises v1 and v2 entry shapes to the same level", async () => {
    api.get.mockResolvedValue({
      items: [
        v2Entry({ metadata: { type: "info" } }),
        { _id: "b", timestamp: "t", msg: "m", type: "info", meta: {} },
      ],
      total: 2,
    } as never);

    const result = await list();

    expect(result.items.map((i: any) => i.level)).toEqual(["info", "info"]);
  });

  it("truncates long messages and meta values in lists and flags it", async () => {
    const entry = v2Entry({
      msg: "x".repeat(2000),
      meta: { error: "e".repeat(5000), userId: "u1" },
    });
    api.get.mockResolvedValue({ items: [entry], total: 1 } as never);

    const result = await list();

    const item = result.items[0];
    expect(item.msg.length).toBeLessThanOrEqual(500);
    expect(item.msgTruncated).toBe(true);
    expect(item.meta.error.length).toBeLessThanOrEqual(201);
    expect(item.meta.userId).toBe("u1");
    expect(item.metaTruncated).toBe(true);
  });

  it("retries without the v2 header when the platform rejects it", async () => {
    api.get
      .mockRejectedValueOnce(
        Object.assign(new Error("unsupported header"), {
          status: 400,
        }) as never,
      )
      .mockResolvedValueOnce({
        items: [{ _id: "a", timestamp: "t", msg: "m", type: "warn", meta: {} }],
        total: 1,
      } as never);

    const result = await list({ sessionId: "abc" });

    expect(api.get).toHaveBeenCalledTimes(2);
    const retryConfig = api.get.mock.calls[1][1] as any;
    expect(retryConfig.headers).toBeUndefined();
    // lastTimeWindow needs the v2 model, so it goes with the header.
    expect(retryConfig.params).toEqual({ sessionId: "abc" });
    expect(result.items[0].level).toBe("warn");
  });

  it("does not retry other errors", async () => {
    api.get.mockRejectedValue(
      Object.assign(new Error("forbidden"), { status: 403 }) as never,
    );

    await expect(list()).rejects.toThrow("forbidden");
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("explains an empty result without dates", async () => {
    api.get.mockResolvedValue({ items: [], total: 0 } as never);

    const result = await list();

    expect(result.items).toEqual([]);
    expect(result._hints?.hint).toMatch(/last hour/);
    expect(result._hints?.hint).toMatch(/startDate/);
  });

  it("explains an empty result for a sessionId", async () => {
    api.get.mockResolvedValue({ items: [], total: -1 } as never);

    const result = await list({ sessionId: "abc" });

    expect(result._hints?.hint).toMatch(/12 hours/);
  });

  it("requires projectId for log", async () => {
    const result = await h.handleToolCall("list_resources", {
      resourceType: "log",
    });

    expect(result.error).toMatch(/projectId/);
    expect(api.get).not.toHaveBeenCalled();
  });

  it("rejects an unparsable startDate before calling the API", async () => {
    const result = await list({ startDate: "not-a-date" });

    expect(result.error).toMatch(/startDate/);
    expect(result.error).toMatch(/ISO 8601/);
    expect(api.get).not.toHaveBeenCalled();
  });

  it("rejects an unparsable endDate before calling the API", async () => {
    const result = await list({ endDate: "yesterday-ish" });

    expect(result.error).toMatch(/endDate/);
    expect(api.get).not.toHaveBeenCalled();
  });

  it("get_resource returns one full entry from /v2.1/.../logs/{id}", async () => {
    const entry = v2Entry({
      msg: "x".repeat(2000),
      meta: { error: "e".repeat(5000) },
    });
    api.get.mockResolvedValue(entry as never);

    const result = await h.handleToolCall("get_resource", {
      resourceType: "log",
      id: LOG_ID,
      projectId: PROJECT,
    });

    expect(api.get).toHaveBeenCalledWith(
      `/v2.1/projects/${PROJECT}/logs/${LOG_ID}`,
      { headers: V2_HEADER },
    );
    expect(result.id).toBe(LOG_ID);
    expect(result.level).toBe("error");
    expect(result.msg).toHaveLength(2000);
    expect(result.meta.error).toHaveLength(5000);
    expect(result.msgTruncated).toBeUndefined();
  });

  it("get_resource raw returns the API body unchanged", async () => {
    const entry = v2Entry();
    api.get.mockResolvedValue(entry as never);

    const result = await h.handleToolCall("get_resource", {
      resourceType: "log",
      id: LOG_ID,
      projectId: PROJECT,
      raw: true,
    });

    expect(result).toEqual(entry);
  });

  it("get_resource requires projectId for log", async () => {
    const result = await h.handleToolCall("get_resource", {
      resourceType: "log",
      id: LOG_ID,
    });

    expect(result.error).toMatch(/projectId/);
    expect(api.get).not.toHaveBeenCalled();
  });
});
