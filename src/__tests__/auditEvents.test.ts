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

  it("prefers a populated modifiedResources over an empty chain", async () => {
    api.get.mockResolvedValue({
      items: [
        rawEvent({
          chain: [],
          modifiedResources: [
            { elementId: "60d5ec49f1a2c8b1a4e0f0b3", elementType: "endpoint" },
          ],
        }),
      ],
      total: 1,
    } as never);

    const result = await h.handleToolCall("list_resources", {
      resourceType: "audit_event",
    });

    expect(result.items[0].modifiedResources).toEqual([
      { elementId: "60d5ec49f1a2c8b1a4e0f0b3", elementType: "endpoint" },
    ]);
  });

  // A platform older than 2026.17.0 rejects the repeatable actor[]/type[]
  // params. Detection deliberately does not read the error message — which
  // misfires both ways — so the recovery has to be behavioural: refetch
  // unfiltered and apply the filters here.
  it("filters client-side when the platform rejects the array filters", async () => {
    const error: any = new Error(
      "Validation failed. Field 'actor' is not allowed.",
    );
    error.status = 400;
    api.get.mockRejectedValueOnce(error as never).mockResolvedValueOnce({
      items: [
        rawEvent({ performedBy: { actor: "mcp-plugin" } }),
        rawEvent({
          _id: "60d5ec49f1a2c8b1a4e0f0c1",
          performedBy: { actor: "ask-ai" },
        }),
        // No performedBy at all: the platform stores it only for non-human
        // actors, so this one is a person and must not match.
        rawEvent({ _id: "60d5ec49f1a2c8b1a4e0f0c2" }),
      ],
      total: 3,
    } as never);

    const result = await h.handleToolCall("list_resources", {
      resourceType: "audit_event",
      actor: ["mcp-plugin"],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].performedBy.actor).toBe("mcp-plugin");
    expect(result.total).toBe(1);
    expect(result._hints.warning).toMatch(/2026\.17\.0/);
    // The retry drops only the rejected filters.
    expect(api.get.mock.calls[1][1]).toMatchObject({
      params: expect.not.objectContaining({ actor: expect.anything() }),
    });
  });

  it("matches a human actor with no performedBy when filtering client-side", async () => {
    const error: any = new Error("Bad Request");
    error.status = 400;
    api.get.mockRejectedValueOnce(error as never).mockResolvedValueOnce({
      items: [
        rawEvent(),
        rawEvent({
          _id: "60d5ec49f1a2c8b1a4e0f0c3",
          performedBy: { actor: "mcp-plugin" },
        }),
      ],
      total: 2,
    } as never);

    const result = await h.handleToolCall("list_resources", {
      resourceType: "audit_event",
      actor: ["human"],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe(EVENT_ID);
  });

  it("filters client-side on eventType too", async () => {
    const error: any = new Error("Bad Request");
    error.status = 400;
    api.get.mockRejectedValueOnce(error as never).mockResolvedValueOnce({
      items: [
        rawEvent(),
        rawEvent({ _id: "60d5ec49f1a2c8b1a4e0f0c4", type: "delete" }),
      ],
      total: 2,
    } as never);

    const result = await h.handleToolCall("list_resources", {
      resourceType: "audit_event",
      eventType: ["delete"],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].type).toBe("delete");
  });

  // The unfiltered retry is also the detection: a 400 that survives it was
  // never about the filters (a rejected `sort` field, say), so the original
  // error must surface untouched rather than as a version hint.
  it("rethrows the original 400 when the unfiltered retry fails too", async () => {
    const error: any = new Error("Validation failed. Field 'sort' is invalid.");
    error.status = 400;
    api.get.mockRejectedValue(error as never);

    await expect(
      h.handleToolCall("list_resources", {
        resourceType: "audit_event",
        actor: ["mcp-plugin"],
        sort: "nope:desc",
      }),
    ).rejects.toThrow(/Field 'sort' is invalid/);
  });

  it("rethrows a 400 when no array filter was sent", async () => {
    const error: any = new Error("Validation failed. Field 'sort' is invalid.");
    error.status = 400;
    api.get.mockRejectedValue(error as never);

    await expect(
      h.handleToolCall("list_resources", {
        resourceType: "audit_event",
        sort: "nope:desc",
      }),
    ).rejects.toThrow(/Field 'sort' is invalid/);
    expect(api.get).toHaveBeenCalledTimes(1);
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

  it("hints at permissions on a 403 from get_resource too", async () => {
    const error: any = new Error("Forbidden");
    error.status = 403;
    api.get.mockRejectedValue(error as never);

    const result = await h.handleToolCall("get_resource", {
      resourceType: "audit_event",
      id: EVENT_ID,
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
