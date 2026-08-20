import { describe, it, expect } from "@jest/globals";
import { withHints, filterResponse, filterList } from "../tools/filters.js";

describe("withHints", () => {
  it("adds _hints to data object", () => {
    const data = { name: "test" };
    const hints = { hint: "some hint" };
    const result = withHints(data, hints);
    expect(result._hints).toEqual({ hint: "some hint" });
  });

  it("passes warning and action hints through unchanged", () => {
    const result = withHints(
      { error: "Failed" },
      { warning: "watch out", action: "do this next" },
    );

    expect(result._hints).toEqual({
      warning: "watch out",
      action: "do this next",
    });
  });

  it("preserves all original data fields", () => {
    const data = { name: "test", count: 5, nested: { a: 1 } };
    const hints = { warning: "watch out" };
    const result = withHints(data, hints);
    expect(result.name).toBe("test");
    expect(result.count).toBe(5);
    expect(result.nested).toEqual({ a: 1 });
  });

  it("handles empty hints object", () => {
    const data = { id: "123" };
    const result = withHints(data, {});
    expect(result._hints).toEqual({});
    expect(result.id).toBe("123");
  });

  it("handles empty data object", () => {
    const result = withHints({}, { hint: "hint" });
    expect(result._hints).toEqual({ hint: "hint" });
    expect(Object.keys(result)).toEqual(["_hints"]);
  });
});

