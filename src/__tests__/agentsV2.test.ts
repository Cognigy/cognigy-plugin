import { describe, it, expect, jest } from "@jest/globals";
import { ToolHandlers } from "../tools/handlers.js";
import {
  agentsV2BaseUrl,
  builtinToolParameters,
  findOrCreateAgentEndpoint,
} from "../tools/agentsV2.js";

const ID = {
  project: "507f1f77bcf86cd799439011",
  agent: "60d5ec49f1a2c8b1a4e0f101",
  skill: "60d5ec49f1a2c8b1a4e0f303",
};
const V1 = "https://api-trial.cognigy.ai";
const EP = "https://endpoint-trial.cognigy.ai";
const LLM = "5a255e2f-94b9-46ab-bfb7-4e407e68ef69";

const descriptor = {
  slug: "http-request",
  parameters: [
    {
      key: "method",
      name: "Method",
      mode: "dynamic",
      type: "string",
      value: "GET",
    },
    { key: "url", name: "URL", mode: "dynamic", type: "string", value: "" },
    {
      key: "payload",
      name: "Payload",
      mode: "dynamic",
      type: "object",
      value: {},
    },
    {
      key: "auth",
      name: "Auth",
      mode: "dynamic",
      type: "connection",
      value: "",
      connectionTypes: ["http_customHeader"],
    },
  ],
};

const httpError = (status: number, message = `HTTP ${status}`) =>
  Object.assign(new Error(message), { status });

type Route = (body?: any, config?: any) => any;

/**
 * An API mock routed by "METHOD url". The capability probe is answered as
 * "AI Agents and the custom system prompt are available" unless overridden.
 */
function routedApi(routes: Record<string, Route>) {
  const all: Record<string, Route> = {
    [`GET ${V1}/v1/agents`]: () => ({ items: [], total: 0 }),
    [`GET ${V1}/v1/agents/capability-probe/system-prompt`]: () => {
      throw httpError(400);
    },
    [`GET ${V1}/v1/agentpersonas`]: () => ({
      items: [{ referenceId: "persona-ref", name: "Brand" }],
      total: 1,
    }),
    ...routes,
  };
  const call =
    (method: string) =>
    async (url: string, a?: any, b?: any): Promise<any> => {
      const route = all[`${method} ${url}`];
      if (!route) throw new Error(`unexpected ${method} ${url}`);
      return method === "GET" || method === "DELETE"
        ? route(undefined, a)
        : route(a, b);
    };
  return {
    get: jest.fn(call("GET")),
    post: jest.fn(call("POST")),
    patch: jest.fn(call("PATCH")),
    put: jest.fn(call("PUT")),
    delete: jest.fn(call("DELETE")),
  } as any;
}

const handlers = (api: any) => new ToolHandlers(api, EP, "", "", V1);
const agentRecord = {
  id: ID.agent,
  referenceId: "agent-ref",
  name: "Bot",
  projectId: ID.project,
};

