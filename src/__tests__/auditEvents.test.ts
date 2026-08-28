/**
 * Tests for the audit_event read surface on list_resources / get_resource.
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";

import { CognigyApiClient } from "../api/client.js";
import { ToolHandlers } from "../tools/handlers.js";

const EVENT_ID = "60d5ec49f1a2c8b1a4e0f0a1";

const rawEvent = (overrides: Record<string, unknown> = {}) => ({
  _id: EVENT_ID,
  timestamp: "2026-08-28T09:00:00.000Z",
  type: "create",
  actionType: undefined,
  user: "someone@example.com",
  organisationReference: "60d5ec49f1a2c8b1a4e0f0ff",
  projectReference: "507f1f77bcf86cd799439011",
  // The live API names this `chain`; the REST docs call it `modifiedResources`.
  chain: [{ elementId: "60d5ec49f1a2c8b1a4e0f0b1", elementType: "aiAgent" }],
  ...overrides,
});

describe("audit events", () => {
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

  it("lists audit events without a projectId", async () => {
    api.get.mockResolvedValue({ items: [rawEvent()], total: 1 } as never);

    const result = await h.handleToolCall("list_resources", {
      resourceType: "audit_event",
    });

    expect(api.get).toHaveBeenCalledWith("/v2.0/auditevents", {
      params: { limit: 25, skip: 0 },
    });
    expect(result.items[0]).toEqual({
      id: EVENT_ID,
      timestamp: "2026-08-28T09:00:00.000Z",
      type: "create",
      user: "someone@example.com",
      modifiedResources: [
        { elementId: "60d5ec49f1a2c8b1a4e0f0b1", elementType: "aiAgent" },
      ],
    });
  });

  it("reads the modification chain from the documented field name too", async () => {
    api.get.mockResolvedValue({
      items: [
        {
          _id: EVENT_ID,
          timestamp: "2026-08-28T09:00:00.000Z",
          type: "create",
          user: "someone@example.com",
          modifiedResources: [
            { elementId: "60d5ec49f1a2c8b1a4e0f0b2", elementType: "flow" },
          ],
        },
      ],
      total: 1,
    } as never);

    const result = await h.handleToolCall("list_resources", {
      resourceType: "audit_event",
    });

    expect(result.items[0].modifiedResources).toEqual([
      { elementId: "60d5ec49f1a2c8b1a4e0f0b2", elementType: "flow" },
    ]);
  });

  it("passes actor, eventType and user through as filters", async () => {
    api.get.mockResolvedValue({ items: [], total: 0 } as never);

    await h.handleToolCall("list_resources", {
      resourceType: "audit_event",
      actor: ["mcp-plugin"],
      eventType: ["create", "patch"],
      user: "someone@example.com",
      sort: "timestamp:desc",
      limit: 5,
    });

    expect(api.get).toHaveBeenCalledWith("/v2.0/auditevents", {
      params: {
        limit: 5,
        skip: 0,
        sort: "timestamp:desc",
        actor: ["mcp-plugin"],
        // The platform's query param is `type`; `eventType` is only the tool's
        // argument name, so it cannot be confused with `resourceType`.
        type: ["create", "patch"],
        user: "someone@example.com",
      },
    });
  });

  it("surfaces performedBy for plugin-performed events", async () => {
    api.get.mockResolvedValue({
      items: [
        rawEvent({
          performedBy: {
            actor: "mcp-plugin",
            taskId: "task-1",
            sessionId: "session-1",
          },
        }),
      ],
      total: 1,
    } as never);

    const result = await h.handleToolCall("list_resources", {
      resourceType: "audit_event",
      actor: ["mcp-plugin"],
    });

    expect(result.items[0].performedBy).toEqual({
      actor: "mcp-plugin",
      taskId: "task-1",
      sessionId: "session-1",
    });
  });

  it("hints at the platform version when the array filters are rejected", async () => {
    const error: any = new Error("Invalid query parameter");
    error.status = 400;
    api.get.mockRejectedValue(error as never);

    const result = await h.handleToolCall("list_resources", {
      resourceType: "audit_event",
      actor: ["mcp-plugin"],
    });

    expect(result.error).toBe("Invalid query parameter");
    expect(result._hints.likely_cause).toMatch(/2026\.17\.0/);
  });

  it("hints at permissions on a 403", async () => {
    const error: any = new Error("Forbidden");
    error.status = 403;
    api.get.mockRejectedValue(error as never);

    const result = await h.handleToolCall("list_resources", {
      resourceType: "audit_event",
    });

    expect(result._hints.action).toMatch(/Admin Center/);
  });

  it("rethrows unrelated failures", async () => {
    const error: any = new Error("Boom");
    error.status = 500;
    api.get.mockRejectedValue(error as never);

    await expect(
      h.handleToolCall("list_resources", { resourceType: "audit_event" }),
    ).rejects.toThrow("Boom");
  });

  it("reads a single audit event", async () => {
    api.get.mockResolvedValue(
      rawEvent({ performedBy: { actor: "ask-ai", taskId: "task-9" } }) as never,
    );

    const result = await h.handleToolCall("get_resource", {
      resourceType: "audit_event",
      id: EVENT_ID,
    });

    expect(api.get).toHaveBeenCalledWith(`/v2.0/auditevents/${EVENT_ID}`);
    expect(result.performedBy).toEqual({ actor: "ask-ai", taskId: "task-9" });
  });
});
