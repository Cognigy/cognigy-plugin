import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { CognigyApiClient } from "../../api/client.js";
import { ToolHandlers } from "../../tools/handlers.js";
import { REGISTRY } from "../../policy/registry.js";
import type { Rule } from "../../policy/types.js";

/**
 * §6 step 3 / §3.4: the policy gate must run BEFORE the backup gate. A
 * policy-refused call is a call that cannot run; if the backup gate went
 * first, a non-compliant call would burn its one-shot hold, the caller would
 * fix the args and retry, and - per the anti-deadlock release documented at
 * the backup gate (handlers.ts, backupGateFor) - that retry would then
 * proceed UNPROTECTED, because the hold had already been spent on the
 * refused call. §7 R2 pins this with a test rather than a comment.
 */
const VALID_FLOW_ID = "507f1f77bcf86cd799439011";

const mutatingCall = {
  operation: "create",
  flowId: VALID_FLOW_ID,
  nodeType: "say",
  config: { text: "hi" },
};

const ALWAYS_FIRES: Rule = {
  id: "test.ordering-always-fires",
  kind: "house-opinion",
  severity: "block",
  targets: [
    {
      tool: "manage_flow_nodes",
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

describe("policy gate ordering vs. the backup gate", () => {
  afterEach(() => {
    REGISTRY.length = 0;
  });

  it("refuses with policy_violation, not backup_not_offered, on a non-compliant mutating call with no snapshot answered", async () => {
    REGISTRY.push(ALWAYS_FIRES);
    const api = mockApiClient();
    const h = new ToolHandlers(api, "https://endpoint-trial.cognigy.ai");

    const result: any = await h.handleToolCall(
      "manage_flow_nodes",
      mutatingCall,
    );

    expect(result.error).toBe("policy_violation");
    // Refused before dispatch - the backup gate's own project lookup and the
    // real handler both would have called the API.
    expect(api.get).not.toHaveBeenCalled();
  });

  it("does not consume the backup gate's one-shot hold", async () => {
    REGISTRY.push(ALWAYS_FIRES);
    const api = mockApiClient();
    const h = new ToolHandlers(api, "https://endpoint-trial.cognigy.ai");

    const refused: any = await h.handleToolCall(
      "manage_flow_nodes",
      mutatingCall,
    );
    expect(refused.error).toBe("policy_violation");

    // Drop the rule - the identical call is now policy-compliant. If the
    // refused call above had wrongly consumed the backup gate's hold, this
    // retry would be treated as an already-held anti-deadlock release and
    // would proceed unprotected instead of being held again.
    REGISTRY.length = 0;

    const retried: any = await h.handleToolCall(
      "manage_flow_nodes",
      mutatingCall,
    );
    expect(retried.error).toBe("backup_not_offered");
  });
});
