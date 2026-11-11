/**
 * Voice Go-Live checklist for AI Agents (service-agents). A separate rule set
 * from voiceChecklist.ts, which reads a legacy agent's flow chart: here the
 * call behaviour lives in the agent's voice settings (voice-config-defaults),
 * its tools, its LLMs and the Voice Gateway endpoint that targets it.
 *
 * Mapped to section 3 of the Voice AI guidebook and agreed with the plugin
 * owner. Two rules differ from the legacy ones on purpose: barge-in stays on
 * but needs at least 2 words (AI Agents can require several words, legacy
 * flows cannot), and the greeting is advisory only.
 *
 * A pure function of the fetched resources, like voiceChecklist.ts.
 */
import { speechBlocks } from "./agentVoice.js";
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
  /** Builtin slugs (`type`) of the tools available to the agent. */
  toolTypes: string[];
  /** The project's speech credentials (raw rows). */
  providers: any[];
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

/** Where a call gets TTS or STT from when the agent's block is empty. */
function fallbackSpeech(
  kind: "tts" | "stt",
  ctx: AgentAuditContext,
): string | null {
  if (ctx.endpoint?.voiceSettings?.[kind]?.credentialId)
    return "the endpoint's speech settings";
  const serves = (p: any) => p?.[kind === "tts" ? "useForTts" : "useForStt"];
  const isDefault = kind === "tts" ? "isDefaultTts" : "isDefaultStt";
  const row =
    ctx.providers.find((p) => serves(p) && p[isDefault]) ??
    ctx.providers.find((p) => serves(p) && p.systemProvided === true);
  if (!row || row.status?.state === "error") return null;
  return `${row.vendor} (${row.name}${row.systemProvided ? ", NiCE-provided" : ""})`;
}

export function evaluateAgentChecks(ctx: AgentAuditContext): AgentVoiceCheck[] {
  const s = ctx.settings;
  const checks: AgentVoiceCheck[] = [];

  // 3.3 Speech services: what the caller hears and how they are heard.
  const blocks = speechBlocks(s);
  const speech: string[] = [];
  let speechOk = true;
  for (const kind of ["tts", "stt"] as const) {
    const label = kind.toUpperCase();
    if (blocks[kind] === "complete") {
      const ref = s[`${kind}CredentialReferenceId`];
      const row = ctx.providers.find((p) => p.referenceId === ref);
      if (row?.status?.state === "error") {
        speechOk = false;
        speech.push(
          `${label}: its speech credential "${row.name}" fails its test.`,
        );
      } else speech.push(`${label}: the agent's own (${s[`${kind}Vendor`]}).`);
    } else if (blocks[kind] === "incomplete") {
      speechOk = false;
      speech.push(
        `${label}: incomplete in the voice settings, so calls ignore it.`,
      );
    } else {
      const from = fallbackSpeech(kind, ctx);
      if (!from) speechOk = false;
      speech.push(
        from
          ? `${label}: none set; calls use ${from}.`
          : `${label}: none set and no working fallback.`,
      );
    }
  }
  checks.push(
    check(
      "agent.speech-resolves",
      "3.3 Speech Services",
      "Speech output and recognition resolve to a working credential",
      speechOk ? "pass" : "fail",
      speech.join(" "),
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

  // 3.4 Prompting: the first thing the caller hears. Advisory: the text is the user's.
  const staticGreeting =
    s.greetingMode === "static" && String(s.greetingText ?? "").trim() !== "";
  checks.push(
    check(
      "agent.greeting",
      "3.4 Prompting",
      "The call opens with a fixed greeting",
      staticGreeting ? "pass" : "warn",
      staticGreeting
        ? "A static greeting plays as soon as the call connects."
        : s.greetingMode === "none"
          ? "The agent waits for the caller to speak first, so the caller hears silence."
          : s.greetingMode === "static"
            ? "greetingMode is static but greetingText is empty."
            : "The LLM writes the greeting, which costs a model turn before the caller hears anything. A static greetingText (greetingMode static) picks up faster.",
    ),
  );

  // 3.5 Transactions: the agent can end and hand over a call.
  const has = (slug: string) => ctx.toolTypes.includes(slug);
  checks.push(
    check(
      "agent.hangup-tool",
      "3.5 Transactions",
      "The agent can end a call (voice-hangup)",
      has("voice-hangup") ? "pass" : "fail",
      has("voice-hangup")
        ? "voice-hangup is attached."
        : "No voice-hangup tool: the agent cannot end a call itself.",
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
        : "No voice-transfer tool. Add one when calls must reach a person; it needs a transfer target, so it is not added automatically.",
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
