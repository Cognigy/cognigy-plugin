/**
 * Voice AI Go-Live checklist evaluator.
 *
 * Implements the deterministic ("Tier A") subset of the Voice AI guidebook
 * Go-Live Checklist (section 3) that the Cognigy REST API can both READ and
 * FIX. Each check inspects the flow's Set Session Config node, the AI Agent
 * Job node, and (optionally) the endpoint / LLM resource, and reports a
 * pass / fail / warn / na status. Auto-fixable checks carry a `fix` descriptor
 * that the handler applies via the chart / endpoint REST routes.
 *
 * The evaluation is a pure function of the fetched resources so it can be
 * unit-tested without a live Cognigy instance.
 */

export type CheckStatus = "pass" | "fail" | "warn" | "na";

/** A fix the handler can apply. Pure data — no side effects here. */
export type VoiceFix =
  | {
      kind: "patchNode";
      nodeId: string;
      /** Fields to merge into the node's existing config. */
      config: Record<string, any>;
    }
  | {
      kind: "createSessionConfig";
      /** Node the new Set Session Config node is inserted before. */
      targetNodeId: string;
      label: string;
      config: Record<string, any>;
    };

export interface VoiceCheck {
  /** Stable identifier, e.g. "vg.barge-in-off". */
  id: string;
  /** Checklist section, e.g. "3.1 Flow Configuration". */
  section: string;
  title: string;
  status: CheckStatus;
  detail: string;
  autoFixable: boolean;
  fix?: VoiceFix;
}

export interface AuditContext {
  /** Raw chart nodes (each with type, config, isEntryPoint, _id/id). */
  nodes: any[];
  /**
   * Endpoint resource. Tri-state: `undefined` = not requested (no endpointId),
   * `null` = requested but the fetch failed, object = resolved.
   */
  endpoint?: any | null;
  /**
   * LLM model resource. Tri-state: `undefined` = not requested (no projectId),
   * `null` = requested but could not be resolved, object = resolved.
   */
  llm?: any | null;
}

// ---------------------------------------------------------------------------
// Recommended values
// ---------------------------------------------------------------------------

const USER_INPUT_TIMEOUT_MIN_MS = 5000;
const USER_INPUT_TIMEOUT_MAX_MS = 7000;
const USER_INPUT_RETRIES_MIN = 5;
const FLOW_INPUT_TIMEOUT_MIN_MS = 1000;
const FLOW_INPUT_TIMEOUT_MAX_MS = 2500;

const DEFAULT_FLOW_FILLER = "One moment please.";
const DEFAULT_AGENT_ERROR_MESSAGE =
  "Sorry, I ran into a problem. Let me try that again.";

/**
 * Sane voice defaults applied to a freshly created Set Session Config node.
 * These values already satisfy every Set-Session-Config config check below.
 */
