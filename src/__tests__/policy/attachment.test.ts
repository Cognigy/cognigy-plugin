import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { CognigyApiClient } from "../../api/client.js";
import { ToolHandlers } from "../../tools/handlers.js";
import { REGISTRY } from "../../policy/registry.js";
import type { Rule } from "../../policy/types.js";

/**
 * §6 step 3: proves the wiring before any real rule exists. Unit-testing the
 * rule function is insufficient - the failure mode being guarded against is
 * losing the wiring while the function still passes in isolation (§5, test
 * 3). So this goes through the real handleToolCall, not evaluatePolicy
 * directly, with a throwaway rule pushed into the actual REGISTRY rather
 * than injected via a test-only backdoor.
 */
const ALWAYS_FIRES: Rule = {
  id: "test.attachment-always-fires",
  kind: "house-opinion",
  severity: "block",
  targets: [
    {
      tool: "list_resources",
      select: () => [{ path: [], value: null }],
    },
  ],
  check: () => [{ path: [], message: "throwaway rule: always fires" }],
  retireWhen: "never - test-only rule, removed at the end of this suite",
};

function mockApiClient(): jest.Mocked<CognigyApiClient> {
  return {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    put: jest.fn(),
  } as any;
}

describe("policy layer attachment", () => {
  afterEach(() => {
    REGISTRY.length = 0;
  });

  it("refuses a call through the real dispatcher when a rule fires", async () => {
    REGISTRY.push(ALWAYS_FIRES);
    const api = mockApiClient();
    const h = new ToolHandlers(api, "https://endpoint-trial.cognigy.ai");

    const result: any = await h.handleToolCall("list_resources", {
      resourceType: "project",
    });

    expect(result.error).toBe("policy_violation");
    expect(result.changed).toBe(false);
    expect(result.findings).toEqual([
      expect.objectContaining({ ruleId: "test.attachment-always-fires" }),
    ]);
    // The refusal happened before the handler ran - the real handler would
    // have hit the API to list projects.
    expect(api.get).not.toHaveBeenCalled();
  });

  it("does not fire for a tool the rule does not target", async () => {
    REGISTRY.push(ALWAYS_FIRES);
    const api = mockApiClient();
    api.get.mockResolvedValueOnce({ _id: "60d5ec49f1a2c8b1a4e0f001" });
    const h = new ToolHandlers(api, "https://endpoint-trial.cognigy.ai");

    const result: any = await h.handleToolCall("get_resource", {
      resourceType: "agent",
      id: "60d5ec49f1a2c8b1a4e0f001",
    });

    expect(result.error).toBeUndefined();
  });
});
