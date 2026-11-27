import { summarizeSnapshot } from "./snapshotManagement.js";

export interface ResponseHints {
  hint?: string;
  warning?: string;
  likely_cause?: string;
  action?: string;
}

export function withHints<T extends object>(
  data: T,
  hints: ResponseHints,
): T & { _hints: ResponseHints } {
  return {
    ...data,
    _hints: hints,
  };
}

const rid = (r: any): string => r._id || r.id;

/** Ownership and audit ids the Simulator returns; no follow-up call takes them. */
const SIMULATOR_INTERNAL_FIELDS = [
  "projectReference",
  "organisationReference",
  "createdBy",
  "lastChangedBy",
];

/** An AI Agent target, named as the tool takes it; users never hear "V2". */
function renameAgentTarget(record: any): any {
  if (record.aiAgentV2ReferenceId !== undefined) {
    record.agentReferenceId = record.aiAgentV2ReferenceId;
    delete record.aiAgentV2ReferenceId;
  }
  return record;
}

/**
 * A Simulator document with its `_id` renamed to the reference the next call
 * takes. `_id` is dropped only when there is one to rename, so nothing is lost.
 */
function simulatorRecord(r: any, referenceKey: string, drop: string[]): any {
  const out: any = { ...r };
  for (const key of [...SIMULATOR_INTERNAL_FIELDS, ...drop]) delete out[key];
  renameAgentTarget(out);
  if (out.simulationFrozen && typeof out.simulationFrozen === "object") {
    out.simulationFrozen = renameAgentTarget({ ...out.simulationFrozen });
  }
  if (r._id === undefined) return out;
  delete out._id;
  return { [referenceKey]: r._id, ...out };
}

