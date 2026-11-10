import { describe, it, expect, jest } from "@jest/globals";
import * as schemas from "../schemas/tools.js";
import { ToolHandlers } from "../tools/handlers.js";
import { SERVER_INSTRUCTIONS } from "../instructions.js";
import {
  annotateAgentKindMismatch,
  LEGACY_AGENT_NOTE,
  NEW_AGENT_NOTE,
} from "../tools/agentsV2.js";

const ID = {
  project: "507f1f77bcf86cd799439011",
  agent: "60d5ec49f1a2c8b1a4e0f101",
  agentV1: "60d5ec49f1a2c8b1a4e0f202",
};
const UUID = "eaeff103-8ef2-4305-9a87-8d8812fb026c";

describe("agent id validation", () => {
  it("rejects a UUID agentId with the referenceId hint", () => {
    const r = schemas.talkToAgentSchema.safeParse({
      agentId: UUID,
      projectId: ID.project,
      message: "hi",
    });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].message).toBe(schemas.AGENT_REFERENCE_ID_MESSAGE);
  });

  it("rejects a UUID aiAgentId with the referenceId hint", () => {
    const r = schemas.updateAiAgentSchema.safeParse({ aiAgentId: UUID });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].message).toBe(schemas.AGENT_REFERENCE_ID_MESSAGE);
  });

  it("keeps the hex message for other garbage", () => {
    const r = schemas.updateAiAgentSchema.safeParse({ aiAgentId: "nope" });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].message).toBe("Must be a 24-char hex ID");
  });

  it("accepts a 24-hex id", () => {
    const r = schemas.talkToAgentSchema.safeParse({
      agentId: ID.agent,
      projectId: ID.project,
      message: "hi",
    });
    expect(r.success).toBe(true);
  });
});

const V1 = "https://api-trial.cognigy.ai";
const EP = "https://endpoint-trial.cognigy.ai";

const v1Agent = {
  _id: ID.agentV1,
  referenceId: "11111111-1111-4111-8111-111111111111",
  name: "Old FAQ Bot",
  description: "v1",
  projectReference: ID.project,
};
const v2Agent = {
  id: ID.agent,
  referenceId: UUID,
  name: "NiCE Air Support",
  role: "Support",
  description: "v2",
  agentType: "text",
  projectId: ID.project,
  instructions: "secret-ish long text",
};

function makeApi(routes: { v1?: () => Promise<any>; v2?: () => Promise<any> }) {
  const api: any = {
    get: jest.fn(async (url: string) => {
      if (url === "/v2.0/aiagents")
        return routes.v1 ? routes.v1() : { items: [], total: 0 };
      if (url === `${V1}/v1/agents`)
        return routes.v2 ? routes.v2() : { items: [], total: 0 };
      throw new Error(`unexpected GET ${url}`);
    }),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  };
  return api;
}

const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { status });
const netError = (code: string) => Object.assign(new Error(code), { code });

