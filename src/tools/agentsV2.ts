/**
 * Agents V2 (service-agents) preview. Lives on this branch only; see the
 * "Agents V2 preview" section of the README for how to run it.
 *
 * service-agents is reached on the API host root (`https://api-<host>/v1/...`),
 * not under `/new` like service-api. Traefik's auth-gateway forward-auth turns
 * the plugin's `X-API-Key` into the internal JWT service-agents expects, so the
 * same key works for both as long as the cluster runs the auth gateway.
 */
import { CognigyApiClient } from "../api/client.js";

export const HTTP_REQUEST_SLUG = "http-request";

export function agentsV2BaseUrl(apiBaseUrl: string): string {
  return new URL(apiBaseUrl).origin;
}

export type AgentsV2ListResult =
  | { available: true; items: any[]; total: number }
  | { available: false; warning?: string };

const ABSENT_STATUSES = new Set([401, 403, 404]);
const ABSENT_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]);

/** Errors that mean "this cluster or key has no Agents V2", not "it broke". */
export function isAgentsV2Absent(error: any): boolean {
  if (typeof error?.status === "number")
    return ABSENT_STATUSES.has(error.status);
  return ABSENT_CODES.has(error?.code);
}

/**
 * The project's Agents V2 agents. Never throws: Agents V2 is absent on most
 * clusters, and list_resources must still return the V1 agents.
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
      warning: `Agents V2 agents could not be checked (${error?.status ?? error?.code ?? error?.message}); the list may be incomplete.`,
    };
  }
}

export interface HttpToolSpec {
  name: string;
  description: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
}

export interface CreateAgentV2Input {
  projectId: string;
  name: string;
  description?: string;
  instructions?: string;
  httpTool?: HttpToolSpec;
  createEndpoint?: boolean;
  /** LLM to bind; omitted = the project's default LLM. */
  largeLanguageModelReferenceId?: string;
}

