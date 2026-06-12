import { describe, it, expect } from "@jest/globals";
import {
  evaluateChecks,
  summarize,
  RECOMMENDED_SESSION_CONFIG,
  type VoiceCheck,
} from "../tools/voiceChecklist.js";

const AGENT_ID = "60d5ec49f1a2c8b1a4e0f001";
const SSC_ID = "60d5ec49f1a2c8b1a4e0f002";

function byId(checks: VoiceCheck[], id: string): VoiceCheck {
  const c = checks.find((x) => x.id === id);
  if (!c) throw new Error(`check ${id} not found`);
  return c;
}

// isEntryPoint reflects the REAL REST projection: it is a per-descriptor flag,
// so the aiAgentJob descriptor reports `true` while setSessionConfig reports
// `false` — the opposite of run order. The evaluator must ignore it and rely on
// `firstNodeId` (the chart `next` chain) instead.
const compliantAgent = {
  _id: AGENT_ID,
  type: "aiAgentJob",
  isEntryPoint: true,
  config: {
    storeLocation: "stream",
    errorHandling: "continue",
    errorMessage: "Sorry, something went wrong.",
    debugLogLLMLatency: true,
  },
};

const compliantSsc = {
  _id: SSC_ID,
  type: "setSessionConfig",
  isEntryPoint: false,
  config: { ...RECOMMENDED_SESSION_CONFIG, sttHints: ["Acme", "widget"] },
};

describe("evaluateChecks — Set Session Config presence", () => {
  it("fails and proposes creating a node when none exists", () => {
    const checks = evaluateChecks({ nodes: [compliantAgent] });
    const first = byId(checks, "vg.session-config-first");
    expect(first.status).toBe("fail");
    expect(first.autoFixable).toBe(true);
    expect(first.fix?.kind).toBe("createSessionConfig");
    if (first.fix?.kind === "createSessionConfig") {
      expect(first.fix.targetNodeId).toBe(AGENT_ID);
    }
  });

  it("marks Set Session Config value checks na when no node exists", () => {
    const checks = evaluateChecks({ nodes: [compliantAgent] });
    expect(byId(checks, "vg.barge-in-off").status).toBe("na");
    expect(byId(checks, "vg.user-input-timeout").status).toBe("na");
  });

  it("passes when the Set Session Config node runs first (firstNodeId)", () => {
    const checks = evaluateChecks({
      nodes: [compliantSsc, compliantAgent],
      firstNodeId: SSC_ID,
    });
    expect(byId(checks, "vg.session-config-first").status).toBe("pass");
  });

  it("warns when a Set Session Config node exists but is not first", () => {
    // Agent runs first per the next chain, even though SSC reports the same
    // descriptor flags — ordering is decided by firstNodeId, not isEntryPoint.
    const checks = evaluateChecks({
      nodes: [compliantSsc, compliantAgent],
      firstNodeId: AGENT_ID,
    });
    expect(byId(checks, "vg.session-config-first").status).toBe("warn");
  });

  it("warns when flow ordering cannot be determined (no firstNodeId)", () => {
    const checks = evaluateChecks({ nodes: [compliantSsc, compliantAgent] });
    expect(byId(checks, "vg.session-config-first").status).toBe("warn");
  });
});

describe("evaluateChecks — fully compliant flow", () => {
  it("reports no failures", () => {
    const checks = evaluateChecks({
      nodes: [compliantSsc, compliantAgent],
      firstNodeId: SSC_ID,
    });
    const failures = checks.filter((c) => c.status === "fail");
    expect(failures).toEqual([]);
  });
});

