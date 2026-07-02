export interface ResponseHints {
  hint?: string;
  warning?: string;
  likely_cause?: string;
  action?: string;
}

export function withHints<T extends Record<string, unknown>>(
  data: T,
  hints: ResponseHints,
): T & { _hints: ResponseHints } {
  return {
    ...data,
    _hints: hints,
  };
}

const rid = (r: any): string => r._id || r.id;

export const RESOURCE_FILTERS: Record<string, (raw: any) => any> = {
  agent: (r) => ({
    id: rid(r),
    referenceId: r.referenceId,
    name: r.name,
    description: r.description,
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
    connectionId: r.connectionId,
    isDefault: r.isDefault,
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
  project: (r) => ({
    id: rid(r),
    name: r.name,
    description: r.description,
    createdAt: r.createdAt,
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
    id: raw._id || raw.id,
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