describe("list_resources { resourceType: 'agent' }", () => {
  const list = (h: any, extra: any = {}) =>
    h.handleToolCall("list_resources", {
      resourceType: "agent",
      projectId: ID.project,
      ...extra,
    });

  it("puts V2 agents in items and V1 agents in legacyAgents", async () => {
    const api = makeApi({
      v1: async () => ({ items: [v1Agent], total: 1 }),
      v2: async () => ({ items: [v2Agent], total: 1 }),
    });
    const r: any = await list(new ToolHandlers(api, EP, "", "", V1));

    expect(r.items).toEqual([
      {
        id: ID.agent,
        referenceId: UUID,
        name: "NiCE Air Support",
        role: "Support",
        description: "v2",
        agentType: "text",
        projectId: ID.project,
        createdAt: undefined,
        use: { agentId: ID.agent },
      },
    ]);
    expect(r.total).toBe(1);
    expect(r.legacyAgents).toHaveLength(1);
    expect(r.legacyAgents[0]).toMatchObject({
      legacy: true,
      id: ID.agentV1,
      use: { aiAgentId: ID.agentV1 },
    });
    expect(r.legacyTotal).toBe(1);
    expect(r._hints.hint).toContain("The AI Agents in items");
    expect(api.get).toHaveBeenCalledWith(`${V1}/v1/agents`, {
      params: { projectId: ID.project, limit: 25, skip: 0 },
    });
  });

  it("keeps today's shape when the project has only V1 agents", async () => {
    const api = makeApi({ v1: async () => ({ items: [v1Agent], total: 1 }) });
    const r: any = await list(new ToolHandlers(api, EP, "", "", V1));

    expect(r.items[0]).toMatchObject({ legacy: true, name: "Old FAQ Bot" });
    expect(r).not.toHaveProperty("legacyAgents");
    // A legacy-only project builds new agents as legacy too.
    expect(r._hints.action).toContain("create_ai_agent { legacy: true }");
  });

  it("stays in V2 mode when the page skips past every V2 agent", async () => {
    const api = makeApi({
      v1: async () => ({ items: [], total: 1 }),
      v2: async () => ({ items: [], total: 1 }),
    });
    const r: any = await list(new ToolHandlers(api, EP, "", "", V1), {
      skip: 25,
    });

    expect(r.items).toEqual([]);
    expect(r.total).toBe(1);
    expect(r.legacyAgents).toEqual([]);
    expect(r._hints.hint).toContain("The AI Agents in items");
  });

  it("never calls service-agents when no Agents V2 base URL is configured", async () => {
    const api = makeApi({ v1: async () => ({ items: [v1Agent], total: 1 }) });
    await list(new ToolHandlers(api, EP));

    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get.mock.calls[0][0]).toBe("/v2.0/aiagents");
  });

  it.each([
    ["404", () => httpError(404)],
    ["401", () => httpError(401)],
    ["403", () => httpError(403)],
    ["ECONNREFUSED", () => netError("ECONNREFUSED")],
    ["ENOTFOUND", () => netError("ENOTFOUND")],
  ])("treats a %s from service-agents as no V2, silently", async (_, err) => {
    const api = makeApi({
      v1: async () => ({ items: [v1Agent], total: 1 }),
      v2: async () => {
        throw err();
      },
    });
    const r: any = await list(new ToolHandlers(api, EP, "", "", V1));

    expect(r.items[0]).not.toHaveProperty("legacy");
    expect(r).not.toHaveProperty("_hints");
  });

  it.each([
    ["500", () => httpError(500), "500"],
    ["a timeout", () => netError("ECONNABORTED"), "ECONNABORTED"],
  ])("warns when service-agents fails with %s", async (_, err, label) => {
    const api = makeApi({
      v1: async () => ({ items: [v1Agent], total: 1 }),
      v2: async () => {
        throw err();
      },
    });
    const r: any = await list(new ToolHandlers(api, EP, "", "", V1));

    expect(r.items[0]).not.toHaveProperty("legacy");
    expect(r._hints.warning).toBe(
      `AI Agents could not be listed (${label}); the list may be incomplete.`,
    );
  });

  it("treats a 200 with a non-list body as no V2 agents", async () => {
    const api = makeApi({
      v1: async () => ({ items: [v1Agent], total: 1 }),
      v2: async () => "<html>catch-all</html>",
    });
    const r: any = await list(new ToolHandlers(api, EP, "", "", V1));

    expect(r.items[0].legacy).toBe(true);
    expect(r).not.toHaveProperty("legacyAgents");
  });

  it("passes only the sort direction to service-agents and says so", async () => {
    const api = makeApi({
      v1: async () => ({ items: [v1Agent], total: 1 }),
      v2: async () => ({ items: [v2Agent], total: 1 }),
    });
    const r: any = await list(new ToolHandlers(api, EP, "", "", V1), {
      sort: "lastChanged:desc",
    });

    expect(api.get).toHaveBeenCalledWith(`${V1}/v1/agents`, {
      params: { projectId: ID.project, limit: 25, skip: 0, sort: "desc" },
    });
    expect(api.get).toHaveBeenCalledWith("/v2.0/aiagents", {
      params: {
        projectId: ID.project,
        limit: 25,
        skip: 0,
        sort: "lastChanged:desc",
      },
    });
    expect(r._hints.warning).toContain("ordered by creation only");
  });

  it("still says 'No agents found.' for an empty project", async () => {
    const api = makeApi({});
    const r: any = await list(new ToolHandlers(api, EP, "", "", V1));
    expect(r.items).toEqual([]);
    expect(r._hints.hint).toBe("No agents found.");
  });
});

