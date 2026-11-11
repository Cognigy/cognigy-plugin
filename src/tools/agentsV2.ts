/**
 * AI Agents served by service-agents (internally "Agents V2"). Users only ever
 * hear "AI Agents"; the flow-based kind behind /v2.0/aiagents is called
 * "legacy" when the two must be told apart. Never say V1/V2 in LLM-facing text.
 *
 * service-agents is reached on the API host root (`https://api-<host>/v1/...`),
 * not under `/new` like service-api. Traefik's auth-gateway forward-auth turns
 * the plugin's `X-API-Key` into the internal JWT service-agents expects, so the
 * same key works for both as long as the cluster runs the auth gateway.
 */
import { CognigyApiClient } from "../api/client.js";

export function agentsV2BaseUrl(apiBaseUrl: string): string {
  return new URL(apiBaseUrl).origin;
}

export type Availability = "available" | "unavailable" | "unknown";

export interface Capabilities {
  /** AI Agents (service-agents) for this environment, org and API key. */
  aiAgents: Availability;
  /** The custom system prompt editor (FEATURE_ENABLE_AGENTS_V2_CUSTOM_SYSTEM_PROMPT). */
  customSystemPrompt: Availability;
  /** GPT live voice-to-voice for AI Agents (FEATURE_ENABLE_V2V). */
  v2v: Availability;
  detail: string[];
}

const ABSENT_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]);

/** Errors that mean "this cluster or key has no AI Agents", not "it broke". */
export function isAgentsV2Absent(error: any): boolean {
  if (typeof error?.status === "number")
    return [401, 403, 404].includes(error.status);
  return ABSENT_CODES.has(error?.code);
}

/**
 * What this environment supports, from two cheap reads. service-agents answers
 * a non-whitelisted org with a bare 403 `{"detail":"forbidden"}` before any
 * permission check (other 403s carry "access denied: …"), a cluster without
 * the service answers 404 or does not connect, and a feature-gated route
 * answers 404 "like an unregistered path" while its flag is off. With the flag
 * on, a malformed agent id reaches the ownership lookup and gets a 400. The
 * voice-prompt routes are gated by FEATURE_ENABLE_V2V, which every service
 * resolves the same way at cluster level.
 */
export async function probeCapabilities(
  api: CognigyApiClient,
  v1: string,
): Promise<Capabilities> {
  const caps: Capabilities = {
    aiAgents: "unknown",
    customSystemPrompt: "unknown",
    v2v: "unknown",
    detail: [],
  };
  if (!v1) {
    caps.aiAgents = "unavailable";
    caps.customSystemPrompt = "unavailable";
    caps.v2v = "unavailable";
    caps.detail.push("No API base URL configured.");
    return caps;
  }
  try {
    await api.get(`${v1}/v1/agents`, { params: { limit: 1 } });
    caps.aiAgents = "available";
  } catch (error: any) {
    if (error?.status === 403 && error?.message === "forbidden") {
      caps.aiAgents = "unavailable";
      caps.detail.push("AI Agents are not enabled for this organisation.");
    } else if (error?.status === 404 || ABSENT_CODES.has(error?.code)) {
      caps.aiAgents = "unavailable";
      caps.detail.push("This environment does not run AI Agents.");
    } else {
      caps.detail.push(
        `AI Agents could not be checked (${error?.status ?? error?.code ?? error?.message}).`,
      );
    }
  }
  if (caps.aiAgents !== "available") {
    caps.customSystemPrompt = caps.aiAgents;
    caps.v2v = caps.aiAgents;
    return caps;
  }
  [caps.customSystemPrompt, caps.v2v] = await Promise.all(
    [
      ["system-prompt", "The custom system prompt"],
      ["voice-prompt", "GPT live (V2V)"],
    ].map(async ([route, what]): Promise<Availability> => {
      try {
        await api.get(`${v1}/v1/agents/capability-probe/${route}`);
        return "available";
      } catch (error: any) {
        if (error?.status === 400) return "available";
        if (error?.status === 404) return "unavailable";
        caps.detail.push(
          `${what} could not be checked (${error?.status ?? error?.message}).`,
        );
        return "unknown";
      }
    }),
  );
  return caps;
}

