import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import * as schemas from "../schemas/tools.js";

const ID = {
  project: "507f1f77bcf86cd799439011",
  agent: "60d5ec49f1a2c8b1a4e0f101",
  agentV1: "60d5ec49f1a2c8b1a4e0f202",
};
const UUID = "eaeff103-8ef2-4305-9a87-8d8812fb026c";

describe("agent id validation", () => {
  it("rejects a UUID agentV2Id with the referenceId hint", () => {
    const r = schemas.talkToAgentSchema.safeParse({
      agentV2Id: UUID,
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
      agentV2Id: ID.agent,
      projectId: ID.project,
      message: "hi",
    });
    expect(r.success).toBe(true);
  });
});
