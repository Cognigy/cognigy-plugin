/**
 * Voice Go-Live checklist for AI Agents (service-agents). A separate rule set
 * from voiceChecklist.ts, which reads a legacy agent's flow chart: here the
 * call behaviour lives in the agent's voice settings (voice-config-defaults),
 * its tools, its LLMs and the Voice Gateway endpoint that targets it.
 *
 * Mapped to section 3 of the Voice AI guidebook and agreed with the plugin
 * owner. Barge-in differs from the legacy rule on purpose: it stays on but
 * needs at least 2 words (AI Agents can require several words, legacy flows
 * cannot).
 *
 * A pure function of the fetched resources, like voiceChecklist.ts.
 */
import { speechBlocks, speechCredentialFor } from "./agentVoice.js";
import type { CheckStatus } from "./voiceChecklist.js";

export type AgentVoiceFix =
  /** Fields to set in the agent's voice settings. */
  | { kind: "voiceSettings"; config: Record<string, any> }
  /** A builtin tool to attach to the agent. */
  | { kind: "addTool"; builtinSlug: string };

export interface AgentVoiceCheck {
  id: string;
  section: string;
  title: string;
  status: CheckStatus;
  detail: string;
  autoFixable: boolean;
  fix?: AgentVoiceFix;
}

export interface AgentAuditContext {
  agent: any;
  /** The agent's voice settings: its instance's values or the defaults. */
  settings: Record<string, any>;
  /** Builtin slugs (`type`) of the tools the agent can call. */
  toolTypes: string[];
  /** Builtin slugs of tools attached to the agent but switched off for it. */
  disabledToolTypes?: string[];
  /** The project's speech credentials (raw rows); null when unreadable. */
  providers: any[] | null;
  /** The project's LLMs. */
  llms: any[];
  /** The Voice Gateway endpoint that targets the agent; null when none does. */
  endpoint: any | null;
  /** Warnings of the current voice prompt's preview; undefined when unread. */
  voicePromptWarnings?: any[];
}

const RANGE = { timeout: [5, 7], retries: 5, minWords: 2 } as const;
const FAST_EFFORT = new Set(["none", "minimal", "low"]);
const MANY_SKILLS = 3;

const check = (
  id: string,
  section: string,
  title: string,
  status: CheckStatus,
  detail: string,
  fix?: AgentVoiceFix,
): AgentVoiceCheck => ({
  id,
  section,
  title,
  status,
  detail,
  autoFixable: !!fix && status === "fail",
  ...(fix && status === "fail" ? { fix } : {}),
});

/**
 * What a call speaks or listens with, as a check result: "ok" with a label,
 * "fail" with a reason, or "unknown" when the credentials cannot be read.
 */
function resolveSpeech(
  kind: "tts" | "stt",
  block: "complete" | "empty" | "incomplete",
  s: Record<string, any>,
  ctx: AgentAuditContext,
): { state: "ok" | "fail" | "unknown"; text: string } {
  const label = kind.toUpperCase();
  if (block === "incomplete")
    return {
      state: "fail",
      text: `${label}: incomplete in the voice settings, so calls ignore it.`,
    };
  if (!ctx.providers)
    return {
      state: "unknown",
      text: `${label}: the project's speech credentials could not be read.`,
    };
  const serves = (p: any) => p?.[kind === "tts" ? "useForTts" : "useForStt"];
  const usable = (p: any, what: string) =>
    !p
      ? {
          state: "fail" as const,
          text: `${label}: ${what} is not in this project.`,
        }
      : !serves(p)
        ? {
            state: "fail" as const,
            text: `${label}: ${what} "${p.name}" does not offer ${label}.`,
          }
        : p.status?.state === "error"
          ? {
              state: "fail" as const,
              text: `${label}: ${what} "${p.name}" fails its test.`,
            }
          : null;
  if (block === "complete") {
    const row = speechCredentialFor(kind, s, ctx.providers);
    const bad = usable(row, "the agent's speech credential");
    if (bad) return bad;
    if (row.vendor !== s[`${kind}Vendor`])
      return {
        state: "fail",
        text: `${label}: the settings say ${s[`${kind}Vendor`]}, but the credential "${row.name}" is ${row.vendor}.`,
      };
    return {
      state: "ok",
      text: `${label}: the agent's own (${row.vendor}, ${row.name}).`,
    };
  }
  const endpointCredential = ctx.endpoint?.voiceSettings?.[kind]?.credentialId;
  if (endpointCredential) {
    const row = ctx.providers.find((p) => p.id === endpointCredential);
    return (
      usable(row, "the endpoint's speech credential") ?? {
        state: "ok",
        text: `${label}: none set; calls use the endpoint's (${row.vendor}).`,
      }
    );
  }
  const isDefault = kind === "tts" ? "isDefaultTts" : "isDefaultStt";
  const row =
    ctx.providers.find((p) => serves(p) && p[isDefault]) ??
    ctx.providers.find((p) => serves(p) && p.systemProvided === true);
  if (!row || row.status?.state === "error")
    return {
      state: "fail",
      text: `${label}: none set and no working fallback.`,
    };
  return {
    state: "ok",
    text: `${label}: none set; calls use ${row.vendor} (${row.name}${row.systemProvided ? ", NiCE-provided" : ""}).`,
  };
}