export type AgentsV2ListResult =
  | { available: true; items: any[]; total: number }
  | { available: false; warning?: string };

/**
 * The project's AI Agents. Never throws: they are absent on many clusters,
 * and list_resources must still return the legacy agents.
 */
export async function listAgentsV2(
  api: CognigyApiClient,
  v1: string,
  projectId: string,
  paging: { limit: number; skip: number; sort?: "asc" | "desc" },
): Promise<AgentsV2ListResult> {
  if (!v1) return { available: false };
  try {
    const res: any = await api.get(`${v1}/v1/agents`, {
      params: { projectId, ...paging },
    });
    const items = Array.isArray(res?.items) ? res.items : [];
    const total = typeof res?.total === "number" ? res.total : items.length;
    return { available: true, items, total };
  } catch (error: any) {
    if (isAgentsV2Absent(error)) return { available: false };
    return {
      available: false,
      warning: `AI Agents could not be listed (${error?.status ?? error?.code ?? error?.message}); the list may be incomplete.`,
    };
  }
}

export async function resolveLocaleReferenceId(
  api: CognigyApiClient,
  projectId: string,
): Promise<string> {
  const resp: any = await api.get("/v2.0/locales", {
    params: { projectId, limit: 100 },
  });
  const items: any[] = (resp?.items ?? resp ?? []).filter(
    (l: any) =>
      typeof l?.referenceId === "string" &&
      (!l.projectReference || String(l.projectReference) === projectId),
  );
  const locale = items.find((l) => l.primary || l.isDefault) ?? items[0];
  if (!locale) throw new Error(`Project ${projectId} has no locale`);
  return locale.referenceId;
}

/** Builtin tools whose extra parameters become the arguments a Flow receives. */
const FLOW_ARGUMENT_TOOLS = new Set(["execute-tool-flow"]);

/**
 * A builtin tool instance's parameters: the live descriptor's list with the
 * caller's values laid over it. service-agents validates every instance
 * against the descriptor, so keys, names and types always come from it. An
 * override is a plain value (sets `value`) or `{ mode, value }`. Only
 * execute-tool-flow takes keys the descriptor lacks: the call's arguments,
 * `{ mode (default aiFilled), description, type (default string), value }`.
 */
export function builtinToolParameters(
  descriptor: any,
  overrides: Record<string, any> = {},
): any[] {
  const base: any[] = descriptor?.parameters ?? descriptor?.defaultParameters;
  if (!Array.isArray(base) || base.length === 0) {
    throw new Error(
      `Builtin tool "${descriptor?.slug ?? "?"}" has no parameter descriptor on this cluster`,
    );
  }
  const unknown = Object.keys(overrides).filter(
    (k) => !base.some((p) => p.key === k),
  );
  const slug = descriptor?.slug ?? descriptor?.type;
  if (unknown.length && !FLOW_ARGUMENT_TOOLS.has(slug)) {
    throw new Error(
      `Unknown parameter(s) ${unknown.join(", ")}; this builtin tool takes ${base.map((p) => p.key).join(", ")}.`,
    );
  }
  const known = base.map((p) => {
    const raw = overrides[p.key];
    const o =
      raw && typeof raw === "object" && !Array.isArray(raw) && "mode" in raw
        ? raw
        : raw === undefined
          ? {}
          : { value: raw };
    // A plain value is a design-time value, so it makes the parameter dynamic
    // (unless its mode is locked); aiFilled would drop it.
    const mode =
      o.mode ?? (raw !== undefined && !p.modeLocked ? "dynamic" : p.mode);
    return {
      key: p.key,
      name: p.name,
      description: p.description ?? "",
      mode,
      type: p.type,
      // An aiFilled parameter takes no design-time value.
      value: /ai_?filled/i.test(mode) ? null : (o.value ?? p.value ?? null),
      ...(p.connectionTypes ? { connectionTypes: p.connectionTypes } : {}),
    };
  });
  const extra = unknown.map((key) => {
    const raw = overrides[key];
    const o =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? raw
        : { mode: "dynamic", value: raw };
    const mode = o.mode ?? "aiFilled";
    return {
      key,
      name: key,
      description: o.description ?? "",
      mode,
      type: o.type ?? "string",
      value: /ai_?filled/i.test(mode) ? null : (o.value ?? null),
    };
  });
  return [...known, ...extra];
}