describe("get_resource { resourceType: 'agent' }", () => {
  function routedApi(v2: () => Promise<any>, v1: () => Promise<any>) {
    return {
      get: jest.fn(async (url: string) => {
        if (url === `${V1}/v1/agents/${ID.agent}`) return v2();
        if (url === `/v2.0/aiagents/${ID.agent}`) return v1();
        throw new Error(`unexpected GET ${url}`);
      }),
      post: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
    } as any;
  }

  it("returns the V2 agent first when projectId is given", async () => {
    const api = routedApi(
      async () => ({
        ...v2Agent,
        toolReferenceIds: ["t1"],
        organisationId: "o",
      }),
      async () => {
        throw new Error("V1 must not be called");
      },
    );
    const h = new ToolHandlers(api, EP, "", "", V1);
    const r: any = await h.handleToolCall("get_resource", {
      resourceType: "agent",
      id: ID.agent,
      projectId: ID.project,
    });

    expect(r).not.toHaveProperty("legacy");
    expect(r.use).toEqual({ agentId: ID.agent });
    expect(r.instructions).toBe("secret-ish long text");
    expect(r.toolReferenceIds).toEqual(["t1"]);
    expect(r).not.toHaveProperty("organisationId");
    expect(api.get).toHaveBeenCalledWith(`${V1}/v1/agents/${ID.agent}`, {
      params: { projectId: ID.project },
    });
  });

  it("falls through to V1 when the V2 read 404s", async () => {
    const api = routedApi(
      async () => {
        throw httpError(404);
      },
      async () => ({ ...v1Agent, _id: ID.agent }),
    );
    const h = new ToolHandlers(api, EP, "", "", V1);
    const r: any = await h.handleToolCall("get_resource", {
      resourceType: "agent",
      id: ID.agent,
      projectId: ID.project,
    });

    expect(r.use).toEqual({ aiAgentId: ID.agent });
    expect(r.name).toBe("Old FAQ Bot");
  });

  it("never calls service-agents without projectId", async () => {
    const api = routedApi(
      async () => {
        throw new Error("V2 must not be called");
      },
      async () => ({ ...v1Agent, _id: ID.agent }),
    );
    const h = new ToolHandlers(api, EP, "", "", V1);
    const r: any = await h.handleToolCall("get_resource", {
      resourceType: "agent",
      id: ID.agent,
    });

    expect(r.use).toEqual({ aiAgentId: ID.agent });
    expect(api.get).not.toHaveBeenCalledWith(
      `${V1}/v1/agents/${ID.agent}`,
      expect.anything(),
    );
  });

  it("returns the raw V2 body with raw: true", async () => {
    const api = routedApi(
      async () => ({ ...v2Agent, organisationId: "o" }),
      async () => ({}),
    );
    const h = new ToolHandlers(api, EP, "", "", V1);
    const r: any = await h.handleToolCall("get_resource", {
      resourceType: "agent",
      id: ID.agent,
      projectId: ID.project,
      raw: true,
    });
    expect(r.organisationId).toBe("o");
  });
});