describe("filterResponse", () => {
  it("returns raw data for unknown resource type", () => {
    const raw = { foo: "bar", extra: true };
    expect(filterResponse("nonexistent", raw)).toBe(raw);
  });

  it("filters agent fields using _id", () => {
    const raw = {
      _id: "agent-1",
      referenceId: "ref-1",
      name: "My Agent",
      description: "desc",
      createdAt: "2024-01-01",
      extraField: "should be stripped",
      internalData: { secret: true },
    };
    expect(filterResponse("agent", raw)).toEqual({
      id: "agent-1",
      referenceId: "ref-1",
      name: "My Agent",
      description: "desc",
      createdAt: "2024-01-01",
    });
  });

  it("filters agent using id field when _id is missing", () => {
    const raw = {
      id: "agent-2",
      referenceId: "ref-2",
      name: "Agent Two",
      description: "desc2",
      createdAt: "2024-02-01",
    };
    expect(filterResponse("agent", raw)).toEqual({
      id: "agent-2",
      referenceId: "ref-2",
      name: "Agent Two",
      description: "desc2",
      createdAt: "2024-02-01",
    });
  });

  it("filters flow fields", () => {
    const raw = {
      _id: "flow-1",
      referenceId: "fref-1",
      name: "Main Flow",
      createdAt: "2024-01-01",
      nodes: [1, 2, 3],
    };
    expect(filterResponse("flow", raw)).toEqual({
      id: "flow-1",
      referenceId: "fref-1",
      name: "Main Flow",
      createdAt: "2024-01-01",
    });
  });

  it("filters endpoint fields for non-webchat channel", () => {
    const raw = {
      _id: "ep-1",
      name: "REST Endpoint",
      channel: "rest",
      flowId: "flow-1",
      URLToken: "tok-123",
      createdAt: "2024-01-01",
      secretConfig: { key: "hidden" },
    };
    const result = filterResponse("endpoint", raw);
    expect(result).toEqual({
      id: "ep-1",
      name: "REST Endpoint",
      channel: "rest",
      flowId: "flow-1",
      URLToken: "tok-123",
      createdAt: "2024-01-01",
    });
    expect(result.webchatConfigured).toBeUndefined();
  });

  it("filters webchat3 endpoint with settings", () => {
    const raw = {
      _id: "ep-wc",
      name: "Webchat EP",
      channel: "webchat3",
      flowId: "flow-1",
      URLToken: "tok-wc",
      createdAt: "2024-01-01",
      settings: {
        colors: { primaryColor: "#ff0000" },
        layout: { chatWindowWidth: "500px" },
        homeScreen: { enabled: true },
        businessHours: { enabled: true },
      },
    };
    const result = filterResponse("endpoint", raw);
    expect(result.webchatConfigured).toBe(true);
    expect(result.webchatSummary).toEqual({
      primaryColor: "#ff0000",
      chatWindowWidth: "500px",
      homeScreen: true,
      businessHours: true,
    });
  });

  it("webchat3 summary uses colorScheme fallback when colors.primaryColor is absent", () => {
    const raw = {
      _id: "ep-cs",
      name: "EP",
      channel: "webchat3",
      flowId: "f1",
      URLToken: "t",
      createdAt: "2024-01-01",
      settings: { colorScheme: "#00ff00" },
    };
    const result = filterResponse("endpoint", raw);
    expect(result.webchatSummary.primaryColor).toBe("#00ff00");
  });

  it("webchat3 summary picks up persistentMenu from layout.enablePersistentMenu", () => {
    const raw = {
      _id: "ep-pm",
      name: "EP",
      channel: "webchat3",
      flowId: "f1",
      URLToken: "t",
      createdAt: "2024-01-01",
      settings: { layout: { enablePersistentMenu: true } },
    };
    expect(filterResponse("endpoint", raw).webchatSummary.persistentMenu).toBe(
      true,
    );
  });

  it("webchat3 summary picks up persistentMenu from root enablePersistentMenu", () => {
    const raw = {
      _id: "ep-pm2",
      name: "EP",
      channel: "webchat3",
      flowId: "f1",
      URLToken: "t",
      createdAt: "2024-01-01",
      settings: { enablePersistentMenu: true },
    };
    expect(filterResponse("endpoint", raw).webchatSummary.persistentMenu).toBe(
      true,
    );
  });

  it("filters llm_model fields", () => {
    const raw = {
      _id: "llm-1",
      referenceId: "lref-1",
      name: "GPT-4o",
      provider: "openAI",
      modelType: "gpt-4o",
      connectionId: "conn-1",
      isDefault: true,
      internalToken: "secret",
    };
    expect(filterResponse("llm_model", raw)).toEqual({
      id: "llm-1",
      referenceId: "lref-1",
      name: "GPT-4o",
      provider: "openAI",
      modelType: "gpt-4o",
      connectionId: "conn-1",
      isDefault: true,
    });
  });

  it("filters knowledge_store fields", () => {
    const raw = {
      _id: "ks-1",
      referenceId: "ksref-1",
      name: "KB Store",
      description: "knowledge base",
      sourceCount: 42,
      embeddings: [1, 2, 3],
    };
    expect(filterResponse("knowledge_store", raw)).toEqual({
      id: "ks-1",
      referenceId: "ksref-1",
      name: "KB Store",
      description: "knowledge base",
      sourceCount: 42,
    });
  });

  it("filters conversation fields", () => {
    const raw = {
      sessionId: "sess-1",
      channel: "webchat",
      startedAt: "2024-01-01",
      messageCount: 10,
      messages: [{ text: "hi" }],
    };
    expect(filterResponse("conversation", raw)).toEqual({
      sessionId: "sess-1",
      channel: "webchat",
      startedAt: "2024-01-01",
      messageCount: 10,
    });
  });

  it("filters project fields, keeping lastChanged over createdAt", () => {
    const raw = {
      _id: "proj-1",
      name: "My Project",
      color: "blue",
      createdAt: 1700000000,
      lastChanged: 1800000000,
      createdBy: "60d5ec49f1a2c8b1a4e0f001",
      lastChangedBy: "60d5ec49f1a2c8b1a4e0f001",
      members: ["user1"],
    };
    expect(filterResponse("project", raw)).toEqual({
      id: "proj-1",
      name: "My Project",
      lastChanged: 1800000000,
    });
  });

  it("omits lastChangedBy from projects (opaque id, resolve via user/me)", () => {
    const filtered = filterResponse("project", {
      _id: "proj-1",
      name: "My Project",
      lastChanged: 1800000000,
      lastChangedBy: "60d5ec49f1a2c8b1a4e0f001",
    });
    expect(filtered.lastChangedBy).toBeUndefined();
  });

  it("filters user fields and drops the project id list", () => {
    const raw = {
      _id: "60d5ec49f1a2c8b1a4e0f001",
      id: "60d5ec49f1a2c8b1a4e0f001",
      name: "someone@example.com",
      organisation: "60d5ec49f1a2c8b1a4e0f0aa",
      roles: ["admin", "projectManager"],
      projects: ["60d5ec49f1a2c8b1a4e0f0b1", "60d5ec49f1a2c8b1a4e0f0b2"],
      acceptedTOS: true,
      disabled: false,
    };
    expect(filterResponse("user", raw)).toEqual({
      id: "60d5ec49f1a2c8b1a4e0f001",
      name: "someone@example.com",
      roles: ["admin", "projectManager"],
    });
  });

  it("filters extension fields", () => {
    const raw = {
      _id: "ext-1",
      name: "My Extension",
      version: "1.0.0",
      code: "function() {}",
    };
    expect(filterResponse("extension", raw)).toEqual({
      id: "ext-1",
      name: "My Extension",
      version: "1.0.0",
    });
  });

  it("filters function fields", () => {
    const raw = {
      _id: "fn-1",
      name: "myFunction",
      description: "does stuff",
      code: "return 42;",
    };
    expect(filterResponse("function", raw)).toEqual({
      id: "fn-1",
      name: "myFunction",
      description: "does stuff",
    });
  });

  it("filters tool fields with fallbacks", () => {
    const raw = {
      _id: "tool-fallback",
      label: "My Tool Label",
      type: "http",
      extra: "data",
    };
    expect(filterResponse("tool", raw)).toEqual({
      toolId: "tool-fallback",
      name: "My Tool Label",
      toolType: "http",
    });
  });

  it("filters tool fields with primary fields", () => {
    const raw = {
      toolId: "tool-primary",
      name: "Primary Tool",
      toolType: "code",
      _id: "should-not-use",
      label: "should-not-use",
      type: "should-not-use",
    };
    expect(filterResponse("tool", raw)).toEqual({
      toolId: "tool-primary",
      name: "Primary Tool",
      toolType: "code",
    });
  });
});