/** Find the REST endpoint that targets this AI Agent, or create one. */
export async function findOrCreateAgentEndpoint(
  api: CognigyApiClient,
  projectId: string,
  agent: { referenceId: string; name?: string },
): Promise<{ endpoint: any; autoCreated: boolean }> {
  const pageSize = 100;
  for (let skip = 0; ; skip += pageSize) {
    const eps: any = await api.get("/v2.0/endpoints", {
      params: { projectId, limit: pageSize, skip },
    });
    const items: any[] = eps?.items ?? eps;
    if (!Array.isArray(items) || items.length === 0) break;
    const hit = items.find(
      (ep) => ep.channel === "rest" && ep.agentId === agent.referenceId,
    );
    if (hit) return { endpoint: hit, autoCreated: false };
    if (items.length < pageSize) break;
  }
  const endpoint = await api.post("/v2.0/endpoints", {
    projectId,
    channel: "rest",
    targetType: "agent",
    agentId: agent.referenceId,
    name: `${agent.name ?? "Agent"} REST Endpoint`,
  });
  return { endpoint, autoCreated: true };
}

/**
 * One AI Agent, or null when it cannot be read for any reason (absent service,
 * legacy agent id, other project). Callers fall back to the legacy kind.
 */
export async function readAgentV2(
  api: CognigyApiClient,
  v1: string,
  id: string,
  projectId: string,
): Promise<any | null> {
  if (!v1) return null;
  try {
    return await api.get(`${v1}/v1/agents/${id}`, { params: { projectId } });
  } catch {
    return null;
  }
}

/** service-agents paths per component kind (manage_agent_components). */
export const COMPONENT_PATHS: Record<string, string> = {
  skill: "skills",
  tool: "tools",
  mcp_server: "mcp-servers",
  persona: "agentpersonas",
};

/** The agent array a component is attached through. */
export const ATTACH_FIELDS: Record<string, string> = {
  skill: "skillReferenceIds",
  tool: "toolReferenceIds",
};

export const LEGACY_AGENT_NOTE =
  "If this is a legacy AI Agent (legacy: true in list_resources { resourceType: 'agent', projectId }), pass it as aiAgentId instead of agentId.";

export const NEW_AGENT_NOTE =
  "If this is an AI Agent without legacy: true in list_resources { resourceType: 'agent', projectId }, the legacy tools cannot edit it — change it with manage_agent and manage_agent_components, test it with talk_to_agent { agentId, projectId } and audit its voice with audit_voice_agent { agentId, projectId }.";

/**
 * Agent ids look the same for both kinds, so a 404 on an agent record often
 * means "right id, wrong kind". Only the agent record itself qualifies; a 404
 * on any other resource keeps its message.
 */
export function annotateAgentKindMismatch(error: any): void {
  if (error?.status !== 404 || typeof error?.url !== "string") return;
  const path = error.url.split("?")[0];
  if (/\/v2\.0\/aiagents\/[^/]+$/.test(path))
    error.message = `${error.message} — ${NEW_AGENT_NOTE}`;
  else if (/\/v1\/agents\/[^/]+$/.test(path))
    error.message = `${error.message} — ${LEGACY_AGENT_NOTE}`;
}
