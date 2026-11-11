/**
 * Speech for AI Agents. An agent's voice behaviour (TTS, STT, greeting,
 * barge-in, silence, waiting audio) lives in one hidden builtin tool instance,
 * `voice-config-defaults`, attached through the agent's toolReferenceIds.
 * No instance means the descriptor's defaults. A speech block counts only when
 * complete (TTS: vendor, voice, language; STT: vendor, language); otherwise a
 * call falls back to the endpoint's speech settings, the project's default
 * speech credential, then the NiCE-provided one.
 */
import { CognigyApiClient } from "../api/client.js";

export const VOICE_SETTINGS_SLUG = "voice-config-defaults";

/**
 * Providers whose LLMs can run voice-to-voice (GPT live), with the name the
 * user knows. The platform checks this inside service-resources and does not
 * list it over REST, so it is kept here: setup_llm's check, the create hint
 * and check_capabilities (v2vProviders, which the skills read) all use it.
 */
export const V2V_PROVIDERS: Record<string, string> = { openAI: "OpenAI" };

// Voice-to-voice models (gpt-live-1) only serve as an AI Agent's voice model;
// bound as a text model they return no replies and no error.
export function isVoiceToVoiceModel(llm: any): boolean {
  return llm?.modelGroup === "voiceToVoice" || llm?.modelType === "gpt-live-1";
}

/** A connected voice-to-voice model an AI Agent can call through, or undefined. */
export function pickVoiceModel(llms: any[]): any | undefined {
  return llms.find(
    (m) =>
      isVoiceToVoiceModel(m) && m.provider in V2V_PROVIDERS && m.connectionId,
  );
}

/**
 * The one build-summary line for a new voice agent on speech recognition and
 * synthesis where GPT live is available. It states what the user got first and
 * offers voice-to-voice as an option, never as the better thing they missed.
 */
export function v2vOfferLine(niceSpeech: boolean): string {
  const keys = Object.values(V2V_PROVIDERS).join(" or ");
  return `${niceSpeech ? "It runs on NiCE-provided speech, so it works right away." : "It runs on the project's speech settings."} It can also run voice-to-voice, which responds faster and sounds more natural. If you have an ${keys} API key, I can set that up.`;
}

/** One speech credential row as the plugin shows it. */
export function summarizeSpeechProvider(r: any): any {
  return {
    id: r.id,
    referenceId: r.referenceId,
    name: r.name,
    vendor: r.vendor,
    niceProvided: r.systemProvided === true,
    stt: !!r.useForStt,
    tts: !!r.useForTts,
    ...(r.isDefaultStt ? { defaultStt: true } : {}),
    ...(r.isDefaultTts ? { defaultTts: true } : {}),
    status: r.status?.state,
  };
}

/** The project's primary speech credentials (raw rows, secrets stripped by the API). */
export async function listSpeechProviders(
  api: CognigyApiClient,
  projectId: string,
  page: { limit: number; skip: number } = { limit: 100, skip: 0 },
): Promise<{ items: any[]; total: number }> {
  const res: any = await api.get("/v2.0/voice/speechCredentials", {
    params: {
      projectId,
      type: "primary",
      pageSize: page.limit,
      page: Math.floor(page.skip / page.limit) + 1,
    },
  });
  const items: any[] = Array.isArray(res?.data) ? res.data : [];
  return { items, total: res?.total ?? items.length };
}

/** The agent's voice-config-defaults instance, or null when it has none. */
export async function findVoiceSettings(
  api: CognigyApiClient,
  v1: string,
  projectId: string,
  agentReferenceId: string,
): Promise<any | null> {
  const res: any = await api.get(`${v1}/tools`, {
    params: {
      projectId,
      agentReferenceId,
      includeHidden: true,
      source: "builtin",
      limit: 100,
    },
  });
  const items: any[] = res?.items ?? [];
  return items.find((t) => t?.type === VOICE_SETTINGS_SLUG) ?? null;
}

/** `[{ key, value }]` → `{ key: value }`. */
export function settingsMap(
  parameters: any[] | undefined,
): Record<string, any> {
  return Object.fromEntries(
    (parameters ?? []).map((p: any) => [p.key, p.value]),
  );
}

/**
 * The settings a call uses: the descriptor's defaults with the stored values
 * over them. Voice Studio stores only the keys that are set, so a stored
 * parameter list is never the whole picture.
 */
export function resolveVoiceSettings(
  defaults: any[] | undefined,
  stored: any[] | undefined,
): Record<string, any> {
  return { ...settingsMap(defaults), ...settingsMap(stored) };
}

const isUnset = (v: any) =>
  v === "" ||
  v == null ||
  (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length);

/**
 * The stored parameter list after `changes`, in Voice Studio's shape: only
 * the keys that are set. An unset value ("", null, {}) removes the key, so it
 * inherits again; 0 and false are real values. Fields of a stored parameter
 * the plugin does not set are kept. Throws on a key the descriptor lacks.
 */
export function voiceParameters(
  defaults: any[],
  stored: any[],
  changes: Record<string, any>,
): any[] {
  const known = new Map(defaults.map((p) => [p.key, p]));
  const unknown = Object.keys(changes).filter((k) => !known.has(k));
  if (unknown.length)
    throw new Error(
      `Unknown voice setting(s) ${unknown.join(", ")}; the settings are ${[...known.keys()].join(", ")}.`,
    );
  const out = new Map(stored.map((p) => [p.key, p]));
  for (const [key, value] of Object.entries(changes)) {
    if (isUnset(value)) {
      out.delete(key);
      continue;
    }
    const d = known.get(key);
    out.set(key, {
      ...out.get(key),
      key,
      name: d.name ?? key,
      description: d.description ?? "",
      mode: "dynamic",
      type: d.type,
      value,
    });
  }
  return [...out.values()];
}

/**
 * The speech credential a TTS or STT block points at: by referenceId, else
 * (settings saved before the referenceId existed) by vendor and label, the
 * way the gateway picks it. Undefined when the project has none that fits.
 */
export function speechCredentialFor(
  kind: "tts" | "stt",
  s: Record<string, any>,
  providers: any[],
): any | undefined {
  const ref = s[`${kind}CredentialReferenceId`];
  if (ref) return providers.find((p) => p.referenceId === ref);
  return providers.find(
    (p) =>
      p[kind === "tts" ? "useForTts" : "useForStt"] &&
      p.vendor === s[`${kind}Vendor`] &&
      (!s[`${kind}Label`] || p.name === s[`${kind}Label`]),
  );
}

type Block = "complete" | "empty" | "incomplete";

/** All or nothing per block, as the call resolves it. */
export function speechBlocks(s: Record<string, any>): {
  tts: Block;
  stt: Block;
} {
  const state = (keys: string[]): Block => {
    const set = keys.filter((k) => String(s[k] ?? "").trim() !== "").length;
    return set === keys.length
      ? "complete"
      : set === 0
        ? "empty"
        : "incomplete";
  };
  return {
    tts: state(["ttsVendor", "ttsVoice", "ttsLanguage"]),
    stt: state(["sttVendor", "sttLanguage"]),
  };
}

/** Voice ids a credential offers for one language, or null when unreadable. */
export async function listVoices(
  api: CognigyApiClient,
  projectId: string,
  credentialId: string,
  language: string,
): Promise<string[] | null> {
  try {
    const res: any = await api.get(
      `/v2.0/voice/speechCredentials/${credentialId}/voices`,
      { params: { projectId, capability: "tts", language } },
    );
    return Array.isArray(res?.voices) ? res.voices.map((v: any) => v.id) : null;
  } catch {
    return null;
  }
}
