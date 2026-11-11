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
    [`GET ${V1}/v1/agents/capability-probe/voice-prompt`]: () => {
      throw httpError(400);
    },
    "GET /v2.0/projects": () => ({ items: [{ _id: ID.project }] }),
    "GET /v2.0/voice/speechCredentials": () => ({ data: [] }),
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
    const agentProbes = api.get.mock.calls.filter(
      (c: any[]) => c[0] === `${V1}/v1/agents`,
    );
    expect(agentProbes).toHaveLength(1);
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
    const agentProbes = api.get.mock.calls.filter(
      (c: any[]) => c[0] === `${V1}/v1/agents`,
    );
    expect(agentProbes).toHaveLength(2);
  });

  it("reads v2v from the voice-prompt route and niceSpeech from the speech providers", async () => {
    const api = routedApi({
      [`GET ${V1}/v1/agents/capability-probe/voice-prompt`]: () => {
        throw httpError(404);
      },
      "GET /v2.0/voice/speechCredentials": () => ({
        data: [{ vendor: "microsoft", systemProvided: true }],
      }),
    });
    const r: any = await handlers(api).handleToolCall("check_capabilities", {});
    expect(r).toMatchObject({ v2v: "unavailable", niceSpeech: "available" });
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

  it("removes the persona with an empty string", async () => {
    const api = routedApi({
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
      personaReferenceId: "",
    });
    expect(api.patch.mock.calls[0][1]).toEqual({ personaReferenceId: "" });
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

describe("voice settings for AI Agents", () => {
  const TOOL = "60d5ec49f1a2c8b1a4e0f404";
  const voiceDescriptor = {
    slug: "voice-config-defaults",
    name: "Voice defaults",
    description: "The voice settings every call starts from.",
    defaultParameters: [
      "ttsVendor",
      "ttsVoice",
      "ttsLanguage",
      "ttsLabel",
      "ttsCredentialReferenceId",
      "sttVendor",
      "sttLanguage",
      "sttLabel",
      "sttCredentialReferenceId",
    ]
      .map((key) => ({
        key,
        name: key,
        mode: "dynamic",
        modeLocked: true,
        type: "string",
        value: "",
      }))
      .concat([
        {
          key: "minWordsToInterrupt",
          name: "minWordsToInterrupt",
          mode: "dynamic",
          modeLocked: true,
          type: "number",
          value: 1,
        } as any,
      ]),
  };
  const nice = {
    id: "ffffffff84fd62f53ccab16b",
    referenceId: "nice-ms",
    name: "Included Speech Provider",
    vendor: "microsoft",
    systemProvided: true,
    useForTts: true,
    useForStt: true,
    isDefaultTts: true,
    status: { state: "ok" },
  };
  const sttOnly = {
    ...nice,
    id: "x2",
    referenceId: "nice-stt",
    vendor: "nice",
    useForTts: false,
    isDefaultTts: false,
  };

  function voiceApi(instance: any = null, extra: Record<string, Route> = {}) {
    let stored = instance;
    let refs: string[] = instance ? [instance.referenceId] : [];
    const api = routedApi({
      [`GET ${V1}/v1/agents/${ID.agent}`]: () => ({
        ...agentRecord,
        toolReferenceIds: refs,
      }),
      [`PATCH ${V1}/v1/agents/${ID.agent}`]: (body) => {
        refs = body.toolReferenceIds ?? refs;
        return { ...agentRecord, ...body };
      },
      [`GET ${V1}/v1/tools`]: (_b, cfg) => {
        expect(cfg.params).toMatchObject({
          agentReferenceId: "agent-ref",
          includeHidden: true,
        });
        return { items: stored ? [stored] : [] };
      },
      [`GET ${V1}/v1/builtin-tools/voice-config-defaults`]: () =>
        voiceDescriptor,
      [`POST ${V1}/v1/tools`]: (body) =>
        (stored = {
          id: TOOL,
          referenceId: "voice-ref",
          type: "voice-config-defaults",
          ...body,
        }),
      [`PATCH ${V1}/v1/tools/${TOOL}`]: (body) =>
        (stored = { ...stored, ...body }),
      [`DELETE ${V1}/v1/tools/${TOOL}`]: () => (stored = null),
      "GET /v2.0/voice/speechCredentials": () => ({ data: [nice, sttOnly] }),
      [`GET /v2.0/voice/speechCredentials/${nice.id}/voices`]: () => ({
        voices: [{ id: "en-US-AvaNeural" }, { id: "en-US-JennyNeural" }],
      }),
      ...extra,
    });
    return api;
  }
  const call = async (h: ToolHandlers, operation: string, config?: any) =>
    (await h.handleToolCall("manage_agent_components", {
      operation,
      component: "voice_settings",
      projectId: ID.project,
      agentId: ID.agent,
      ...(config ? { config } : {}),
    })) as any;
  async function declined(api: any) {
    const h = handlers(api);
    await h.handleToolCall("manage_snapshots", {
      operation: "decline",
      projectId: ID.project,
    });
    return h;
  }

  it("shows the defaults for an agent without voice settings", async () => {
    const r = await call(handlers(voiceApi()), "get");
    expect(r).toMatchObject({
      toolId: null,
      usingDefaults: true,
      speech: { tts: "empty", stt: "empty" },
    });
    expect(r.settings.minWordsToInterrupt).toBe(1);
  });

  it("creates one instance, fills vendor and label from the credential and attaches it", async () => {
    const api = voiceApi();
    const h = await declined(api);
    const r = await call(h, "update", {
      ttsCredentialReferenceId: "nice-ms",
      ttsLanguage: "en-US",
      ttsVoice: "en-US-AvaNeural",
      sttCredentialReferenceId: "nice-stt",
      sttLanguage: "en-US",
    });
    expect(r.speech).toEqual({ tts: "complete", stt: "complete" });
    expect(r.settings).toMatchObject({
      ttsVendor: "microsoft",
      ttsLabel: "Included Speech Provider",
      sttVendor: "nice",
    });
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post.mock.calls[0][1]).toMatchObject({
      source: "builtin",
      type: "voice-config-defaults",
    });
    expect(api.patch).toHaveBeenCalledWith(
      `${V1}/v1/agents/${ID.agent}`,
      { toolReferenceIds: ["voice-ref"] },
      expect.anything(),
    );

    // A second create updates the same instance.
    await call(h, "create", { minWordsToInterrupt: 3 });
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.patch.mock.calls.at(-1)[0]).toBe(`${V1}/v1/tools/${TOOL}`);
  });

  it("refuses a credential or voice that does not exist, changing nothing", async () => {
    const api = voiceApi();
    const h = await declined(api);
    const bad = await call(h, "update", {
      ttsCredentialReferenceId: "made-up",
    });
    expect(bad).toMatchObject({
      error: "unknown_speech_provider",
      changed: false,
    });
    const stt = await call(h, "update", {
      ttsCredentialReferenceId: "nice-stt",
    });
    expect(stt.error).toBe("unknown_speech_provider");
    const voice = await call(h, "update", {
      ttsCredentialReferenceId: "nice-ms",
      ttsLanguage: "en-US",
      ttsVoice: "en-US-Nope",
    });
    expect(voice).toMatchObject({
      error: "unknown_voice",
      voices: ["en-US-AvaNeural", "en-US-JennyNeural"],
    });
    expect(api.post).not.toHaveBeenCalled();
  });

  it("warns about an incomplete TTS block and offers the voices", async () => {
    const h = await declined(voiceApi());
    const r = await call(h, "update", {
      ttsCredentialReferenceId: "nice-ms",
      ttsLanguage: "en-US",
    });
    expect(r.speech.tts).toBe("incomplete");
    expect(r._hints.warning).toContain("TTS is incomplete");
    expect(r.voices).toContain("en-US-JennyNeural");
  });

  it("resets to the defaults by deleting the instance", async () => {
    const api = voiceApi({
      id: TOOL,
      referenceId: "voice-ref",
      type: "voice-config-defaults",
      parameters: [],
    });
    const h = await declined(api);
    expect(await call(h, "delete")).toEqual({
      reset: true,
      agentId: ID.agent,
      removed: true,
    });
    expect(api.delete).toHaveBeenCalledWith(
      `${V1}/v1/tools/${TOOL}`,
      expect.anything(),
    );
  });

  it("sends the generic tool path for voice-config-defaults to voice_settings", async () => {
    const api = voiceApi();
    const r: any = await handlers(api).handleToolCall(
      "manage_agent_components",
      {
        operation: "create",
        component: "tool",
        projectId: ID.project,
        config: { builtinSlug: "voice-config-defaults", name: "x" },
      },
    );
    expect(r).toMatchObject({ error: "use_voice_settings", changed: false });
    expect(api.post).not.toHaveBeenCalled();
  });

  it("lists speech providers with NiCE-provided rows marked", async () => {
    const r: any = await handlers(voiceApi()).handleToolCall("list_resources", {
      resourceType: "speech_provider",
      projectId: ID.project,
    });
    expect(r.items[0]).toEqual({
      id: nice.id,
      referenceId: "nice-ms",
      name: "Included Speech Provider",
      vendor: "microsoft",
      niceProvided: true,
      stt: true,
      tts: true,
      defaultTts: true,
      status: "ok",
    });
  });

  it("sets NiCE-provided voice preview without a Connection, only for an entitled vendor", async () => {
    const api = voiceApi(null, {
      [`PATCH /new/v2.0/projects/${ID.project}/settings`]: () => ({}),
    });
    const h = await declined(api);
    const no: any = await h.handleToolCall("manage_settings", {
      operation: "set_voice_preview",
      projectId: ID.project,
      provider: "google",
      isNiceProvided: true,
    });
    expect(no.niceProvidedVendors).toEqual(["microsoft", "nice"]);
    const ok: any = await h.handleToolCall("manage_settings", {
      operation: "set_voice_preview",
      projectId: ID.project,
      provider: "microsoft",
      isNiceProvided: true,
    });
    expect(ok).toEqual({
      updated: true,
      provider: "microsoft",
      isNiceProvided: true,
    });
    expect(api.patch.mock.calls.at(-1)[1]).toEqual({
      audioPreviewSettings: {
        provider: "microsoft",
        isNiceProvided: true,
        connections: { microsoft: { connectionId: null } },
      },
    });
  });
});

describe("GPT live (V2V) for AI Agents", () => {
  const LIVE = "597e276b-0bd0-40e8-86df-d4d743ea311c";
  const agentUrl = `${V1}/v1/agents/${ID.agent}`;

  async function declined(api: any) {
    const h = handlers(api);
    await h.handleToolCall("manage_snapshots", {
      operation: "decline",
      projectId: ID.project,
    });
    return h;
  }

  it("keeps gpt-live-1 to openAI, never default, and rolls back on 'not enabled'", async () => {
    const api = routedApi({
      "POST /v2.0/connections": () => ({ _id: "conn1", referenceId: "c-ref" }),
      "DELETE /v2.0/connections/conn1": () => ({}),
      "POST /v2.0/largelanguagemodels": () => {
        throw httpError(
          400,
          "You cannot create a LargeLanguageModel of type `gpt-live-1` as it is not enabled",
        );
      },
    });
    const h = handlers(api);
    const wrong: any = await h.handleToolCall("setup_llm", {
      projectId: ID.project,
      provider: "anthropic",
      modelType: "gpt-live-1",
      apiKey: "k",
    });
    expect(wrong.changed).toBe(false);
    const r: any = await h.handleToolCall("setup_llm", {
      projectId: ID.project,
      provider: "openAI",
      modelType: "gpt-live-1",
      apiKey: "k",
    });
    expect(r).toMatchObject({ error: "v2v_not_enabled", changed: false });
    expect(api.post.mock.calls.at(-1)[1].isDefault).toBe(false);
    expect(api.delete).toHaveBeenCalledWith("/v2.0/connections/conn1");
  });

  it("points a new gpt-live-1 model at an agent's voice model", async () => {
    const api = routedApi({
      "POST /v2.0/connections": () => ({ _id: "conn1", referenceId: "c-ref" }),
      "POST /v2.0/largelanguagemodels": () => ({
        _id: "llm1",
        referenceId: LIVE,
        modelType: "gpt-live-1",
        isDefault: true,
      }),
      "POST /v2.0/largelanguagemodels/llm1/test": () => ({
        isCredentialsValid: true,
      }),
    });
    const r: any = await handlers(api).handleToolCall("setup_llm", {
      projectId: ID.project,
      provider: "openAI",
      modelType: "gpt-live-1",
      apiKey: "k",
    });
    expect(r._hints.action).toContain(
      `voiceLargeLanguageModelReferenceId: "${LIVE}"`,
    );
    expect(r._hints.warning).toContain("project default");
  });

  it("reads the agent back and reports voice fields the platform dropped", async () => {
    const api = routedApi({
      [`PATCH ${agentUrl}`]: (body) => ({ ...agentRecord, ...body }),
      [`GET ${agentUrl}`]: () => agentRecord,
    });
    const h = await declined(api);
    const r: any = await h.handleToolCall("manage_agent", {
      operation: "update",
      agentId: ID.agent,
      projectId: ID.project,
      voiceLargeLanguageModelReferenceId: LIVE,
      realtimeVoice: "cedar",
      role: "Concierge",
    });
    expect(r).toMatchObject({
      updated: true,
      error: "v2v_not_enabled",
      dropped: ["voiceLargeLanguageModelReferenceId", "realtimeVoice"],
    });
    expect(r._hints.action).toContain("FEATURE_ENABLE_V2V");
  });

  it("passes when the voice fields stuck", async () => {
    const stored = {
      ...agentRecord,
      voiceLargeLanguageModelReferenceId: LIVE,
      realtimeVoice: "cedar",
    };
    const api = routedApi({
      [`PATCH ${agentUrl}`]: () => stored,
      [`GET ${agentUrl}`]: () => stored,
    });
    const h = await declined(api);
    const r: any = await h.handleToolCall("manage_agent", {
      operation: "update",
      agentId: ID.agent,
      projectId: ID.project,
      voiceLargeLanguageModelReferenceId: LIVE,
      realtimeVoice: "cedar",
    });
    expect(r.error).toBeUndefined();
    expect(r.agent).toMatchObject({
      voiceLargeLanguageModelReferenceId: LIVE,
      realtimeVoice: "cedar",
    });
  });

  it("reads and previews the voice prompt, and says when GPT live is off", async () => {
    const api = routedApi({
      [`GET ${agentUrl}/voice-prompt`]: () => ({
        template: "T",
        isDefault: true,
        defaultTemplate: "T",
        realtimeVoices: ["marin", "cedar"],
      }),
      [`POST ${agentUrl}/voice-prompt/preview`]: (body) => ({
        prompt: body.template,
        warnings: [],
      }),
    });
    const h = handlers(api);
    const vp: any = await h.handleToolCall("manage_agent", {
      operation: "voice_prompt",
      agentId: ID.agent,
      projectId: ID.project,
    });
    expect(vp.defaultTemplate).toBeUndefined();
    expect(vp.realtimeVoices).toEqual(["marin", "cedar"]);
    const pv: any = await h.handleToolCall("manage_agent", {
      operation: "preview_voice_prompt",
      agentId: ID.agent,
      projectId: ID.project,
      template: "Hi {{agent.name}}",
    });
    expect(pv.prompt).toBe("Hi {{agent.name}}");

    const off = routedApi({
      [`GET ${V1}/v1/agents/capability-probe/voice-prompt`]: () => {
        throw httpError(404);
      },
      [`GET ${agentUrl}/voice-prompt`]: () => {
        throw httpError(404);
      },
    });
    const r: any = await handlers(off).handleToolCall("manage_agent", {
      operation: "voice_prompt",
      agentId: ID.agent,
      projectId: ID.project,
    });
    expect(r).toMatchObject({ error: "v2v_not_enabled", changed: false });
  });
});

describe("audit_voice_agent for AI Agents", () => {
  const TOOL = "60d5ec49f1a2c8b1a4e0f404";
  const params = (keys: Record<string, any>) =>
    Object.entries(keys).map(([key, value]) => ({
      key,
      name: key,
      mode: "dynamic",
      modeLocked: true,
      type: typeof value,
      value,
    }));
  const instance = {
    id: TOOL,
    referenceId: "voice-ref",
    type: "voice-config-defaults",
    parameters: params({
      bargeInOnSpeech: true,
      minWordsToInterrupt: 1,
      bargeInOnDtmf: false,
      promptOnSilence: true,
      silenceTimeoutSeconds: 8,
      silenceRetries: 2,
      continuousAsr: false,
      greetingMode: "agent",
      thinkingSound: "typing_loop",
    }),
  };

  function auditApi() {
    let stored = instance;
    return routedApi({
      [`GET ${V1}/v1/agents/${ID.agent}`]: () => ({
        ...agentRecord,
        toolReferenceIds: ["voice-ref"],
      }),
      [`PATCH ${V1}/v1/agents/${ID.agent}`]: (body) => ({
        ...agentRecord,
        ...body,
      }),
      [`GET ${V1}/v1/tools`]: (_b, cfg) =>
        cfg.params.agentReferenceId
          ? { items: [stored] }
          : { items: [{ referenceId: "hangup-ref", type: "voice-hangup" }] },
      [`PATCH ${V1}/v1/tools/${TOOL}`]: (body) =>
        (stored = { ...stored, ...body }),
      "GET /v2.0/largelanguagemodels": () => ({
        items: [
          {
            referenceId: "llm",
            name: "GPT-4o",
            modelType: "gpt-4o",
            modelGroup: "chat",
            connectionId: "c",
            isDefault: true,
          },
        ],
      }),
      "GET /v2.0/endpoints": () => ({
        items: [{ _id: "ep1", channel: "voiceGateway2", agentId: "agent-ref" }],
      }),
      "GET /v2.0/endpoints/ep1": () => ({
        _id: "ep1",
        name: "VG",
        agentId: "agent-ref",
      }),
    });
  }

  it("reports without changing anything by default", async () => {
    const api = auditApi();
    const r: any = await handlers(api).handleToolCall("audit_voice_agent", {
      agentId: ID.agent,
      projectId: ID.project,
    });
    expect(r.mode).toBe("dry-run");
    expect(r.summary.fixable).toBe(3);
    expect(api.patch).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("applies the voice settings fixes in one update and attaches voice-hangup", async () => {
    const api = auditApi();
    const h = handlers(api);
    await h.handleToolCall("manage_snapshots", {
      operation: "decline",
      projectId: ID.project,
    });
    const r: any = await h.handleToolCall("audit_voice_agent", {
      agentId: ID.agent,
      projectId: ID.project,
      apply: true,
    });
    expect(r.appliedFixes.every((f: any) => f.applied)).toBe(true);
    const toolPatches = api.patch.mock.calls.filter(
      (c: any[]) => c[0] === `${V1}/v1/tools/${TOOL}`,
    );
    expect(toolPatches).toHaveLength(1);
    expect(api.patch).toHaveBeenCalledWith(
      `${V1}/v1/agents/${ID.agent}`,
      { toolReferenceIds: ["voice-ref", "hangup-ref"] },
      expect.anything(),
    );
    expect(r.checks.find((c: any) => c.id === "agent.silence").status).toBe(
      "pass",
    );
  });
});

describe("voice agents run voice-to-voice when they can", () => {
  const LIVE = "597e276b-0bd0-40e8-86df-d4d743ea311c";
  const liveModel = {
    referenceId: LIVE,
    name: "GPT Live",
    provider: "openAI",
    modelType: "gpt-live-1",
    modelGroup: "voiceToVoice",
    connectionId: "c-openai",
  };
  const NICE = { vendor: "microsoft", systemProvided: true };

  function createApi(llms: any[], extra: Record<string, Route> = {}) {
    return routedApi({
      "GET /v2.0/locales": () => ({
        items: [{ referenceId: "loc-1", projectReference: ID.project }],
      }),
      "GET /v2.0/largelanguagemodels": () => ({ items: llms }),
      [`POST ${V1}/v1/agents`]: (body) => ({ ...agentRecord, ...body }),
      [`GET ${V1}/v1/agents/${ID.agent}`]: () => ({
        ...agentRecord,
        voiceLargeLanguageModelReferenceId: LIVE,
      }),
      "GET /v2.0/voice/speechCredentials": () => ({ data: [NICE] }),
      ...extra,
    });
  }
  const create = (api: any, extra: Record<string, any> = {}) =>
    handlers(api).handleToolCall("manage_agent", {
      operation: "create",
      projectId: ID.project,
      name: "Clinic Desk",
      largeLanguageModelReferenceId: LLM,
      createEndpoint: false,
      agentType: "voice",
      ...extra,
    }) as Promise<any>;
  const sent = (api: any) =>
    api.post.mock.calls.find((c: any[]) => c[0] === `${V1}/v1/agents`)[1];

  it("binds a GPT live model that is already in the project", async () => {
    const api = createApi([liveModel]);
    const r = await create(api);
    expect(sent(api).voiceLargeLanguageModelReferenceId).toBe(LIVE);
    expect(r._hints.hint).toContain('voice-to-voice on "GPT Live"');
  });

  it("offers voice-to-voice once, as an option, when the project has no model", async () => {
    const api = createApi([]);
    const r = await create(api);
    expect(sent(api).voiceLargeLanguageModelReferenceId).toBeUndefined();
    expect(r._hints.hint).toContain(
      '"It runs on NiCE-provided speech, so it works right away. It can also run voice-to-voice, which responds faster and sounds more natural. If you have an OpenAI API key, I can set that up."',
    );
    expect(r._hints.hint).not.toMatch(/best|fallback|unfortunately/i);
  });

  it("never mentions voice-to-voice where it is not enabled", async () => {
    const api = createApi([liveModel], {
      [`GET ${V1}/v1/agents/capability-probe/voice-prompt`]: () => {
        throw httpError(404);
      },
    });
    const r = await create(api);
    expect(sent(api).voiceLargeLanguageModelReferenceId).toBeUndefined();
    expect(JSON.stringify(r)).not.toMatch(/voice-to-voice|GPT live/i);
  });

  it("keeps speech when the caller passes '' and leaves text agents alone", async () => {
    const speech = createApi([liveModel]);
    const r = await create(speech, { voiceLargeLanguageModelReferenceId: "" });
    expect("voiceLargeLanguageModelReferenceId" in sent(speech)).toBe(false);
    expect(r._hints.hint).toBeUndefined();

    const text = createApi([liveModel]);
    const t = await create(text, { agentType: "text" });
    expect(sent(text).voiceLargeLanguageModelReferenceId).toBeUndefined();
    expect(t._hints.hint).toBeUndefined();
  });

  it("names the voice-to-voice providers in check_capabilities", async () => {
    const r: any = await handlers(createApi([])).handleToolCall(
      "check_capabilities",
      {},
    );
    expect(r.v2vProviders).toEqual(["openAI"]);
  });
});
