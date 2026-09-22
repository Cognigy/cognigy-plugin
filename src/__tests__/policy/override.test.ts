import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { CognigyApiClient } from "../../api/client.js";
import { ToolHandlers } from "../../tools/handlers.js";
import { REGISTRY } from "../../policy/registry.js";
import type { Rule } from "../../policy/types.js";

/**
 * §5, test 7 / §3.5: the soft-gate override channel. Goes through the real
 * handleToolCall - per §7 R4, the round trip must exercise the full path
 * rather than calling evaluatePolicy directly, because the risk being
 * guarded against is upstream moving argument validation earlier than
 * handleToolCall and silently breaking the channel.
 *
 * Uses a throwaway always-fires rule targeting list_resources, which (unlike
 * the shipped codenode.runtime-apis rule) carries an optional `projectId` in
 * its args - needed to exercise the "does not leak across projects" case.
 */
const PROJECT_A = "507f1f77bcf86cd799439011";
const PROJECT_B = "60d5ec49f1a2c8b1a4e0f000";

const ALWAYS_FIRES: Rule = {
  id: "test.override-always-fires",
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

function listAgentsCall(projectId: string): Record<string, any> {
  return { resourceType: "agent", projectId };
}

describe("policy override channel (§3.5) round trip", () => {
  afterEach(() => {
    REGISTRY.length = 0;
  });

  it("a retry with the correct _policyOverride succeeds", async () => {
    REGISTRY.push(ALWAYS_FIRES);
    const api = mockApiClient();
    const h = new ToolHandlers(api, "https://endpoint-trial.cognigy.ai");

    const refused: any = await h.handleToolCall(
      "list_resources",
      listAgentsCall(PROJECT_A),
    );
    expect(refused.error).toBe("policy_violation");
    expect(api.get).not.toHaveBeenCalled();

    api.get.mockResolvedValueOnce({ items: [], total: 0 });
    const args = {
      ...listAgentsCall(PROJECT_A),
      _policyOverride: ["test.override-always-fires"],
    };
    const retried: any = await h.handleToolCall("list_resources", args);

    expect(retried.error).toBeUndefined();
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("the override sticks for the rest of the session for the same project, without repeating _policyOverride", async () => {
    REGISTRY.push(ALWAYS_FIRES);
    const api = mockApiClient();
    const h = new ToolHandlers(api, "https://endpoint-trial.cognigy.ai");

    api.get.mockResolvedValueOnce({ items: [], total: 0 });
    await h.handleToolCall("list_resources", {
      ...listAgentsCall(PROJECT_A),
      _policyOverride: ["test.override-always-fires"],
    });

    api.get.mockResolvedValueOnce({ items: [], total: 0 });
    const secondCall: any = await h.handleToolCall(
      "list_resources",
      listAgentsCall(PROJECT_A),
    );

    expect(secondCall.error).toBeUndefined();
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("an unrelated rule id does not unlock the rule that actually fired", async () => {
    REGISTRY.push(ALWAYS_FIRES);
    const api = mockApiClient();
    const h = new ToolHandlers(api, "https://endpoint-trial.cognigy.ai");

    const result: any = await h.handleToolCall("list_resources", {
      ...listAgentsCall(PROJECT_A),
      _policyOverride: ["some.other.rule"],
    });

    expect(result.error).toBe("policy_violation");
    expect(api.get).not.toHaveBeenCalled();
  });

  it("an override does not leak across projects", async () => {
    REGISTRY.push(ALWAYS_FIRES);
    const api = mockApiClient();
    const h = new ToolHandlers(api, "https://endpoint-trial.cognigy.ai");

    api.get.mockResolvedValueOnce({ items: [], total: 0 });
    await h.handleToolCall("list_resources", {
      ...listAgentsCall(PROJECT_A),
      _policyOverride: ["test.override-always-fires"],
    });

    const otherProjectResult: any = await h.handleToolCall(
      "list_resources",
      listAgentsCall(PROJECT_B),
    );

    expect(otherProjectResult.error).toBe("policy_violation");
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("strips _policyOverride from args unconditionally, even when nothing blocks", async () => {
    // REGISTRY is left empty - no rule targets list_resources here, so
    // nothing blocks regardless of the override channel.
    const api = mockApiClient();
    const h = new ToolHandlers(api, "https://endpoint-trial.cognigy.ai");

    api.get.mockResolvedValueOnce({ items: [], total: 0 });
    const args = {
      ...listAgentsCall(PROJECT_A),
      _policyOverride: ["anything"],
    };
    const result: any = await h.handleToolCall("list_resources", args);

    expect(result.error).toBeUndefined();
    expect((args as any)._policyOverride).toBeUndefined();
  });
});