describe("wrong-kind notes", () => {
  const err404 = (url: string) =>
    Object.assign(new Error("Not found"), { status: 404, url });

  it("adds the V2 note to a 404 on a V1 agent record", () => {
    const e = err404(`/v2.0/aiagents/${ID.agent}`);
    annotateAgentKindMismatch(e);
    expect(e.message).toBe(`Not found — ${NEW_AGENT_NOTE}`);
  });

  it("adds the V1 note to a 404 on a V2 agent record (query string ignored)", () => {
    const e = err404(`${V1}/v1/agents/${ID.agent}?projectId=${ID.project}`);
    annotateAgentKindMismatch(e);
    expect(e.message).toBe(`Not found — ${LEGACY_AGENT_NOTE}`);
  });

  it.each([
    `/v2.0/endpoints/${ID.agent}`,
    `/v2.0/aiagents/${ID.agent}/jobs`,
    `/v2.0/flows/${ID.agent}/chart`,
  ])("leaves a 404 on %s alone", (url) => {
    const e = err404(url);
    annotateAgentKindMismatch(e);
    expect(e.message).toBe("Not found");
  });

  it("leaves non-404s alone", () => {
    const e = Object.assign(new Error("boom"), {
      status: 500,
      url: `/v2.0/aiagents/${ID.agent}`,
    });
    annotateAgentKindMismatch(e);
    expect(e.message).toBe("boom");
  });

  it("reaches the caller of a V1-only tool given a V2 id", async () => {
    const api: any = {
      get: jest.fn(async () => {
        throw err404(`/v2.0/aiagents/${ID.agent}`);
      }),
      post: jest.fn(),
      patch: jest.fn(async () => {
        throw err404(`/v2.0/aiagents/${ID.agent}`);
      }),
      delete: jest.fn(),
    };
    const h = new ToolHandlers(api, EP, "", "", V1);
    await expect(
      h.handleToolCall("talk_to_agent", {
        aiAgentId: ID.agent,
        projectId: ID.project,
        message: "hi",
      }),
    ).rejects.toThrow(NEW_AGENT_NOTE);
  });
});

describe("backup gate with legacy agents", () => {
  it("learns the project of a legacy V1 agent from a V2-mode listing", async () => {
    const OTHER_PROJECT = "60d5ec49f1a2c8b1a4e0fbbb";
    const api = makeApi({
      v1: async () => ({
        items: [{ ...v1Agent, projectReference: OTHER_PROJECT }],
        total: 1,
      }),
      v2: async () => ({
        items: [{ ...v2Agent, projectId: OTHER_PROJECT }],
        total: 1,
      }),
    });
    const h = new ToolHandlers(api, EP, "", "", V1);

    await h.handleToolCall("manage_snapshots", {
      operation: "decline",
      projectId: ID.project,
    });
    await h.handleToolCall("list_resources", {
      resourceType: "agent",
      projectId: OTHER_PROJECT,
    });
    const result: any = await h.handleToolCall("update_ai_agent", {
      aiAgentId: ID.agentV1,
      description: "new persona",
    });

    // The decline was for ID.project; the legacy agent lives in OTHER_PROJECT.
    expect(result.error).toBe("backup_not_offered");
    expect(api.patch).not.toHaveBeenCalled();
  });
});

describe("list hint wording", () => {
  it("sends `use` to talk_to_agent only and points changes at manage_agent", async () => {
    const api = makeApi({ v2: async () => ({ items: [v2Agent], total: 1 }) });
    const r: any = await new ToolHandlers(api, EP, "", "", V1).handleToolCall(
      "list_resources",
      { resourceType: "agent", projectId: ID.project },
    );

    // get_resource takes id, not aiAgentId/agentId — `use` would fail there.
    expect(r._hints.hint).not.toContain("talk_to_agent / get_resource");
    expect(r._hints.hint).toContain("plus projectId");
    expect(r._hints.hint).toContain("manage_agent");
  });
});

describe("always-on instructions", () => {
  it("makes AI Agents the default and keeps versions away from the user", () => {
    const line = SERVER_INSTRUCTIONS.split("\n").find((l) =>
      l.startsWith("AGENTS:"),
    )!;
    expect(line).toContain("call check_capabilities once");
    expect(line).toContain("build AI Agents with manage_agent");
    expect(line).toContain("create_ai_agent (legacy: true) only when");
    expect(line).toContain('never say V1, V2 or "Agents V2" to the user');
  });
});