async function resolveLocaleReferenceId(
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

/**
 * Create a builtin `http-request` tool. The parameter list is taken from the
 * live descriptor and only method/url/headers are overridden, because
 * service-agents validates every instance against the descriptor.
 */
export async function createHttpTool(
  api: CognigyApiClient,
  v1: string,
  projectId: string,
  spec: HttpToolSpec,
): Promise<any> {
  const descriptor: any = await api.get(
    `${v1}/v1/builtin-tools/${HTTP_REQUEST_SLUG}`,
  );
  const base: any[] = descriptor?.parameters ?? descriptor?.defaultParameters;
  if (!Array.isArray(base) || base.length === 0) {
    throw new Error(
      `Builtin tool "${HTTP_REQUEST_SLUG}" not available on this cluster`,
    );
  }
  const method = (spec.method ?? "GET").toUpperCase();
  const overrides: Record<string, { mode?: string; value?: unknown }> = {
    method: { mode: "dynamic", value: method },
    url: { mode: "dynamic", value: spec.url },
    headers: { mode: "dynamic", value: spec.headers ?? {} },
    payload: ["POST", "PUT", "PATCH"].includes(method)
      ? { mode: "aiFilled" }
      : {},
  };
  const parameters = base.map((p) => {
    const o = overrides[p.key] ?? {};
    return {
      key: p.key,
      name: p.name,
      description: p.description ?? "",
      mode: o.mode ?? p.mode,
      type: p.type,
      value: o.value ?? p.value ?? null,
      ...(p.connectionTypes ? { connectionTypes: p.connectionTypes } : {}),
    };
  });
  return api.post(`${v1}/v1/tools`, {
    projectId,
    source: "builtin",
    builtinSlug: HTTP_REQUEST_SLUG,
    type: HTTP_REQUEST_SLUG,
    name: spec.name,
    description: spec.description,
    parameters,
  });
}

/** Find the REST endpoint that targets this V2 agent, or create one. */
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

export async function createAgentV2(
  api: CognigyApiClient,
  v1: string,
  endpointBaseUrl: string,
  data: CreateAgentV2Input,
): Promise<any> {
  const localeReferenceId = await resolveLocaleReferenceId(api, data.projectId);
  // Compensating deletes, newest first, so a failure half-way does not leave
  // an orphaned tool or agent behind (a retry would otherwise create duplicates).
  const undo: { kind: string; url: string }[] = [];
  const rollback = async (cause: Error): Promise<never> => {
    const outcome: string[] = [];
    for (const u of undo.reverse()) {
      try {
        await api.delete(u.url);
        outcome.push(`${u.kind} deleted`);
      } catch (e: any) {
        outcome.push(`${u.kind} NOT deleted (${e.message})`);
      }
    }
    throw new Error(
      `create_agent_v2 failed: ${cause.message}` +
        (outcome.length ? ` — rolled back: ${outcome.join(", ")}` : ""),
    );
  };
  let tool: any = null;
  let agent: any;
  let endpoint: any = null;
  try {
    if (data.httpTool) {
      tool = await createHttpTool(api, v1, data.projectId, data.httpTool);
      undo.push({
        kind: "tool",
        url: `${v1}/v1/tools/${tool.id}?projectId=${data.projectId}`,
      });
    }
    agent = await api.post(`${v1}/v1/agents`, {
      projectId: data.projectId,
      localeReferenceId,
      name: data.name,
      description: data.description ?? "",
      instructions: data.instructions ?? data.description ?? "",
      agentType: "text",
      toolReferenceIds: tool ? [tool.referenceId] : [],
      ...(data.largeLanguageModelReferenceId
        ? { largeLanguageModelReferenceId: data.largeLanguageModelReferenceId }
        : {}),
    });
    undo.push({
      kind: "agent",
      url: `${v1}/v1/agents/${agent.id}?projectId=${data.projectId}`,
    });
    if (data.createEndpoint !== false) {
      endpoint = (await findOrCreateAgentEndpoint(api, data.projectId, agent))
        .endpoint;
    }
  } catch (e: any) {
    await rollback(e);
  }
  return {
    projectId: data.projectId,
    agent: {
      id: agent.id,
      referenceId: agent.referenceId,
      name: agent.name ?? data.name,
    },
    tool: tool
      ? { id: tool.id, referenceId: tool.referenceId, name: tool.name }
      : null,
    endpoint: endpoint
      ? { id: endpoint._id ?? endpoint.id, URLToken: endpoint.URLToken }
      : null,
    endpointUrl: endpoint?.URLToken
      ? `${endpointBaseUrl}/${endpoint.URLToken}`
      : null,
    next: endpoint
      ? `talk_to_agent { agentV2Id: "${agent.id}", projectId: "${data.projectId}", message }`
      : "Set createEndpoint: true (or create a REST endpoint targeting this agent) before talk_to_agent.",
  };
}

/** talk_to_agent { agentV2Id } — the endpoint for a V2 agent. */
export async function resolveAgentV2Endpoint(
  api: CognigyApiClient,
  v1: string,
  agentV2Id: string,
  projectId: string,
): Promise<{ endpoint: any; autoCreated: boolean }> {
  const agent: any = await api.get(`${v1}/v1/agents/${agentV2Id}`, {
    params: { projectId },
  });
  return findOrCreateAgentEndpoint(api, projectId, agent);
}

/**
 * One Agents V2 agent, or null when it cannot be read for any reason (absent
 * service, wrong kind, other project). Callers fall back to V1.
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

export const V2_AGENT_NOTE =
  "If this is an Agents V2 agent (kind: \"v2\" in list_resources { resourceType: 'agent', projectId }), V1 tools cannot edit it — read it with get_resource { resourceType: 'agent', id, projectId }, test it with talk_to_agent { agentV2Id, projectId }, and configure it in the Agents V2 editor.";

export const V1_AGENT_NOTE =
  "If this is a V1 AI Agent (kind: \"v1\" in list_resources { resourceType: 'agent', projectId }), pass it as aiAgentId instead of agentV2Id.";

/**
 * Agent ids look the same for both kinds, so a 404 on an agent record often
 * means "right id, wrong kind". Only the agent record itself qualifies; a 404
 * on any other resource keeps its message.
 */
export function annotateAgentKindMismatch(error: any): void {
  if (error?.status !== 404 || typeof error?.url !== "string") return;
  const path = error.url.split("?")[0];
  if (/\/v2\.0\/aiagents\/[^/]+$/.test(path))
    error.message = `${error.message} — ${V2_AGENT_NOTE}`;
  else if (/\/v1\/agents\/[^/]+$/.test(path))
    error.message = `${error.message} — ${V1_AGENT_NOTE}`;
}
