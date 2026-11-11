import { describe, it, expect } from "@jest/globals";
import {
  evaluateAgentChecks,
  type AgentAuditContext,
} from "../tools/agentVoiceChecklist.js";

const defaults = {
  ttsVendor: "",
  ttsVoice: "",
  ttsLanguage: "",
  sttVendor: "",
  sttLanguage: "",
  greetingMode: "agent",
  greetingText: "",
  bargeInOnSpeech: true,
  minWordsToInterrupt: 1,
  bargeInOnDtmf: false,
  promptOnSilence: true,
  silenceTimeoutSeconds: 8,
  silenceRetries: 2,
  continuousAsr: false,
  thinkingSound: "typing_loop",
};
const textLlm = {
  referenceId: "llm",
  name: "GPT-4o",
  modelType: "gpt-4o",
  modelGroup: "chat",
  connectionId: "c",
  isDefault: true,
};
const niceMs = {
  referenceId: "nice-ms",
  name: "Included Speech Provider",
  vendor: "microsoft",
  systemProvided: true,
  useForTts: true,
  useForStt: true,
  status: { state: "ok" },
};

const ctx = (over: Partial<AgentAuditContext> = {}): AgentAuditContext => ({
  agent: { largeLanguageModelReferenceId: "llm", llmConfig: {} },
  settings: { ...defaults },
  toolTypes: [],
  providers: [niceMs],
  llms: [textLlm],
  endpoint: { name: "VG", agentId: "ref" },
  ...over,
});
const byId = (checks: any[]) =>
  Object.fromEntries(checks.map((c) => [c.id, c]));

describe("AI Agent voice go-live checks", () => {
  it("flags the platform defaults the guidebook asks to change, with fixes", () => {
    const checks = evaluateAgentChecks(ctx());
    expect(checks).toHaveLength(10);
    const c = byId(checks);
    expect(c["agent.barge-in"]).toMatchObject({
      status: "fail",
      fix: {
        kind: "voiceSettings",
        config: {
          bargeInOnSpeech: true,
          minWordsToInterrupt: 2,
          bargeInOnDtmf: false,
        },
      },
    });
    expect(c["agent.silence"].fix.config).toEqual({
      promptOnSilence: true,
      silenceTimeoutSeconds: 6,
      silenceRetries: 5,
    });
    expect(c["agent.hangup-tool"].fix).toEqual({
      kind: "addTool",
      builtinSlug: "voice-hangup",
    });
    expect(c["agent.transfer-tool"].status).toBe("warn");
    expect(c["agent.latency"].status).toBe("warn");
    expect(c["agent.v2v"].status).toBe("na");
    expect(c["agent.speech-resolves"]).toMatchObject({ status: "pass" });
    expect(c["agent.speech-resolves"].detail).toContain("NiCE-provided");
  });

  it("passes a tuned agent", () => {
    const checks = evaluateAgentChecks(
      ctx({
        agent: {
          largeLanguageModelReferenceId: "llm",
          llmConfig: { reasoningEffort: "low" },
        },
        settings: {
          ...defaults,
          minWordsToInterrupt: 2,
          silenceTimeoutSeconds: 6,
          silenceRetries: 5,
        },
        toolTypes: ["voice-hangup", "voice-transfer"],
      }),
    );
    expect(
      checks.filter((c) => c.status !== "pass" && c.status !== "na"),
    ).toEqual([]);
  });

  it("resolves the credential a complete block points at", () => {
    const tts = {
      ...defaults,
      ttsVendor: "microsoft",
      ttsVoice: "en-US-AvaNeural",
      ttsLanguage: "en-US",
    };
    const speech = (over: Partial<AgentAuditContext>) =>
      byId(evaluateAgentChecks(ctx(over)))["agent.speech-resolves"];

    const missing = speech({
      settings: { ...tts, ttsCredentialReferenceId: "gone" },
    });
    expect(missing.status).toBe("fail");
    expect(missing.detail).toContain("not in this project");

    const sttOnly = { ...niceMs, referenceId: "stt", useForTts: false };
    expect(
      speech({
        settings: { ...tts, ttsCredentialReferenceId: "stt" },
        providers: [sttOnly],
      }).detail,
    ).toContain("does not offer TTS");

    const mismatch = speech({
      settings: {
        ...tts,
        ttsVendor: "deepgram",
        ttsCredentialReferenceId: "nice-ms",
      },
    });
    expect(mismatch.detail).toContain("is microsoft");

    // Saved before the referenceId existed: found by vendor and label.
    expect(
      speech({ settings: { ...tts, ttsLabel: "Included Speech Provider" } })
        .status,
    ).toBe("pass");
    expect(
      speech({ settings: { ...tts, ttsLabel: "Someone else's" } }).status,
    ).toBe("fail");

    expect(speech({ providers: null }).status).toBe("warn");
  });

  it("fails speech that the call ignores or cannot resolve", () => {
    const partial = byId(
      evaluateAgentChecks(
        ctx({
          settings: {
            ...defaults,
            ttsVendor: "microsoft",
            ttsLanguage: "en-US",
          },
        }),
      ),
    );
    expect(partial["agent.speech-resolves"].status).toBe("fail");
    expect(partial["agent.speech-resolves"].detail).toContain(
      "TTS: incomplete",
    );
    const none = byId(evaluateAgentChecks(ctx({ providers: [] })));
    expect(none["agent.speech-resolves"].detail).toContain(
      "no working fallback",
    );
  });

  it("fails a voice-to-voice text LLM and a GPT live prompt with warnings", () => {
    const live = {
      ...textLlm,
      referenceId: "live",
      name: "GPT Live",
      modelType: "gpt-live-1",
      modelGroup: "voiceToVoice",
    };
    const c = byId(
      evaluateAgentChecks(
        ctx({
          agent: {
            largeLanguageModelReferenceId: "live",
            voiceLargeLanguageModelReferenceId: "live",
          },
          llms: [live],
          voicePromptWarnings: [{ message: "Unknown variable {{x}}" }],
          endpoint: null,
        }),
      ),
    );
    expect(c["agent.text-llm"].status).toBe("fail");
    expect(c["agent.v2v"].detail).toContain("Unknown variable");
    expect(c["endpoint.agent-target"]).toMatchObject({
      status: "fail",
      autoFixable: false,
    });
  });
});
