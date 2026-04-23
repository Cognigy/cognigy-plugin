import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { CognigyApiClient } from "../api/client.js";
import { ToolHandlers } from "../tools/handlers.js";

describe("read_guide", () => {
  let api: jest.Mocked<CognigyApiClient>;
  let handlers: ToolHandlers;

  beforeEach(() => {
    api = {
      get: jest.fn(),
      post: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
      put: jest.fn(),
      uploadFile: jest.fn(),
    } as any;

    handlers = new ToolHandlers(api, "https://endpoint-trial.cognigy.ai");
  });

  it("lists available guides when called without arguments", async () => {
    const result = await handlers.handleToolCall("read_guide", {});

    expect(result.guides).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          guideId: "settings",
          uri: "cognigy://guide/settings",
        }),
      ]),
    );
    expect(result._instruction).toContain("guideId or uri");
  });

  it("loads a guide by guideId", async () => {
    const result = await handlers.handleToolCall("read_guide", {
      guideId: "settings",
    });

    expect(result.guideId).toBe("settings");
    expect(result.uri).toBe("cognigy://guide/settings");
    expect(result.content).toContain("# Settings Guide");
    expect(result.mimeType).toBe("text/markdown");
  });

  it("loads a guide by uri", async () => {
    const result = await handlers.handleToolCall("read_guide", {
      uri: "cognigy://guide/knowledge-setup",
    });

    expect(result.guideId).toBe("knowledge-setup");
    expect(result.content).toContain("# Adding Knowledge to an Agent");
  });
});
