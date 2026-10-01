import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { CognigyApiClient } from "../api/client.js";
import { ToolHandlers } from "../tools/handlers.js";
import {
  agentsV2BaseUrl,
  findOrCreateAgentEndpoint,
} from "../tools/agentsV2.js";

const ID = {
  project: "507f1f77bcf86cd799439011",
  agent: "60d5ec49f1a2c8b1a4e0f101",
};
const V1 = "https://api-trial.cognigy.ai";
const EP = "https://endpoint-trial.cognigy.ai";

const descriptor = {
  slug: "http-request",
  parameters: [
    {
      key: "method",
      name: "Method",
      description: "",
      mode: "dynamic",
      type: "string",
      value: "GET",
    },
    {
      key: "url",
      name: "URL",
      description: "",
      mode: "aiFilled",
      type: "string",
      value: "",
    },
    {
      key: "headers",
      name: "Headers",
      description: "",
      mode: "dynamic",
      type: "object",
      value: {},
    },
    {
      key: "payload",
      name: "Payload",
      description: "",
      mode: "dynamic",
      type: "object",
      value: {},
    },
    {
      key: "auth",
      name: "Auth",
      description: "",
      mode: "dynamic",
      type: "connection",
      value: "",
      connectionTypes: ["http_customHeader", "http_oauth2"],
    },
  ],
};

describe("Agents V2 preview", () => {
  let api: jest.Mocked<CognigyApiClient>;
  let h: ToolHandlers;

  beforeEach(() => {
    api = {
      get: jest.fn(),
      post: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
    } as any;
    h = new ToolHandlers(api, EP, "", "", V1);
  });

  it("derives the service-agents root from the API base URL", () => {
    expect(agentsV2BaseUrl("https://api-trial.cognigy.ai/new")).toBe(V1);
  });

  it("create_agent_v2 creates tool, agent and endpoint against /v1 on the API host", async () => {
    api.get
      .mockResolvedValueOnce({
        items: [{ referenceId: "loc-1", projectReference: ID.project }],
      })
      .mockResolvedValueOnce(descriptor)
      .mockResolvedValueOnce({ items: [] });
    api.post
      .mockResolvedValueOnce({
        id: "tool-1",
        referenceId: "tool-ref",
        name: "Weather",
      })
      .mockResolvedValueOnce({
        id: ID.agent,
        referenceId: "agent-ref",
        name: "Bot",
      })
      .mockResolvedValueOnce({ _id: "ep-1", URLToken: "tok" });

    const result = await h.handleToolCall("create_agent_v2", {
      projectId: ID.project,
      name: "Bot",
      instructions: "Be helpful",
      httpTool: {
        name: "Weather",
        description: "Get weather",
        url: "https://wttr.in/Berlin?format=j1",
        method: "post",
      },
    });

    expect(api.get.mock.calls[1][0]).toBe(
      `${V1}/v1/builtin-tools/http-request`,
    );
    const toolBody: any = api.post.mock.calls[0][1];
    expect(api.post.mock.calls[0][0]).toBe(`${V1}/v1/tools`);
    expect(toolBody).toMatchObject({
      source: "builtin",
      builtinSlug: "http-request",
      type: "http-request",
      projectId: ID.project,
    });
    const byKey = Object.fromEntries(
      toolBody.parameters.map((p: any) => [p.key, p]),
    );
    expect(byKey.method).toMatchObject({ mode: "dynamic", value: "POST" });
    expect(byKey.url).toMatchObject({
      mode: "dynamic",
      value: "https://wttr.in/Berlin?format=j1",
    });
    expect(byKey.payload.mode).toBe("aiFilled");
    expect(byKey.auth.connectionTypes).toEqual([
      "http_customHeader",
      "http_oauth2",
    ]);

    expect(api.post.mock.calls[1][0]).toBe(`${V1}/v1/agents`);
    expect(api.post.mock.calls[1][1]).toMatchObject({
      projectId: ID.project,
      localeReferenceId: "loc-1",
      name: "Bot",
      instructions: "Be helpful",
      agentType: "text",
      toolReferenceIds: ["tool-ref"],
    });

    expect(api.post.mock.calls[2][0]).toBe("/v2.0/endpoints");
    expect(api.post.mock.calls[2][1]).toMatchObject({
      channel: "rest",
      targetType: "agent",
      agentId: "agent-ref",
    });
    expect(result.endpointUrl).toBe(`${EP}/tok`);
    expect(result.tool.referenceId).toBe("tool-ref");
  });

  it("reuses an existing REST endpoint that targets the agent", async () => {
    api.get.mockResolvedValueOnce({
      items: [
        { channel: "rest", agentId: "other", URLToken: "x" },
        { channel: "rest", agentId: "agent-ref", URLToken: "tok" },
      ],
    });
    const r = await findOrCreateAgentEndpoint(api, ID.project, {
      referenceId: "agent-ref",
    });
    expect(r.autoCreated).toBe(false);
    expect(r.endpoint.URLToken).toBe("tok");
    expect(api.post).not.toHaveBeenCalled();
  });

  it("talk_to_agent rejects agentV2Id without projectId", async () => {
    await expect(
      h.handleToolCall("talk_to_agent", { agentV2Id: ID.agent, message: "hi" }),
    ).rejects.toThrow(/projectId/);
  });
});