describe("evaluateChecks — failing config produces fixes", () => {
  const badSsc = {
    _id: SSC_ID,
    type: "setSessionConfig",
    isEntryPoint: false,
    config: {
      bargeInOnSpeech: true,
      bargeInOnDtmf: true,
      asrEnabled: true,
      userNoInputTimeout: 2000,
      userNoInputRetries: 1,
      flowNoInputTimeoutEnable: false,
      flowNoInputFail: true,
    },
  };
  const badAgent = {
    _id: AGENT_ID,
    type: "aiAgentJob",
    isEntryPoint: true,
    config: {
      storeLocation: "input",
      errorHandling: "stop",
      errorMessage: "",
      debugLogLLMLatency: false,
    },
  };

  const checks = evaluateChecks({ nodes: [badSsc, badAgent] });

  it("flags barge-in and targets the Set Session Config node", () => {
    const c = byId(checks, "vg.barge-in-off");
    expect(c.status).toBe("fail");
    expect(c.fix?.kind).toBe("patchNode");
    if (c.fix?.kind === "patchNode") {
      expect(c.fix.nodeId).toBe(SSC_ID);
      expect(c.fix.config).toEqual({
        bargeInOnSpeech: false,
        bargeInOnDtmf: false,
      });
    }
  });

  it("flags continuous ASR, input timeout, flow timeout, fails-on-error", () => {
    expect(byId(checks, "vg.continuous-asr-off").status).toBe("fail");
    expect(byId(checks, "vg.user-input-timeout").status).toBe("fail");
    expect(byId(checks, "vg.flow-input-timeout").status).toBe("fail");
    expect(byId(checks, "vg.flow-fails-on-error-off").status).toBe("fail");
  });

  it("flags AI Agent stream/error/latency settings", () => {
    expect(byId(checks, "agent.stream-output").status).toBe("fail");
    expect(byId(checks, "agent.fails-on-error-off").status).toBe("fail");
    expect(byId(checks, "agent.error-message").status).toBe("fail");
    expect(byId(checks, "agent.log-llm-latency").status).toBe("fail");
  });
});

describe("evaluateChecks — advisory checks", () => {
  it("warns when STT hints are empty and never auto-fixes", () => {
    const ssc = {
      _id: SSC_ID,
      type: "setSessionConfig",
      isEntryPoint: false,
      config: { ...RECOMMENDED_SESSION_CONFIG },
    };
    const c = byId(
      evaluateChecks({ nodes: [ssc, compliantAgent] }),
      "vg.stt-hints",
    );
    expect(c.status).toBe("warn");
    expect(c.autoFixable).toBe(false);
  });

  it("marks endpoint and llm checks na when not requested (undefined)", () => {
    const checks = evaluateChecks({ nodes: [compliantSsc, compliantAgent] });
    expect(byId(checks, "endpoint.output-transformer").status).toBe("na");
    expect(byId(checks, "llm.fallback").status).toBe("na");
  });

  it("warns when endpoint/llm were requested but could not be resolved (null)", () => {
    const checks = evaluateChecks({
      nodes: [compliantSsc, compliantAgent],
      endpoint: null,
      llm: null,
    });
    expect(byId(checks, "endpoint.output-transformer").status).toBe("warn");
    expect(byId(checks, "llm.fallback").status).toBe("warn");
  });

  it("fails (not warns) when a configured silence overlay has a non-zero delay", () => {
    const ssc = {
      _id: SSC_ID,
      type: "setSessionConfig",
      isEntryPoint: false,
      config: {
        ...RECOMMENDED_SESSION_CONFIG,
        silenceOverlayAction: "addTrack",
        silenceOverlayDelay: 5,
      },
    };
    const c = byId(
      evaluateChecks({ nodes: [ssc, compliantAgent] }),
      "vg.silence-overlay-delay",
    );
    expect(c.status).toBe("fail");
    expect(c.autoFixable).toBe(true);
  });

  it("passes the output transformer check when enabled with code", () => {
    const checks = evaluateChecks({
      nodes: [compliantSsc, compliantAgent],
      endpoint: {
        transformer: {
          outputTransformerEnabled: true,
          transformer: "return x;",
        },
      },
      llm: { fallbacks: [{ id: "a" }] },
    });
    expect(byId(checks, "endpoint.output-transformer").status).toBe("pass");
    expect(byId(checks, "llm.fallback").status).toBe("pass");
  });
});

describe("summarize", () => {
  it("counts statuses and fixable checks", () => {
    const checks = evaluateChecks({ nodes: [compliantAgent] });
    const s = summarize(checks);
    expect(s.total).toBe(checks.length);
    expect(s.fail).toBeGreaterThan(0);
    expect(s.fixable).toBeGreaterThan(0);
  });
});