export const RECOMMENDED_SESSION_CONFIG: Record<string, any> = {
  bargeInOnSpeech: false,
  bargeInOnDtmf: false,
  asrEnabled: false,
  userNoInputTimeoutEnable: true,
  userNoInputTimeout: 6000,
  userNoInputRetries: USER_INPUT_RETRIES_MIN,
  flowNoInputTimeoutEnable: true,
  flowNoInputTimeout: 1500,
  flowNoInputSpeech: DEFAULT_FLOW_FILLER,
  flowNoInputFail: false,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function nodeId(n: any): string {
  return n?._id || n?.id || "";
}

function findByType(nodes: any[], type: string): any | undefined {
  return nodes.find((n) => n?.type === type);
}

function findAllByType(nodes: any[], type: string): any[] {
  return nodes.filter((n) => n?.type === type);
}

const SESSION_CONFIG_TYPE = "setSessionConfig";
const AI_AGENT_JOB_TYPE = "aiAgentJob";

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

export function evaluateChecks(ctx: AuditContext): VoiceCheck[] {
  const nodes = Array.isArray(ctx.nodes) ? ctx.nodes : [];
  const checks: VoiceCheck[] = [];

  const sscNodes = findAllByType(nodes, SESSION_CONFIG_TYPE);
  const ssc = sscNodes[0];
  const sscConfig: Record<string, any> = ssc?.config ?? {};
  const agent = findByType(nodes, AI_AGENT_JOB_TYPE);
  const agentConfig: Record<string, any> = agent?.config ?? {};
  const entry = nodes.find((n) => n?.isEntryPoint);

  // --- 3.1: first node is a Set Session Config node -----------------------
  {
    const id = "vg.session-config-first";
    const section = "3.1 Flow Configuration";
    const title = "First node is a Set Session Config node";
    const target = agent ?? entry;
    if (!ssc) {
      checks.push({
        id,
        section,
        title,
        status: "fail",
        detail:
          "No Set Session Config node found. Voice flows must open with one so per-session speech settings are applied before the agent runs.",
        autoFixable: !!target,
        ...(target
          ? {
              fix: {
                kind: "createSessionConfig",
                targetNodeId: nodeId(target),
                label: "Set Session Config",
                config: RECOMMENDED_SESSION_CONFIG,
              },
            }
          : {}),
      });
    } else if (entry && nodeId(entry) === nodeId(ssc)) {
      checks.push({
        id,
        section,
        title,
        status: "pass",
        detail: "Set Session Config node is the flow entry point.",
        autoFixable: false,
      });
    } else {
      checks.push({
        id,
        section,
        title,
        status: "warn",
        detail:
          "A Set Session Config node exists but is not the flow entry point. Verify it runs before the AI Agent node.",
        autoFixable: false,
      });
    }
  }

  // Set Session Config value checks share this guard.
  const sscPresent = !!ssc;
  const sscNaDetail =
    "No Set Session Config node to inspect. Fix vg.session-config-first first.";

  // --- 3.1: barge-in off --------------------------------------------------
  pushBoolean(checks, {
    id: "vg.barge-in-off",
    section: "3.1 Flow Configuration",
    title: "Barge-in off",
    present: sscPresent,
    naDetail: sscNaDetail,
    ok:
      sscConfig.bargeInOnSpeech === false && sscConfig.bargeInOnDtmf === false,
    passDetail: "Barge-in is disabled.",
    failDetail:
      "Barge-in is enabled. Default to off unless selectively enabled with clear justification.",
    fix: ssc
      ? {
          kind: "patchNode",
          nodeId: nodeId(ssc),
          config: { bargeInOnSpeech: false, bargeInOnDtmf: false },
        }
      : undefined,
  });

  // --- 3.1: continuous ASR off --------------------------------------------
  pushBoolean(checks, {
    id: "vg.continuous-asr-off",
    section: "3.1 Flow Configuration",
    title: "Continuous ASR off",
    present: sscPresent,
    naDetail: sscNaDetail,
    ok: sscConfig.asrEnabled === false,
    passDetail: "Continuous ASR is disabled.",
    failDetail:
      "Continuous ASR is enabled. Turn it off when using Flux (confidence-based end-of-turn).",
    fix: ssc
      ? {
          kind: "patchNode",
          nodeId: nodeId(ssc),
          config: { asrEnabled: false },
        }
      : undefined,
  });

  // --- 3.1: user input timeout changed from defaults ----------------------
  {
    const id = "vg.user-input-timeout";
    const section = "3.1 Flow Configuration";
    const title = "User input timeout tuned (5–7 s, ≥5 retries)";
    if (!sscPresent) {
      checks.push({
        id,
        section,
        title,
        status: "na",
        detail: sscNaDetail,
        autoFixable: false,
      });
    } else {
      const timeout = Number(sscConfig.userNoInputTimeout);
      const retries = Number(sscConfig.userNoInputRetries);
      const timeoutOk =
        sscConfig.userNoInputTimeoutEnable === true &&
        timeout >= USER_INPUT_TIMEOUT_MIN_MS &&
        timeout <= USER_INPUT_TIMEOUT_MAX_MS;
      const retriesOk = retries >= USER_INPUT_RETRIES_MIN;
      const ok = timeoutOk && retriesOk;
      checks.push({
        id,
        section,
        title,
        status: ok ? "pass" : "fail",
        detail: ok
          ? `User input timeout ${timeout} ms with ${retries} retries.`
          : `User input timeout/retries off recommendation (got timeout=${sscConfig.userNoInputTimeout ?? "unset"} ms, retries=${sscConfig.userNoInputRetries ?? "unset"}). Recommended: 5000–7000 ms, ≥5 retries.`,
        autoFixable: !ok,
        ...(ok
          ? {}
          : {
              fix: {
                kind: "patchNode",
                nodeId: nodeId(ssc),
                config: {
                  userNoInputTimeoutEnable: true,
                  userNoInputTimeout: 6000,
                  userNoInputRetries: USER_INPUT_RETRIES_MIN,
                },
              },
            }),
      });
    }
  }

  // --- 3.1: flow input timeout enabled (~1500 ms) with filler -------------
  {
    const id = "vg.flow-input-timeout";
    const section = "3.1 Flow Configuration";
    const title = "Flow input timeout enabled (~1500 ms) with filler phrase";
    if (!sscPresent) {
      checks.push({
        id,
        section,
        title,
        status: "na",
        detail: sscNaDetail,
        autoFixable: false,
      });
    } else {
      const timeout = Number(sscConfig.flowNoInputTimeout);
      const enabled = sscConfig.flowNoInputTimeoutEnable === true;
      const hasFiller =
        typeof sscConfig.flowNoInputSpeech === "string" &&
        sscConfig.flowNoInputSpeech.trim().length > 0;
      const timeoutOk =
        timeout >= FLOW_INPUT_TIMEOUT_MIN_MS &&
        timeout <= FLOW_INPUT_TIMEOUT_MAX_MS;
      const ok = enabled && timeoutOk && hasFiller;
      checks.push({
        id,
        section,
        title,
        status: ok ? "pass" : "fail",
        detail: ok
          ? `Flow input timeout ${timeout} ms with filler phrase.`
          : "Flow input timeout should be enabled at ~1500 ms with a filler phrase.",
        autoFixable: !ok,
        ...(ok
          ? {}
          : {
              fix: {
                kind: "patchNode",
                nodeId: nodeId(ssc),
                config: {
                  flowNoInputTimeoutEnable: true,
                  flowNoInputTimeout: 1500,
                  flowNoInputSpeech: hasFiller
                    ? sscConfig.flowNoInputSpeech
                    : DEFAULT_FLOW_FILLER,
                },
              },
            }),
      });
    }
  }

  // --- 3.1: flow input timeout "fails on error" off -----------------------
  pushBoolean(checks, {
    id: "vg.flow-fails-on-error-off",
    section: "3.1 Flow Configuration",
    title: "Flow input timeout — fails on error off",
    present: sscPresent,
    naDetail: sscNaDetail,
    ok: sscConfig.flowNoInputFail === false,
    passDetail: "Flow input timeout does not fail the call on error.",
    failDetail:
      "Flow input timeout is set to fail on error. Turn it off so the call survives a no-input.",
    fix: ssc
      ? {
          kind: "patchNode",
          nodeId: nodeId(ssc),
          config: { flowNoInputFail: false },
        }
      : undefined,
  });

  // --- 3.1: Stream to Output on (AI Agent node) ---------------------------
  {
    const id = "agent.stream-output";
    const section = "3.1 Flow Configuration";
    const title = "Stream to Output on in the AI Agent node";
    if (!agent) {
      checks.push({
        id,
        section,
        title,
        status: "na",
        detail: "No AI Agent (aiAgentJob) node found in the flow.",
        autoFixable: false,
      });
    } else {
      const ok = agentConfig.storeLocation === "stream";
      checks.push({
        id,
        section,
        title,
        status: ok ? "pass" : "fail",
        detail: ok
          ? "AI Agent output is streamed (storeLocation = stream)."
          : `AI Agent output is not streamed (storeLocation = ${agentConfig.storeLocation ?? "unset"}). Streaming lowers time-to-first-audio.`,
        autoFixable: !ok,
        ...(ok
          ? {}
          : {
              fix: {
                kind: "patchNode",
                nodeId: nodeId(agent),
                config: { storeLocation: "stream" },
              },
            }),
      });
    }
  }

  // --- 3.1: AI Agent "fails on error" off ---------------------------------
  {
    const id = "agent.fails-on-error-off";
    const section = "3.1 Flow Configuration";
    const title = "AI Agent does not stop the flow on error";
    if (!agent) {
      checks.push({
        id,
        section,
        title,
        status: "na",
        detail: "No AI Agent node found.",
        autoFixable: false,
      });
    } else {
      const ok =
        agentConfig.errorHandling !== undefined &&
        agentConfig.errorHandling !== "stop";
      checks.push({
        id,
        section,
        title,
        status: ok ? "pass" : "fail",
        detail: ok
          ? `AI Agent error handling = ${agentConfig.errorHandling}.`
          : "AI Agent stops the flow on error. Set error handling to continue so the call is not dropped.",
        autoFixable: !ok,
        ...(ok
          ? {}
          : {
              fix: {
                kind: "patchNode",
                nodeId: nodeId(agent),
                config: { errorHandling: "continue" },
              },
            }),
      });
    }
  }

  // --- 3.2: AI Agent error message configured -----------------------------
  {
    const id = "agent.error-message";
    const section = "3.2 LLM";
    const title = "AI Agent error message configured";
    if (!agent) {
      checks.push({
        id,
        section,
        title,
        status: "na",
        detail: "No AI Agent node found.",
        autoFixable: false,
      });
    } else {
      const msg = agentConfig.errorMessage;
      const ok = typeof msg === "string" && msg.trim().length > 0;
      checks.push({
        id,
        section,
        title,
        status: ok ? "pass" : "fail",
        detail: ok
          ? "AI Agent has a configured error message."
          : "AI Agent has no error message. Configure one so callers hear a graceful failure.",
        autoFixable: !ok,
        ...(ok
          ? {}
          : {
              fix: {
                kind: "patchNode",
                nodeId: nodeId(agent),
                config: { errorMessage: DEFAULT_AGENT_ERROR_MESSAGE },
              },
            }),
      });
    }
  }

  // --- 3.2: Log LLM Latency on --------------------------------------------
  {
    const id = "agent.log-llm-latency";
    const section = "3.2 LLM";
    const title = "Log LLM Latency on";
    if (!agent) {
      checks.push({
        id,
        section,
        title,
        status: "na",
        detail: "No AI Agent node found.",
        autoFixable: false,
      });
    } else {
      const ok = agentConfig.debugLogLLMLatency === true;
      checks.push({
        id,
        section,
        title,
        status: ok ? "pass" : "fail",
        detail: ok
          ? "LLM latency logging is on."
          : "LLM latency logging is off. Turn it on to diagnose voice latency.",
        autoFixable: !ok,
        ...(ok
          ? {}
          : {
              fix: {
                kind: "patchNode",
                nodeId: nodeId(agent),
                config: { debugLogLLMLatency: true },
              },
            }),
      });
    }
  }

  // --- 3.6: silence overlay delay set to 0 (when configured) --------------
  {
    const id = "vg.silence-overlay-delay";
    const section = "3.6 Audio Experience";
    const title = "Silence overlay delay set to 0";
    const configured =
      sscPresent &&
      sscConfig.silenceOverlayAction !== undefined &&
      sscConfig.silenceOverlayAction !== false &&
      sscConfig.silenceOverlayAction !== "";
    if (!configured) {
      checks.push({
        id,
        section,
        title,
        status: "na",
        detail: sscPresent
          ? "Silence overlay not configured (optional)."
          : sscNaDetail,
        autoFixable: false,
      });
    } else {
      const ok = Number(sscConfig.silenceOverlayDelay) === 0;
      checks.push({
        id,
        section,
        title,
        status: ok ? "pass" : "fail",
        detail: ok
          ? "Silence overlay delay is 0."
          : `Silence overlay delay is ${sscConfig.silenceOverlayDelay}. Set it to 0.`,
        autoFixable: !ok,
        ...(ok
          ? {}
          : {
              fix: {
                kind: "patchNode",
                nodeId: nodeId(ssc),
                config: { silenceOverlayDelay: 0 },
              },
            }),
      });
    }
  }

  // --- 3.3: STT hints present (advisory) ----------------------------------
  {
    const id = "vg.stt-hints";
    const section = "3.3 Speech Services";
    const title = "STT hints include brand/domain terms";
    if (!sscPresent) {
      checks.push({
        id,
        section,
        title,
        status: "na",
        detail: sscNaDetail,
        autoFixable: false,
      });
    } else {
      const hints = sscConfig.sttHints;
      const has = Array.isArray(hints) && hints.length > 0;
      checks.push({
        id,
        section,
        title,
        status: has ? "pass" : "warn",
        detail: has
          ? `${hints.length} STT hint(s) configured. Confirm they cover brand and domain terms.`
          : "No STT hints configured. Add brand and domain terms to improve recognition. (Cannot be auto-filled.)",
        autoFixable: false,
      });
    }
  }

  // --- 3.7: Output Transformer strips markdown (advisory) -----------------
  {
    const id = "endpoint.output-transformer";
    const section = "3.7 Deployment";
    const title = "Endpoint Output Transformer enabled";
    if (ctx.endpoint === undefined) {
      checks.push({
        id,
        section,
        title,
        status: "na",
        detail: "Pass endpointId to audit the Output Transformer.",
        autoFixable: false,
      });
    } else if (ctx.endpoint === null) {
      checks.push({
        id,
        section,
        title,
        status: "warn",
        detail:
          "endpointId was provided but the endpoint could not be fetched (not found or no access). Verify the id and permissions.",
        autoFixable: false,
      });
    } else {
      const t = ctx.endpoint.transformer ?? {};
      const code = typeof t.transformer === "string" ? t.transformer : "";
      const ok = t.outputTransformerEnabled === true && code.trim().length > 0;
      checks.push({
        id,
        section,
        title,
        status: ok ? "pass" : "warn",
        detail: ok
          ? "Output Transformer is enabled with code present. Confirm it strips markdown and fixes pronunciations."
          : "Output Transformer is not enabled or empty. Add one that strips markdown and fixes pronunciations. (Code is not auto-generated.)",
        autoFixable: false,
      });
    }
  }

  // --- 3.2: Fallback LLM configured (advisory) ----------------------------
  {
    const id = "llm.fallback";
    const section = "3.2 LLM";
    const title = "Fallback LLM configured";
    if (ctx.llm === undefined) {
      checks.push({
        id,
        section,
        title,
        status: "na",
        detail:
          "Pass projectId so the agent's LLM can be resolved and inspected.",
        autoFixable: false,
      });
    } else if (ctx.llm === null) {
      checks.push({
        id,
        section,
        title,
        status: "warn",
        detail:
          "projectId was provided but the agent's LLM could not be resolved. Verify the project has an LLM assigned.",
        autoFixable: false,
      });
    } else {
      const fallbacks = ctx.llm.fallbacks;
      const has = Array.isArray(fallbacks) && fallbacks.length > 0;
      checks.push({
        id,
        section,
        title,
        status: has ? "pass" : "warn",
        detail: has
          ? `${fallbacks.length} fallback LLM(s) configured.`
          : "No fallback LLM configured. Add one so the call survives a primary-LLM outage. (Requires choosing a model — not auto-applied.)",
        autoFixable: false,
      });
    }
  }

  return checks;
}

interface BooleanCheckSpec {
  id: string;
  section: string;
  title: string;
  present: boolean;
  naDetail: string;
  ok: boolean;
  passDetail: string;
  failDetail: string;
  fix?: VoiceFix;
}

function pushBoolean(checks: VoiceCheck[], spec: BooleanCheckSpec): void {
  if (!spec.present) {
    checks.push({
      id: spec.id,
      section: spec.section,
      title: spec.title,
      status: "na",
      detail: spec.naDetail,
      autoFixable: false,
    });
    return;
  }
  checks.push({
    id: spec.id,
    section: spec.section,
    title: spec.title,
    status: spec.ok ? "pass" : "fail",
    detail: spec.ok ? spec.passDetail : spec.failDetail,
    autoFixable: !spec.ok && !!spec.fix,
    ...(!spec.ok && spec.fix ? { fix: spec.fix } : {}),
  });
}

export function summarize(checks: VoiceCheck[]): {
  pass: number;
  fail: number;
  warn: number;
  na: number;
  total: number;
  fixable: number;
} {
  const summary = {
    pass: 0,
    fail: 0,
    warn: 0,
    na: 0,
    total: checks.length,
    fixable: 0,
  };
  for (const c of checks) {
    summary[c.status] += 1;
    if (c.autoFixable) summary.fixable += 1;
  }
  return summary;
}