export function evaluateAgentChecks(ctx: AgentAuditContext): AgentVoiceCheck[] {
  const s = ctx.settings;
  const checks: AgentVoiceCheck[] = [];

  // 3.3 Speech services: what the caller hears and how they are heard.
  const blocks = speechBlocks(s);
  const speech = (["tts", "stt"] as const).map((k) =>
    resolveSpeech(k, blocks[k], s, ctx),
  );
  checks.push(
    check(
      "agent.speech-resolves",
      "3.3 Speech Services",
      "Speech output and recognition resolve to a working credential",
      speech.some((r) => r.state === "fail")
        ? "fail"
        : speech.some((r) => r.state === "unknown")
          ? "warn"
          : "pass",
      speech.map((r) => r.text).join(" "),
    ),
  );

  // 3.1 Flow configuration: turn taking and listening.
  const bargeOk =
    s.bargeInOnSpeech === true &&
    Number(s.minWordsToInterrupt) >= RANGE.minWords &&
    s.bargeInOnDtmf !== true;
  checks.push(
    check(
      "agent.barge-in",
      "3.1 Flow Configuration",
      `Barge-in on speech needs at least ${RANGE.minWords} words; keypresses don't interrupt`,
      bargeOk ? "pass" : "fail",
      `bargeInOnSpeech ${s.bargeInOnSpeech}, minWordsToInterrupt ${s.minWordsToInterrupt}, bargeInOnDtmf ${s.bargeInOnDtmf}.`,
      {
        kind: "voiceSettings",
        config: {
          bargeInOnSpeech: true,
          minWordsToInterrupt: Math.max(
            RANGE.minWords,
            Number(s.minWordsToInterrupt) || 0,
          ),
          bargeInOnDtmf: false,
        },
      },
    ),
  );
  checks.push(
    check(
      "agent.continuous-asr",
      "3.1 Flow Configuration",
      "Continuous ASR off",
      s.continuousAsr === true ? "fail" : "pass",
      `continuousAsr ${s.continuousAsr}.`,
      { kind: "voiceSettings", config: { continuousAsr: false } },
    ),
  );
  const timeout = Number(s.silenceTimeoutSeconds);
  const retries = Number(s.silenceRetries);
  const timeoutOk = timeout >= RANGE.timeout[0] && timeout <= RANGE.timeout[1];
  checks.push(
    check(
      "agent.silence",
      "3.1 Flow Configuration",
      `Silent callers are re-prompted after ${RANGE.timeout[0]}-${RANGE.timeout[1]} s, at least ${RANGE.retries} times`,
      s.promptOnSilence === true && timeoutOk && retries >= RANGE.retries
        ? "pass"
        : "fail",
      `promptOnSilence ${s.promptOnSilence}, silenceTimeoutSeconds ${s.silenceTimeoutSeconds}, silenceRetries ${s.silenceRetries}.`,
      {
        kind: "voiceSettings",
        config: {
          promptOnSilence: true,
          silenceTimeoutSeconds: timeoutOk ? timeout : 6,
          silenceRetries: Math.max(RANGE.retries, retries || 0),
        },
      },
    ),
  );

  // 3.5 Transactions: the agent can end and hand over a call.
  const has = (slug: string) => ctx.toolTypes.includes(slug);
  const off = (slug: string) =>
    (ctx.disabledToolTypes ?? []).includes(slug)
      ? ` It is attached but switched off for this agent.`
      : "";
  checks.push(
    check(
      "agent.hangup-tool",
      "3.5 Transactions",
      "The agent can end a call (voice-hangup)",
      has("voice-hangup") ? "pass" : "fail",
      has("voice-hangup")
        ? "voice-hangup is attached."
        : `No usable voice-hangup tool: the agent cannot end a call itself.${off("voice-hangup")}`,
      { kind: "addTool", builtinSlug: "voice-hangup" },
    ),
  );
  checks.push(
    check(
      "agent.transfer-tool",
      "3.5 Transactions",
      "The agent can hand a call to a person (voice-transfer)",
      has("voice-transfer") ? "pass" : "warn",
      has("voice-transfer")
        ? "voice-transfer is attached."
        : `No usable voice-transfer tool. Add one when calls must reach a person; it needs a transfer target, so it is not added automatically.${off("voice-transfer")}`,
    ),
  );

  // 3.2 Latency and the agent's LLMs.
  const effort = ctx.agent?.llmConfig?.reasoningEffort;
  const skills = (ctx.agent?.skillReferenceIds ?? []).length;
  const slow: string[] = [];
  if (!FAST_EFFORT.has(effort))
    slow.push(
      effort
        ? `reasoningEffort is ${effort}; use none, minimal or low for voice.`
        : "reasoningEffort is not set, so the model's default applies; none, minimal or low answers faster.",
    );
  if (s.thinkingSound === "none")
    slow.push("No thinking sound, so think time sounds like a dropped call.");
  if (skills > MANY_SKILLS)
    slow.push(
      `${skills} skills attached; every skill the agent loads costs a turn.`,
    );
  checks.push(
    check(
      "agent.latency",
      "3.2 Error Handling & Latency",
      "Fast answers: low reasoning effort, a thinking sound, few skills",
      slow.length ? "warn" : "pass",
      slow.length ? slow.join(" ") : "Nothing slows the answers down.",
    ),
  );

  const ref = ctx.agent?.largeLanguageModelReferenceId;
  const text = ref
    ? ctx.llms.find((m) => m.referenceId === ref)
    : ctx.llms.find((m) => m.isDefault);
  const textProblem = !text
    ? ref
      ? `Its text LLM ${ref} is not in this project.`
      : "No text LLM is bound and the project has no default."
    : text.modelGroup === "voiceToVoice" || text.modelType === "gpt-live-1"
      ? `Its text LLM "${text.name}" is a voice-to-voice model, which cannot answer text turns.`
      : !text.connectionId && !text.isInPlatformLlm
        ? `Its text LLM "${text.name}" has no connection.`
        : "";
  checks.push(
    check(
      "agent.text-llm",
      "3.2 Error Handling & Latency",
      "A connected text LLM answers, never a voice-to-voice model",
      textProblem ? "fail" : "pass",
      textProblem || `"${text.name}" (${text.modelType}).`,
    ),
  );

  // 3.4 Prompting, GPT live only.
  const voiceRef = ctx.agent?.voiceLargeLanguageModelReferenceId;
  if (!voiceRef) {
    checks.push(
      check(
        "agent.v2v",
        "3.4 Prompting",
        "GPT live voice model and voice prompt",
        "na",
        "No voice model: calls use speech recognition and synthesis.",
      ),
    );
  } else {
    const live = ctx.llms.find((m) => m.referenceId === voiceRef);
    const warnings = ctx.voicePromptWarnings ?? [];
    const problem = !live
      ? `Its voice model ${voiceRef} is not in this project.`
      : live.modelGroup !== "voiceToVoice"
        ? `Its voice model "${live.name}" is not a voice-to-voice model.`
        : !live.connectionId
          ? `Its voice model "${live.name}" has no connection.`
          : warnings.length
            ? `The voice prompt has warnings: ${warnings.map((w) => w.message ?? w.token).join("; ")}`
            : "";
    checks.push(
      check(
        "agent.v2v",
        "3.4 Prompting",
        "GPT live voice model and voice prompt",
        problem ? "fail" : "pass",
        problem ||
          `"${live.name}", voice ${ctx.agent?.realtimeVoice || "marin"}, voice prompt without warnings.`,
      ),
    );
  }

  // 3.7 Deployment.
  checks.push(
    check(
      "endpoint.agent-target",
      "3.7 Deployment",
      "A Voice Gateway endpoint is active and targets the agent",
      ctx.endpoint && ctx.endpoint.active !== false ? "pass" : "fail",
      !ctx.endpoint
        ? "No Voice Gateway endpoint targets this agent: create one with manage_voice_gateway { projectId, agentId }."
        : ctx.endpoint.active === false
          ? `Endpoint "${ctx.endpoint.name}" is inactive.`
          : `Endpoint "${ctx.endpoint.name}".`,
    ),
  );
  return checks;
}