describe("filterList", () => {
  it("returns raw items for unknown resource type", () => {
    const items = [{ a: 1 }, { b: 2 }];
    expect(filterList("nonexistent", items)).toBe(items);
  });

  it("filters each item in array", () => {
    const items = [
      {
        _id: "p1",
        name: "P1",
        createdAt: 1700000000,
        lastChanged: 1800000000,
        extra: "x",
      },
      {
        _id: "p2",
        name: "P2",
        createdAt: 1700000001,
        lastChanged: 1800000001,
        extra: "y",
      },
    ];
    expect(filterList("project", items)).toEqual([
      { id: "p1", name: "P1", lastChanged: 1800000000 },
      { id: "p2", name: "P2", lastChanged: 1800000001 },
    ]);
  });

  it("handles empty array", () => {
    expect(filterList("agent", [])).toEqual([]);
  });

  it("applies correct filter per resource type", () => {
    const extensions = [
      { _id: "e1", name: "Ext1", version: "1.0", code: "hidden" },
    ];
    const conversations = [
      {
        sessionId: "s1",
        channel: "rest",
        startedAt: "2024-01-01",
        messageCount: 3,
        messages: [],
      },
    ];
    expect(filterList("extension", extensions)).toEqual([
      { id: "e1", name: "Ext1", version: "1.0" },
    ]);
    expect(filterList("conversation", conversations)).toEqual([
      {
        sessionId: "s1",
        channel: "rest",
        startedAt: "2024-01-01",
        messageCount: 3,
      },
    ]);
  });
});

describe("snapshot filter", () => {
  const marker = "cognigy-plugin:auto-backup:v1";

  it("marks a plugin backup", () => {
    const result = filterResponse("snapshot", {
      _id: "60d5ec49f1a2c8b1a4e0fa01",
      name: "[AI Backup] pre-update — 2026-08-20 13-00-17",
      description: `Automatic backup.\n${marker}`,
      createdAt: 1750000000,
      createdBy: "user1",
      hash: "abc123",
      packageExpiresAt: 999,
      size: 4096,
    });

    expect(result.isPluginBackup).toBe(true);
    expect(result.id).toBe("60d5ec49f1a2c8b1a4e0fa01");
    // Download-only noise stays out of the LLM's context.
    expect(result.hash).toBeUndefined();
    expect(result.packageExpiresAt).toBeUndefined();
    expect(result.size).toBeUndefined();
  });

  it("does not mark a human snapshot", () => {
    const result = filterResponse("snapshot", {
      _id: "60d5ec49f1a2c8b1a4e0fa03",
      name: "Release 2026-01",
      description: "Prepared by hand.",
      createdAt: 1750000000,
    });

    expect(result.isPluginBackup).toBe(false);
  });

  it("requires BOTH markers, so a name lookalike is still protected", () => {
    expect(
      filterResponse("snapshot", {
        _id: "60d5ec49f1a2c8b1a4e0fa04",
        name: "[AI Backup] hand-made lookalike",
        description: "No marker here.",
      }).isPluginBackup,
    ).toBe(false);

    expect(
      filterResponse("snapshot", {
        _id: "60d5ec49f1a2c8b1a4e0fa05",
        name: "Renamed by a person",
        description: `something\n${marker}`,
      }).isPluginBackup,
    ).toBe(false);
  });
});