export const RESOURCE_FILTERS: Record<string, (raw: any) => any> = {
  // `projectId` comes from the API as `projectReference`. It is exposed here
  // because snapshots are project-scoped: a caller holding only an agent id
  // has no other way through this surface to find the project to back up.
  agent: (r) => ({
    id: rid(r),
    referenceId: r.referenceId,
    name: r.name,
    description: r.description,
    projectId: r.projectReference ?? r.projectId,
    createdAt: r.createdAt,
  }),
  // AI Agent (service-agents) list item. The full config is in get_resource.
  agent_v2: (r) => ({
    id: rid(r),
    referenceId: r.referenceId,
    name: r.name,
    role: r.role,
    description: r.description,
    agentType: r.agentType,
    projectId: r.projectId,
    createdAt: r.createdAt,
  }),
  flow: (r) => ({
    id: rid(r),
    referenceId: r.referenceId,
    name: r.name,
    createdAt: r.createdAt,
  }),
  endpoint: (r) => {
    const base: any = {
      id: rid(r),
      name: r.name,
      channel: r.channel,
      flowId: r.flowId,
      URLToken: r.URLToken,
      createdAt: r.createdAt,
    };
    if (r.channel === "webchat3" && r.settings) {
      base.webchatConfigured = true;
      const s = r.settings;
      // GET returns nested, POST/PATCH may return either format
      base.webchatSummary = {
        ...(s.colors?.primaryColor
          ? { primaryColor: s.colors.primaryColor }
          : s.colorScheme
            ? { primaryColor: s.colorScheme }
            : {}),
        ...(s.layout?.chatWindowWidth
          ? { chatWindowWidth: s.layout.chatWindowWidth }
          : {}),
        ...(s.homeScreen?.enabled ? { homeScreen: true } : {}),
        ...(s.layout?.enablePersistentMenu || s.enablePersistentMenu
          ? { persistentMenu: true }
          : {}),
        ...(s.businessHours?.enabled ? { businessHours: true } : {}),
      };
    }
    return base;
  },
  llm_model: (r) => ({
    id: rid(r),
    referenceId: r.referenceId,
    name: r.name,
    provider: r.provider,
    modelType: r.modelType,
    modelGroup: r.modelGroup,
    connectionId: r.connectionId,
    isInPlatformLlm: r.isInPlatformLlm,
    isDefault: r.isDefault,
    apiType: r.apiType,
    openAICompatible: r.openAICompatible,
    awsBedrock: r.awsBedrock,
  }),
  knowledge_store: (r) => ({
    id: rid(r),
    referenceId: r.referenceId,
    name: r.name,
    description: r.description,
    sourceCount: r.sourceCount,
  }),
  conversation: (r) => ({
    sessionId: r.sessionId,
    channel: r.channel,
    startedAt: r.startedAt,
    messageCount: r.messageCount,
  }),
  // `lastChanged` instead of `createdAt`: for "which project am I working in"
  // recency beats creation date, and it costs 2 extra chars. Projects have no
  // `description` field at all. `lastChangedBy` is deliberately omitted — it is
  // an opaque 24-hex user id; resolve it with get_resource { resourceType:
  // 'user', id: 'me' } and read it from the single-project raw response.
  project: (r) => ({
    id: rid(r),
    name: r.name,
    lastChanged: r.lastChanged,
  }),
  // Drops `projects` (a long array of opaque project ids) and `organisation`.
  // `id` is what project/agent `createdBy` + `lastChangedBy` reference.
  user: (r) => ({
    id: rid(r),
    name: r.name,
    roles: r.roles,
  }),
  extension: (r) => ({
    id: rid(r),
    name: r.name,
    version: r.version,
  }),
  function: (r) => ({
    id: rid(r),
    name: r.name,
    description: r.description,
  }),
  tool: (r) => ({
    toolId: r.toolId ?? rid(r),
    name: r.name ?? r.label,
    toolType: r.toolType ?? r.type,
  }),
  // Delegated, not re-implemented: `isPluginBackup` is the deletion gate, and a
  // second copy of that computation is the kind of thing that drifts. list
  // renders through this filter while create/restore/delete return
  // summarizeSnapshot directly — both must agree, always.
  //
  // (summarizeSnapshot drops `hash` and `packageExpiresAt` for the same reason
  // this filter did: both only matter for downloading, which this plugin
  // deliberately does not do.)
  snapshot: summarizeSnapshot,
  // Audit events are verbose and mostly opaque ids. `performedBy` is the point
  // of this view — it is absent on human-performed events (the platform only
  // stores it for non-human actors), so a missing key means "a person did
  // this", and `mcp-plugin` means this plugin did.
  audit_event: (r) => {
    // The live API returns the modification chain as `chain`, even though the
    // REST docs name the field `modifiedResources` — accept either. `chain`
    // only wins when it actually carries entries, so an empty `chain: []`
    // alongside a populated `modifiedResources` cannot drop the chain.
    const chain =
      Array.isArray(r.chain) && r.chain.length ? r.chain : r.modifiedResources;
    return {
      id: rid(r),
      timestamp: r.timestamp,
      type: r.type,
      ...(r.actionType ? { actionType: r.actionType } : {}),
      user: r.user,
      ...(r.performedBy
        ? {
            performedBy: {
              actor: r.performedBy.actor,
              ...(r.performedBy.taskId ? { taskId: r.performedBy.taskId } : {}),
              ...(r.performedBy.sessionId
                ? { sessionId: r.performedBy.sessionId }
                : {}),
            },
          }
        : {}),
      ...(Array.isArray(chain) && chain.length
        ? {
            modifiedResources: chain.map((m: any) => ({
              elementId: m.elementId,
              elementType: m.elementType,
            })),
          }
        : {}),
    };
  },
  // Simulator (manage_simulations). The UUID `referenceId` is dropped: a
  // simulation is addressed by its `_id` only, and showing both invites the
  // wrong one. flowId stays because the persona operations take it.
  simulation: (r) =>
    simulatorRecord(r, "simulationReference", [
      "referenceId",
      "resourceIds",
      "jobNodeId",
      "aiAgentId",
    ]),
  simulation_summary: (r) => ({
    simulationReference: rid(r),
    name: r.name,
    personaName: r.personaName,
    mission: r.mission,
    flowReferenceId: r.flowReferenceId,
    agentReferenceId: r.aiAgentV2ReferenceId,
    lastChanged: r.lastChanged,
  }),
  // simulationReference is kept: a project-wide batch list is the only place a
  // batch's scenario can be read from, and get_batch needs it.
  simulation_batch: (r) => simulatorRecord(r, "batchReference", []),
  simulation_run: (r) => simulatorRecord(r, "runReference", []),
  // Project log entry. meta.text is the user's message or the agent's output,
  // so it stays out of this view; get_resource returns the rest of meta.
  // `type` moves into `metadata` on the v2 log model.
  log: (r) => ({
    id: rid(r),
    timestamp: r.timestamp,
    level: r.type ?? r.metadata?.type,
    // ponytail: a fixed cap; a Code Node can api.log() any size of string.
    message:
      typeof r.msg === "string" && r.msg.length > 1000
        ? `${r.msg.slice(0, 1000)}…`
        : r.msg,
    traceId: r.traceId,
    flowName: r.meta?.flowName,
    nodeLabel: r.meta?.nodeLabel,
    error: r.meta?.error,
  }),
};

/**
 * Shape a single flow-chart node (from GET /chart/nodes/{id}) for the LLM.
 * Keeps the editable config but drops server-computed noise: `transpiled` is
 * the code node's compiled JS output (can be ~200k chars) and is read-only.
 * `hasError` is kept so callers can tell a code node failed to transpile.
 */
export function filterFlowNodeDetail(raw: any): any {
  const config = { ...(raw?.config ?? {}) };
  delete config.transpiled;
  if (config.mock && typeof config.mock === "object") {
    config.mock = { ...config.mock };
    delete config.mock.transpiled;
  }
  return {
    id: rid(raw),
    type: raw.type,
    label: raw.label,
    parentId: raw.parentId ?? null,
    isEntryPoint: raw.isEntryPoint ?? false,
    ...(raw.isDisabled ? { isDisabled: true } : {}),
    ...(raw.comment ? { comment: raw.comment } : {}),
    config,
  };
}

export function filterResponse(resourceType: string, raw: any): any {
  const filter = RESOURCE_FILTERS[resourceType];
  return filter ? filter(raw) : raw;
}

export function filterList(resourceType: string, items: any[]): any[] {
  const filter = RESOURCE_FILTERS[resourceType];
  if (!filter) return items;
  return items.map(filter);
}
