import { describe, it, expect, beforeEach, jest } from "@jest/globals";

const post = jest.fn<(...args: any[]) => Promise<any>>();
jest.unstable_mockModule("axios", () => ({ default: { post } }));

const { ToolHandlers } = await import("../tools/handlers.js");

const ID = {
  project: "507f1f77bcf86cd799439011",
  agent: "60d5ec49f1a2c8b1a4e0f101",
};
const V1 = "https://api-trial.cognigy.ai";
const EP = "https://endpoint-trial.cognigy.ai";

describe("talk_to_agent { agentV2Id }", () => {
  let api: any;
  let h: InstanceType<typeof ToolHandlers>;

  beforeEach(() => {
    post.mockReset();
    api = {
      get: jest.fn(),
      post: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
    };
    h = new ToolHandlers(api, EP, "", "", V1);
  });

  it("reads the V2 agent, reuses its REST endpoint and sends to the /test/ URL", async () => {
    api.get
      .mockResolvedValueOnce({
        id: ID.agent,
        referenceId: "agent-ref",
        name: "Bot",
      })
      .mockResolvedValueOnce({
        items: [
          {
            _id: "ep-1",
            channel: "rest",
            agentId: "agent-ref",
            URLToken: "tok",
          },
        ],
      });
    post.mockResolvedValueOnce({ data: { text: "18°C", outputStack: [] } });

    const r: any = await h.handleToolCall("talk_to_agent", {
      agentV2Id: ID.agent,
      projectId: ID.project,
      message: "weather?",
    });

    expect(api.get.mock.calls[0][0]).toBe(`${V1}/v1/agents/${ID.agent}`);
    expect(api.post).not.toHaveBeenCalled();
    expect(post.mock.calls[0][0]).toBe(`${EP}/test/tok`);
    expect(r.agentResponse).toBe("18°C");
    expect(r.endpointResolved).toBe(true);
    expect(r.endpointUrl).toBe(`${EP}/tok`);
  });

  it("creates the endpoint when none targets the agent, and surfaces a turn error", async () => {
    api.get
      .mockResolvedValueOnce({
        id: ID.agent,
        referenceId: "agent-ref",
        name: "Bot",
      })
      .mockResolvedValueOnce({ items: [] });
    api.post.mockResolvedValueOnce({ _id: "ep-2", URLToken: "tok2" });
    post.mockResolvedValueOnce({
      data: {
        text: "",
        outputStack: [],
        error: { code: "INTERNAL", message: "LLM not configured" },
      },
    });

    const r: any = await h.handleToolCall("talk_to_agent", {
      agentV2Id: ID.agent,
      projectId: ID.project,
      message: "hi",
    });

    expect(api.post.mock.calls[0][1]).toMatchObject({
      channel: "rest",
      targetType: "agent",
      agentId: "agent-ref",
    });
    expect(r.endpointAutoCreated).toBe(true);
    expect(r.error.message).toBe("LLM not configured");
    expect(r._hints.likely_cause).toContain("LLM not configured");
  });

  it("accepts a plain-string platform error too", async () => {
    post.mockResolvedValueOnce({ data: { text: "", error: "model missing" } });
    const r: any = await h.handleToolCall("talk_to_agent", {
      endpointUrl: `${EP}/abc`,
      message: "hi",
    });
    expect(r.error).toEqual({ message: "model missing" });
  });
});