describe("AI Agents base URL and endpoint", () => {
  it("derives the service-agents root from the API base URL", () => {
    expect(agentsV2BaseUrl("https://api-trial.cognigy.ai/new")).toBe(V1);
  });

  it("reuses an existing REST endpoint that targets the agent", async () => {
    const api = routedApi({
      "GET /v2.0/endpoints": () => ({
        items: [
          { channel: "rest", agentId: "other", URLToken: "x" },
          { channel: "rest", agentId: "agent-ref", URLToken: "tok" },
        ],
      }),
    });
    const r = await findOrCreateAgentEndpoint(api, ID.project, {
      referenceId: "agent-ref",
    });
    expect(r.autoCreated).toBe(false);
    expect(r.endpoint.URLToken).toBe("tok");
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe("check_capabilities", () => {
  it("reports AI Agents off for an org outside the whitelist, once per session", async () => {
    const api = routedApi({
      [`GET ${V1}/v1/agents`]: () => {
        throw httpError(403, "forbidden");
      },
    });
    const h = handlers(api);
    const r: any = await h.handleToolCall("check_capabilities", {});
    await h.handleToolCall("check_capabilities", {});

    expect(r.aiAgents).toBe("unavailable");
    expect(r.customSystemPrompt).toBe("unavailable");
    expect(r.detail[0]).toContain("not enabled for this organisation");
    expect(r._hints.action).toContain("create_ai_agent");
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("tells a permission 403 apart from the whitelist and retries when unsure", async () => {
    const api = routedApi({
      [`GET ${V1}/v1/agents`]: () => {
        throw httpError(403, "access denied: insufficient permissions");
      },
    });
    const h = handlers(api);
    const r: any = await h.handleToolCall("check_capabilities", {});
    await h.handleToolCall("check_capabilities", {});

    expect(r.aiAgents).toBe("unknown");
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("reads the custom system prompt flag from the gated route", async () => {
    const api = routedApi({
      [`GET ${V1}/v1/agents/capability-probe/system-prompt`]: () => {
        throw httpError(404);
      },
    });
    const r: any = await handlers(api).handleToolCall("check_capabilities", {});
    expect(r).toMatchObject({
      aiAgents: "available",
      customSystemPrompt: "unavailable",
    });
  });
});

describe("manage_agent", () => {
  it("creates an agent with its settings and a REST endpoint", async () => {
    const api = routedApi({
      "GET /v2.0/locales": () => ({
        items: [{ referenceId: "loc-1", projectReference: ID.project }],
      }),
      [`POST ${V1}/v1/agents`]: () => agentRecord,
      "GET /v2.0/endpoints": () => ({ items: [] }),
      "POST /v2.0/endpoints": () => ({ _id: "ep-1", URLToken: "tok" }),
    });
    const r: any = await handlers(api).handleToolCall("manage_agent", {
      operation: "create",
      projectId: ID.project,
      name: "Bot",
      role: "Support specialist",
      instructions: "Be helpful",
      largeLanguageModelReferenceId: LLM,
      llmConfig: { temperature: 0.2 },
      knowledge: { ragMode: "agent" },
    });

    const [, body] = api.post.mock.calls[0];
    expect(body).toEqual({
      projectId: ID.project,
      localeReferenceId: "loc-1",
      name: "Bot",
      role: "Support specialist",
      instructions: "Be helpful",
      largeLanguageModelReferenceId: LLM,
      llmConfig: { temperature: 0.2 },
      knowledge: { ragMode: "agent" },
      personaReferenceId: "persona-ref",
    });
    expect(api.post.mock.calls[1][1]).toMatchObject({
      channel: "rest",
      targetType: "agent",
      agentId: "agent-ref",
    });
    expect(r.endpointUrl).toBe(`${EP}/tok`);
    expect(r.use).toEqual({ agentId: ID.agent });
    expect(r._hints.action).toContain(`agentId: "${ID.agent}"`);
  });

  it("binds the model create_ai_agent would pick when no LLM is given", async () => {
    const api = routedApi({
      "GET /v2.0/locales": () => ({ items: [{ referenceId: "loc-1" }] }),
      "GET /new/v2.0/largelanguagemodels": () => ({
        items: [
          { referenceId: "broken", isDefault: true },
          { referenceId: "nice", isInPlatformLlm: true, modelType: "gpt-x" },
        ],
      }),
      [`POST ${V1}/v1/agents`]: () => agentRecord,
    });
    const r: any = await handlers(api).handleToolCall("manage_agent", {
      operation: "create",
      projectId: ID.project,
      name: "Bot",
      createEndpoint: false,
    });
    expect(api.post.mock.calls[0][1].largeLanguageModelReferenceId).toBe(
      "nice",
    );
    expect(r.llm).toEqual({
      referenceId: "nice",
      isDefault: false,
      connected: true,
    });
    expect(r._hints.action).toContain("talk_to_agent");
  });

  it("says so when the project has no text LLM for a new agent", async () => {
    const api = routedApi({
      "GET /v2.0/locales": () => ({ items: [{ referenceId: "loc-1" }] }),
      "GET /new/v2.0/largelanguagemodels": () => ({ items: [] }),
      [`POST ${V1}/v1/agents`]: () => agentRecord,
    });
    const r: any = await handlers(api).handleToolCall("manage_agent", {
      operation: "create",
      projectId: ID.project,
      name: "Bot",
      createEndpoint: false,
    });
    expect(api.post.mock.calls[0][1]).not.toHaveProperty(
      "largeLanguageModelReferenceId",
    );
    expect(r.llm).toBeUndefined();
    expect(r._hints.action).toContain("no text LLM");
  });

  it("waits for service-agents to know a project it just created", async () => {
    ToolHandlers.NEW_PROJECT_RETRY_MS = 0;
    let calls = 0;
    const api = routedApi({
      "POST /v2.0/projects": () => ({ _id: ID.project }),
      "GET /v2.0/locales": () => ({ items: [{ referenceId: "loc-1" }] }),
      [`POST ${V1}/v1/agents`]: () => {
        if (++calls < 3)
          throw httpError(403, "access denied: project not authorized");
        return agentRecord;
      },
    });
    const r: any = await handlers(api).handleToolCall("manage_agent", {
      operation: "create",
      name: "Bot",
      largeLanguageModelReferenceId: LLM,
      createEndpoint: false,
    });
    expect(calls).toBe(3);
    expect(r.createdProject).toBe(true);
    expect(r.use).toEqual({ agentId: ID.agent });
  });

  it("does not retry a 403 for a project it did not create", async () => {
    const api = routedApi({
      "GET /v2.0/locales": () => ({ items: [{ referenceId: "loc-1" }] }),
      [`POST ${V1}/v1/agents`]: () => {
        throw httpError(403, "access denied: project not authorized");
      },
    });
    await expect(
      handlers(api).handleToolCall("manage_agent", {
        operation: "create",
        projectId: ID.project,
        name: "Bot",
        largeLanguageModelReferenceId: LLM,
      }),
    ).rejects.toThrow("not authorized");
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it("hands back the project it created when the agent fails", async () => {
    const api = routedApi({
      "POST /v2.0/projects": () => ({ _id: ID.project }),
      "GET /v2.0/locales": () => ({ items: [{ referenceId: "loc-1" }] }),
      [`POST ${V1}/v1/agents`]: () => {
        throw httpError(400, "instructions too long");
      },
    });
    const r: any = await handlers(api).handleToolCall("manage_agent", {
      operation: "create",
      name: "Bot",
      largeLanguageModelReferenceId: LLM,
      createEndpoint: false,
    });
    expect(r).toMatchObject({ projectId: ID.project, projectCreated: true });
    expect(r.error).toContain("instructions too long");
    expect(r._hints.action).toContain(`projectId: "${ID.project}"`);
  });

  it("keeps the stored safety toggles an update does not name", async () => {
    const api = routedApi({
      [`GET ${V1}/v1/agents/${ID.agent}`]: () => ({
        ...agentRecord,
        guardrails: {
          safetySettings: {
            avoidHarmfulContent: true,
            avoidUngroundedContent: true,
            avoidCopyrightInfringements: true,
            preventJailbreakAndManipulation: true,
          },
        },
      }),
      [`PATCH ${V1}/v1/agents/${ID.agent}`]: (body) => ({
        ...agentRecord,
        ...body,
      }),
    });
    const h = handlers(api);
    await h.handleToolCall("manage_snapshots", {
      operation: "decline",
      projectId: ID.project,
    });
    await h.handleToolCall("manage_agent", {
      operation: "update",
      agentId: ID.agent,
      projectId: ID.project,
      guardrails: { safetySettings: { avoidCopyrightInfringements: false } },
    });
    expect(api.patch.mock.calls[0][1].guardrails.safetySettings).toEqual({
      avoidHarmfulContent: true,
      avoidUngroundedContent: true,
      avoidCopyrightInfringements: false,
      preventJailbreakAndManipulation: true,
    });
  });

  it("refuses to remove the persona, which the UI requires", async () => {
    const api = routedApi({});
    await expect(
      handlers(api).handleToolCall("manage_agent", {
        operation: "update",
        agentId: ID.agent,
        projectId: ID.project,
        personaReferenceId: "",
      }),
    ).rejects.toThrow(/personaReferenceId/);
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("gives a new agent the project's first persona", async () => {
    const api = routedApi({
      "GET /v2.0/locales": () => ({ items: [{ referenceId: "loc-1" }] }),
      [`POST ${V1}/v1/agents`]: () => agentRecord,
    });
    const r: any = await handlers(api).handleToolCall("manage_agent", {
      operation: "create",
      projectId: ID.project,
      name: "Bot",
      largeLanguageModelReferenceId: LLM,
      createEndpoint: false,
    });
    expect(api.post.mock.calls[0][1].personaReferenceId).toBe("persona-ref");
    expect(r.persona).toEqual({
      referenceId: "persona-ref",
      name: "Brand",
      created: false,
    });
  });

  it("makes the UI's default persona when the project has none", async () => {
    const api = routedApi({
      "GET /v2.0/locales": () => ({ items: [{ referenceId: "loc-1" }] }),
      [`GET ${V1}/v1/agentpersonas`]: () => ({ items: [], total: 0 }),
      [`POST ${V1}/v1/agentpersonas`]: (body) => ({
        ...body,
        referenceId: "new-persona",
      }),
      [`POST ${V1}/v1/agents`]: () => agentRecord,
    });
    const r: any = await handlers(api).handleToolCall("manage_agent", {
      operation: "create",
      projectId: ID.project,
      name: "Bot",
      largeLanguageModelReferenceId: LLM,
      createEndpoint: false,
    });
    const [personaCall, agentCall] = api.post.mock.calls;
    expect(personaCall[1]).toMatchObject({
      name: "NiCE",
      projectId: ID.project,
      voiceConfig: { ttsVendor: "ElevenLabs" },
    });
    expect(agentCall[1].personaReferenceId).toBe("new-persona");
    expect(r.persona.created).toBe(true);
  });

  it("keeps a persona the caller names", async () => {
    const api = routedApi({
      "GET /v2.0/locales": () => ({ items: [{ referenceId: "loc-1" }] }),
      [`POST ${V1}/v1/agents`]: () => agentRecord,
    });
    const named = "5a255e2f-94b9-46ab-bfb7-4e407e68ef70";
    await handlers(api).handleToolCall("manage_agent", {
      operation: "create",
      projectId: ID.project,
      name: "Bot",
      largeLanguageModelReferenceId: LLM,
      personaReferenceId: named,
      createEndpoint: false,
    });
    expect(api.post.mock.calls[0][1].personaReferenceId).toBe(named);
    expect(
      api.get.mock.calls.some((c: any[]) => c[0] === `${V1}/v1/agentpersonas`),
    ).toBe(false);
  });

  it("creates a pre-turn hook Flow with its closing node, without a backup hold", async () => {
    const api = routedApi({
      [`POST /v2.0/flows`]: (body) => ({
        _id: "6af33f8a694c26ad820bf927",
        referenceId: "flow-ref",
        ...body,
      }),
      [`GET /v2.0/flows/6af33f8a694c26ad820bf927/chart`]: () => ({
        nodes: [
          { _id: "end-1", type: "end" },
          { _id: "start-1", type: "start" },
        ],
      }),
      [`POST /v2.0/flows/6af33f8a694c26ad820bf927/chart/nodes`]: () => ({
        _id: "node-1",
      }),
    });
    const r: any = await handlers(api).handleToolCall("manage_agent", {
      operation: "create_flow",
      projectId: ID.project,
      flowType: "preTurn",
      name: "Tag VIPs",
    });
    expect(api.post.mock.calls[0][1]).toEqual({
      projectId: ID.project,
      name: "Tag VIPs",
      kind: "preTurnFlow",
    });
    expect(api.post.mock.calls[1][1]).toMatchObject({
      type: "agentV2ContinueToAgent",
      mode: "append",
      target: "start-1",
    });
    expect(r).toMatchObject({
      flowReferenceId: "flow-ref",
      closingNodeId: "node-1",
    });
    expect(r._hints.action).toContain('flowReferenceId: "flow-ref"');
  });

  it("creates an Execute Tool Flow Flow ending in Tool Result", async () => {
    const api = routedApi({
      [`POST /v2.0/flows`]: (body) => ({
        _id: "f1",
        referenceId: "r1",
        ...body,
      }),
      [`GET /v2.0/flows/f1/chart`]: () => ({
        nodes: [{ _id: "start-1", type: "start" }],
      }),
      [`POST /v2.0/flows/f1/chart/nodes`]: () => ({ _id: "node-1" }),
    });
    const r: any = await handlers(api).handleToolCall("manage_agent", {
      operation: "create_flow",
      projectId: ID.project,
      flowType: "tool",
      name: "Order lookup",
    });
    expect(api.post.mock.calls[0][1].kind).toBe("flowExecutionTool");
    expect(api.post.mock.calls[1][1]).toMatchObject({
      type: "agentV2ResolveToolAction",
      config: { answer: "{{JSON.stringify(input.data.toolArgs)}}" },
    });
    expect(r._hints.action).toContain('builtinSlug: "execute-tool-flow"');
  });

  it("creates nothing where AI Agents are unavailable", async () => {
    const api = routedApi({
      [`GET ${V1}/v1/agents`]: () => {
        throw httpError(404);
      },
    });
    const r: any = await handlers(api).handleToolCall("manage_agent", {
      operation: "create",
      projectId: ID.project,
      name: "Bot",
    });
    expect(r.error).toBe("ai_agents_unavailable");
    expect(api.post).not.toHaveBeenCalled();
  });

  it("creates no hook Flow where AI Agents are unavailable", async () => {
    const api = routedApi({
      [`GET ${V1}/v1/agents`]: () => {
        throw httpError(403, "forbidden");
      },
    });
    const r: any = await handlers(api).handleToolCall("manage_agent", {
      operation: "create_flow",
      projectId: ID.project,
      flowType: "preTurn",
      name: "Hook",
    });
    expect(r.error).toBe("ai_agents_unavailable");
    expect(api.post).not.toHaveBeenCalled();
  });

  it("explains a bare 403 from service-agents only where AI Agents are unavailable", async () => {
    const forbidden = () => {
      throw Object.assign(httpError(403, "forbidden"), {
        url: `${V1}/v1/tools`,
      });
    };
    const off = routedApi({
      [`GET ${V1}/v1/agents`]: () => {
        throw httpError(403, "forbidden");
      },
      [`GET ${V1}/v1/tools`]: forbidden,
    });
    const args = {
      operation: "list",
      component: "tool",
      projectId: ID.project,
    };
    const r: any = await handlers(off).handleToolCall(
      "manage_agent_components",
      args,
    );
    expect(r.error).toBe("ai_agents_unavailable");
    expect(r._hints.action).toContain("talk_to_agent { aiAgentId }");

    const on = routedApi({ [`GET ${V1}/v1/tools`]: forbidden });
    await expect(
      handlers(on).handleToolCall("manage_agent_components", args),
    ).rejects.toThrow("forbidden");
  });

  it("offers no backup for an update that cannot run without AI Agents", async () => {
    const api = routedApi({
      [`GET ${V1}/v1/agents`]: () => {
        throw httpError(403, "forbidden");
      },
      [`PATCH ${V1}/v1/agents/${ID.agent}`]: () => {
        throw Object.assign(httpError(403, "forbidden"), {
          url: `${V1}/v1/agents/${ID.agent}`,
        });
      },
    });
    const r: any = await handlers(api).handleToolCall("manage_agent", {
      operation: "update",
      agentId: ID.agent,
      projectId: ID.project,
      role: "Support",
    });
    expect(r.error).toBe("ai_agents_unavailable");
  });

  it("holds the first update for a backup, then patches only what was passed", async () => {
    const api = routedApi({
      [`PATCH ${V1}/v1/agents/${ID.agent}`]: (body) => ({
        ...agentRecord,
        ...body,
      }),
    });
    const h = handlers(api);
    const update = {
      operation: "update",
      agentId: ID.agent,
      projectId: ID.project,
      instructions: "New rules",
    };

    const held: any = await h.handleToolCall("manage_agent", update);
    expect(held.error).toBe("backup_not_offered");
    expect(api.patch).not.toHaveBeenCalled();

    await h.handleToolCall("manage_snapshots", {
      operation: "decline",
      projectId: ID.project,
    });
    const r: any = await h.handleToolCall("manage_agent", update);
    expect(api.patch).toHaveBeenCalledWith(
      `${V1}/v1/agents/${ID.agent}`,
      { instructions: "New rules" },
      { params: { projectId: ID.project } },
    );
    expect(r.agent.instructions).toBe("New rules");
  });

  it("does not hold changes to an agent created this session", async () => {
    const api = routedApi({
      "GET /v2.0/locales": () => ({ items: [{ referenceId: "loc-1" }] }),
      [`POST ${V1}/v1/agents`]: () => agentRecord,
      [`PATCH ${V1}/v1/agents/${ID.agent}`]: () => agentRecord,
    });
    const h = handlers(api);
    await h.handleToolCall("manage_agent", {
      operation: "create",
      projectId: ID.project,
      name: "Bot",
      createEndpoint: false,
    });
    const r: any = await h.handleToolCall("manage_agent", {
      operation: "update",
      agentId: ID.agent,
      projectId: ID.project,
      role: "Greeter",
    });
    expect(r.updated).toBe(true);
  });

  it("says so when the environment has no custom system prompt", async () => {
    const api = routedApi({
      [`GET ${V1}/v1/agents/capability-probe/system-prompt`]: () => {
        throw httpError(404);
      },
    });
    const r: any = await handlers(api).handleToolCall("manage_agent", {
      operation: "get_system_prompt",
      agentId: ID.agent,
      projectId: ID.project,
    });
    expect(r.error).toBe("custom_system_prompt_unavailable");
  });

  it("saves a custom system prompt with PUT", async () => {
    const api = routedApi({
      [`PUT ${V1}/v1/agents/${ID.agent}/system-prompt`]: (body) => ({
        isCustomized: true,
        template: body.template,
      }),
    });
    const h = handlers(api);
    await h.handleToolCall("manage_snapshots", {
      operation: "decline",
      projectId: ID.project,
    });
    const r: any = await h.handleToolCall("manage_agent", {
      operation: "save_system_prompt",
      agentId: ID.agent,
      projectId: ID.project,
      template: "You are [[agent.name]].",
      acknowledgeRisk: true,
    });
    expect(api.put.mock.calls[0][1]).toEqual({
      projectId: ID.project,
      template: "You are [[agent.name]].",
      acknowledgeRisk: true,
    });
    expect(r.isCustomized).toBe(true);
  });
});

describe("manage_agent_components", () => {
  it("builds a builtin tool's parameters from the live descriptor", () => {
    const params = builtinToolParameters(descriptor, {
      method: "POST",
      url: "https://x.test/",
      payload: { mode: "aiFilled" },
    });
    const byKey = Object.fromEntries(params.map((p) => [p.key, p]));
    expect(byKey.method).toMatchObject({ mode: "dynamic", value: "POST" });
    expect(byKey.url.value).toBe("https://x.test/");
    expect(byKey.payload).toMatchObject({ mode: "aiFilled", value: null });
    expect(byKey.auth.connectionTypes).toEqual(["http_customHeader"]);
  });

  it("makes a parameter dynamic when given a plain value, unless its mode is locked", () => {
    const params = builtinToolParameters(
      {
        parameters: [
          { key: "url", name: "URL", mode: "aiFilled", type: "string" },
          {
            key: "to",
            name: "To",
            mode: "dynamic",
            modeLocked: true,
            type: "string",
            value: "",
          },
        ],
      },
      { url: "https://x.test/", to: "a@b.test" },
    );
    expect(params[0]).toMatchObject({
      mode: "dynamic",
      value: "https://x.test/",
    });
    expect(params[1]).toMatchObject({ mode: "dynamic", value: "a@b.test" });
  });

  it("rejects parameter keys the descriptor does not have", () => {
    expect(() => builtinToolParameters(descriptor, { verb: "GET" })).toThrow(
      /Unknown parameter\(s\) verb/,
    );
  });

  it.each(["mcp_server", "persona"])(
    "creates no %s when agentId asks to attach it",
    async (component) => {
      const api = routedApi({});
      await expect(
        handlers(api).handleToolCall("manage_agent_components", {
          operation: "create",
          component,
          projectId: ID.project,
          config: { name: "X" },
          agentId: ID.agent,
        }),
      ).rejects.toThrow(/attaches skills and tools only/);
      expect(api.post).not.toHaveBeenCalled();
      expect(api.patch).not.toHaveBeenCalled();
    },
  );

  it("passes extra execute-tool-flow parameters as the Flow's arguments", () => {
    const params = builtinToolParameters(
      {
        slug: "execute-tool-flow",
        parameters: [
          {
            key: "flowReferenceId",
            name: "flowReferenceId",
            mode: "dynamic",
            modeLocked: true,
            type: "string",
            value: "",
          },
        ],
      },
      {
        flowReferenceId: "flow-ref",
        orderId: { description: "The order to look up" },
        region: "EU",
      },
    );
    expect(params).toEqual([
      expect.objectContaining({ key: "flowReferenceId", value: "flow-ref" }),
      {
        key: "orderId",
        name: "orderId",
        description: "The order to look up",
        mode: "aiFilled",
        type: "string",
        value: null,
      },
      {
        key: "region",
        name: "region",
        description: "",
        mode: "dynamic",
        type: "string",
        value: "EU",
      },
    ]);
  });

  it("creates a builtin tool and attaches it to an existing agent", async () => {
    const api = routedApi({
      [`GET ${V1}/v1/builtin-tools/http-request`]: () => descriptor,
      [`POST ${V1}/v1/tools`]: () => ({
        id: "tool-1",
        referenceId: "tool-ref",
        name: "Weather",
        source: "builtin",
      }),
      [`GET ${V1}/v1/agents/${ID.agent}`]: () => ({
        ...agentRecord,
        toolReferenceIds: ["old-ref"],
      }),
      [`PATCH ${V1}/v1/agents/${ID.agent}`]: () => agentRecord,
    });
    const h = handlers(api);
    await h.handleToolCall("manage_snapshots", {
      operation: "decline",
      projectId: ID.project,
    });
    const r: any = await h.handleToolCall("manage_agent_components", {
      operation: "create",
      component: "tool",
      projectId: ID.project,
      agentId: ID.agent,
      config: {
        builtinSlug: "http-request",
        name: "Weather",
        description: "Get the weather",
        parameters: { url: "https://wttr.in/" },
      },
    });

    expect(api.post.mock.calls[0][1]).toMatchObject({
      source: "builtin",
      type: "http-request",
      builtinSlug: "http-request",
      projectId: ID.project,
    });
    expect(api.patch).toHaveBeenCalledWith(
      `${V1}/v1/agents/${ID.agent}`,
      { toolReferenceIds: ["old-ref", "tool-ref"] },
      { params: { projectId: ID.project } },
    );
    expect(r.attached.changed).toBe(true);
  });

  it("does not hold creating a component that no agent uses yet", async () => {
    const api = routedApi({
      [`POST ${V1}/v1/skills`]: () => ({ id: ID.skill, referenceId: "s-ref" }),
    });
    const r: any = await handlers(api).handleToolCall(
      "manage_agent_components",
      {
        operation: "create",
        component: "skill",
        projectId: ID.project,
        config: { name: "Refunds", instructions: "..." },
      },
    );
    expect(r.referenceId).toBe("s-ref");
  });

  it("holds attaching a new skill to an older agent", async () => {
    const api = routedApi({
      [`POST ${V1}/v1/skills`]: () => ({ id: ID.skill, referenceId: "s-ref" }),
    });
    const h = handlers(api);
    await h.handleToolCall("manage_agent_components", {
      operation: "create",
      component: "skill",
      projectId: ID.project,
      config: { name: "Refunds" },
    });
    const r: any = await h.handleToolCall("manage_agent_components", {
      operation: "attach",
      component: "skill",
      projectId: ID.project,
      componentId: "s-ref",
      agentId: ID.agent,
    });
    expect(r.error).toBe("backup_not_offered");
  });

  it("detaches by id, resolving the referenceId first", async () => {
    const api = routedApi({
      [`GET ${V1}/v1/skills/${ID.skill}`]: () => ({ referenceId: "s-ref" }),
      [`GET ${V1}/v1/agents/${ID.agent}`]: () => ({
        skillReferenceIds: ["s-ref", "keep"],
      }),
      [`PATCH ${V1}/v1/agents/${ID.agent}`]: () => ({}),
    });
    const h = handlers(api);
    await h.handleToolCall("manage_snapshots", {
      operation: "decline",
      projectId: ID.project,
    });
    const r: any = await h.handleToolCall("manage_agent_components", {
      operation: "detach",
      component: "skill",
      projectId: ID.project,
      componentId: ID.skill,
      agentId: ID.agent,
    });
    expect(r.skillReferenceIds).toEqual(["keep"]);
  });

  it("takes a deleted skill off the agents that still use it", async () => {
    const api = routedApi({
      [`GET ${V1}/v1/skills/${ID.skill}`]: () => ({ referenceId: "s-ref" }),
      [`DELETE ${V1}/v1/skills/${ID.skill}`]: () => ({}),
      [`GET ${V1}/v1/agents`]: () => ({
        items: [
          { id: ID.agent, skillReferenceIds: ["s-ref", "keep"] },
          { id: "other", skillReferenceIds: ["keep"] },
        ],
        total: 2,
      }),
      [`GET ${V1}/v1/agents/${ID.agent}`]: () => ({
        skillReferenceIds: ["s-ref", "keep"],
      }),
      [`PATCH ${V1}/v1/agents/${ID.agent}`]: () => ({}),
    });
    const h = handlers(api);
    await h.handleToolCall("manage_snapshots", {
      operation: "decline",
      projectId: ID.project,
    });
    const r: any = await h.handleToolCall("manage_agent_components", {
      operation: "delete",
      component: "skill",
      projectId: ID.project,
      componentId: ID.skill,
    });
    expect(r.detachedFrom).toEqual([ID.agent]);
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(api.patch.mock.calls[0][1]).toEqual({ skillReferenceIds: ["keep"] });
  });

  it("deletes no persona that an agent still uses", async () => {
    const api = routedApi({
      [`GET ${V1}/v1/agentpersonas/p1`]: () => ({ referenceId: "p-ref" }),
      [`GET ${V1}/v1/agents`]: () => ({
        items: [
          { id: ID.agent, name: "Bot", personaReferenceId: "p-ref" },
          { id: "other", name: "Other", personaReferenceId: "x" },
        ],
        total: 2,
      }),
    });
    const h = handlers(api);
    await h.handleToolCall("manage_snapshots", {
      operation: "decline",
      projectId: ID.project,
    });
    const r: any = await h.handleToolCall("manage_agent_components", {
      operation: "delete",
      component: "persona",
      projectId: ID.project,
      componentId: "p1",
    });
    expect(r).toMatchObject({
      error: "persona_in_use",
      changed: false,
      agents: [{ id: ID.agent, name: "Bot" }],
    });
    expect(api.delete).not.toHaveBeenCalled();
  });

  it("deletes no skill while the agents that use it cannot be listed", async () => {
    const api = routedApi({
      [`GET ${V1}/v1/skills/${ID.skill}`]: () => ({ referenceId: "s-ref" }),
      [`GET ${V1}/v1/agents`]: (_: any, opts: any) => {
        if (opts?.params?.limit === 100) throw httpError(500, "boom");
        return { items: [], total: 0 };
      },
    });
    const h = handlers(api);
    await h.handleToolCall("manage_snapshots", {
      operation: "decline",
      projectId: ID.project,
    });
    await expect(
      h.handleToolCall("manage_agent_components", {
        operation: "delete",
        component: "skill",
        projectId: ID.project,
        componentId: ID.skill,
      }),
    ).rejects.toThrow(/Skill not deleted/);
    expect(api.delete).not.toHaveBeenCalled();
  });

  it("keeps both skills when two attaches to one agent run in parallel", async () => {
    let stored: string[] = [];
    const api = routedApi({
      [`GET ${V1}/v1/agents/${ID.agent}`]: async () => {
        const seen = [...stored];
        await new Promise((r) => setTimeout(r, 5));
        return { skillReferenceIds: seen };
      },
      [`PATCH ${V1}/v1/agents/${ID.agent}`]: (body: any) => {
        stored = body.skillReferenceIds;
        return {};
      },
    });
    const h = handlers(api);
    await h.handleToolCall("manage_snapshots", {
      operation: "decline",
      projectId: ID.project,
    });
    const attach = (componentId: string) =>
      h.handleToolCall("manage_agent_components", {
        operation: "attach",
        component: "skill",
        projectId: ID.project,
        componentId,
        agentId: ID.agent,
      });
    await Promise.all([attach("s-1"), attach("s-2")]);
    expect([...stored].sort()).toEqual(["s-1", "s-2"]);
  });

  it("keeps a parameter's other fields when an update changes another one", async () => {
    const api = routedApi({
      [`GET ${V1}/v1/tools/t1`]: () => ({
        id: "t1",
        type: "execute-tool-flow",
        parameters: [
          {
            key: "flowReferenceId",
            name: "Flow",
            mode: "dynamic",
            type: "string",
            value: "old-flow",
          },
          {
            key: "count",
            name: "count",
            mode: "aiFilled",
            type: "number",
            value: null,
            default: 5,
          },
        ],
      }),
      [`PATCH ${V1}/v1/tools/t1`]: (body: any) => body,
    });
    const h = handlers(api);
    await h.handleToolCall("manage_snapshots", {
      operation: "decline",
      projectId: ID.project,
    });
    await h.handleToolCall("manage_agent_components", {
      operation: "update",
      component: "tool",
      projectId: ID.project,
      componentId: "t1",
      config: { parameters: { flowReferenceId: "new-flow" } },
    });
    const sent = api.patch.mock.calls.find(
      (c: any[]) => c[0] === `${V1}/v1/tools/t1`,
    )[1];
    expect(sent.parameters).toEqual([
      expect.objectContaining({ key: "flowReferenceId", value: "new-flow" }),
      expect.objectContaining({ key: "count", default: 5 }),
    ]);
  });

  it("syncs MCP tools with everything discovery showed as reviewed", async () => {
    const api = routedApi({
      [`GET ${V1}/v1/mcp-servers/m1/tools`]: () => ({
        items: [{ name: "search" }, { name: "book" }],
      }),
      [`POST ${V1}/v1/mcp-servers/m1/tools/sync`]: (body) => body,
    });
    const h = handlers(api);
    await h.handleToolCall("manage_snapshots", {
      operation: "decline",
      projectId: ID.project,
    });
    const r: any = await h.handleToolCall("manage_agent_components", {
      operation: "sync_tools",
      component: "mcp_server",
      projectId: ID.project,
      componentId: "m1",
      import: ["search"],
    });
    expect(r).toEqual({
      projectId: ID.project,
      import: ["search"],
      remove: [],
      reviewedToolNames: ["search", "book"],
    });
  });
});

describe("legacy guard on create_ai_agent", () => {
  it("points a new project at manage_agent where AI Agents exist", async () => {
    const api = routedApi({
      "GET /v2.0/aiagents": () => ({ items: [], total: 0 }),
    });
    const r: any = await handlers(api).handleToolCall("create_ai_agent", {
      projectId: ID.project,
      name: "Bot",
    });
    expect(r.error).toBe("use_manage_agent");
    expect(api.post).not.toHaveBeenCalled();
  });

  it("lets a legacy-only project through", async () => {
    const api = routedApi({
      "GET /v2.0/aiagents": () => ({ items: [{ _id: "x" }], total: 1 }),
    });
    const r: any = await handlers(api)
      .handleToolCall("create_ai_agent", { projectId: ID.project, name: "Bot" })
      .catch((e: any) => ({ error: e.message }));
    expect(r.error).not.toBe("use_manage_agent");
  });

  it("ignores agents marked for deletion", async () => {
    // Only deleted legacy agents: the project counts as empty.
    let api = routedApi({
      "GET /v2.0/aiagents": () => ({
        items: [{ _id: "x", name: "DELETE_Old bot" }],
        total: 1,
      }),
    });
    let r: any = await handlers(api).handleToolCall("create_ai_agent", {
      projectId: ID.project,
      name: "Bot",
    });
    expect(r.error).toBe("use_manage_agent");

    // Live legacy agents next to deleted AI Agents: legacy-only.
    api = routedApi({
      "GET /v2.0/aiagents": () => ({
        items: [{ _id: "x", name: "Shop bot" }],
        total: 1,
      }),
      [`GET ${V1}/v1/agents`]: () => ({
        items: [{ id: "y", name: "DELETE_Old agent" }],
        total: 1,
      }),
    });
    r = await handlers(api)
      .handleToolCall("create_ai_agent", { projectId: ID.project, name: "Bot" })
      .catch((e: any) => ({ error: e.message }));
    expect(r.error).not.toBe("use_manage_agent");
  });

  it("lets legacy: true through", async () => {
    const api = routedApi({});
    const r: any = await handlers(api)
      .handleToolCall("create_ai_agent", {
        projectId: ID.project,
        name: "Bot",
        legacy: true,
      })
      .catch((e: any) => ({ error: e.message }));
    expect(r.error).not.toBe("use_manage_agent");
  });
});

describe("delete_resource and endpoints for AI Agents", () => {
  it("renames the agent and deactivates the endpoints that target it", async () => {
    const api = routedApi({
      [`GET ${V1}/v1/agents/${ID.agent}`]: () => agentRecord,
      [`PATCH ${V1}/v1/agents/${ID.agent}?projectId=${ID.project}`]: () => ({}),
      "GET /v2.0/endpoints": () => ({
        items: [
          { _id: "ep-1", agentId: "agent-ref" },
          { _id: "ep-2", agentId: "other" },
        ],
      }),
      "PATCH /v2.0/endpoints/ep-1": () => ({}),
    });
    const h = handlers(api);
    await h.handleToolCall("manage_snapshots", {
      operation: "decline",
      projectId: ID.project,
    });
    const r: any = await h.handleToolCall("delete_resource", {
      resourceType: "agent",
      id: ID.agent,
      projectId: ID.project,
    });

    expect(api.patch).toHaveBeenCalledWith(
      `${V1}/v1/agents/${ID.agent}?projectId=${ID.project}`,
      { name: "DELETE_Bot" },
    );
    expect(r.endpoints.deactivated).toEqual(["endpoint:ep-1"]);
    expect(r._hints.warning).toContain("endpoints were deactivated");
  });

  it("aims a new webchat endpoint at the agent's referenceId", async () => {
    const api = routedApi({
      "GET /v2.0/locales": () => ({ items: [] }),
      [`GET ${V1}/v1/agents/${ID.agent}`]: () => agentRecord,
      "POST /v2.0/endpoints": () => ({ _id: "ep-9" }),
      "GET /v2.0/endpoints/ep-9": () => ({ _id: "ep-9", URLToken: "t" }),
    });
    await handlers(api)
      .handleToolCall("manage_webchat", {
        projectId: ID.project,
        agentId: ID.agent,
      })
      .catch(() => null);
    const create = api.post.mock.calls.find(
      (c: any[]) => c[0] === "/v2.0/endpoints",
    );
    expect(create[1]).toMatchObject({
      channel: "webchat3",
      targetType: "agent",
      agentId: "agent-ref",
      flowId: "",
    });
  });

  it.each([
    ["manage_webchat", "/v2.0/endpoints/60d5ec49f1a2c8b1a4e0f505"],
    ["manage_voice_gateway", "/new/v2.0/endpoints/60d5ec49f1a2c8b1a4e0f505"],
  ])(
    "%s re-points an endpoint from an AI Agent to a flow",
    async (tool, path) => {
      const api = routedApi({
        [`GET ${path}`]: () => ({
          _id: "60d5ec49f1a2c8b1a4e0f505",
          projectReference: ID.project,
          targetType: "agent",
          agentId: "agent-ref",
          flowId: "",
          settings: {},
        }),
        [`PATCH ${path}`]: () => ({}),
      });
      await handlers(api)
        .handleToolCall(tool, {
          endpointId: "60d5ec49f1a2c8b1a4e0f505",
          flowId: "flow-ref",
        })
        .catch(() => null);
      const patch = api.patch.mock.calls.find((c: any[]) => c[0] === path);
      expect(patch[1]).toMatchObject({
        flowId: "flow-ref",
        targetType: "flow",
        agentId: "",
      });
    },
  );

  it("talk_to_agent rejects agentId without projectId", async () => {
    await expect(
      handlers(routedApi({})).handleToolCall("talk_to_agent", {
        agentId: ID.agent,
        message: "hi",
      }),
    ).rejects.toThrow(/projectId/);
  });
});
