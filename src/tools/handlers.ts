import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { spawn } from "child_process";
import { pipeline } from "stream/promises";
import { basename, dirname, isAbsolute, join } from "path";
import { randomUUID } from "crypto";
import { pathToFileURL } from "url";
import axios from "axios";
import { CognigyApiClient } from "../api/client.js";
import {
  toProductionEndpointUrl,
  toTestModeEndpointUrl,
} from "../utils/endpointUrl.js";
import { logger } from "../utils/logger.js";
import {
  filterResponse,
  filterList,
  filterFlowNodeDetail,
  withHints,
} from "./filters.js";
import { buildWebchatSettings, deepMerge } from "./webchatSettings.js";
import { normalizeToolParameters } from "./toolParameters.js";
import { getNodeEntry, supportedNodeTypes } from "./nodeRegistry.js";
import {
  evaluateChecks,
  summarize,
  nodeId as voiceNodeId,
  type VoiceCheck,
  type VoiceFix,
} from "./voiceChecklist.js";
import { z } from "zod";
import * as schemas from "../schemas/tools.js";
import {
  chartToAscii,
  chartToMermaid,
  chartToHtml,
  chartLegend,
} from "../render/flowRender.js";

// The self-contained mermaid UMD build, inlined into rich flow-viz HTML so it
// renders offline. Copied to dist/assets at build time (scripts/copy-assets.mjs);
// falls back to node_modules in dev. Read once, then cached (null = not found →
// the HTML uses a CDN loader instead).
let mermaidJsCache: string | null | undefined;
function loadMermaidJs(): string | undefined {
  if (mermaidJsCache !== undefined) return mermaidJsCache ?? undefined;
  const candidates = [
    new URL("../assets/mermaid.min.js", import.meta.url), // published: dist/assets
    new URL("../../node_modules/mermaid/dist/mermaid.min.js", import.meta.url), // dev
  ];
  for (const url of candidates) {
    try {
      if (existsSync(url)) {
        mermaidJsCache = readFileSync(url, "utf8");
        return mermaidJsCache;
      }
    } catch {
      // try next candidate
    }
  }
  mermaidJsCache = null;
  return undefined;
}

// Attach a minimal, one-time render suggestion to a flow-mutation result so the
// model briefly offers to visualize the change — without rendering unprompted
// or nagging. Merged into _hints so it never clobbers an existing warning.
function withRenderSuggestion<T extends object>(
  result: T,
  flowId: string,
  focusNodeId?: string,
): T {
  const call = `manage_flow_nodes { operation: "render", flowId: "${flowId}"${
    focusNodeId ? `, focus: "${focusNodeId}"` : ""
  } }`;
  const existing = (result as any)._hints ?? {};
  (result as any)._hints = {
    ...existing,
    renderSuggestion: `Flow changed. Offer once, in one short line (do not render unprompted, do not repeat the offer): ask if the user wants to see the updated flow — if yes, call ${call}.`,
  };
  return result;
}
import {
  buildPackageExportablePreview,
  buildPackageExportPlan,
  buildPackageImportPreview,
  normalizeTask,
} from "./packageManagement.js";
import {
  AUTO_BACKUP_NAME_PREFIX,
  buildAutoBackupFields,
  buildRestorePreflight,
  evaluateSnapshotLimit,
  isAutoBackup,
  nextBackupVersion,
  RESTORE_WARNINGS,
  SNAPSHOT_EXCLUSIONS,
  SNAPSHOT_IN_USE_FAIL_REASON,
  SNAPSHOT_LIMIT_FAIL_REASON,
  summarizeSnapshot,
  type SnapshotSummary,
} from "./snapshotManagement.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_AGENT_IMAGE = "default-avatar:1";

// Prefix applied to agents/flows/projects instead of deleting them.
const DELETE_PREFIX = "DELETE_";

// Cognigy resource names are capped at 200 chars (see schemas/tools.ts).
const MAX_RESOURCE_NAME_LENGTH = 200;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function retryGetEntryNode(
  apiClient: CognigyApiClient,
  flowId: string,
  maxRetries = 3,
  delayMs = 500,
): Promise<any> {
  for (let i = 0; i < maxRetries; i++) {
    const nodes: any = await apiClient.get(
      `/v2.0/flows/${flowId}/chart/nodes`,
      {
        params: { limit: 10 },
      },
    );
    const items = nodes.items ?? nodes;
    const entry =
      (Array.isArray(items) ? items : []).find((n: any) => n.isEntryPoint) ??
      (Array.isArray(items) ? items[0] : undefined);
    if (entry) return entry;
    if (i < maxRetries - 1)
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
  }
  throw new Error("Could not find entry node in flow");
}

/**
 * Transform user-friendly config into the exact format the Cognigy API descriptor
 * validator expects. Config keys must match descriptor field keys exactly — extra
 * or unknown keys cause "Node config validation failed".
 *
 * Descriptor field schemas (from shared/charts/descriptors/):
 *   say:          { say: { text: string[], type: "text", data: "", linear: false, loop: false, _cognigy: {} } }
 *   question:     { say: { text: string[], ... }, type: "text"|"yesNo"|"email"|... }
 *   if:           { condition: { type: "rule", rule: { left, operand, right } } }
 *   switch:       { switch: { type: "intent"|"state"|"cognigyScript", operator: string } }
 *   addToContext:  { key: string, value: string, mode?: "simple"|"array" }
 *   sleep:        { milliseconds: number }
 *   code:         { code: string }
 *   httpRequest:  { url, type, headers, ... }   — keys match descriptor directly
 *   goTo:         { flowNode: { flow, node }, ... }
 */
const SAY_DEFAULTS = {
  data: "",
  linear: false,
  loop: false,
  type: "text",
  _cognigy: {},
};

function buildSayObject(text: any): Record<string, any> {
  const textArr = Array.isArray(text)
    ? text
    : text != null
      ? [String(text)]
      : [];
  return { ...SAY_DEFAULTS, text: textArr };
}

function buildRichSayObject(
  text: any,
  outputType: string,
  richData: any,
): Record<string, any> {
  const typeKeyMap: Record<string, string> = {
    quickReplies: "_quickReplies",
    buttons: "_buttons",
    gallery: "_gallery",
    list: "_list",
    image: "_image",
    video: "_video",
    audio: "_audio",
    adaptiveCard: "_adaptiveCard",
  };
  const dataKey = typeKeyMap[outputType];
  if (!dataKey) return buildSayObject(text);

  const textArr = Array.isArray(text)
    ? text
    : text != null
      ? [String(text)]
      : [];
  const textStr = textArr.length > 0 ? textArr[0] : "";

  let richPayload: any;
  if (outputType === "quickReplies") {
    const qrs = (Array.isArray(richData) ? richData : []).map(
      (qr: any, i: number) => ({
        id: qr.id ?? i + 1,
        title: qr.title ?? "",
        payload: qr.payload ?? "",
        contentType: qr.contentType ?? "postback",
        imageUrl: qr.imageUrl ?? "",
        imageAltText: qr.imageAltText ?? "",
        condition: qr.condition ?? "",
      }),
    );
    richPayload = { type: "quick_replies", text: textStr, quickReplies: qrs };
  } else if (outputType === "buttons") {
    const btns = (Array.isArray(richData) ? richData : []).map(
      (btn: any, i: number) => ({
        id: btn.id ?? i + 1,
        type: btn.type ?? "postback",
        title: btn.title ?? "",
        payload: btn.payload ?? "",
        url: btn.url ?? "",
        ...(btn.condition ? { condition: btn.condition } : {}),
      }),
    );
    richPayload = { type: "buttons", text: textStr, buttons: btns };
  } else {
    richPayload =
      typeof richData === "object"
        ? { ...richData, text: textStr }
        : { text: textStr };
  }

  const channelData = { [dataKey]: richPayload };
  return {
    ...SAY_DEFAULTS,
    type: outputType,
    text: textArr,
    _cognigy: { _default: channelData },
    _data: { _cognigy: { _default: channelData } },
  };
}

function transformConfigForApi(
  nodeType: string,
  config: Record<string, any>,
): Record<string, any> {
  if (!config || Object.keys(config).length === 0) return config;

  switch (nodeType) {
    case "say": {
      if (config.say && typeof config.say === "object") return config;
      const {
        text,
        quickReplies,
        buttons,
        gallery,
        list,
        image,
        video,
        audio,
        adaptiveCard,
        ...rest
      } = config;
      const richTypeMap: [string, any][] = [
        ["quickReplies", quickReplies],
        ["buttons", buttons],
        ["gallery", gallery],
        ["list", list],
        ["image", image],
        ["video", video],
        ["audio", audio],
        ["adaptiveCard", adaptiveCard],
      ];
      const activeRich = richTypeMap.find(([, val]) => val !== undefined);
      if (activeRich) {
        return {
          say: buildRichSayObject(text, activeRich[0], activeRich[1]),
          ...rest,
        };
      }
      return { say: buildSayObject(text), ...rest };
    }

    case "question": {
      if (config.say && typeof config.say === "object") return config;
      const { text, quickReplies, buttons, ...rest } = config;
      const out: Record<string, any> = { ...rest };
      if (text !== undefined) {
        if (quickReplies) {
          out.say = buildRichSayObject(text, "quickReplies", quickReplies);
        } else if (buttons) {
          out.say = buildRichSayObject(text, "buttons", buttons);
        } else {
          out.say = buildSayObject(text);
        }
      }
      return out;
    }

    case "if": {
      const cond = config.condition;
      if (typeof cond === "string") {
        return {
          condition: {
            condition: cond,
            type: "condition",
            rule: { left: "1", operand: "eq", right: "1" },
          },
        };
      }
      if (typeof cond === "object" && cond !== null) {
        if (!cond.type) cond.type = "condition";
        if (!cond.rule) {
          cond.rule = { left: "1", operand: "eq", right: "1" };
        }
        return { condition: cond };
      }
      return config;
    }

    case "switch": {
      if (config.switch && typeof config.switch === "object") return config;
      const lookupType = config.type ?? "intent";
      const operatorMap: Record<string, string> = {
        intent: "ci.intent",
        state: "ci.state",
        type: "ci.type",
        cognigyScript: config.condition ?? "",
      };
      return {
        switch: {
          type: lookupType,
          operator: operatorMap[lookupType] ?? lookupType,
        },
      };
    }

    case "sleep": {
      if (config.milliseconds !== undefined) return config;
      if (config.delay !== undefined) return { milliseconds: config.delay };
      return config;
    }

    case "addToContext": {
      if (config.key !== undefined) return config;
      if (
        Array.isArray(config.contextEntries) &&
        config.contextEntries.length > 0
      ) {
        return {
          key: config.contextEntries[0].key,
          value: config.contextEntries[0].value,
          mode: "simple",
        };
      }
      return config;
    }

    case "goTo": {
      if (config.flowNode) return config;
      const {
        flowId: targetFlowId,
        nodeId: targetNodeId,
        mode: goToMode,
        ...rest
      } = config;
      if (targetFlowId || targetNodeId) {
        const baseConfig = {
          flowNode: { flow: targetFlowId ?? "", node: targetNodeId ?? "" },
          ...rest,
        };
        if (goToMode !== undefined) {
          return { ...baseConfig, executionMode: goToMode };
        }
        return baseConfig;
      }
      return config;
    }

    case "httpRequest": {
      const out: Record<string, any> = { ...config };
      if (
        out.headers &&
        typeof out.headers === "object" &&
        !Array.isArray(out.headers)
      ) {
        out.headers = JSON.stringify(out.headers);
      }
      if (out.contextStore !== undefined) {
        out.storeLocation = "context";
        out.contextKey = out.contextStore;
        delete out.contextStore;
      }
      if (out.inputStore !== undefined) {
        if (!out.storeLocation) out.storeLocation = "input";
        out.inputKey = out.inputStore;
        delete out.inputStore;
      }
      return out;
    }

    case "case": {
      if (config.case && typeof config.case === "object") return config;
      const val = config.value;
      if (val !== undefined) {
        return { case: { value: val } };
      }
      return config;
    }

    default:
      return config;
  }
}

function identifyFailedStep(
  agentId: string | null,
  flowId: string | null,
  endpointId: string | null,
): string {
  if (!agentId) return "agent";
  if (!flowId) return "flow";
  if (!endpointId) return "endpoint";
  return "node";
}

const TOOL_TYPE_MAP: Record<string, { type: string; extension: string }> = {
  tool: { type: "aiAgentJobTool", extension: "@cognigy/basic-nodes" },
  knowledge: { type: "knowledgeTool", extension: "@cognigy/basic-nodes" },
  send_email: { type: "sendEmailTool", extension: "@cognigy/basic-nodes" },
  mcp: { type: "aiAgentJobMCPTool", extension: "@cognigy/basic-nodes" },
  http: { type: "aiAgentJobTool", extension: "@cognigy/basic-nodes" },
};

const RESOLVE_NODE_MAP: Record<string, { type: string; label: string } | null> =
  {
    tool: { type: "aiAgentToolAnswer", label: "Resolve Tool Action" },
    mcp: { type: "aiAgentJobCallMCPTool", label: "Call MCP Tool" },
    knowledge: null,
    send_email: null,
    http: null, // HTTP handles its own resolve node creation
  };

/**
 * Translate user-friendly HTTP fields (method, body, headers-as-object) into
 * the Cognigy httpRequest node descriptor field names (type, payloadType/
 * payloadJSON/payloadText, headers-as-JSON-string).
 */
function buildHttpNodeConfig(http: {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): Record<string, any> {
  const cfg: any = {};
  if (http.url) cfg.url = http.url;
  if (http.method) cfg.type = http.method;
  else if (http.url) cfg.type = "GET";
  if (http.headers) cfg.headers = JSON.stringify(http.headers);
  if (http.body) {
    try {
      cfg.payloadType = "json";
      cfg.payloadJSON = JSON.parse(http.body);
    } catch {
      cfg.payloadType = "text";
      cfg.payloadText = http.body;
    }
  }
  return cfg;
}

const AI_AGENT_TOOL_TYPES = new Set([
  "aiAgentJobDefault",
  "aiAgentJobTool",
  "aiAgentJobMCPTool",
  "knowledgeTool",
  "handoverToAiAgentTool",
  "handoverToHumanAgentTool",
  "sendEmailTool",
  "executeWorkflowTool",
]);

const MCP_MANAGED_TOOL_TYPES = new Set([
  "aiAgentJobTool",
  "aiAgentJobMCPTool",
  "knowledgeTool",
  "sendEmailTool",
]);

const PROVIDER_CONNECTION_TYPE: Record<string, string> = {
  openAI: "OpenAIProvider",
  azureOpenAI: "AzureOpenAIProviderV2",
  anthropic: "AnthropicProvider",
  google: "GoogleVertexAIProvider",
  mistral: "MistralProvider",
  openAICompatible: "OpenAICompatibleProvider",
};

/**
 * Resolve the flow ID for an AI Agent. The Cognigy agent record doesn't store
 * a direct flowId reference, so we try multiple strategies:
 *   1. Direct field on the agent object (future-proofing)
 *   2. GET /v2.0/aiagents/{id}/jobs — returns Job nodes that reference this agent
 *   3. Search project flows for one whose name matches "{agentName} Flow"
 */
async function resolveFlowForAgent(
  apiClient: CognigyApiClient,
  agentId: string,
): Promise<{ flowId: string; agent: any } | null> {
  const agent: any = await apiClient.get(`/v2.0/aiagents/${agentId}`);

  // Strategy 1: direct field
  const directId = agent.flowId || agent.flow?._id || agent.flow?.id;
  if (directId) return { flowId: directId, agent };

  // Strategy 2: /jobs endpoint — returns nodes referencing this agent
  try {
    const jobs: any = await apiClient.get(`/v2.0/aiagents/${agentId}/jobs`);
    const items = jobs.items ?? jobs;
    if (Array.isArray(items) && items.length > 0) {
      const flowId = items[0].flowId || items[0].flow?._id || items[0].parentId;
      if (flowId) return { flowId, agent };
    }
  } catch {
    // endpoint may not exist on all versions — fall through
  }

  // Strategy 3: search project flows by naming convention
  const projectId =
    agent.projectReference ||
    agent.projectId ||
    agent.project?._id ||
    agent.project?.id;
  if (projectId) {
    try {
      const flows: any = await apiClient.get("/v2.0/flows", {
        params: { projectId, limit: 100 },
      });
      const flowItems = flows.items ?? flows;
      if (Array.isArray(flowItems)) {
        const match = flowItems.find(
          (f: any) => f.name === `${agent.name} Flow`,
        );
        if (match) return { flowId: match._id || match.id, agent };

        // Last resort: scan all flows for an aiAgentJob node referencing this agent
        for (const f of flowItems) {
          const fid = f._id || f.id;
          try {
            const nodes: any = await apiClient.get(
              `/v2.0/flows/${fid}/chart/nodes`,
              {
                params: { limit: 50 },
              },
            );
            const nodeItems = nodes.items ?? nodes;
            const jobNode = (Array.isArray(nodeItems) ? nodeItems : []).find(
              (n: any) =>
                n.type === "aiAgentJob" &&
                n.config?.aiAgent === agent.referenceId,
            );
            if (jobNode) return { flowId: fid, agent };
          } catch {
            // skip flows we can't read
          }
        }
      }
    } catch {
      // fall through
    }
  }

  return null;
}

/**
 * Resolve the value to store in `endpoint.localeId` when creating an endpoint.
 *
 * `localeId` must be a locale *referenceId* (a UUID): the Endpoint Editor
 * matches its locale dropdown on `referenceId`, and an endpoint with an empty
 * or wrong `localeId` leaves "Open Demo Webchat" / "Open Demo Widget"
 * permanently disabled (the editor never backfills an empty value).
 */
async function resolveEndpointLocaleId(
  apiClient: CognigyApiClient,
  projectId: string,
  flowId?: string,
): Promise<string | undefined> {
  let locales: any[] = [];
  try {
    const resp: any = await apiClient.get("/v2.0/locales", {
      params: { projectId, limit: 100 },
    });
    const items = resp?.items ?? resp;
    // `/v2.0/locales` silently widens to EVERY project the key can see when
    // `projectId` is not one of them (e.g. a snapshot id) — never pick a
    // foreign project's locale.
    if (Array.isArray(items))
      locales = items.filter(
        (l: any) =>
          (!l?.projectReference || String(l.projectReference) === projectId) &&
          typeof l?.referenceId === "string" &&
          l.referenceId.length > 0,
      );
  } catch {
    return undefined;
  }
  if (locales.length === 0) return undefined;

  // Prefer the flow's locale — only worth the extra calls when the project
  // actually has more than one to choose from.
  if (flowId && locales.length > 1) {
    let flow: any = null;
    try {
      if (/^[0-9a-f]{24}$/i.test(flowId)) {
        flow = await apiClient.get(`/v2.0/flows/${flowId}`);
      } else {
        const flows: any = await apiClient.get("/v2.0/flows", {
          params: { projectId, limit: 100 },
        });
        const items = flows?.items ?? flows;
        const match = (Array.isArray(items) ? items : []).find(
          (f: any) => f.referenceId === flowId,
        );
        const mongoId = match?._id ?? match?.id;
        if (mongoId) flow = await apiClient.get(`/v2.0/flows/${mongoId}`);
      }
    } catch {
      // fall through to the primary locale
    }
    const flowLocale = flow?.localeReference;
    if (flowLocale) {
      const match = locales.find(
        (l: any) =>
          String(l._id ?? l.id) === String(flowLocale) ||
          l.referenceId === flowLocale,
      );
      if (match) return match.referenceId;
    }
  }

  return (locales.find((l: any) => l.primary) ?? locales[0]).referenceId;
}

/**
 * Thrown when the PLATFORM reported the task as failed/cancelled — i.e. the
 * operation itself definitively did not happen. Everything else that can go
 * wrong while polling (network blip, 5xx after the client's retries, a task
 * body we could not read) leaves the outcome UNKNOWN, and callers must not
 * treat the two the same: a snapshot delete whose status we merely lost is
 * still very possibly deleted.
 */
/**
 * Tools that change an EXISTING agent or its project, and so warrant a backup
 * offer. create_ai_agent is deliberately absent: creating is additive, so there
 * is nothing to roll back to, and the same reasoning exempts setup_llm and
 * package import. Exported so a surface test can assert every tool is
 * classified — a new tool 18 must land here, be read-only, or be listed as an
 * explicit exemption.
 */
export const BACKUP_WORTHY_TOOLS = new Set([
  "update_ai_agent",
  "create_tool",
  "update_tool",
  "manage_flow_nodes",
  "delete_resource",
  // Rewrites node configs and prepends flow nodes — the bulkiest single change
  // the plugin can make. Only in apply mode; see isBackupWorthyCall.
  "audit_voice_agent",
  // Project settings (voice preview, Knowledge AI models) ARE snapshot-covered.
  "manage_settings",
]);

export class TaskFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskFailedError";
  }
}

// ---------------------------------------------------------------------------
// ToolHandlers
// ---------------------------------------------------------------------------

export class ToolHandlers {
  private static readonly SENSITIVE_KEYS = new Set([
    "apiKey",
    "headers",
    "body",
    "preProcessCode",
    "postProcessCode",
  ]);
  private static readonly DEFAULT_PACKAGE_TIMEOUT_MS = 600000;
  /** Pagination guard for listAllSnapshots (100 per page). */
  private static readonly MAX_SNAPSHOT_PAGES = 20;
  private static readonly TASK_POLL_INTERVAL_MS = 3000;

  /**
   * Resource types a snapshot does NOT capture. Deleting one of these is not
   * protected by a backup at all, so holding the call would offer a rollback
   * that does not exist — and it would be inconsistent with manage_webchat and
   * manage_knowledge, which are exempt for exactly this reason.
   */
  private static readonly SNAPSHOT_EXCLUDED_RESOURCE_TYPES = new Set([
    "endpoint",
    "knowledge_store",
  ]);

  /**
   * Schemas of the gated tools. The gate runs before the handler validates, so
   * without this an INVALID first call would consume the one-shot hold: the
   * caller sees backup_not_offered instead of its validation error, fixes the
   * args, retries — and proceeds unprotected, because the hold is spent.
   */
  private static readonly GATED_TOOL_SCHEMAS: Record<string, z.ZodTypeAny> = {
    update_ai_agent: schemas.updateAiAgentSchema,
    create_tool: schemas.createToolSchema,
    update_tool: schemas.updateToolSchema,
    manage_flow_nodes: schemas.manageFlowNodesSchema,
    delete_resource: schemas.deleteResourceSchema,
    audit_voice_agent: schemas.auditVoiceAgentSchema,
    manage_settings: schemas.manageSettingsSchema,
  };

  /** Operations on multi-operation tools above that only READ. */
  private static readonly READ_ONLY_OPERATIONS = new Set([
    "get",
    "list",
    "render",
  ]);

  /**
   * A backup is only worth offering before something is actually changed, so a
   * read-only operation on an otherwise-mutating tool (manage_flow_nodes get /
   * list / render) must not trigger the offer.
   */
  private static isBackupWorthyCall(toolName: string, args: any): boolean {
    if (!BACKUP_WORTHY_TOOLS.has(toolName)) return false;

    // A call that cannot run must not consume the one-shot hold.
    const schema = ToolHandlers.GATED_TOOL_SCHEMAS[toolName];
    if (schema && !schema.safeParse(args).success) return false;

    // audit_voice_agent rewrites an existing agent's nodes and settings, but
    // only in apply mode; its default dry-run mutates nothing.
    if (toolName === "audit_voice_agent") return args?.apply === true;

    // Deleting something a snapshot never contained is not backup-protectable.
    if (
      toolName === "delete_resource" &&
      ToolHandlers.SNAPSHOT_EXCLUDED_RESOURCE_TYPES.has(args?.resourceType)
    ) {
      return false;
    }

    const operation = args?.operation;
    return (
      typeof operation !== "string" ||
      !ToolHandlers.READ_ONLY_OPERATIONS.has(operation)
    );
  }

  /** Whether the call targets something this session created. */
  private targetsNewResource(args: any): boolean {
    if (!this.resourcesCreatedThisSession.size) return false;
    // projectId is matched only against ids actually recorded, so passing an
    // EXISTING project to a later call cannot false-match its way past the gate.
    for (const key of ["aiAgentId", "flowId", "id", "projectId"]) {
      const value = args?.[key];
      if (
        typeof value === "string" &&
        this.resourcesCreatedThisSession.has(value)
      ) {
        return true;
      }
    }
    return false;
  }

  // Session state for the backup gate below. The plugin speaks MCP over stdio,
  // which means one server process per client session — so instance lifetime is
  // session lifetime and this state is exactly "this session".
  //
  // The answer is kept PER PROJECT: a user who declines a backup on a sandbox
  // must still be asked before the first change to a production project. Only
  // the anti-deadlock hold falls back to session-wide state for calls whose
  // project cannot be determined (see backupGateFor).
  private readonly snapshotCreatedForProject = new Set<string>();
  private readonly backupDeclinedForProject = new Set<string>();
  /**
   * Call signatures (tool + args) the gate has already held, per project. The
   * anti-deadlock release is keyed on the SIGNATURE, not the project: a client
   * that ignores the offer and retries the same call proceeds, but a client
   * that issues several DIFFERENT mutations in parallel has each of them held
   * until the offer is answered — otherwise only the first of a concurrent
   * burst would be held and the rest would mutate the project unprotected.
   * Known limitation: an IDENTICAL duplicate issued concurrently is
   * indistinguishable from a retry by signature and is let through.
   */
  private readonly backupGateHeldCallsForProject = new Map<
    string,
    Set<string>
  >();
  private readonly backupGateHeldCallsWithoutProject = new Set<string>();
  /**
   * projectId of resources seen this session, so the gate can tell which
   * project a call like update_ai_agent { aiAgentId } belongs to WITHOUT
   * spending an API call. Filled from reads the model already makes
   * (list_resources / get_resource) and from what this session created.
   */
  private readonly projectOfResource = new Map<string, string>();
  /**
   * Agent and flow ids this session created. Changes to brand-new material are
   * additive — there is no prior state to roll back to — so the backup gate
   * must not hold them. Without this, cognigy-agent-builder gets held on its
   * own step 5 (`update_ai_agent` right after `create_ai_agent`).
   */
  private readonly resourcesCreatedThisSession = new Set<string>();
  /**
   * Highest backup version this session handed out. Version numbers come from
   * the project's existing backups, so without this floor a create → delete →
   * create would reuse a number and make "restore v3" ambiguous.
   */
  private highestBackupVersionThisSession = 0;

  constructor(
    private apiClient: CognigyApiClient,
    private endpointBaseUrl: string,
    private webchatBaseUrl: string = "",
    private staticFilesBaseUrl: string = "",
  ) {}

  private sanitizeArgs(args: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(args)) {
      result[key] = ToolHandlers.SENSITIVE_KEYS.has(key) ? "[REDACTED]" : value;
    }
    return result;
  }

  private async readTask(taskId: string, projectId?: string): Promise<any> {
    return this.apiClient.get(`/new/v2.0/tasks/${taskId}`, {
      ...(projectId ? { params: { projectId } } : {}),
    });
  }

  private async waitForTask(
    taskId: string,
    projectId: string,
    timeoutMs = ToolHandlers.DEFAULT_PACKAGE_TIMEOUT_MS,
  ): Promise<{ task: any; timedOut: boolean }> {
    const startedAt = Date.now();
    let task = await this.readTask(taskId, projectId);

    while (task && (task.status === "queued" || task.status === "active")) {
      if (Date.now() - startedAt >= timeoutMs) {
        return { task, timedOut: true };
      }

      await new Promise((resolve) =>
        setTimeout(resolve, ToolHandlers.TASK_POLL_INTERVAL_MS),
      );
      task = await this.readTask(taskId, projectId);
    }

    if (!task) {
      throw new Error(`Task ${taskId} could not be read`);
    }

    if (task.status === "error") {
      throw new TaskFailedError(task.failReason || `Task ${taskId} failed`);
    }

    if (task.status === "cancelled" || task.status === "cancelling") {
      throw new TaskFailedError(`Task ${taskId} was cancelled`);
    }

    if (task.status !== "done") {
      throw new TaskFailedError(
        `Task ${taskId} ended with unexpected status "${task.status}"`,
      );
    }

    return { task, timedOut: false };
  }

  private resolvePackageFilePath(filePath: string): string {
    const resolvedPath = filePath.startsWith("~")
      ? filePath.replace(/^~/, process.env.HOME || "")
      : filePath;

    if (!isAbsolute(resolvedPath)) {
      throw new Error("filePath must be an absolute path to a local .zip file");
    }

    if (!existsSync(resolvedPath)) {
      throw new Error(`File not found: ${resolvedPath}`);
    }

    if (!resolvedPath.toLowerCase().endsWith(".zip")) {
      throw new Error(
        `Unsupported package file "${resolvedPath}". Only .zip files are supported.`,
      );
    }

    const stats = statSync(resolvedPath);
    if (!stats.isFile()) {
      throw new Error(`Path is not a file: ${resolvedPath}`);
    }

    if (stats.size === 0) {
      throw new Error(`File is empty: ${resolvedPath}`);
    }

    return resolvedPath;
  }

  private buildExportPackageName(name: string): string {
    const randomIdentifier = new Date()
      .toISOString()
      .replace(/:/g, "-")
      .slice(0, 19)
      .replace("T", "_");

    return `${name}_${randomIdentifier}`;
  }

  private sanitizePackageFileName(name: string): string {
    const cleaned = name
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .trim()
      .replace(/\s+/g, " ");

    return cleaned || "export";
  }

  private resolvePackageOutputPath(
    outputPath: string,
    suggestedFileName: string,
  ): string {
    const resolvedPath = outputPath.startsWith("~")
      ? outputPath.replace(/^~/, process.env.HOME || "")
      : outputPath;

    if (!isAbsolute(resolvedPath)) {
      throw new Error(
        "outputPath must be an absolute path to a local file or directory",
      );
    }

    const finalPath =
      existsSync(resolvedPath) && statSync(resolvedPath).isDirectory()
        ? join(resolvedPath, suggestedFileName)
        : resolvedPath.toLowerCase().endsWith(".zip")
          ? resolvedPath
          : `${resolvedPath}.zip`;

    mkdirSync(dirname(finalPath), { recursive: true });
    return finalPath;
  }

  private buildDefaultPackageOutputPath(suggestedFileName: string): string {
    const exportDir = join(tmpdir(), "cognigy-mcp-packages");
    mkdirSync(exportDir, { recursive: true });
    return join(exportDir, `${randomUUID()}-${suggestedFileName}`);
  }

  private describeSavedPackageLocation(
    finalPath: string,
    usedDefaultOutputPath: boolean,
  ): Record<string, any> {
    const savedDirectory = dirname(finalPath);

    return {
      savedTo: finalPath,
      savedToUri: pathToFileURL(finalPath).href,
      savedFileName: basename(finalPath),
      savedDirectory,
      savedDirectoryUri: pathToFileURL(savedDirectory).href,
      openArchiveUri: pathToFileURL(finalPath).href,
      openContainingFolderPath: savedDirectory,
      openContainingFolderUri: pathToFileURL(savedDirectory).href,
      ...(usedDefaultOutputPath
        ? {
            savedToTemp: true,
            note: "The package download URL requires authentication, so the archive was saved locally instead of returning a raw link.",
          }
        : {}),
    };
  }

  private async getPackageExportGraph(projectId: string): Promise<any> {
    return this.apiClient.get(`/new/v2.0/projects/${projectId}/graph`, {
      params: {
        packages: false,
        dependencies: true,
      },
    });
  }

  private async downloadPackageArchive(args: {
    projectId: string;
    packageId: string;
    outputPath?: string;
  }): Promise<any> {
    const packageData: any = await this.apiClient.get(
      `/new/v2.0/packages/${args.packageId}`,
    );
    const packageName = packageData?.name || "export";
    const suggestedFileName = `${this.sanitizePackageFileName(packageName)}.zip`;

    const downloadResponse: any = await this.apiClient.post(
      `/new/v2.0/packages/${args.packageId}/downloadlink`,
    );
    const downloadLink = downloadResponse?.downloadLink;

    if (!downloadLink) {
      throw new Error("Package download link could not be created");
    }

    const usedDefaultOutputPath = !args.outputPath;
    const finalPath = args.outputPath
      ? this.resolvePackageOutputPath(args.outputPath, suggestedFileName)
      : this.buildDefaultPackageOutputPath(suggestedFileName);
    const downloadStream: any = await this.apiClient.get(downloadLink, {
      baseURL: undefined,
      headers: { Accept: "*/*" },
      responseType: "stream",
    });

    await pipeline(downloadStream, createWriteStream(finalPath));

    return {
      package: {
        id: args.packageId,
        name: packageName,
      },
      suggestedFileName,
      ...this.describeSavedPackageLocation(finalPath, usedDefaultOutputPath),
    };
  }

  private async getPackagePreview(
    projectId: string,
    packageId: string,
  ): Promise<any> {
    const graph: any = await this.apiClient.get(
      `/new/v2.0/projects/${projectId}/graph`,
      {
        params: { packages: true },
      },
    );

    return buildPackageImportPreview(projectId, packageId, {
      [projectId]: graph?.[projectId],
      [packageId]: graph?.[packageId],
    });
  }

  private buildImportPayload(
    preview: any,
    data: any,
  ): {
    resourceIds: string[];
    strategies: Array<{
      _id: string;
      autoRename: true;
      identityConflictStrategy: "replace" | "re-identify";
    }>;
    localeMapping: Array<{ packageLocaleId: string; agentLocaleId: string }>;
  } {
    const previewResourceMap = new Map<string, any>(
      preview.resources.map((resource: any) => [resource.id, resource]),
    );
    const requestedSelections = new Map<string, any>(
      (data.resources ?? []).map((resource: any) => [resource.id, resource]),
    );

    const mergedSelections = preview.resources.map((resource: any) => {
      const requested = requestedSelections.get(resource.id);
      const shouldImport = requested?.import ?? resource.selectedByDefault;
      const strategy = requested?.strategy ?? resource.defaultStrategy;

      if (resource.disabledReason && shouldImport) {
        throw new Error(
          `Resource ${resource.id} (${resource.name}) cannot be imported: ${resource.disabledReason}`,
        );
      }

      return {
        id: resource.id,
        type: resource.type,
        import: shouldImport,
        strategy,
      };
    });

    for (const requested of data.resources ?? []) {
      if (!previewResourceMap.has(requested.id)) {
        throw new Error(
          `Resource ${requested.id} is not present in the package preview`,
        );
      }
    }

    const selectedResources = mergedSelections.filter(
      (resource: any) => resource.import,
    );
    if (selectedResources.length === 0) {
      throw new Error(
        "At least one package resource must be selected for import",
      );
    }

    const requiresLocaleMapping =
      selectedResources.some((resource: any) => resource.type === "flow") &&
      preview.locales.packageLocales.length > 0;

    const packageLocaleIds = new Set(
      preview.locales.packageLocales.map((locale: any) => locale.id),
    );
    const agentLocaleIds = new Set(
      preview.locales.projectLocales.map((locale: any) => locale.id),
    );
    const localeMapping =
      data.localeMapping ?? preview.locales.defaultLocaleMapping;

    for (const mapping of localeMapping) {
      if (!packageLocaleIds.has(mapping.packageLocaleId)) {
        throw new Error(
          `Unknown packageLocaleId in localeMapping: ${mapping.packageLocaleId}`,
        );
      }
      if (!agentLocaleIds.has(mapping.agentLocaleId)) {
        throw new Error(
          `Unknown agentLocaleId in localeMapping: ${mapping.agentLocaleId}`,
        );
      }
    }

    const mappedAgentLocaleIds = new Set<string>();
    for (const mapping of localeMapping) {
      if (mappedAgentLocaleIds.has(mapping.agentLocaleId)) {
        throw new Error(
          `Duplicate locale mapping target: ${mapping.agentLocaleId}`,
        );
      }
      mappedAgentLocaleIds.add(mapping.agentLocaleId);
    }

    if (requiresLocaleMapping && localeMapping.length === 0) {
      throw new Error(
        "localeMapping is required when importing flows from a package with locales",
      );
    }

    const primaryPackageLocale = preview.locales.packageLocales.find(
      (locale: any) => locale.isPrimary,
    );
    if (requiresLocaleMapping && primaryPackageLocale) {
      const hasPrimaryMapping = localeMapping.some(
        (mapping: any) => mapping.packageLocaleId === primaryPackageLocale.id,
      );
      if (!hasPrimaryMapping) {
        throw new Error(
          "The primary package locale must be mapped before importing flows",
        );
      }
    }

    return {
      resourceIds: selectedResources.map((resource: any) => resource.id),
      strategies: selectedResources.map((resource: any) => ({
        _id: resource.id,
        autoRename: true as const,
        identityConflictStrategy: resource.strategy,
      })),
      localeMapping,
    };
  }

  // =========================================================================
  // Tool 13: manage_packages
  // =========================================================================
  async handleManagePackages(args: any): Promise<any> {
    const data = schemas.managePackagesSchema.parse(args);

    switch (data.operation) {
      case "list_exportable": {
        const graph = await this.getPackageExportGraph(data.projectId);
        return {
          operation: "list_exportable",
          projectId: data.projectId,
          ...buildPackageExportablePreview(data.projectId, {
            [data.projectId]: graph?.[data.projectId],
          }),
        };
      }

      case "upload_and_inspect": {
        const timeoutMs =
          data.timeoutMs ?? ToolHandlers.DEFAULT_PACKAGE_TIMEOUT_MS;
        const resolvedPath = this.resolvePackageFilePath(data.filePath);
        const fileName = basename(resolvedPath);
        const uploadResponse: any = await this.apiClient.uploadFile(
          "/new/v2.0/packages/upload",
          createReadStream(resolvedPath),
          fileName,
          { projectId: data.projectId },
          { timeoutMs },
        );

        const taskId = uploadResponse?._id ?? uploadResponse?.id;
        if (!taskId) {
          throw new Error("Package upload did not return a task ID");
        }

        const { task, timedOut } = await this.waitForTask(
          taskId,
          data.projectId,
          timeoutMs,
        );
        const normalizedTask = normalizeTask(task);

        if (
          timedOut ||
          normalizedTask.status !== "done" ||
          !normalizedTask.data?.packageId
        ) {
          return withHints(
            {
              operation: "upload_and_inspect",
              projectId: data.projectId,
              uploadTaskId: taskId,
              task: normalizedTask,
              timedOutWaiting: timedOut,
            },
            {
              warning:
                "Package upload succeeded, but extraction is still running.",
              action: `Use manage_packages { operation: "read_task", projectId: "${data.projectId}", taskId: "${taskId}" } until the task is done, then call inspect with the packageId.`,
            },
          );
        }

        const preview = await this.getPackagePreview(
          data.projectId,
          normalizedTask.data.packageId,
        );
        return {
          operation: "upload_and_inspect",
          projectId: data.projectId,
          uploadTaskId: taskId,
          task: normalizedTask,
          ...preview,
        };
      }

      case "inspect": {
        const preview = await this.getPackagePreview(
          data.projectId,
          data.packageId,
        );
        return {
          operation: "inspect",
          projectId: data.projectId,
          ...preview,
        };
      }

      case "import": {
        const timeoutMs =
          data.timeoutMs ?? ToolHandlers.DEFAULT_PACKAGE_TIMEOUT_MS;
        const preview = await this.getPackagePreview(
          data.projectId,
          data.packageId,
        );
        const payload = this.buildImportPayload(preview, data);
        const response: any = await this.apiClient.post(
          `/new/v2.0/packages/${data.packageId}/merge`,
          payload,
        );

        const taskId = response?._id ?? response?.id;
        if (!taskId) {
          throw new Error("Package import did not return a task ID");
        }

        if (data.waitForCompletion === false) {
          return {
            operation: "import",
            projectId: data.projectId,
            packageId: data.packageId,
            task: {
              id: taskId,
              name: "mergePackage",
              status: "queued",
              currentStep: 0,
              totalStep: 0,
              progress: 0,
              failReason: null,
              data: null,
            },
            selectedResourceCount: payload.resourceIds.length,
            localeMappingCount: payload.localeMapping.length,
          };
        }

        const { task, timedOut } = await this.waitForTask(
          taskId,
          data.projectId,
          timeoutMs,
        );
        const normalizedTask = normalizeTask(task);
        const result = {
          operation: "import",
          projectId: data.projectId,
          packageId: data.packageId,
          task: normalizedTask,
          selectedResourceCount: payload.resourceIds.length,
          localeMappingCount: payload.localeMapping.length,
          ...(timedOut ? { timedOutWaiting: true } : {}),
        };

        if (timedOut) {
          return withHints(result, {
            warning: "Package import is still running.",
            action: `Use manage_packages { operation: "read_task", projectId: "${data.projectId}", taskId: "${taskId}" } to continue polling the import task.`,
          });
        }

        return result;
      }

      case "export": {
        const timeoutMs =
          data.timeoutMs ?? ToolHandlers.DEFAULT_PACKAGE_TIMEOUT_MS;
        const graph = await this.getPackageExportGraph(data.projectId);
        const exportPlan = buildPackageExportPlan(
          data.projectId,
          {
            [data.projectId]: graph?.[data.projectId],
          },
          data.resourceIds,
          {
            includeDependencies: data.includeDependencies,
            dependencyResourceIds: data.dependencyResourceIds,
          },
        );
        const packageName = this.buildExportPackageName(data.name);
        const response: any = await this.apiClient.post("/new/v2.0/packages", {
          projectId: data.projectId,
          name: packageName,
          description: data.description,
          resourceIds: exportPlan.resourceIds,
        });

        const taskId = response?._id ?? response?.id;
        if (!taskId) {
          throw new Error("Package export did not return a task ID");
        }

        if (data.waitForCompletion === false) {
          return {
            operation: "export",
            projectId: data.projectId,
            packageName,
            task: {
              id: taskId,
              name: "createPackageNFS",
              status: "queued",
              currentStep: 0,
              totalStep: 0,
              progress: 0,
              failReason: null,
              data: null,
            },
            ...exportPlan,
          };
        }

        const { task, timedOut } = await this.waitForTask(
          taskId,
          data.projectId,
          timeoutMs,
        );
        const normalizedTask = normalizeTask(task);
        const result: any = {
          operation: "export",
          projectId: data.projectId,
          packageName,
          task: normalizedTask,
          ...exportPlan,
          ...(timedOut ? { timedOutWaiting: true } : {}),
        };

        if (timedOut) {
          return withHints(result, {
            warning: "Package export is still running.",
            action: `Use manage_packages { operation: "read_task", projectId: "${data.projectId}", taskId: "${taskId}" } to continue polling the export task.`,
          });
        }

        const packageId = normalizedTask.data?.packageId;
        if (packageId) {
          Object.assign(
            result,
            await this.downloadPackageArchive({
              projectId: data.projectId,
              packageId,
              outputPath: data.outputPath,
            }),
          );
        }

        return result;
      }

      case "download": {
        return {
          operation: "download",
          projectId: data.projectId,
          ...(await this.downloadPackageArchive({
            projectId: data.projectId,
            packageId: data.packageId,
            outputPath: data.outputPath,
          })),
        };
      }

      case "read_task": {
        const task = await this.readTask(data.taskId, data.projectId);
        return {
          operation: "read_task",
          projectId: data.projectId,
          task: normalizeTask(task),
        };
      }
    }
  }

  // =========================================================================
  // Tool 1: create_ai_agent
  // =========================================================================
  async handleCreateAiAgent(args: any): Promise<any> {
    const data = schemas.createAiAgentSchema.parse(args);

    let projectId = data.projectId ?? null;
    let createdProject = false;
    let agentId: string | null = null;
    let flowId: string | null = null;
    let endpointId: string | null = null;

    try {
      // Step 0: Auto-create project if none provided
      if (!projectId) {
        const project: any = await this.apiClient.post("/v2.0/projects", {
          name: data.name,
          color: "blue",
          locale: "en-US",
        });
        projectId = project._id || project.id;
        createdProject = true;
      }

      // Step 1: Create agent resource
      const agentPayload: any = {
        projectId,
        name: data.name,
        image: DEFAULT_AGENT_IMAGE,
        imageOptimizedFormat: true,
      };
      if (data.description) agentPayload.description = data.description;
      const agent: any = await this.apiClient.post(
        "/v2.0/aiagents",
        agentPayload,
      );
      agentId = agent._id || agent.id;

      // Step 2: Create flow
      const flow: any = await this.apiClient.post("/v2.0/flows", {
        projectId,
        name: `${data.name} Flow`,
        description: `Auto-generated flow for ${data.name}`,
      });
      flowId = flow._id || flow.id;

      // Step 3: Find entry node (with retry)
      const entryNode = await retryGetEntryNode(this.apiClient, flowId!);

      // Step 4: Create AI Agent Job Node
      const jobNode: any = await this.apiClient.post(
        `/v2.0/flows/${flowId}/chart/nodes`,
        {
          mode: "append",
          target: entryNode._id,
          type: "aiAgentJob",
          extension: "@cognigy/basic-nodes",
          label: "AI Agent",
          config: {
            aiAgent: agent.referenceId,
            outputImmediately: true,
          },
        },
      );
      const jobNodeId = jobNode._id || jobNode.id;

      // Step 4a: Auto-assign default LLM to the job node so talk_to_agent works
      // immediately without a separate update_ai_agent call.
      //
      // The node preview (agent avatar + name) is computed server-side from
      // `config.aiAgent`. A config PATCH that omits `aiAgent` makes the backend
      // recompute the preview as a bare string (the job name), wiping the
      // avatar. So we always re-send `aiAgent` alongside any config change to
      // force the backend to regenerate the proper avatar preview object.
      let llmAutoAssigned = false;
      try {
        const llmList: any = await this.apiClient.get(
          "/v2.0/largelanguagemodels",
          {
            params: { projectId },
          },
        );
        const llmItems = llmList.items ?? llmList;
        if (Array.isArray(llmItems) && llmItems.length > 0) {
          const defaultLlm =
            llmItems.find((l: any) => l.isDefault) ?? llmItems[0];
          const llmRefId = defaultLlm.referenceId ?? defaultLlm._id;
          if (llmRefId) {
            await this.apiClient.patch(
              `/v2.0/flows/${flowId}/chart/nodes/${jobNodeId}`,
              {
                config: {
                  aiAgent: agent.referenceId,
                  llmProviderReferenceId: llmRefId,
                },
              },
            );
            llmAutoAssigned = true;
          }
        }
      } catch (llmErr: any) {
        logger.warn(
          "Failed to auto-assign LLM to job node — agent may need manual LLM assignment",
          { error: llmErr.message },
        );
      }

      // Step 4d: Remove backend-created placeholder child tools that are only
      // used for UI preview and should not exist in Cognigy MCP flows.
      try {
        let placeholderTools: any[] = [];

        try {
          const chart: any = await this.apiClient.get(
            `/new/v2.0/flows/${flowId}/chart`,
            (flow?.localeReference ?? flow?.localeId)
              ? {
                  params: {
                    preferredLocaleId: flow.localeReference ?? flow.localeId,
                  },
                }
              : undefined,
          );
          const chartNodes = chart.nodes ?? [];
          const chartRelations = chart.relations ?? [];
          const jobRelation = (
            Array.isArray(chartRelations) ? chartRelations : []
          ).find((relation: any) => relation.node === jobNodeId);
          const childNodeIds = new Set(jobRelation?.children ?? []);

          placeholderTools = (
            Array.isArray(chartNodes) ? chartNodes : []
          ).filter(
            (n: any) =>
              childNodeIds.has(n._id || n.id) && n.preview === "unlock_account",
          );
        } catch {
          // Fall back to the regular node list when the chart endpoint is not available.
        }

        if (placeholderTools.length === 0) {
          const nodeList: any = await this.apiClient.get(
            `/v2.0/flows/${flowId}/chart/nodes`,
            {
              params: { limit: 200 },
            },
          );
          const nodeItems = nodeList.items ?? nodeList;
          placeholderTools = (Array.isArray(nodeItems) ? nodeItems : []).filter(
            (n: any) =>
              (n.parentId === jobNodeId || n.parent === jobNodeId) &&
              (n.label === "unlock_account" ||
                n.config?.toolId === "unlock_account"),
          );
        }

        for (const placeholderTool of placeholderTools) {
          const placeholderToolId = placeholderTool._id || placeholderTool.id;
          if (!placeholderToolId) continue;
          await this.apiClient.delete(
            `/v2.0/flows/${flowId}/chart/nodes/${placeholderToolId}`,
          );
        }
      } catch (placeholderCleanupError: any) {
        logger.warn(
          "Failed to remove backend-created placeholder tool from agent flow",
          { error: placeholderCleanupError.message },
        );
      }

      // Step 4e: If knowledge store provided, create a knowledge tool on the job node
      let knowledgeToolId: string | null = null;
      if (data.knowledgeStoreReferenceId) {
        try {
          const knowledgeToolNode: any = await this.apiClient.post(
            `/v2.0/flows/${flowId}/chart/nodes`,
            {
              type: "knowledgeTool",
              extension: "@cognigy/basic-nodes",
              mode: "appendChild",
              target: jobNodeId,
              label: "Search Knowledge",
              config: {
                knowledgeStoreId: data.knowledgeStoreReferenceId,
                toolId: "search_knowledge",
                description:
                  "Search the knowledge base for relevant information",
              },
            },
          );
          knowledgeToolId = knowledgeToolNode._id || knowledgeToolNode.id;
        } catch (knowledgeError: any) {
          logger.warn(
            "Failed to create knowledge tool — agent was created without it",
            { error: knowledgeError.message },
          );
        }
      }

      // Step 5: Create REST endpoint
      const endpoint: any = await this.apiClient.post("/v2.0/endpoints", {
        projectId,
        channel: "rest",
        flowId: flow.referenceId,
        name: `${data.name} REST Endpoint`,
      });
      endpointId = endpoint._id || endpoint.id;

      // Step 6: LLM status — derived from the auto-assign attempt in Step 4a
      // If auto-assignment succeeded, we know the LLM is configured.
      // If it did not, we cannot reliably distinguish "no LLM" from "error",
      // so we report "unknown" instead of incorrectly claiming "missing".
      const llmStatus: "configured" | "unknown" = llmAutoAssigned
        ? "configured"
        : "unknown";

      // Remember what this session minted so the backup gate leaves it alone.
      // The project counts too when we created it: holding a change to a
      // seconds-old project contradicts the exemption's own rationale, and a
      // backup of it would eat one of that project's ~10 snapshot slots.
      for (const id of [
        agentId,
        agent.referenceId,
        flowId,
        flow.referenceId,
        ...(createdProject ? [projectId] : []),
      ]) {
        if (id) this.resourcesCreatedThisSession.add(String(id));
      }

      // Scope the gate for later calls that name only the agent or the flow.
      for (const resource of [agent, flow]) {
        this.rememberProjectOf(resource, String(projectId));
      }

      const result: any = {
        projectId,
        projectCreated: createdProject,
        agent: filterResponse("agent", agent),
        flow: filterResponse("flow", flow),
        endpoint: filterResponse("endpoint", endpoint),
        endpointUrl: endpoint.URLToken
          ? `${this.endpointBaseUrl}/${endpoint.URLToken}`
          : "URL not available",
        llmStatus,
      };

      if (knowledgeToolId) {
        result.knowledgeTool = {
          toolId: knowledgeToolId,
          knowledgeStoreReferenceId: data.knowledgeStoreReferenceId,
        };
      }

      if (data.knowledgeStoreReferenceId && !knowledgeToolId) {
        return withHints(result, {
          warning: "Agent created but knowledge tool failed to provision.",
          action: `Create it manually: create_tool { aiAgentId: "${agentId}", toolType: "knowledge", name: "Search Knowledge", config: { knowledgeStoreId: "${data.knowledgeStoreReferenceId}", toolId: "search_knowledge", description: "Search the knowledge base" } }`,
        });
      }

      if (llmStatus === "unknown") {
        const nextAction = createdProject
          ? `A new project was auto-created as "${projectId}". Immediately inspect the other projects with list_resources { resourceType: "project" } and list_resources { resourceType: "llm_model", projectId } for each one. Choose only source-project llm_model entries with a non-empty connectionId, transfer the required LLM resources plus their shared connection resource(s) via manage_packages export/upload_and_inspect/import, verify the import with list_resources { resourceType: "llm_model", projectId: "${projectId}" }, and do not call talk_to_agent until the import is confirmed. If this workflow will use knowledge, transfer the source project's embedding model and exact Knowledge Search model together before calling manage_settings. Only use setup_llm if no reusable LLM with connectionId exists or package transfer fails.`
          : `Inspect the other projects with list_resources { resourceType: "project" } and list_resources { resourceType: "llm_model", projectId } for each one. Choose only source-project llm_model entries with a non-empty connectionId, transfer the required LLM resources plus their shared connection resource(s) via manage_packages export/upload_and_inspect/import, verify the import with list_resources { resourceType: "llm_model", projectId: "${projectId}" }, and do not call talk_to_agent until the import is confirmed. If this workflow will use knowledge, transfer the source project's embedding model and exact Knowledge Search model together before calling manage_settings. Only use setup_llm if no reusable LLM with connectionId exists or package transfer fails.`;
        return withHints(result, {
          warning:
            "Could not verify LLM resource in project. Agent may not generate responses.",
          action: nextAction,
        });
      }

      return result;
    } catch (error: any) {
      const rolledBack: string[] = [];
      const rollbackFailed: string[] = [];

      if (endpointId) {
        try {
          await this.apiClient.delete(`/v2.0/endpoints/${endpointId}`);
          rolledBack.push("endpoint");
        } catch {
          rollbackFailed.push("endpoint");
        }
      }
      if (flowId) {
        try {
          await this.apiClient.delete(`/v2.0/flows/${flowId}`);
          rolledBack.push("flow");
        } catch {
          rollbackFailed.push("flow");
        }
      }
      if (agentId) {
        try {
          await this.apiClient.delete(`/v2.0/aiagents/${agentId}`);
          rolledBack.push("agent");
        } catch {
          rollbackFailed.push("agent");
        }
      }
      if (createdProject && projectId) {
        try {
          await this.apiClient.delete(`/v2.0/projects/${projectId}`);
          rolledBack.push("project");
        } catch {
          rollbackFailed.push("project");
        }
      }

      const likelyCause =
        rollbackFailed.length > 0
          ? `Orchestration failed. Rolled back: [${rolledBack.join(", ")}]. FAILED to roll back: [${rollbackFailed.join(", ")}] — these are orphaned and should be deleted manually.`
          : "Orchestration failed. All created resources were rolled back.";

      const action =
        rollbackFailed.length > 0
          ? `Delete orphaned resources with delete_resource, then retry create_ai_agent.`
          : "Read the troubleshooting guide, then retry create_ai_agent.";

      return withHints(
        {
          failed: {
            step: identifyFailedStep(agentId, flowId, endpointId),
            error: error.message,
          },
        },
        {
          likely_cause: likelyCause,
          action,
        },
      );
    }
  }

  // =========================================================================
  // Tool 2: update_ai_agent
  // =========================================================================
  async handleUpdateAiAgent(args: any): Promise<any> {
    const { aiAgentId, jobConfig, ...rest } =
      schemas.updateAiAgentSchema.parse(args);

    const updatedParts: string[] = [];

    // Step 1: Patch AI Agent resource if any agent-level fields provided
    const agentPayload: Record<string, any> = {};
    if (rest.name !== undefined) agentPayload.name = rest.name;
    if (rest.description !== undefined)
      agentPayload.description = rest.description;
    if (rest.instructions !== undefined)
      agentPayload.instructions = rest.instructions;

    let agentResult: any;
    if (Object.keys(agentPayload).length > 0) {
      agentResult = await this.apiClient.patch(
        `/v2.0/aiagents/${aiAgentId}`,
        agentPayload,
      );
      updatedParts.push("agent");
    }

    // Step 2: Patch AI Agent Job Node config if any job-level fields provided
    const needsJobPatch = jobConfig && Object.keys(jobConfig).length > 0;
    const needsPreviewPatch =
      rest.name !== undefined || jobConfig?.jobName !== undefined;

    let jobNodeResult: any;
    if (needsJobPatch || needsPreviewPatch) {
      const resolved = await resolveFlowForAgent(this.apiClient, aiAgentId);
      if (!resolved) {
        if (needsJobPatch) {
          return withHints(
            {
              error:
                "Could not find a flow associated with this agent. Job config was not updated.",
            },
            {
              action:
                "Ensure the agent was created via create_ai_agent, which provisions the flow and Job Node.",
            },
          );
        }
      } else {
        const nodes: any = await this.apiClient.get(
          `/v2.0/flows/${resolved.flowId}/chart/nodes`,
          {
            params: { limit: 100 },
          },
        );
        const allNodes = nodes.items ?? nodes;
        const jobNode = (Array.isArray(allNodes) ? allNodes : []).find(
          (n: any) => n.type === "aiAgentJob",
        );
        if (!jobNode) {
          if (needsJobPatch) {
            return withHints(
              {
                error:
                  "No AI Agent Job Node found in the flow. Job config was not updated.",
              },
              {
                action: "Ensure the agent was created via create_ai_agent.",
              },
            );
          }
        } else {
          const jobNodeId = jobNode._id || jobNode.id;
          const nodePatch: Record<string, any> = {};

          // The node's avatar preview is computed server-side from
          // `config.aiAgent`. Any config PATCH that omits it makes the backend
          // recompute the preview as a bare string (the job name), which wipes
          // the avatar image in the flow editor. So we always include the
          // existing `aiAgent` reference in the config patch — both when
          // changing job fields and when only the agent name/avatar changed —
          // to force the backend to regenerate the proper avatar preview.
          if (needsJobPatch || needsPreviewPatch) {
            // The avatar preview is recomputed server-side from `config.aiAgent`;
            // omitting it wipes the avatar. The `/chart/nodes` index may not
            // carry `config`, so prefer the authoritative agent reference from
            // the resolved agent record, falling back to the node's config.
            const nodeConfigPatch: Record<string, any> = {
              aiAgent: resolved.agent?.referenceId ?? jobNode.config?.aiAgent,
            };
            if (needsJobPatch) {
              if (jobConfig!.llmProviderReferenceId !== undefined)
                nodeConfigPatch.llmProviderReferenceId =
                  jobConfig!.llmProviderReferenceId;
              if (jobConfig!.jobName !== undefined)
                nodeConfigPatch.name = jobConfig!.jobName;
              if (jobConfig!.jobDescription !== undefined)
                nodeConfigPatch.description = jobConfig!.jobDescription;
              if (jobConfig!.jobInstructions !== undefined)
                nodeConfigPatch.instructions = jobConfig!.jobInstructions;
              if (jobConfig!.temperature !== undefined)
                nodeConfigPatch.temperature = jobConfig!.temperature;
              if (jobConfig!.maxTokens !== undefined)
                nodeConfigPatch.maxTokens = jobConfig!.maxTokens;
            }
            nodePatch.config = nodeConfigPatch;
          }

          jobNodeResult = await this.apiClient.patch(
            `/v2.0/flows/${resolved.flowId}/chart/nodes/${jobNodeId}`,
            nodePatch,
          );
          updatedParts.push("jobNode");
        }
      }
    }

    if (updatedParts.length === 0) {
      return withHints(
        {
          error:
            "Nothing to update. Provide agent-level fields (name, description, instructions) and/or jobConfig fields.",
        },
        { action: "Include at least one field to update." },
      );
    }

    // Build response from what was updated
    const response: any = { updated: updatedParts };
    if (agentResult) {
      Object.assign(response, filterResponse("agent", agentResult));
    }
    if (jobNodeResult) {
      const jobNodeResponse: Record<string, any> = {
        id: jobNodeResult._id || jobNodeResult.id,
      };
      if (jobConfig && Object.keys(jobConfig).length > 0)
        jobNodeResponse.configUpdated = Object.keys(jobConfig);
      if (needsPreviewPatch) jobNodeResponse.previewUpdated = true;
      response.jobNode = jobNodeResponse;
    }

    return response;
  }

  // =========================================================================
  // Tool 3: setup_llm
  // =========================================================================
  async handleSetupLlm(args: any): Promise<any> {
    const data = schemas.setupLlmSchema.parse(args);

    if (!data.apiKey && !data.connectionId) {
      return withHints(
        { error: "Either apiKey or connectionId must be provided." },
        {
          action: "Read the provider guide for credential requirements.",
        },
      );
    }

    let connectionRefId = data.connectionId;

    if (connectionRefId) {
      try {
        const connections: any = await this.apiClient.get(
          "/new/v2.0/connections",
          {
            params: { projectId: data.projectId },
          },
        );
        const items = connections?.items ?? connections;
        const match = (Array.isArray(items) ? items : []).find(
          (connection: any) =>
            connection.referenceId === connectionRefId ||
            connection._id === connectionRefId ||
            connection.id === connectionRefId,
        );

        if (!match) {
          return withHints(
            {
              error:
                "The provided connectionId was not found in the target project. Cognigy connections are project-scoped and cannot be reused across projects directly.",
              connectionId: connectionRefId,
              projectId: data.projectId,
            },
            {
              action:
                "Import the LLM and its connection into the target project with manage_packages, or provide an apiKey / same-project connectionId.",
            },
          );
        }

        connectionRefId =
          match.referenceId ?? match._id ?? match.id ?? connectionRefId;
      } catch (connectionLookupError: any) {
        return withHints(
          {
            error: `Could not verify the provided connectionId in the target project: ${connectionLookupError.message}`,
            connectionId: connectionRefId,
            projectId: data.projectId,
          },
          {
            action:
              "Verify the connection exists in the target project, or import it together with the LLM via manage_packages before retrying.",
          },
        );
      }
    }

    // If apiKey is provided, auto-create a Connection first
    if (data.apiKey && !connectionRefId) {
      try {
        const connection: any = await this.apiClient.post("/v2.0/connections", {
          projectId: data.projectId,
          name: `${data.provider} - auto - ${randomUUID()}`,
          type: PROVIDER_CONNECTION_TYPE[data.provider] ?? data.provider,
          extension: "@cognigy/generative-ai-provider",
          fields: { apiKey: data.apiKey },
        });
        connectionRefId =
          connection.referenceId || connection._id || connection.id;
      } catch (connError: any) {
        return withHints(
          { error: `Failed to create connection: ${connError.message}` },
          {
            action: "Check API key and provider, then retry.",
          },
        );
      }
    }

    const displayName = data.name || data.customModel || data.modelType;

    // Provider-specific metadata. For openAICompatible the actual model name
    // and endpoint live here — modelType is just "custom-model" / "custom-embedding-model".
    const providerMeta =
      data.provider === "openAICompatible"
        ? {
            customModel: data.customModel,
            baseCustomUrl: data.baseCustomUrl,
            ...(data.customAuthHeader
              ? { customAuthHeader: data.customAuthHeader }
              : {}),
          }
        : {};

    let result: any;
    try {
      result = await this.apiClient.post("/v2.0/largelanguagemodels", {
        projectId: data.projectId,
        name: displayName,
        modelType: data.modelType,
        provider: data.provider,
        connectionId: connectionRefId,
        isDefault: data.isDefault ?? true,
        ...(data.apiType ? { apiType: data.apiType } : {}),
        [data.provider]: providerMeta,
      });
    } catch (error: any) {
      return withHints(
        { error: error.message },
        {
          action:
            "Read the provider guide for valid provider names and model strings.",
        },
      );
    }

    const llmId = result._id || result.id;

    if (data.dangerouslySkipConnectionTest) {
      const filtered = filterResponse("llm_model", result);
      return {
        ...filtered,
        warning:
          "Connection test was skipped. The model may not work correctly — verify manually before use.",
        connectionTest: { skipped: true },
      };
    }

    if (!llmId) {
      logger.error(
        "LLM creation response did not include an id; unable to run connection test or cleanup.",
        {
          provider: data.provider,
          modelType: data.modelType,
          rawResult: result,
        },
      );

      return withHints(
        {
          error:
            "Model may have been created but the API response did not include a model id. " +
            "Connection test and automatic cleanup could not be performed. Please verify the model state in the UI and delete it manually if necessary.",
          provider: data.provider,
          modelType: data.modelType,
        },
        {
          action:
            "Verify your provider setup and model configuration, then retry.",
        },
      );
    }
    try {
      const testResponse: any = await this.apiClient.post(
        `/v2.0/largelanguagemodels/${llmId}/test`,
      );

      if (!testResponse?.isCredentialsValid) {
        let cleanedUp = false;
        try {
          if (result.isDefault) {
            try {
              await this.apiClient.patch(`/v2.0/largelanguagemodels/${llmId}`, {
                isDefault: false,
              });
            } catch (unsetDefaultError: any) {
              logger.warn(
                "Failed to unset default flag before deleting broken LLM model",
                {
                  llmId,
                  error: unsetDefaultError.message,
                },
              );
            }
          }
          await this.apiClient.delete(`/v2.0/largelanguagemodels/${llmId}`);
          cleanedUp = true;
        } catch (cleanupError: any) {
          logger.warn(
            "Failed to clean up broken LLM model after failed connection test",
            {
              llmId,
              error: cleanupError.message,
            },
          );
        }

        return withHints(
          {
            error: `Model created but connection test failed${cleanedUp ? " — the model has been removed to prevent broken references" : " — automatic cleanup failed, delete the model manually"}.`,
            providerMessage: testResponse?.msg || "No details from provider.",
            provider: data.provider,
            modelType: data.modelType,
            ...(cleanedUp ? {} : { modelId: llmId }),
          },
          {
            action:
              "Verify your API key and model type are correct, then retry.",
          },
        );
      }

      const filtered = filterResponse("llm_model", result);
      return {
        ...filtered,
        connectionTest: {
          isCredentialsValid: true,
          msg: testResponse.msg,
        },
      };
    } catch (testError: any) {
      logger.warn(
        "Connection test request failed, but model was created successfully",
        {
          llmId,
          error: testError.message,
        },
      );

      const filtered = filterResponse("llm_model", result);
      return withHints(
        {
          ...filtered,
          warning: `Model created but the connection test could not be executed: ${testError.message}. Verify the model works before relying on it.`,
          connectionTest: { skipped: true, reason: testError.message },
        },
        {
          action:
            "Test the model manually or delete and recreate if credentials are wrong.",
        },
      );
    }
  }

  // =========================================================================
  // Tool 4: talk_to_agent
  // =========================================================================
  async handleTalkToAgent(args: any): Promise<any> {
    const data = schemas.talkToAgentSchema.parse(args);

    const sessionId = data.sessionId || `mcp-session-${randomUUID()}`;
    const userId = data.userId || "mcp-user";

    // --- Endpoint resolution ---
    let endpointUrl: string | undefined = data.endpointUrl;
    let endpointMeta: {
      autoCreated?: boolean;
      resolved?: boolean;
      endpointId?: string;
    } = {};

    if (!endpointUrl && data.aiAgentId) {
      const resolved = await resolveFlowForAgent(
        this.apiClient,
        data.aiAgentId,
      );
      if (!resolved) {
        return withHints(
          {
            error: "Could not find a flow associated with this agent.",
            sessionId,
          },
          {
            likely_cause:
              "Agent may not have been created via create_ai_agent, or has no associated flow.",
            action:
              "Create the agent with create_ai_agent, or provide endpointUrl directly.",
          },
        );
      }

      const { flowId, agent } = resolved;

      let flowReferenceId: string | null = null;
      let flowProjectReference: string | null = null;
      try {
        const flowObj: any = await this.apiClient.get(`/v2.0/flows/${flowId}`);
        flowReferenceId = flowObj.referenceId ?? null;
        flowProjectReference = flowObj.projectReference ?? null;
      } catch {
        // fall through — we'll still match on flowId
      }

      const projectId =
        data.projectId ||
        agent.projectReference ||
        agent.projectId ||
        agent.project?._id ||
        agent.project?.id ||
        flowProjectReference;

      if (!projectId) {
        return withHints(
          {
            error: "Could not determine projectId for this agent.",
            sessionId,
          },
          { action: "Provide projectId explicitly alongside aiAgentId." },
        );
      }

      // Search for an existing REST endpoint connected to this flow
      let existingEndpoint: any = null;
      const pageSize = 100;
      let offset = 0;
      let hasMore = true;

      while (hasMore && !existingEndpoint) {
        const eps: any = await this.apiClient.get("/v2.0/endpoints", {
          params: { projectId, limit: pageSize, skip: offset },
        });
        const epItems = eps.items ?? eps;
        if (!Array.isArray(epItems) || epItems.length === 0) break;

        existingEndpoint = epItems.find(
          (ep: any) =>
            ep.channel === "rest" &&
            (ep.flowId === flowId || ep.flowId === flowReferenceId),
        );

        hasMore = epItems.length >= pageSize;
        offset += pageSize;
      }

      if (existingEndpoint) {
        endpointUrl = existingEndpoint.URLToken
          ? `${this.endpointBaseUrl}/${existingEndpoint.URLToken}`
          : undefined;
        endpointMeta = {
          resolved: true,
          endpointId: existingEndpoint._id || existingEndpoint.id,
        };
      } else {
        // Auto-create REST endpoint
        try {
          const flowRef = flowReferenceId || flowId;
          const endpoint: any = await this.apiClient.post("/v2.0/endpoints", {
            projectId,
            channel: "rest",
            flowId: flowRef,
            name: `${agent.name} REST Endpoint`,
          });
          endpointUrl = endpoint.URLToken
            ? `${this.endpointBaseUrl}/${endpoint.URLToken}`
            : undefined;
          endpointMeta = {
            autoCreated: true,
            endpointId: endpoint._id || endpoint.id,
          };
        } catch (createErr: any) {
          return withHints(
            {
              error: "Failed to auto-create REST endpoint for agent.",
              detail: createErr.response?.data?.error || createErr.message,
              sessionId,
            },
            {
              likely_cause:
                "Insufficient permissions or project configuration issue.",
              action:
                "Create endpoint manually via create_ai_agent or the Cognigy UI, then provide endpointUrl.",
            },
          );
        }
      }

      if (!endpointUrl) {
        return withHints(
          {
            error: "Endpoint found/created but URL token not available.",
            sessionId,
          },
          {
            action:
              "Try list_resources { resourceType: 'endpoint', projectId } to check endpoint status.",
          },
        );
      }
    }

    // --- Message sending ---
    const payload: any = { userId, sessionId, text: data.message };
    if (data.data) payload.data = data.data;

    // Test mode (see utils/endpointUrl.ts) keeps plugin traffic out of the
    // customer's billable conversation count, so it is the default. It is a
    // pure URL variant, so the handler stays stateless: when the platform
    // rejects the test-mode URL (older release, disabled feature, or the
    // 600-messages-per-hour test budget), the message is re-sent to the
    // regular endpoint and the caller is told it was billed. Network-level
    // failures (timeout, DNS) are not retried: they would fail on the regular
    // URL too, and a timed-out message may already have been processed.
    const useTestMode = data.testMode !== false;
    let productionUrl: string;
    let targetUrl: string;
    try {
      productionUrl = toProductionEndpointUrl(endpointUrl!);
      targetUrl = useTestMode
        ? toTestModeEndpointUrl(endpointUrl!)
        : productionUrl;
    } catch (urlErr: any) {
      // A caller-supplied endpointUrl is schema-validated, so this is almost
      // always a malformed COGNIGY_ENDPOINT_BASE_URL. Return it structured
      // instead of letting the URL parser's TypeError escape the tool.
      return withHints(
        {
          error: "Endpoint URL is not a valid absolute URL.",
          detail: urlErr?.message,
          endpointUrl,
          sessionId,
        },
        {
          likely_cause:
            "COGNIGY_ENDPOINT_BASE_URL is misconfigured (it must be an absolute https URL), or the endpointUrl argument is malformed.",
          action:
            "Check the endpoint base URL in the server configuration, or pass a full endpointUrl from list_resources { resourceType: 'endpoint' }.",
        },
      );
    }
    let testModeFallback:
      | { status: number; detail: string; testModeUrl: string }
      | undefined;

    const send = (url: string) =>
      axios.post(url, payload, {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        timeout: 30000,
      });

    try {
      let response;
      try {
        response = await send(targetUrl);
      } catch (testErr: any) {
        const status = testErr?.response?.status;
        if (!useTestMode || typeof status !== "number") throw testErr;
        logger.warn(
          `talk_to_agent: test-mode endpoint answered ${status}; falling back to the regular endpoint`,
        );
        testModeFallback = {
          status,
          detail:
            testErr.response?.data?.error ||
            testErr.response?.data?.message ||
            testErr.message,
          testModeUrl: targetUrl,
        };
        targetUrl = productionUrl;
        response = await send(targetUrl);
      }

      let agentResponse = response.data.text || "";
      const outputStack = response.data.outputStack || [];
      const textOutputs = outputStack
        .filter((o: any) => o.text?.trim())
        .map((o: any) => o.text);
      if (textOutputs.length > 0) agentResponse = textOutputs.join(" ");

      const result: any = {
        agentResponse,
        sessionId,
        endpointUrl: targetUrl,
        testMode: useTestMode && !testModeFallback,
      };
      if (endpointMeta.autoCreated) result.endpointAutoCreated = true;
      if (endpointMeta.resolved) result.endpointResolved = true;
      if (testModeFallback) result.testModeFallback = testModeFallback;

      if (data.verbose) {
        result.rawResponse = response.data;
      }

      const hints: Record<string, string> = {};
      if (testModeFallback) {
        hints.warning = `Test mode was rejected by the platform (HTTP ${testModeFallback.status}), so this message was sent to the regular endpoint and COUNTS as a billable conversation. Likely causes: the platform predates Cognigy 4.27 (no REST test mode), test mode is disabled for this environment, or the 600-test-messages-per-hour budget is exhausted. Tell the user. Pass testMode: false to skip the test-mode attempt for further messages in this run if the rejection persists.`;
      }
      if (!agentResponse) {
        hints.likely_cause =
          "Agent returned no text. Possible causes: 1) no LLM configured, 2) empty agent description, 3) endpoint not connected to flow.";
        hints.action = "Read the troubleshooting guide for diagnostic steps.";
      }

      return Object.keys(hints).length > 0 ? withHints(result, hints) : result;
    } catch (error: any) {
      const detail =
        error.response?.data?.error ||
        error.response?.data?.message ||
        error.message;
      return withHints(
        {
          error: `Request failed with status ${error.response?.status ?? "unknown"}`,
          detail,
          sessionId,
          endpointUrl: targetUrl,
          ...(testModeFallback ? { testModeFallback } : {}),
        },
        {
          likely_cause: "Endpoint URL invalid or expired.",
          action:
            "Verify endpoint with list_resources { resourceType: 'endpoint' }.",
        },
      );
    }
  }

  // =========================================================================
  // Tool 5: list_resources
  // =========================================================================
  async handleListResources(args: any): Promise<any> {
    const data = schemas.listResourcesSchema.parse(args);
    const {
      resourceType,
      projectId,
      aiAgentId,
      limit,
      skip,
      sort,
      actor,
      eventType,
      user,
    } = data;
    // `sort` rides along with paging so every server-backed list endpoint gets
    // it. 'tool' builds its own params and has no server-side sort.
    const paging = {
      limit: limit ?? 25,
      skip: skip ?? 0,
      ...(sort ? { sort } : {}),
    };

    // Validate projectId requirement. 'project' and 'audit_event' are
    // organisation-scoped; 'tool' takes aiAgentId instead.
    if (
      resourceType !== "project" &&
      resourceType !== "tool" &&
      resourceType !== "audit_event" &&
      !projectId
    ) {
      return withHints(
        { error: `projectId is required for resourceType '${resourceType}'.` },
        {
          action:
            "Use list_resources { resourceType: 'project' } to find projectIds first.",
        },
      );
    }
    if (resourceType === "tool" && !aiAgentId) {
      return withHints(
        { error: "aiAgentId is required for resourceType 'tool'." },
        {
          action:
            "Use list_resources { resourceType: 'agent', projectId } to find agents first.",
        },
      );
    }

    let items: any[];
    let total: number | undefined;
    // Set when the platform rejected the audit_event filters and this plugin
    // applied them instead, so the response can say so.
    let filteredClientSide = false;

    switch (resourceType) {
      case "project": {
        const res: any = await this.apiClient.get("/v2.0/projects", {
          params: paging,
        });
        items = res.items ?? res;
        total = res.total;
        break;
      }
      case "agent": {
        const res: any = await this.apiClient.get("/v2.0/aiagents", {
          params: { projectId, ...paging },
        });
        items = res.items ?? res;
        total = res.total;
        break;
      }
      case "flow": {
        const res: any = await this.apiClient.get("/v2.0/flows", {
          params: { projectId, ...paging },
        });
        items = res.items ?? res;
        total = res.total;
        break;
      }
      case "endpoint": {
        const res: any = await this.apiClient.get("/v2.0/endpoints", {
          params: { projectId, ...paging },
        });
        items = res.items ?? res;
        total = res.total;
        break;
      }
      case "llm_model": {
        const endpoint = data.useCase
          ? "/new/v2.0/largelanguagemodels"
          : "/v2.0/largelanguagemodels";
        const res: any = await this.apiClient.get(endpoint, {
          params: {
            projectId,
            ...(data.useCase ? { useCase: data.useCase } : {}),
            ...paging,
          },
        });
        items = res.items ?? res;
        total = res.total;
        break;
      }
      case "knowledge_store": {
        const res: any = await this.apiClient.get("/v2.0/knowledgestores", {
          params: { projectId, ...paging },
        });
        items = res.items ?? res;
        total = res.total;
        break;
      }
      case "conversation": {
        const params: any = { projectId, ...paging };
        if (data.startDate) params.startDate = data.startDate;
        if (data.endDate) params.endDate = data.endDate;
        if (data.channel) params.channel = data.channel;
        const res: any = await this.apiClient.get("/v2.0/conversations", {
          params,
        });
        items = res.items ?? res;
        total = res.total;
        break;
      }
      case "extension": {
        const res: any = await this.apiClient.get(
          `/v2.0/projects/${projectId}/extensions`,
          {
            params: paging,
          },
        );
        items = res.items ?? res;
        total = res.total;
        break;
      }
      case "function": {
        const res: any = await this.apiClient.get(
          `/v2.0/projects/${projectId}/functions`,
          {
            params: paging,
          },
        );
        items = res.items ?? res;
        total = res.total;
        break;
      }
      case "tool": {
        const resolved = await resolveFlowForAgent(this.apiClient, aiAgentId!);
        if (!resolved) {
          return withHints(
            { error: "Could not find a flow associated with this agent." },
            {
              likely_cause: "Agent was not created via create_ai_agent.",
              action: "Create the agent with create_ai_agent first.",
            },
          );
        }
        const agentFlowId = resolved.flowId;
        const nodes: any = await this.apiClient.get(
          `/v2.0/flows/${agentFlowId}/chart/nodes`,
          {
            params: { limit: 100 },
          },
        );
        const allNodes = nodes.items ?? nodes;
        items = (Array.isArray(allNodes) ? allNodes : [])
          .filter((n: any) => AI_AGENT_TOOL_TYPES.has(n.type))
          .map((n: any) => ({
            toolId: n._id || n.id,
            name: n.label || n.name,
            toolType: n.type,
            description: n.config?.description,
            ...(n.config?.knowledgeStoreId
              ? { knowledgeStoreId: n.config.knowledgeStoreId }
              : {}),
          }));
        total = items.length;
        break;
      }
      case "audit_event": {
        // Organisation-scoped, so no projectId. `actor` / `type` are sent as
        // repeatable params (axios serialises arrays as `actor[]=…`), matching
        // what GET /v2.0/auditevents documents. Both filters need the platform
        // at 2026.17.0 or newer; the catch below covers older ones.
        try {
          const res: any = await this.apiClient.get("/v2.0/auditevents", {
            params: {
              ...paging,
              ...(actor ? { actor } : {}),
              ...(eventType ? { type: eventType } : {}),
              ...(user ? { user } : {}),
            },
          });
          items = res.items ?? res;
          total = res.total;
        } catch (error: any) {
          // A 400 while either filter is set is most likely a platform older
          // than 2026.17.0 rejecting the repeatable actor[]/type[] params.
          // Recover by doing what the alternative would only have *told* the
          // caller to do — refetch without the filters and apply them here —
          // rather than sniffing the free-text error message, which misfires
          // both ways (a rejected `sort` field reads as "type", and an old
          // platform's 400 need not name either filter). If the refetch fails
          // too, the 400 was about something else and the original stands.
          if (error?.status === 400 && (actor || eventType)) {
            let retried: any;
            try {
              retried = await this.apiClient.get("/v2.0/auditevents", {
                params: { ...paging, ...(user ? { user } : {}) },
              });
            } catch {
              throw error;
            }
            const raw = retried?.items ?? retried;
            items = (Array.isArray(raw) ? raw : []).filter(
              (e: any) =>
                // `performedBy` is absent on human-performed events.
                (!actor || actor.includes(e?.performedBy?.actor ?? "human")) &&
                (!eventType || eventType.includes(e?.type)),
            );
            total = items.length;
            filteredClientSide = true;
            break;
          }
          if (error?.status === 403) return this.auditEventForbidden(error);
          throw error;
        }
        break;
      }
      default:
        throw new Error(`Unknown resourceType: ${resourceType}`);
    }

    if (!Array.isArray(items)) items = [];
    const filtered =
      resourceType === "tool" ? items : filterList(resourceType, items);

    if (resourceType === "endpoint") {
      filtered.forEach((ep: any) => {
        if (ep.URLToken)
          ep.endpointUrl = `${this.endpointBaseUrl}/${ep.URLToken}`;
      });
    }

    const result: any = { items: filtered, total: total ?? filtered.length };

    if (filteredClientSide) {
      return withHints(result, {
        warning:
          "actor / eventType were applied by this plugin, not by the platform: this Cognigy version rejected the actor[]/type[] query filters, which need 2026.17.0 or newer.",
        action:
          "Only the requested page was fetched and then filtered, so `total` counts matches within that page, not across the whole audit log. Raise `limit` or page through with `skip` to see more.",
      });
    }

    if (sort && resourceType === "tool") {
      return withHints(result, {
        warning:
          "sort was ignored: 'tool' items are read from the agent's flow chart, which has no server-side sort.",
      });
    }

    if (filtered.length === 0 && resourceType === "agent") {
      return withHints(result, {
        hint: "No agents found.",
      });
    }

    return result;
  }

  /**
   * Audit events live above any project, so a 403 here is about the API key's
   * user lacking Admin Center access rather than anything project-scoped —
   * knowledge the list and get paths both need, kept in one place so they
   * cannot drift apart.
   */
  private auditEventForbidden(error: any): any {
    return withHints(
      { error: error.message },
      {
        likely_cause:
          "Audit events are organisation-scoped; the API key's user lacks the required admin permission.",
        action: "Use an API key belonging to a user with Admin Center access.",
      },
    );
  }

  // =========================================================================
  // Tool 6: get_resource
  // =========================================================================
  async handleGetResource(args: any): Promise<any> {
    const data = schemas.getResourceSchema.parse(args);
    const { resourceType, id, raw } = data;

    const endpointMap: Record<string, string> = {
      agent: `/v2.0/aiagents/${id}`,
      flow: `/v2.0/flows/${id}`,
      endpoint: `/v2.0/endpoints/${id}`,
      project: `/v2.0/projects/${id}`,
      conversation: `/v2.0/conversations/${id}`,
      session_state: `/v2.0/sessions/${id}/state`,
      llm_model: `/v2.0/largelanguagemodels/${id}`,
      knowledge_store: `/v2.0/knowledgestores/${id}`,
      extension: `/v2.0/extensions/${id}`,
      function: `/v2.0/functions/${id}`,
      // id "me" hits GET /v2.0/users/me — the only way to learn which user the
      // API key belongs to, so `createdBy` / `lastChangedBy` ids can be
      // attributed instead of guessed.
      user: `/v2.0/users/${id}`,
      audit_event: `/v2.0/auditevents/${id}`,
    };

    const url = endpointMap[resourceType];
    if (!url) throw new Error(`Unknown resourceType: ${resourceType}`);

    let result: any;
    try {
      result = await this.apiClient.get(url);
    } catch (error: any) {
      if (resourceType === "audit_event" && error?.status === 403)
        return this.auditEventForbidden(error);
      throw error;
    }
    if (raw) return result;

    const filtered = RESOURCE_FILTERS_GET[resourceType]
      ? RESOURCE_FILTERS_GET[resourceType](result)
      : filterResponse(resourceType, result);

    if (resourceType === "endpoint" && (result as any).URLToken) {
      filtered.endpointUrl = `${this.endpointBaseUrl}/${(result as any).URLToken}`;
    }

    return filtered;
  }

  // =========================================================================
  // Tool 7: delete_resource
  // =========================================================================
  async handleDeleteResource(args: any): Promise<any> {
    const data = schemas.deleteResourceSchema.parse(args);
    const { resourceType, id, aiAgentId, cascade } = data;

    if (resourceType === "tool") {
      if (!aiAgentId) {
        return withHints(
          { error: "aiAgentId is required for resourceType 'tool'." },
          {
            action:
              "Provide aiAgentId so the handler can resolve the agent's flow.",
          },
        );
      }
      const resolved = await resolveFlowForAgent(this.apiClient, aiAgentId);
      if (!resolved) {
        return withHints(
          { error: "Could not find a flow associated with this agent." },
          {
            action: "Ensure agent was created via create_ai_agent.",
          },
        );
      }
      await this.apiClient.delete(
        `/v2.0/flows/${resolved.flowId}/chart/nodes/${id}`,
      );
      return { deleted: true, resourceType: "tool", id };
    }

    // Agents, flows and projects are never hard-deleted — they are renamed
    // with the DELETE_ prefix to mark them for manual deletion.
    if (resourceType === "agent") {
      if (cascade === false) {
        const agent: any = await this.apiClient.get(`/v2.0/aiagents/${id}`);
        const rename = await this.renameForDeletion(
          `/v2.0/aiagents/${id}`,
          agent?.name,
          `agent ${id}`,
        );
        return withHints(
          {
            markedForDeletion: true,
            alreadyMarked: rename.alreadyMarked || undefined,
            resourceType,
            id,
            name: rename.name,
          },
          {
            warning:
              "Agents cannot be deleted via this plugin. The agent was renamed to mark it for manual deletion; its endpoints and flow were left untouched (cascade: false).",
            action: "Delete the agent manually in the Cognigy UI.",
          },
        );
      }
      return this.softDeleteAgent(id);
    }

    if (resourceType === "flow" || resourceType === "project") {
      return this.markForDeletion(resourceType, id);
    }

    const deleteMap: Record<string, string> = {
      endpoint: `/v2.0/endpoints/${id}`,
      llm_model: `/v2.0/largelanguagemodels/${id}`,
      knowledge_store: `/v2.0/knowledgestores/${id}`,
      function: `/v2.0/functions/${id}`,
    };

    const url = deleteMap[resourceType];
    if (!url) throw new Error(`Unknown resourceType: ${resourceType}`);

    await this.apiClient.delete(url);
    return { deleted: true, resourceType, id };
  }

  /**
   * Rename a resource to DELETE_<name> to mark it for manual deletion.
   * Idempotent: an already-prefixed name is left unchanged.
   */
  private async renameForDeletion(
    url: string,
    currentName: string | undefined,
    resource: string,
  ): Promise<{ name: string; alreadyMarked: boolean }> {
    const name = currentName ?? "";
    if (!name.trim()) {
      throw new Error(
        `Cannot mark ${resource} for deletion: it has no name to prefix.`,
      );
    }
    if (name.startsWith(DELETE_PREFIX)) {
      return { name, alreadyMarked: true };
    }
    const newName = `${DELETE_PREFIX}${name}`.slice(
      0,
      MAX_RESOURCE_NAME_LENGTH,
    );
    await this.apiClient.patch(url, { name: newName });
    return { name: newName, alreadyMarked: false };
  }

  /**
   * Deactivate (active: false) every endpoint that references a flow, so the
   * flow stops serving traffic. Reversible in the Cognigy UI — endpoints are
   * never deleted here. `checked: false` means enumeration never ran, so
   * endpoints may still be live.
   */
  private async deactivateEndpointsForFlow(
    projectId: string,
    flowId: string,
    flowReferenceId: string | undefined,
  ): Promise<{
    deactivated: string[];
    failed: { resource: string; error: string }[];
    checked: boolean;
  }> {
    const deactivated: string[] = [];
    const failed: { resource: string; error: string }[] = [];

    if (!flowReferenceId) {
      return { deactivated, failed, checked: false };
    }

    try {
      const limit = 100;
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const eps: any = await this.apiClient.get("/v2.0/endpoints", {
          params: { projectId, limit, offset },
        });
        const epItems = eps.items ?? eps;
        if (!Array.isArray(epItems) || epItems.length === 0) {
          break;
        }

        for (const ep of epItems) {
          if (ep.flowId === flowReferenceId || ep.flowId === flowId) {
            const epId = ep._id || ep.id;
            try {
              await this.apiClient.patch(`/v2.0/endpoints/${epId}`, {
                active: false,
              });
              deactivated.push(`endpoint:${epId}`);
            } catch (e: any) {
              failed.push({
                resource: `endpoint:${epId}`,
                error: e.message ?? String(e),
              });
            }
          }
        }

        if (epItems.length < limit) {
          hasMore = false;
        } else {
          offset += limit;
        }
      }
    } catch (e: any) {
      failed.push({
        resource: `endpoints:list:${projectId}`,
        error: e?.message ?? String(e),
      });
    }

    return { deactivated, failed, checked: true };
  }

  /**
   * Flows and projects cannot be deleted via the plugin — rename them to
   * DELETE_<name> so a human can delete them manually in the Cognigy UI.
   * Flows are also taken offline first by deactivating their endpoints;
   * projects are rename-only (everything inside stays live).
   */
  private async markForDeletion(
    resourceType: "flow" | "project",
    id: string,
  ): Promise<any> {
    const url =
      resourceType === "flow" ? `/v2.0/flows/${id}` : `/v2.0/projects/${id}`;
    const current: any = await this.apiClient.get(url);

    let endpoints: {
      deactivated: string[];
      failed: { resource: string; error: string }[];
      checked: boolean;
    } | null = null;
    if (resourceType === "flow") {
      const projectId =
        current?.projectId ??
        current?.projectReference ??
        current?.project?._id ??
        current?.project?.id;
      endpoints = projectId
        ? await this.deactivateEndpointsForFlow(
            projectId,
            id,
            current?.referenceId,
          )
        : { deactivated: [], failed: [], checked: false };
    }

    const rename = await this.renameForDeletion(
      url,
      current?.name,
      `${resourceType} ${id}`,
    );

    const parts = [
      `${resourceType === "flow" ? "Flows" : "Projects"} cannot be deleted via this plugin. ${
        rename.alreadyMarked
          ? `The ${resourceType} is already marked for manual deletion as "${rename.name}".`
          : `The ${resourceType} was renamed to "${rename.name}" to mark it for manual deletion.`
      }`,
    ];
    if (endpoints) {
      if (endpoints.failed.length > 0) {
        parts.push(
          "Endpoint deactivation was incomplete — the flow may still be reachable via its endpoints (see cascade.failed).",
        );
      } else if (!endpoints.checked) {
        parts.push(
          "The flow's endpoints could not be enumerated — the flow may still be reachable via its endpoints.",
        );
      } else if (endpoints.deactivated.length > 0) {
        parts.push(
          `${endpoints.deactivated.length} endpoint(s) referencing the flow were deactivated (reversible in the Cognigy UI) to take it offline.`,
        );
      } else {
        parts.push("No endpoints referenced the flow.");
      }
    }
    if (resourceType === "project") {
      parts.push(
        "The rename takes nothing offline: flows, endpoints and agents inside the project remain live and reachable. Deactivate or delete them individually if the project must stop serving traffic.",
      );
    }

    return withHints(
      {
        markedForDeletion: true,
        alreadyMarked: rename.alreadyMarked || undefined,
        resourceType,
        id,
        name: rename.name,
        cascade: endpoints
          ? {
              deactivated: endpoints.deactivated,
              failed:
                endpoints.failed.length > 0 ? endpoints.failed : undefined,
            }
          : undefined,
      },
      {
        warning: parts.join(" "),
        action: `Delete the ${resourceType} manually in the Cognigy UI when appropriate.`,
      },
    );
  }

  /**
   * Soft-delete an AI Agent. Nothing is hard-deleted:
   * 1. Resolve the agent's flow
   * 2. Deactivate every endpoint pointing at that flow (takes the agent
   *    offline; reversible in the Cognigy UI)
   * 3. Rename the flow to DELETE_<name>
   * 4. Rename the agent to DELETE_<name>
   */
  private async softDeleteAgent(agentId: string): Promise<any> {
    const deactivated: string[] = [];
    const renamed: string[] = [];
    const failed: { resource: string; error: string }[] = [];

    const resolved = await resolveFlowForAgent(this.apiClient, agentId);
    const agent: any =
      resolved?.agent ??
      (await this.apiClient.get(`/v2.0/aiagents/${agentId}`));
    const flowId = resolved?.flowId;
    const projectId =
      agent?.projectReference ??
      agent?.projectId ??
      agent?.project?._id ??
      agent?.project?.id;

    let flow: any;
    if (flowId) {
      try {
        flow = await this.apiClient.get(`/v2.0/flows/${flowId}`);
      } catch (e: any) {
        failed.push({
          resource: `flow:${flowId}`,
          error: e?.message ?? String(e),
        });
      }
    }

    // Step 1: deactivate endpoints that reference the agent's flow
    let endpointsChecked = false;
    if (flowId && projectId) {
      const flowRef = agent?.flowReferenceId ?? flow?.referenceId;
      const eps = await this.deactivateEndpointsForFlow(
        projectId,
        flowId,
        flowRef,
      );
      endpointsChecked = eps.checked;
      deactivated.push(...eps.deactivated);
      failed.push(...eps.failed);
    }

    // Step 2: rename the flow (flows are never deleted)
    let flowRename: { name: string; alreadyMarked: boolean } | undefined;
    if (flowId && flow) {
      try {
        flowRename = await this.renameForDeletion(
          `/v2.0/flows/${flowId}`,
          flow?.name,
          `flow ${flowId}`,
        );
        if (!flowRename.alreadyMarked) renamed.push(`flow:${flowId}`);
      } catch (e: any) {
        failed.push({
          resource: `flow:${flowId}`,
          error: e.message ?? String(e),
        });
      }
    }

    // Step 3: rename the agent (agents are never deleted)
    let agentRename: { name: string; alreadyMarked: boolean } | undefined;
    try {
      agentRename = await this.renameForDeletion(
        `/v2.0/aiagents/${agentId}`,
        agent?.name,
        `agent ${agentId}`,
      );
      if (!agentRename.alreadyMarked) renamed.push(`agent:${agentId}`);
    } catch (e: any) {
      failed.push({
        resource: `agent:${agentId}`,
        error: e.message ?? String(e),
      });
    }

    // Compose the warning from what actually happened — never claim the
    // agent is offline unless endpoint deactivation fully succeeded.
    const agentMarked = agentRename !== undefined;
    const endpointFailed = failed.some(
      (f) =>
        f.resource.startsWith("endpoint:") ||
        f.resource.startsWith("endpoints:"),
    );

    const parts = ["Agents and flows cannot be deleted via this plugin."];
    parts.push(
      !agentMarked
        ? "The agent could not be renamed and is NOT marked for deletion (see cascade.failed)."
        : agentRename?.alreadyMarked
          ? "The agent already carried the DELETE_ prefix and was left unchanged."
          : "The agent was renamed with the DELETE_ prefix to mark it for manual deletion.",
    );
    if (flowRename) {
      parts.push(
        flowRename.alreadyMarked
          ? "Its flow already carried the DELETE_ prefix and was left unchanged."
          : "Its flow was renamed with the DELETE_ prefix as well.",
      );
    } else if (flowId) {
      parts.push("Its flow could not be renamed (see cascade.failed).");
    }
    if (endpointFailed) {
      parts.push(
        "Endpoint deactivation was incomplete — the agent may still be reachable (see cascade.failed).",
      );
    } else if (!endpointsChecked) {
      parts.push(
        "The agent's flow/endpoints could not be resolved, so no endpoints were deactivated — the agent may still be reachable.",
      );
    } else if (deactivated.length > 0) {
      parts.push(
        `${deactivated.length} endpoint(s) were deactivated (reversible in the Cognigy UI) to take the agent offline.`,
      );
    } else {
      parts.push("No endpoints referenced the agent's flow.");
    }

    return withHints(
      {
        markedForDeletion: agentMarked,
        alreadyMarked: agentRename?.alreadyMarked || undefined,
        resourceType: "agent",
        id: agentId,
        name: agentRename?.name,
        cascade: {
          deactivated,
          renamed,
          failed: failed.length > 0 ? failed : undefined,
        },
      },
      {
        warning: parts.join(" "),
        action: "Delete the renamed resources manually in the Cognigy UI.",
      },
    );
  }

  // =========================================================================
  // Tool 8: manage_knowledge
  // =========================================================================
  async handleManageKnowledge(args: any): Promise<any> {
    const data = schemas.manageKnowledgeSchema.parse(args);

    switch (data.operation) {
      case "create_store": {
        if (!data.projectId) {
          return withHints(
            { error: "projectId is required for create_store" },
            {
              action:
                "Use list_resources { resourceType: 'project' } to find projectIds.",
            },
          );
        }
        if (!data.name) {
          return withHints(
            { error: "name is required for create_store" },
            { action: "Provide a name for the knowledge store." },
          );
        }
        const payload: any = { projectId: data.projectId, name: data.name };
        if (data.description) payload.description = data.description;
        const result = await this.apiClient.post(
          "/v2.0/knowledgestores",
          payload,
        );
        return filterResponse("knowledge_store", result);
      }
      case "create_source": {
        if (!data.knowledgeStoreId) {
          return withHints(
            { error: "knowledgeStoreId is required for create_source" },
            {
              action:
                "Use list_resources { resourceType: 'knowledge_store', projectId } to find store IDs.",
            },
          );
        }
        const storeId = data.knowledgeStoreId;
        const sourceType =
          data.type ?? (data.url ? "url" : data.filePath ? "file" : "manual");

        if (sourceType === "file") {
          if (!data.filePath) {
            throw new Error(
              'filePath is required for type "file" — provide an absolute path to the local file',
            );
          }

          const resolvedPath = data.filePath.startsWith("~")
            ? data.filePath.replace(/^~/, process.env.HOME || "")
            : data.filePath;

          if (!existsSync(resolvedPath)) {
            throw new Error(`File not found: ${resolvedPath}`);
          }

          const fileName = basename(resolvedPath);
          const ext = fileName.split(".").pop()?.toLowerCase();
          const ALLOWED_EXTS = ["pdf", "txt", "text", "docx", "ctxt", "pptx"];
          if (!ext || !ALLOWED_EXTS.includes(ext)) {
            throw new Error(
              `Unsupported file type ".${ext}" (${fileName}). Supported: ${ALLOWED_EXTS.join(", ")}`,
            );
          }

          const fileBuffer = readFileSync(resolvedPath);

          const MAX_FILE_SIZE = 10 * 1024 * 1024;
          if (fileBuffer.length > MAX_FILE_SIZE) {
            throw new Error(
              `File too large: ${(fileBuffer.length / 1024 / 1024).toFixed(1)}MB (max 10MB). File: ${fileName}`,
            );
          }

          if (fileBuffer.length === 0) {
            throw new Error(`File is empty: ${fileName}`);
          }

          const result: any = await this.apiClient.uploadFile(
            `/v2.0/knowledgestores/${storeId}/sources/upload`,
            fileBuffer,
            fileName,
          );

          return withHints(
            {
              source: {
                taskId: result.taskData?.taskId || result._id || result.id,
                type: "file",
                fileName,
                fileSize: `${(fileBuffer.length / 1024).toFixed(0)}KB`,
                status: "ingesting",
              },
            },
            {
              warning:
                "File ingestion is async — content will be processed and chunked automatically. This may take 10-60 seconds.",
              action:
                "Wait, then use list_chunks to verify the content was ingested.",
            },
          );
        }

        if (sourceType === "url") {
          if (!data.url) {
            return withHints(
              { error: 'url is required for type "url"' },
              {
                action:
                  "Provide the url field with a valid web page URL to scrape.",
              },
            );
          }
          const payload: any = {
            name: data.name || data.url,
            type: "url",
            url: data.url,
          };
          if (data.description) payload.description = data.description;
          const result: any = await this.apiClient.post(
            `/v2.0/knowledgestores/${storeId}/sources`,
            payload,
          );
          return withHints(
            {
              source: {
                id: result.taskData?.taskId || result._id || result.id,
                type: "url",
                status: "ingesting",
              },
            },
            {
              warning:
                "URL ingestion is async — content may not be searchable for 10-60 seconds.",
              action:
                "Wait, then use list_chunks to verify the content was ingested.",
            },
          );
        }

        // Manual/text source: create source, then add a chunk with the text
        if (!data.text) {
          return withHints(
            { error: "text is required for manual sources" },
            {
              action:
                "Provide the text field with the content to store as a knowledge chunk.",
            },
          );
        }
        const sourcePayload: any = {
          name: data.name || "Manual source",
          type: "manual",
        };
        if (data.description) sourcePayload.description = data.description;
        const sourceResult: any = await this.apiClient.post(
          `/v2.0/knowledgestores/${storeId}/sources`,
          sourcePayload,
        );
        const source = sourceResult.knowledgeSource ?? sourceResult;
        const sourceId = source._id || source.id;

        const chunkResult: any = await this.apiClient.post(
          `/v2.0/knowledgestores/${storeId}/sources/${sourceId}/chunks`,
          { text: data.text, order: 1 },
        );

        return withHints(
          {
            source: { id: sourceId, type: "manual", name: sourcePayload.name },
            chunk: { id: chunkResult._id || chunkResult.id },
          },
          {
            warning:
              "Chunk created. It may take a few seconds before it becomes searchable.",
            action:
              "Wait, then use list_chunks to verify the content was ingested.",
          },
        );
      }
      case "list_chunks": {
        if (!data.knowledgeStoreId) {
          return withHints(
            { error: "knowledgeStoreId is required for list_chunks" },
            {
              action:
                "Use list_resources { resourceType: 'knowledge_store', projectId } to find store IDs.",
            },
          );
        }
        const ksId = data.knowledgeStoreId;

        let targetSourceId = data.sourceId;
        if (!targetSourceId) {
          const sources: any = await this.apiClient.get(
            `/v2.0/knowledgestores/${ksId}/sources`,
          );
          const srcItems = sources.items ?? sources;
          if (!Array.isArray(srcItems) || srcItems.length === 0) {
            return withHints(
              { chunks: [], sources: [] },
              {
                likely_cause: "No sources found in this knowledge store.",
                action: "Add a source first with create_source.",
              },
            );
          }
          targetSourceId = srcItems[0]._id || srcItems[0].id;
        }

        const params: any = { limit: data.limit ?? 25 };
        if (data.filter) params.filter = data.filter;

        const result: any = await this.apiClient.get(
          `/v2.0/knowledgestores/${ksId}/sources/${targetSourceId}/chunks`,
          { params },
        );
        const chunks = result.items ?? result;
        return {
          chunks: Array.isArray(chunks)
            ? chunks.map((c: any) => ({
                id: c._id || c.id,
                text: c.text,
                order: c.order,
                disabled: c.disabled,
              }))
            : [],
          total: result.total ?? (Array.isArray(chunks) ? chunks.length : 0),
          sourceId: targetSourceId,
        };
      }
      case "list_sources": {
        if (!data.knowledgeStoreId) {
          return withHints(
            { error: "knowledgeStoreId is required for list_sources" },
            {
              action:
                "Use list_resources { resourceType: 'knowledge_store' } to find store IDs.",
            },
          );
        }
        const sources: any = await this.apiClient.get(
          `/v2.0/knowledgestores/${data.knowledgeStoreId}/sources`,
        );
        const items = sources.items ?? sources;
        return {
          knowledgeStoreId: data.knowledgeStoreId,
          sources: (Array.isArray(items) ? items : []).map((s: any) => ({
            id: s._id || s.id,
            name: s.name,
            type: s.type,
            status: s.status,
            description: s.description,
          })),
          total: Array.isArray(items) ? items.length : 0,
        };
      }
      default:
        throw new Error(`Unknown operation: ${data.operation}`);
    }
  }

  // =========================================================================
  // Tool 9: create_tool
  // =========================================================================
  async handleCreateTool(args: any): Promise<any> {
    const data = schemas.createToolSchema.parse(args);

    // Step 1: Resolve the agent's flow
    const resolved = await resolveFlowForAgent(this.apiClient, data.aiAgentId);
    if (!resolved) {
      return withHints(
        { error: "Could not find a flow associated with this agent." },
        {
          likely_cause:
            "create_tool requires an agent created via create_ai_agent (which auto-provisions the flow).",
          action:
            "Read the tools guide, ensure agent was created via create_ai_agent, then retry.",
        },
      );
    }
    const { flowId } = resolved;

    // Step 2: Find the AI Agent Job Node
    const nodes: any = await this.apiClient.get(
      `/v2.0/flows/${flowId}/chart/nodes`,
      {
        params: { limit: 100 },
      },
    );
    const allNodes = nodes.items ?? nodes;
    const jobNode = (Array.isArray(allNodes) ? allNodes : []).find(
      (n: any) => n.type === "aiAgentJob",
    );

    if (!jobNode) {
      return withHints(
        {
          error:
            "No aiAgentJob node found in the flow. Tools must be children of an AI Agent Job node.",
        },
        {
          action:
            "Ensure the agent was created via create_ai_agent (which provisions the aiAgentJob node).",
        },
      );
    }

    const cfg = data.config;
    const requestedToolId =
      typeof cfg.toolId === "string" && cfg.toolId.trim().length > 0
        ? cfg.toolId.trim()
        : undefined;

    if (requestedToolId) {
      const duplicateTool = (Array.isArray(allNodes) ? allNodes : []).find(
        (node: any) =>
          MCP_MANAGED_TOOL_TYPES.has(node.type) &&
          (node.config?.toolId === requestedToolId ||
            node.label === requestedToolId ||
            node.name === requestedToolId),
      );

      if (duplicateTool) {
        const duplicateToolNodeId = duplicateTool._id || duplicateTool.id;
        return withHints(
          {
            toolId: duplicateToolNodeId,
            toolNodeId: duplicateToolNodeId,
            requestedToolId,
            name: duplicateTool.label || duplicateTool.name || data.name,
            toolType:
              duplicateTool.type === "knowledgeTool"
                ? "knowledge"
                : duplicateTool.type === "sendEmailTool"
                  ? "send_email"
                  : duplicateTool.type === "aiAgentJobMCPTool"
                    ? "mcp"
                    : data.toolType,
            reusedExisting: true,
          },
          {
            warning: `A tool with toolId "${requestedToolId}" already exists in this agent flow, so the existing tool was reused instead of creating a duplicate.`,
            action: `Continue by adding logic inside that tool with manage_flow_nodes using parentNodeId "${duplicateToolNodeId}", or modify it with update_tool { aiAgentId: "${data.aiAgentId}", toolNodeId: "${duplicateToolNodeId}", ... }.`,
          },
        );
      }
    }

    // Step 3: Create the tool node
    const mapping = TOOL_TYPE_MAP[data.toolType];
    if (!mapping) throw new Error(`Unknown toolType: ${data.toolType}`);

    const nodeConfig: any = {};
    let parameterWarnings: string[] = [];
    switch (data.toolType) {
      case "tool":
        if (cfg.toolId) nodeConfig.toolId = cfg.toolId;
        if (cfg.description) nodeConfig.description = cfg.description;
        if (cfg.parameters) {
          const normalized = normalizeToolParameters(cfg.parameters);
          nodeConfig.useParameters = true;
          nodeConfig.parameters = normalized.parameters;
          parameterWarnings = normalized.warnings;
        }
        break;
      case "knowledge":
        if (cfg.knowledgeStoreId)
          nodeConfig.knowledgeStoreId = cfg.knowledgeStoreId;
        if (cfg.toolId) nodeConfig.toolId = cfg.toolId;
        if (cfg.description) nodeConfig.description = cfg.description;
        if (cfg.topK) nodeConfig.topK = cfg.topK;
        break;
      case "send_email":
        if (cfg.toolId) nodeConfig.toolId = cfg.toolId;
        if (cfg.description) nodeConfig.description = cfg.description;
        if (cfg.recipient) nodeConfig.recipient = cfg.recipient;
        break;
      case "mcp":
        if (cfg.mcpName) nodeConfig.name = cfg.mcpName;
        if (cfg.mcpServerUrl) nodeConfig.mcpServerUrl = cfg.mcpServerUrl;
        if (cfg.timeout) nodeConfig.timeout = cfg.timeout;
        break;
      case "http":
        if (cfg.toolId) nodeConfig.toolId = cfg.toolId;
        if (cfg.description) nodeConfig.description = cfg.description;
        if (cfg.parameters) {
          const normalized = normalizeToolParameters(cfg.parameters);
          nodeConfig.useParameters = true;
          nodeConfig.parameters = normalized.parameters;
          parameterWarnings = normalized.warnings;
        }
        break;
    }

    // For non-http tools: create the tool node + resolve node (if required by the tool type)
    const toolLabel = cfg.toolId || data.name;
    if (data.toolType !== "http") {
      const createdNodeIds: string[] = [];
      try {
        const createdNode: any = await this.apiClient.post(
          `/v2.0/flows/${flowId}/chart/nodes`,
          {
            type: mapping.type,
            extension: mapping.extension,
            mode: "appendChild",
            target: jobNode._id,
            label: toolLabel,
            config: nodeConfig,
          },
        );
        const toolNodeId = createdNode._id || createdNode.id;
        createdNodeIds.push(toolNodeId);

        const resolveSpec = RESOLVE_NODE_MAP[data.toolType];
        let resolveNodeId: string | undefined;
        if (resolveSpec) {
          const resolveConfig: Record<string, any> = {};
          if (resolveSpec.type === "aiAgentToolAnswer") {
            resolveConfig.answer =
              cfg.toolResponseValue ?? "{{JSON.stringify(input.result)}}";
          }
          const resolveLabel =
            resolveSpec.type === "aiAgentToolAnswer"
              ? `${toolLabel} - Resolve`
              : resolveSpec.label;
          const resolveNode: any = await this.apiClient.post(
            `/v2.0/flows/${flowId}/chart/nodes`,
            {
              type: resolveSpec.type,
              extension: "@cognigy/basic-nodes",
              mode: "append",
              target: toolNodeId,
              label: resolveLabel,
              config: resolveConfig,
            },
          );
          resolveNodeId = resolveNode._id || resolveNode.id;
          if (resolveNodeId) createdNodeIds.push(resolveNodeId);
        }

        const created = {
          toolId: toolNodeId,
          name: data.name,
          toolType: data.toolType,
          ...(resolveNodeId ? { resolveNodeId } : {}),
        };
        return parameterWarnings.length > 0
          ? withHints(created, { warning: parameterWarnings.join(" ") })
          : created;
      } catch (error: any) {
        const rolledBack: string[] = [];
        const rollbackFailed: string[] = [];
        for (const nodeId of createdNodeIds.reverse()) {
          try {
            await this.apiClient.delete(
              `/v2.0/flows/${flowId}/chart/nodes/${nodeId}`,
            );
            rolledBack.push(nodeId);
          } catch {
            rollbackFailed.push(nodeId);
          }
        }
        const action =
          rollbackFailed.length > 0
            ? `Rollback partially failed — orphaned node IDs: [${rollbackFailed.join(", ")}]. Delete them with delete_resource { resourceType: 'tool', id, aiAgentId }, then retry.`
            : "Check tool type and config, then retry.";
        return withHints({ error: error.message }, { action });
      }
    }

    // HTTP tool: parent aiAgentJobTool + child httpRequest (+ optional Code nodes)
    if (!cfg.url) {
      return withHints(
        { error: "url is required in config for http tool type." },
        {
          action: "Provide config.url and retry.",
        },
      );
    }

    const createdNodeIds: string[] = [];
    try {
      // 1. Create the tool node as a child of the Job Node
      const toolNode: any = await this.apiClient.post(
        `/v2.0/flows/${flowId}/chart/nodes`,
        {
          type: mapping.type,
          extension: mapping.extension,
          mode: "appendChild",
          target: jobNode._id,
          label: toolLabel,
          config: nodeConfig,
        },
      );
      const toolNodeId = toolNode._id || toolNode.id;
      createdNodeIds.push(toolNodeId);

      // 2. Create the Resolve Tool node — must be created before the HTTP node
      //    so the flow tree is wired correctly (matches UI creation order).
      const resolveAnswer =
        cfg.toolResponseValue || "{{JSON.stringify(input.httprequest)}}";
      const resolveNode: any = await this.apiClient.post(
        `/v2.0/flows/${flowId}/chart/nodes`,
        {
          type: "aiAgentToolAnswer",
          extension: "@cognigy/basic-nodes",
          mode: "append",
          target: toolNodeId,
          label: `${toolLabel} - Resolve`,
          config: {
            answer: resolveAnswer,
          },
        },
      );
      const resolveNodeId = resolveNode._id || resolveNode.id;
      createdNodeIds.push(resolveNodeId);

      // 3. Create optional pre-process Code node
      let preProcessNodeId: string | undefined;
      if (cfg.preProcessCode) {
        const preNode: any = await this.apiClient.post(
          `/v2.0/flows/${flowId}/chart/nodes`,
          {
            type: "code",
            extension: "@cognigy/basic-nodes",
            mode: "append",
            target: toolNodeId,
            label: `${toolLabel} - Pre-Process`,
            config: { code: cfg.preProcessCode },
          },
        );
        preProcessNodeId = preNode._id || preNode.id;
        if (preProcessNodeId) createdNodeIds.push(preProcessNodeId);
      }

      // 4. Create the HTTP Request node
      const httpConfig = buildHttpNodeConfig({
        url: cfg.url,
        method: cfg.method,
        headers: cfg.headers,
        body: cfg.body,
      });
      const httpNode: any = await this.apiClient.post(
        `/v2.0/flows/${flowId}/chart/nodes`,
        {
          type: "httpRequest",
          extension: "@cognigy/basic-nodes",
          mode: "append",
          target: preProcessNodeId ?? toolNodeId,
          label: `${toolLabel} - HTTP Request`,
          config: httpConfig,
        },
      );
      const httpNodeId = httpNode._id || httpNode.id;
      createdNodeIds.push(httpNodeId);

      // 5. Create optional post-process Code node
      let postProcessNodeId: string | undefined;
      if (cfg.postProcessCode) {
        const postNode: any = await this.apiClient.post(
          `/v2.0/flows/${flowId}/chart/nodes`,
          {
            type: "code",
            extension: "@cognigy/basic-nodes",
            mode: "append",
            target: httpNodeId,
            label: `${toolLabel} - Post-Process`,
            config: { code: cfg.postProcessCode },
          },
        );
        postProcessNodeId = postNode._id || postNode.id;
        if (postProcessNodeId) createdNodeIds.push(postProcessNodeId);
      }

      const createdHttp = {
        toolId: toolNodeId,
        name: data.name,
        toolType: "http",
        childNodes: {
          ...(preProcessNodeId ? { preProcessNodeId } : {}),
          httpNodeId,
          ...(postProcessNodeId ? { postProcessNodeId } : {}),
          resolveNodeId,
        },
      };
      return parameterWarnings.length > 0
        ? withHints(createdHttp, { warning: parameterWarnings.join(" ") })
        : createdHttp;
    } catch (error: any) {
      const rolledBack: string[] = [];
      const rollbackFailed: string[] = [];
      for (const nodeId of createdNodeIds.reverse()) {
        try {
          await this.apiClient.delete(
            `/v2.0/flows/${flowId}/chart/nodes/${nodeId}`,
          );
          rolledBack.push(nodeId);
        } catch {
          rollbackFailed.push(nodeId);
        }
      }
      const action =
        rollbackFailed.length > 0
          ? `Rollback partially failed — orphaned node IDs: [${rollbackFailed.join(", ")}]. Delete them with delete_resource { resourceType: 'tool', id, aiAgentId }, then retry.`
          : "Check HTTP config and code snippets, then retry.";
      return withHints({ error: error.message }, { action });
    }
  }

  // =========================================================================
  // Tool 10: update_tool
  // =========================================================================
  async handleUpdateTool(args: any): Promise<any> {
    const data = schemas.updateToolSchema.parse(args);

    const resolved = await resolveFlowForAgent(this.apiClient, data.aiAgentId);
    if (!resolved) {
      return withHints(
        { error: "Could not find a flow associated with this agent." },
        {
          likely_cause:
            "update_tool requires an agent created via create_ai_agent.",
          action: "Ensure agent was created via create_ai_agent, then retry.",
        },
      );
    }
    const { flowId } = resolved;

    if (!data.name && !data.config) {
      return withHints(
        { error: "Nothing to update. Provide at least name or config." },
        { action: "Include fields to update in the request." },
      );
    }

    const updatedFields: string[] = [];
    const cfg = data.config;
    const toolType = data.toolType;

    // Detect whether config contains HTTP child-node fields
    const hasHttpUpdates =
      cfg && (cfg.url || cfg.method || cfg.headers || cfg.body);
    const hasCodeUpdates =
      cfg &&
      (cfg.preProcessCode !== undefined || cfg.postProcessCode !== undefined);
    const hasResolveUpdate = cfg && cfg.toolResponseValue !== undefined;
    const hasChildUpdates =
      hasHttpUpdates || hasCodeUpdates || hasResolveUpdate;

    // Step 1: Update the tool node itself (label and/or tool-node config)
    const patchPayload: any = {};
    let parameterWarnings: string[] = [];
    if (data.name) patchPayload.label = data.name;

    if (cfg) {
      const nodeConfig: any = {};

      if (toolType === "tool" || toolType === "http" || !toolType) {
        if (cfg.toolId) nodeConfig.toolId = cfg.toolId;
        if (cfg.description) nodeConfig.description = cfg.description;
        if (cfg.parameters) {
          const normalized = normalizeToolParameters(cfg.parameters);
          nodeConfig.useParameters = true;
          nodeConfig.parameters = normalized.parameters;
          parameterWarnings = normalized.warnings;
        }
      }
      if (toolType === "knowledge") {
        if (cfg.knowledgeStoreId)
          nodeConfig.knowledgeStoreId = cfg.knowledgeStoreId;
        if (cfg.toolId) nodeConfig.toolId = cfg.toolId;
        if (cfg.description) nodeConfig.description = cfg.description;
        if (cfg.topK) nodeConfig.topK = cfg.topK;
      }
      if (toolType === "send_email") {
        if (cfg.toolId) nodeConfig.toolId = cfg.toolId;
        if (cfg.description) nodeConfig.description = cfg.description;
        if (cfg.recipient) nodeConfig.recipient = cfg.recipient;
      }
      if (toolType === "mcp") {
        if (cfg.mcpName) nodeConfig.name = cfg.mcpName;
        if (cfg.mcpServerUrl) nodeConfig.mcpServerUrl = cfg.mcpServerUrl;
        if (cfg.timeout) nodeConfig.timeout = cfg.timeout;
      }

      if (Object.keys(nodeConfig).length > 0) {
        patchPayload.config = nodeConfig;
      }
    }

    if (Object.keys(patchPayload).length > 0) {
      await this.apiClient.patch(
        `/v2.0/flows/${flowId}/chart/nodes/${data.toolNodeId}`,
        patchPayload,
      );
      if (data.name) updatedFields.push("name");
      if (patchPayload.config) updatedFields.push("config");
    }

    // Step 2: Update child nodes for http tools (httpRequest + Code nodes)
    const skippedUpdates: string[] = [];
    if (hasChildUpdates && cfg) {
      const nodes: any = await this.apiClient.get(
        `/v2.0/flows/${flowId}/chart/nodes`,
        {
          params: { limit: 200 },
        },
      );
      const rawNodes = nodes.items ?? nodes;
      const allNodes = Array.isArray(rawNodes) ? rawNodes : [];

      const toolNode = allNodes.find(
        (n) => (n._id || n.id) === data.toolNodeId,
      );
      const toolLabel: string = toolNode?.label ?? "";

      const findById = (id?: string) =>
        id ? allNodes.find((n) => (n._id || n.id) === id) : undefined;
      const findByLabelSuffix = (suffix: string, type: string) => {
        if (!toolLabel) return undefined;
        const target = `${toolLabel} - ${suffix}`;
        return allNodes.find((n) => n.type === type && n.label === target);
      };

      if (hasHttpUpdates) {
        const httpNode =
          findById(cfg.httpNodeId) ??
          findByLabelSuffix("HTTP Request", "httpRequest");
        if (httpNode) {
          const httpPatch = buildHttpNodeConfig({
            url: cfg.url,
            method: cfg.method,
            headers: cfg.headers,
            body: cfg.body,
          });
          if (Object.keys(httpPatch).length > 0) {
            await this.apiClient.patch(
              `/v2.0/flows/${flowId}/chart/nodes/${httpNode._id || httpNode.id}`,
              { config: httpPatch },
            );
            updatedFields.push("http");
          }
        } else {
          skippedUpdates.push(
            "HTTP node not found — pass config.httpNodeId (from create_tool's childNodes.httpNodeId) to update it explicitly",
          );
        }
      }

      if (cfg.preProcessCode !== undefined) {
        const preNode =
          findById(cfg.preProcessNodeId) ??
          findByLabelSuffix("Pre-Process", "code");
        if (preNode) {
          await this.apiClient.patch(
            `/v2.0/flows/${flowId}/chart/nodes/${preNode._id || preNode.id}`,
            { config: { code: cfg.preProcessCode } },
          );
          updatedFields.push("preProcessCode");
        } else if (cfg.preProcessNodeId) {
          skippedUpdates.push(
            "Pre-process Code node with the provided preProcessNodeId was not found",
          );
        } else if (toolNode) {
          await this.apiClient.post(`/v2.0/flows/${flowId}/chart/nodes`, {
            type: "code",
            extension: "@cognigy/basic-nodes",
            mode: "append",
            target: data.toolNodeId,
            label: `${toolLabel} - Pre-Process`,
            config: { code: cfg.preProcessCode },
          });
          updatedFields.push("preProcessCode");
        } else {
          skippedUpdates.push(
            "Tool node not found — cannot provision pre-process Code node",
          );
        }
      }

      if (cfg.postProcessCode !== undefined) {
        const postNode =
          findById(cfg.postProcessNodeId) ??
          findByLabelSuffix("Post-Process", "code");
        if (postNode) {
          await this.apiClient.patch(
            `/v2.0/flows/${flowId}/chart/nodes/${postNode._id || postNode.id}`,
            { config: { code: cfg.postProcessCode } },
          );
          updatedFields.push("postProcessCode");
        } else if (cfg.postProcessNodeId) {
          skippedUpdates.push(
            "Post-process Code node with the provided postProcessNodeId was not found",
          );
        } else {
          const httpAnchor =
            findById(cfg.httpNodeId) ??
            findByLabelSuffix("HTTP Request", "httpRequest");
          if (httpAnchor) {
            await this.apiClient.post(`/v2.0/flows/${flowId}/chart/nodes`, {
              type: "code",
              extension: "@cognigy/basic-nodes",
              mode: "append",
              target: httpAnchor._id || httpAnchor.id,
              label: `${toolLabel} - Post-Process`,
              config: { code: cfg.postProcessCode },
            });
            updatedFields.push("postProcessCode");
          } else {
            skippedUpdates.push(
              "HTTP Request node not found — cannot provision post-process Code node (it is wired after the HTTP Request)",
            );
          }
        }
      }

      if (cfg.toolResponseValue !== undefined) {
        const resolveCandidates = allNodes.filter(
          (n) => n.type === "aiAgentToolAnswer",
        );
        const resolveNode =
          findById(cfg.resolveNodeId) ??
          findByLabelSuffix("Resolve", "aiAgentToolAnswer") ??
          (resolveCandidates.length === 1 ? resolveCandidates[0] : undefined);
        if (resolveNode) {
          await this.apiClient.patch(
            `/v2.0/flows/${flowId}/chart/nodes/${resolveNode._id || resolveNode.id}`,
            { config: { answer: cfg.toolResponseValue } },
          );
          updatedFields.push("toolResponseValue");
        } else if (resolveCandidates.length > 1) {
          skippedUpdates.push(
            `Multiple Resolve Tool Action nodes exist and none matched the label "${toolLabel} - Resolve" — pass config.resolveNodeId (from create_tool's childNodes.resolveNodeId) to pick one`,
          );
        } else {
          skippedUpdates.push(
            "Resolve Tool Action node not found — pass config.resolveNodeId to update it explicitly",
          );
        }
      }
    }

    const response: any = {
      toolId: data.toolNodeId,
      name: data.name ?? undefined,
      updated: true,
      updatedFields,
    };

    if (skippedUpdates.length > 0) {
      return withHints(response, {
        warning: [
          `Some updates were skipped: ${skippedUpdates.join("; ")}`,
          ...parameterWarnings,
        ].join(" "),
        action:
          "Child nodes may not exist yet. Use create_tool with http type to create the full node tree, or verify the tool structure.",
      });
    }

    return parameterWarnings.length > 0
      ? withHints(response, { warning: parameterWarnings.join(" ") })
      : response;
  }

  // =========================================================================
  // Tool 12: manage_flow_nodes
  // =========================================================================
  async handleManageFlowNodes(args: any): Promise<any> {
    const data = schemas.manageFlowNodesSchema.parse(args);
    const { flowId, operation } = data;

    switch (operation) {
      // ----- LIST -----
      case "list": {
        const nodes: any = await this.apiClient.get(
          `/v2.0/flows/${flowId}/chart/nodes`,
          {
            params: { limit: 200 },
          },
        );
        const items = nodes.items ?? nodes;
        if (!Array.isArray(items)) return { nodes: [] };

        return {
          nodes: items.map((n: any) => ({
            id: n._id || n.id,
            type: n.type,
            label: n.label,
            parentId: n.parentId ?? null,
            isEntryPoint: n.isEntryPoint ?? false,
          })),
        };
      }

      // ----- GET -----
      case "get": {
        if (!data.nodeId) {
          return withHints(
            { error: "nodeId is required for get operation." },
            {
              action:
                'Use manage_flow_nodes { operation: "list", flowId } to find node IDs.',
            },
          );
        }

        const node: any = await this.apiClient.get(
          `/v2.0/flows/${flowId}/chart/nodes/${data.nodeId}`,
        );
        const detail = filterFlowNodeDetail(node);

        // Code nodes are TypeScript, transpiled server-side at save time.
        // hasError = true means the last saved code did not compile.
        if (detail.config?.hasError) {
          return withHints(detail, {
            warning:
              "config.hasError is true — the last saved code failed to transpile (TypeScript/syntax error).",
            action: "Fix the code and update the node.",
          });
        }
        return detail;
      }

      // ----- CREATE -----
      case "create": {
        if (!data.nodeType) {
          return withHints(
            { error: "nodeType is required for create operation." },
            {
              action: "Read the flow-nodes guide for supported node types.",
            },
          );
        }

        const entry = getNodeEntry(data.nodeType);
        if (!entry) {
          return withHints(
            {
              error: `Unsupported nodeType: "${data.nodeType}". Supported types: ${supportedNodeTypes().join(", ")}`,
            },
            {
              action:
                "Read the flow-nodes guide for the full list and config schemas.",
            },
          );
        }

        if (!data.label) {
          return withHints(
            { error: "label is required for create operation." },
            { action: "Provide a display label for the node." },
          );
        }

        const cfg = data.config ?? {};
        const aliasMap: Record<string, string[]> = {
          milliseconds: ["milliseconds", "delay"],
          key: ["key", "contextEntries"],
          value: ["value", "contextEntries"],
        };
        const missingKeys = entry.requiredConfigKeys.filter((k) => {
          const aliases = aliasMap[k] ?? [k];
          return !aliases.some((a) => cfg[a] !== undefined);
        });
        if (missingKeys.length > 0) {
          const missingKeyLabels = missingKeys.map((k) => {
            const aliases = aliasMap[k] ?? [k];
            return aliases.length > 1 ? aliases.join(" / ") : aliases[0];
          });
          return withHints(
            {
              error: `Missing required config keys for ${data.nodeType}: ${missingKeyLabels.join(", ")}`,
            },
            {
              action: `Provide the required config fields: ${missingKeyLabels.join(", ")}`,
            },
          );
        }

        const targetNodeId = data.parentNodeId;
        let mode = data.mode ?? "append";

        if (!targetNodeId) {
          return withHints(
            { error: "parentNodeId is required for create operation." },
            {
              action:
                "Specify the parentNodeId of a node inside the appropriate tool branch where the new node should be created.",
            },
          );
        }

        // Auto-rewrite appendChild → append for node types where appendChild
        // creates orphaned nodes (parentId: null).  This covers:
        //   • aiAgentJobTool — so nodes land in the tool's execution chain
        //   • then / else / case / default — branching children of if and switch
        const REWRITE_TYPES = new Set([
          "aiAgentJobTool",
          "then",
          "else",
          "case",
          "default",
        ]);
        if (mode === "appendChild" && targetNodeId) {
          try {
            const targetCheck: any = await this.apiClient.get(
              `/v2.0/flows/${flowId}/chart/nodes/${targetNodeId}`,
            );
            if (targetCheck && REWRITE_TYPES.has(targetCheck.type)) {
              mode = "append";
            }
          } catch {
            // If the check fails, proceed with the original mode.
          }
        }

        // xApp guardrail: every xApp node except initAppSession needs a
        // preceding initAppSession node — it creates the session and populates
        // input.apps.url. If none exists in the flow yet, warn (non-blocking).
        const XAPP_DEPENDENT_TYPES = new Set([
          "setHTMLAppState",
          "setAdaptiveCardAppState",
          "setAppState",
          "getAppSessionPin",
        ]);
        let missingInitAppSession = false;
        if (XAPP_DEPENDENT_TYPES.has(entry.type)) {
          try {
            const existing: any = await this.apiClient.get(
              `/v2.0/flows/${flowId}/chart/nodes`,
              { params: { limit: 200 } },
            );
            const nodes: any[] = existing?.items ?? existing ?? [];
            missingInitAppSession =
              Array.isArray(nodes) &&
              !nodes.some((n: any) => n?.type === "initAppSession");
          } catch {
            // If the check fails, skip the warning and proceed.
          }
        }

        const apiConfig = data.config
          ? transformConfigForApi(entry.type, data.config)
          : undefined;

        const createdNode: any = await this.apiClient.post(
          `/v2.0/flows/${flowId}/chart/nodes`,
          {
            type: entry.type,
            extension: entry.extension,
            mode,
            target: targetNodeId,
            label: data.label,
            ...(apiConfig && Object.keys(apiConfig).length > 0
              ? { config: apiConfig }
              : {}),
          },
        );

        const nodeId = createdNode._id || createdNode.id;
        const actualParentId =
          createdNode.parentId ??
          createdNode.parent_id ??
          (createdNode.parent &&
            (createdNode.parent._id || createdNode.parent.id));

        const result = {
          nodeId,
          type: entry.type,
          label: data.label,
          ...(actualParentId ? { parentId: actualParentId } : {}),
          targetNodeId,
          mode,
          configApplied: data.config ? Object.keys(data.config) : [],
        };

        if (missingInitAppSession) {
          return withRenderSuggestion(
            withHints(result, {
              warning:
                "No xApp: Init Session (initAppSession) node exists in this flow. Every xApp node needs one, and it must run before this node — it creates the session and populates input.apps.url. (This check only verifies presence, not execution order.)",
              action:
                "Add an initAppSession node and ensure it runs before this xApp node (earlier in the same tool branch).",
            }),
            flowId,
            nodeId,
          );
        }

        return withRenderSuggestion(result, flowId, nodeId);
      }

      // ----- UPDATE -----
      case "update": {
        if (!data.nodeId) {
          return withHints(
            { error: "nodeId is required for update operation." },
            {
              action:
                'Use manage_flow_nodes { operation: "list", flowId } to find node IDs.',
            },
          );
        }

        if (!data.config && !data.label) {
          return withHints(
            { error: "Nothing to update. Provide at least label or config." },
            { action: "Include fields to update in the request." },
          );
        }

        const patchPayload: any = {};
        if (data.label) patchPayload.label = data.label;
        if (data.config) {
          const existingNode: any = await this.apiClient.get(
            `/v2.0/flows/${flowId}/chart/nodes/${data.nodeId}`,
          );
          const nodeType = existingNode?.type ?? "";

          // Strip server-computed, read-only fields before merging them back
          // into the PATCH. `transpiled` (a code node's compiled JS) can be
          // ~200k chars, and echoing `hasError` back is meaningless.
          const existingConfig = { ...(existingNode?.config ?? {}) };
          delete existingConfig.transpiled;
          delete existingConfig.hasError;
          if (existingConfig.mock && typeof existingConfig.mock === "object") {
            existingConfig.mock = { ...existingConfig.mock };
            delete existingConfig.mock.transpiled;
            delete existingConfig.mock.hasError;
          }

          // Handle case node updates — the Cognigy API expects exactly
          // { config: { case: { value: "..." } } } with no extra fields merged in.
          if (nodeType === "case") {
            if (data.config.value !== undefined) {
              patchPayload.config = { case: { value: data.config.value } };
            }
          }
          // Handle switch node updates — if cases array is provided, patch each
          // child case node with its value, then update the switch node itself.
          else if (nodeType === "switch" && Array.isArray(data.config.cases)) {
            const casesToUpdate = data.config.cases;
            const caseResults: any[] = [];
            for (const c of casesToUpdate) {
              if (!c.id || c.value === undefined) continue;
              try {
                await this.apiClient.patch(
                  `/v2.0/flows/${flowId}/chart/nodes/${c.id}`,
                  { config: { case: { value: c.value } } },
                );
                caseResults.push({ id: c.id, value: c.value, updated: true });
              } catch (err: any) {
                caseResults.push({
                  id: c.id,
                  value: c.value,
                  updated: false,
                  error: err.message,
                });
              }
            }
            // Update the switch node itself (without the cases array)
            const { cases: _cases, ...switchConfig } = data.config;
            if (Object.keys(switchConfig).length > 0) {
              const transformed = transformConfigForApi(nodeType, switchConfig);
              patchPayload.config = deepMerge(existingConfig, transformed);
            }
            if (Object.keys(patchPayload).length > 0) {
              await this.apiClient.patch(
                `/v2.0/flows/${flowId}/chart/nodes/${data.nodeId}`,
                patchPayload,
              );
            }
            return withRenderSuggestion(
              {
                updated: true,
                nodeId: data.nodeId,
                ...(data.label ? { label: data.label } : {}),
                ...(data.config
                  ? { configUpdated: Object.keys(data.config) }
                  : {}),
                casesUpdated: caseResults,
              },
              flowId,
              data.nodeId,
            );
          } else {
            const transformed = transformConfigForApi(nodeType, data.config);
            patchPayload.config = deepMerge(existingConfig, transformed);
          }
        }

        await this.apiClient.patch(
          `/v2.0/flows/${flowId}/chart/nodes/${data.nodeId}`,
          patchPayload,
        );

        const result = {
          updated: true,
          nodeId: data.nodeId,
          ...(data.label ? { label: data.label } : {}),
          ...(data.config ? { configUpdated: Object.keys(data.config) } : {}),
        };

        // The PATCH response echoes the input config without the server-computed
        // `hasError` (transpilation runs after the write). When code was edited,
        // read the node back to detect a transpile failure and surface it.
        if (data.config?.code !== undefined) {
          try {
            const saved: any = await this.apiClient.get(
              `/v2.0/flows/${flowId}/chart/nodes/${data.nodeId}`,
            );
            if (saved?.config?.hasError) {
              return withRenderSuggestion(
                withHints(result, {
                  warning:
                    "Node saved, but config.hasError is true — the code failed to transpile (TypeScript/syntax error).",
                  action: "Fix the code and update again.",
                }),
                flowId,
                data.nodeId,
              );
            }
          } catch {
            // Non-fatal — the update itself succeeded.
          }
        }
        return withRenderSuggestion(result, flowId, data.nodeId);
      }

      // ----- DELETE -----
      case "delete": {
        if (!data.nodeId) {
          return withHints(
            { error: "nodeId is required for delete operation." },
            {
              action:
                'Use manage_flow_nodes { operation: "list", flowId } to find node IDs.',
            },
          );
        }

        await this.apiClient.delete(
          `/v2.0/flows/${flowId}/chart/nodes/${data.nodeId}`,
        );

        // No focus on delete — the node is gone; just suggest a fresh render.
        return withRenderSuggestion(
          { deleted: true, nodeId: data.nodeId },
          flowId,
        );
      }

      // ----- RENDER -----
      case "render": {
        // Topology (start→next chain + children) comes from the chart endpoint;
        // node labels come from the node-list endpoint. Merge the two.
        let chart: any;
        try {
          chart = await this.apiClient.get(`/new/v2.0/flows/${flowId}/chart`);
        } catch {
          return withHints(
            { error: "Could not load flow chart." },
            {
              action:
                "Verify flowId. Use list_resources { resourceType: 'flow', projectId }.",
            },
          );
        }

        try {
          const list: any = await this.apiClient.get(
            `/v2.0/flows/${flowId}/chart/nodes`,
            { params: { limit: 200 } },
          );
          const items = list.items ?? list;
          if (Array.isArray(items)) {
            const labelById = new Map<string, string>(
              items.map((n: any) => [n._id || n.id, n.label]),
            );
            for (const n of chart.nodes ?? []) {
              const id = n._id || n.id;
              const lbl = labelById.get(id);
              if (!n.label && lbl) n.label = lbl;
            }
          }
        } catch {
          // Labels are optional — the serializer falls back to preview/type.
        }

        const format = data.format ?? "both";
        const showLegend = data.legend ?? true;
        const result: any = {};
        if (format === "ascii" || format === "both") {
          result.ascii = chartToAscii(chart, data.focus);
        }
        if (format === "mermaid" || format === "both") {
          result.mermaid = chartToMermaid(chart, data.focus, {
            legend: showLegend,
          });
        }
        // A shape/edge key for exactly the elements present in this flow (the
        // model can print it as a short list; the HTML always draws it).
        if (showLegend) result.legend = chartLegend(chart);

        if (data.writeHtml) {
          const html = chartToHtml(chart, {
            title: `Flow ${flowId}`,
            focusId: data.focus,
            mermaidJs: loadMermaidJs(), // inline for offline; undefined → CDN
          });
          const file = join(tmpdir(), `cognigy-flow-${flowId}.html`);
          writeFileSync(file, html, "utf8");
          result.htmlPath = file;
          result.htmlUrl = pathToFileURL(file).href;

          // Open the file in the user's default browser by default whenever an
          // HTML view is written — the whole point of writeHtml is to look at
          // it. Safe: the MCP server runs on the user's own machine. Pass
          // openInBrowser:false to only get the path back without opening.
          if (data.openInBrowser !== false) {
            try {
              const isWin = process.platform === "win32";
              const opener = isWin
                ? "start"
                : process.platform === "darwin"
                  ? "open"
                  : "xdg-open";
              // On Windows `start` is a cmd.exe builtin whose first quoted arg
              // is the window TITLE — pass an empty title so a path containing
              // spaces isn't swallowed as the title and the file still opens.
              const openerArgs = isWin ? ['""', file] : [file];
              spawn(opener, openerArgs, {
                detached: true,
                stdio: "ignore",
                shell: isWin,
              }).unref();
              result.opened = true;
            } catch {
              result.opened = false;
            }
          }
        }

        const baseAction =
          "CRITICAL — how to deliver the diagram so it renders natively (zoomable, mobile-friendly): create a native Mermaid/diagram ARTIFACT whose content is EXACTLY the `mermaid` string (titled e.g. Flow: <flow name>). Only a native mermaid artifact produces the interactive 'Download and open · MERMAID' card that works on phones. HARD RULES: (1) Do NOT wrap the mermaid in an HTML page/artifact or a generic HTML 'visualize' widget/connector — an HTML-embedded diagram is not mobile-friendly and is the wrong result. (2) Do NOT paste the mermaid as an inline ```mermaid fenced code block — it renders as plain text or a tiny thumbnail. Use ONLY a native mermaid-type artifact. Keep ALL other content — commentary, the `legend`, the `ascii` tree — OUTSIDE the artifact, in the normal message text. The `ascii` tree is only a fallback for clients with no mermaid-artifact support at all (e.g. a terminal); the rich HTML file (writeHtml) is only for opening in a desktop browser, never for rendering inside the chat.";

        const htmlAction = result.htmlUrl
          ? ` A rich, zoomable HTML view was written to the user's OWN local machine (this MCP server runs locally, on the same computer as the user) — it is NOT in your sandbox and needs no upload. Do NOT try to read, fetch, open, download, or "package" the file, and do NOT regenerate it yourself — it is already complete and self-contained.${
              result.opened
                ? " It was opened in the user's default browser automatically; also give them the `htmlUrl`/`htmlPath` in case it did not."
                : ' Simply tell the user to open it in a browser, giving them the `htmlUrl` (a file:// link) and the plain `htmlPath`, e.g. "Open this in your browser: <htmlUrl>".'
            }`
          : ` Then, on its own line, proactively offer the rich view — e.g. "Want a rich, zoomable HTML diagram you can open in a browser? (yes)". If the user agrees, re-call this operation with writeHtml:true (it opens in the browser automatically), same flowId/focus. The file is written to the user's own machine; just hand them the returned htmlUrl/htmlPath — do not try to access it yourself.`;

        return withHints(result, { action: baseAction + htmlAction });
      }

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }

  // =========================================================================
  // Tool 11: manage_webchat
  // =========================================================================
  async handleManageWebchat(args: any): Promise<any> {
    const data = schemas.manageWebchatSchema.parse(args);

    const webchatSettings = buildWebchatSettings(data);
    const settingsKeys = Object.keys(webchatSettings).filter(
      (k) => k !== "demoWebchat",
    );
    const hasSettings = settingsKeys.length > 0;

    let endpointId = data.endpointId ?? null;

    // CREATE when no endpointId provided, UPDATE when endpointId is explicit
    if (!endpointId) {
      if (!data.projectId) {
        return withHints(
          { error: "projectId is required to create a webchat endpoint." },
          {
            action:
              "Provide projectId. Use list_resources { resourceType: 'project' } to find one.",
          },
        );
      }
      if (!data.flowId) {
        return withHints(
          {
            error:
              "flowId is required to create a webchat endpoint. To update an existing one, provide endpointId instead.",
          },
          {
            action:
              "Provide flowId. Use list_resources { resourceType: 'flow', projectId } to find one, or create an agent first with create_ai_agent.",
          },
        );
      }

      const localeId = await resolveEndpointLocaleId(
        this.apiClient,
        data.projectId,
        data.flowId,
      );

      const createPayload: any = {
        projectId: data.projectId,
        entrypoint: data.projectId,
        channel: "webchat3",
        flowId: data.flowId,
        name: data.name || "Webchat",
        targetType: "flow",
        agentId: "",
      };
      if (localeId) createPayload.localeId = localeId;

      try {
        const createdEndpoint: any = await this.apiClient.post(
          "/v2.0/endpoints",
          createPayload,
        );
        endpointId = createdEndpoint._id || createdEndpoint.id;

        // Re-fetch to guarantee URLToken and full settings are available
        let endpoint: any = await this.apiClient.get(
          `/v2.0/endpoints/${endpointId}`,
        );

        let settingsApplied = false;
        if (hasSettings) {
          try {
            const mergedSettings = this.mergeWebchatSettings(
              endpoint.settings ?? {},
              webchatSettings,
            );
            await this.apiClient.patch(`/v2.0/endpoints/${endpointId}`, {
              settings: mergedSettings,
            });
            endpoint = await this.apiClient.get(
              `/v2.0/endpoints/${endpointId}`,
            );
            settingsApplied = true;
          } catch {
            // Settings patch failed but endpoint was created — continue
          }
        }

        const response = this.buildWebchatResponse({
          created: true,
          endpointId: endpointId!,
          endpoint,
          settingsKeys: settingsApplied ? settingsKeys : [],
        });
        if (hasSettings && !settingsApplied) {
          return withHints(response, {
            warning: "Endpoint created but settings failed to apply.",
            action: `Retry settings by calling manage_webchat { endpointId: "${endpointId}", ...settings }`,
          });
        }
        return response;
      } catch (error: any) {
        return withHints(
          { error: `Failed to create webchat endpoint: ${error.message}` },
          {
            action: "Check projectId and flowId, then retry.",
          },
        );
      }
    }

    // UPDATE: patch existing endpoint
    if (!data.name && !hasSettings) {
      const ep = await this.safeGetEndpoint(endpointId);
      if (ep) {
        return this.buildWebchatResponse({
          endpointId: endpointId!,
          endpoint: ep,
          settingsKeys: [],
          note: "No changes requested. Returning current endpoint info.",
        });
      }
      return withHints(
        {
          error:
            "Nothing to update. Provide at least one setting group or name.",
        },
        {
          action:
            "Include layout, behavior, homeScreen, or other setting groups.",
        },
      );
    }

    try {
      // Read-merge-write: fetch full settings, merge our changes, send complete object
      const fullEndpoint: any = await this.apiClient.get(
        `/v2.0/endpoints/${endpointId}`,
      );
      const existingSettings = fullEndpoint.settings ?? {};
      const mergedSettings = this.mergeWebchatSettings(
        existingSettings,
        webchatSettings,
      );

      const patchPayload: any = { settings: mergedSettings };
      if (data.name) patchPayload.name = data.name;
      if (data.flowId) patchPayload.flowId = data.flowId;

      await this.apiClient.patch(`/v2.0/endpoints/${endpointId}`, patchPayload);
      const endpoint: any = await this.apiClient.get(
        `/v2.0/endpoints/${endpointId}`,
      );

      return this.buildWebchatResponse({
        updated: true,
        endpointId: endpointId!,
        endpoint,
        settingsKeys,
      });
    } catch (error: any) {
      return withHints(
        { error: `Failed to update webchat endpoint: ${error.message}` },
        {
          action: "Verify endpointId and settings, then retry.",
        },
      );
    }
  }

  /**
   * Build a consistent webchat response. The demo URL is always the top-level
   * field so the LLM surfaces it by default. Integration details (configUrl,
   * embeddingSnippet) are nested under _integration so the LLM only mentions
   * them when the user explicitly asks about embedding.
   */
  private buildWebchatResponse(opts: {
    created?: boolean;
    updated?: boolean;
    endpointId: string;
    endpoint: any;
    settingsKeys: string[];
    note?: string;
  }): any {
    const { endpoint } = opts;
    const demoWebchatUrl = this.buildDemoWebchatUrl(endpoint);
    const configUrl = this.buildConfigUrl(endpoint);

    const result: any = {};
    if (opts.created) result.created = true;
    if (opts.updated) result.updated = true;
    result.endpointId = opts.endpointId;
    result.name = endpoint.name;
    result.channel = endpoint.channel ?? "webchat3";
    result.demoWebchatUrl = demoWebchatUrl;
    if (opts.settingsKeys.length > 0)
      result.settingsApplied = opts.settingsKeys;
    if (opts.note) result.note = opts.note;

    result._integration = {
      configUrl,
      embeddingSnippet: `<script src="https://github.com/Cognigy/Webchat/releases/latest/download/webchat.js"></script>\n<script>window.cognigyWebchat.open({ configUrl: "${configUrl}" });</script>`,
    };

    result._instruction =
      "ALWAYS show demoWebchatUrl to the user as a clickable link. This is the live demo page they can open in a browser right now. Only mention _integration details if the user asks about embedding or deploying to their website.";

    return result;
  }

  /**
   * Merge partial webchat settings into a full existing settings object.
   * The v3 API validation destructures nested groups (colors, layout, behavior,
   * startBehavior, demoWebchat, fileStorageSettings, chatOptions) and crashes
   * if any top-level group is missing. We must send the complete settings object.
   */
  private mergeWebchatSettings(
    existing: Record<string, any>,
    updates: Record<string, any>,
  ): Record<string, any> {
    return deepMerge(existing, updates);
  }

  private async safeGetEndpoint(endpointId: string): Promise<any> {
    try {
      return await this.apiClient.get(`/v2.0/endpoints/${endpointId}`);
    } catch {
      return null;
    }
  }

  private buildDemoWebchatUrl(endpoint: any): string | undefined {
    if (!endpoint.URLToken || !this.webchatBaseUrl) return undefined;
    return `${this.webchatBaseUrl}/v3/${endpoint.URLToken}`;
  }

  private buildConfigUrl(endpoint: any): string {
    if (!endpoint.URLToken) return "URL not available";
    return `${this.endpointBaseUrl}/${endpoint.URLToken}`;
  }

  // =========================================================================
  // Voice Gateway
  // =========================================================================

  async handleManageVoiceGateway(args: any): Promise<any> {
    const data = schemas.manageVoiceGatewaySchema.parse(args);

    let endpointId = data.endpointId ?? null;

    // ---- CREATE ----
    if (!endpointId) {
      if (!data.projectId) {
        return withHints(
          {
            error: "projectId is required to create a voice gateway endpoint.",
          },
          {
            action:
              "Provide projectId. Use list_resources { resourceType: 'project' } to find one.",
          },
        );
      }
      if (!data.flowId) {
        return withHints(
          {
            error:
              "flowId is required to create a voice gateway endpoint. To update an existing one, provide endpointId instead.",
          },
          {
            action:
              "Provide flowId. Use list_resources { resourceType: 'flow', projectId } to find one, or create an agent first with create_ai_agent.",
          },
        );
      }

      // Resolve locale — the flow's when the project has several, else primary
      const localeId = await resolveEndpointLocaleId(
        this.apiClient,
        data.projectId,
        data.flowId,
      );

      // Step 1: Create voiceGateway2 endpoint
      const createPayload: any = {
        projectId: data.projectId,
        entrypoint: data.projectId,
        channel: "voiceGateway2",
        flowId: data.flowId,
        name: data.name || "Voice Gateway",
        targetType: "flow",
        agentId: "",
      };
      if (localeId) createPayload.localeId = localeId;

      let endpoint: any;
      try {
        const created: any = await this.apiClient.post(
          "/new/v2.0/endpoints",
          createPayload,
        );
        endpointId = created._id || created.id;
        endpoint = await this.apiClient.get(
          `/new/v2.0/endpoints/${endpointId}`,
        );
      } catch (error: any) {
        return withHints(
          {
            error: `Failed to create voice gateway endpoint: ${error.message}`,
          },
          {
            action: "Check projectId and flowId, then retry.",
          },
        );
      }

      // Step 2: Provision WebRTC client
      const userWidgetConfig = data.webrtcWidgetConfig ?? {};
      const webrtcWidgetConfig = {
        label: userWidgetConfig.label ?? "",
        active: true,
        theme: userWidgetConfig.theme ?? "DARK_MODE",
        transcription: {
          enabled: userWidgetConfig.transcription?.enabled ?? true,
          backgroundMode:
            userWidgetConfig.transcription?.backgroundMode ?? "transparent",
        },
        demoPage: {
          background: {
            mode: userWidgetConfig.demoPage?.background?.mode ?? "color",
            color: userWidgetConfig.demoPage?.background?.color ?? "#FFFFFF",
          },
          position: userWidgetConfig.demoPage?.position ?? "centered",
        },
        ...(userWidgetConfig.avatarLogoUrl
          ? { avatarLogoUrl: userWidgetConfig.avatarLogoUrl }
          : {}),
        ...(userWidgetConfig.tagline
          ? { tagline: userWidgetConfig.tagline }
          : {}),
      };

      try {
        await this.apiClient.patch(`/new/v2.0/endpoints/${endpointId}`, {
          createWebrtcClient: true,
          channel: "voiceGateway2",
          name: endpoint.name,
          URLToken: endpoint.URLToken,
          localeId: endpoint.localeId ?? localeId,
          webrtcWidgetConfig,
        });
        endpoint = await this.apiClient.get(
          `/new/v2.0/endpoints/${endpointId}`,
        );
      } catch (error: any) {
        // Endpoint created but WebRTC failed — still return what we have
        return withHints(
          this.buildVoiceGatewayResponse({
            created: true,
            endpointId: endpointId!,
            endpoint,
            webrtcProvisioned: false,
          }),
          {
            warning: `Endpoint created but WebRTC client provisioning failed: ${error.message}`,
            action: `Retry by calling manage_voice_gateway { endpointId: "${endpointId}" }`,
          },
        );
      }

      return this.buildVoiceGatewayResponse({
        created: true,
        endpointId: endpointId!,
        endpoint,
        webrtcProvisioned: true,
      });
    }

    // ---- UPDATE ----
    try {
      let endpoint: any = await this.apiClient.get(
        `/new/v2.0/endpoints/${endpointId}`,
      );

      const patchPayload: any = {};
      if (data.name) patchPayload.name = data.name;
      if (data.flowId) patchPayload.flowId = data.flowId;

      if (data.webrtcWidgetConfig) {
        const existing = endpoint.webrtcWidgetConfig ?? {};
        patchPayload.webrtcWidgetConfig = {
          ...existing,
          ...data.webrtcWidgetConfig,
          transcription: {
            ...(existing.transcription ?? {}),
            ...(data.webrtcWidgetConfig.transcription ?? {}),
          },
          demoPage: {
            ...(existing.demoPage ?? {}),
            ...(data.webrtcWidgetConfig.demoPage ?? {}),
            background: {
              ...(existing.demoPage?.background ?? {}),
              ...(data.webrtcWidgetConfig.demoPage?.background ?? {}),
            },
          },
        };
      }

      // If no WebRTC client yet, provision it
      if (!endpoint.webrtcClient) {
        patchPayload.createWebrtcClient = true;
        patchPayload.channel = "voiceGateway2";
        patchPayload.URLToken = endpoint.URLToken;
        if (!patchPayload.webrtcWidgetConfig) {
          patchPayload.webrtcWidgetConfig = {
            label: "",
            active: true,
            theme: "DARK_MODE",
            transcription: { enabled: true, backgroundMode: "transparent" },
            demoPage: {
              background: { mode: "color", color: "#FFFFFF" },
              position: "centered",
            },
          };
        }
      }

      if (Object.keys(patchPayload).length === 0) {
        return this.buildVoiceGatewayResponse({
          endpointId: endpointId!,
          endpoint,
          webrtcProvisioned: !!endpoint.webrtcClient,
          note: "No changes requested. Returning current endpoint info.",
        });
      }

      await this.apiClient.patch(
        `/new/v2.0/endpoints/${endpointId}`,
        patchPayload,
      );
      endpoint = await this.apiClient.get(`/new/v2.0/endpoints/${endpointId}`);

      return this.buildVoiceGatewayResponse({
        updated: true,
        endpointId: endpointId!,
        endpoint,
        webrtcProvisioned: !!endpoint.webrtcClient,
      });
    } catch (error: any) {
      return withHints(
        { error: `Failed to update voice gateway endpoint: ${error.message}` },
        {
          action: "Verify endpointId and settings, then retry.",
        },
      );
    }
  }

  // =========================================================================
  // Settings
  // =========================================================================

  private static readonly SPEECH_PROVIDER_TYPE_MAP: Record<string, string> = {
    microsoft: "MicrosoftSpeechProvider",
    google: "GoogleSpeechProvider",
    aws: "AWSSpeechProvider",
    deepgram: "DeepgramSpeechProvider",
    elevenlabs: "ElevenLabsSpeechProvider",
  };

  async handleManageSettings(args: any): Promise<any> {
    const data = schemas.manageSettingsSchema.parse(args);

    switch (data.operation) {
      case "set_voice_preview": {
        const { projectId, provider } = data;
        let connectionRefId = data.connectionId;

        // Auto-detect speech connection if not provided
        if (!connectionRefId) {
          const providerType =
            ToolHandlers.SPEECH_PROVIDER_TYPE_MAP[provider] ?? provider;
          try {
            const connections: any = await this.apiClient.get(
              "/new/v2.0/connections",
              { params: { projectId } },
            );
            const items = connections?.items ?? connections;
            const match = (Array.isArray(items) ? items : []).find(
              (c: any) =>
                c.extension === "@cognigy/audio-preview-provider" &&
                c.type === providerType,
            );
            if (match) {
              connectionRefId = match.referenceId ?? match._id;
            }
          } catch {
            // Fall through — will report missing connection
          }

          if (!connectionRefId) {
            return withHints(
              {
                error: `No speech connection found for provider "${provider}".`,
                provider,
                providerType,
              },
              {
                action: `Upload a package containing a "${providerType}" speech connection using manage_packages { operation: "upload_and_inspect", projectId: "${projectId}", filePath: "<path>" }, import it, then retry this operation.`,
              },
            );
          }
        }

        // PATCH project settings
        try {
          await this.apiClient.patch(
            `/new/v2.0/projects/${projectId}/settings`,
            {
              audioPreviewSettings: {
                provider,
                connections: {
                  [provider]: { connectionId: connectionRefId },
                },
              },
            },
          );
        } catch (error: any) {
          return withHints(
            {
              error: `Failed to update voice preview settings: ${error.message}`,
            },
            {
              action: "Verify projectId and connectionId, then retry.",
            },
          );
        }

        return {
          updated: true,
          provider,
          connectionId: connectionRefId,
          _hint:
            "Voice preview settings configured. You can now use manage_voice_gateway to create a voice endpoint, or test voice preview in the Cognigy UI.",
        };
      }
      case "set_knowledge_ai": {
        const patchPayload: Record<string, any> = {};
        const updatedFields: string[] = [];

        if (data.knowledgeSearchModelId || data.answerExtractionModelId) {
          patchPayload.generativeAISettings = {
            enabled: true,
            useCasesSettings: {},
          };
          if (data.knowledgeSearchModelId) {
            patchPayload.generativeAISettings.useCasesSettings.knowledgeSearch =
              {
                largeLanguageModelId: data.knowledgeSearchModelId,
              };
            updatedFields.push("knowledgeSearchModelId");
          }
          if (data.answerExtractionModelId) {
            patchPayload.generativeAISettings.useCasesSettings.answerExtraction =
              {
                largeLanguageModelId: data.answerExtractionModelId,
              };
            updatedFields.push("answerExtractionModelId");
          }
        }

        if (
          data.contentParser !== undefined ||
          data.azureDIConnectionId !== undefined
        ) {
          patchPayload.knowledgeAISettings = {};
          if (data.contentParser !== undefined) {
            patchPayload.knowledgeAISettings.fileExtractor = data.contentParser;
            updatedFields.push("contentParser");
          }
          if (data.azureDIConnectionId !== undefined) {
            patchPayload.knowledgeAISettings.azureDIConnectionId =
              data.azureDIConnectionId;
            if (!updatedFields.includes("azureDIConnectionId")) {
              updatedFields.push("azureDIConnectionId");
            }
          }
        }

        try {
          await this.apiClient.patch(
            `/new/v2.0/projects/${data.projectId}/settings`,
            patchPayload,
          );
        } catch (error: any) {
          let allowedKnowledgeSearchModels: any[] | undefined;
          let allowedKnowledgeSearchModelsError: string | undefined;

          if (data.knowledgeSearchModelId) {
            try {
              const res: any = await this.apiClient.get(
                "/new/v2.0/largelanguagemodels",
                {
                  params: {
                    projectId: data.projectId,
                    useCase: "knowledgeSearch",
                    limit: 100,
                  },
                },
              );
              const items = res.items ?? res;
              allowedKnowledgeSearchModels = filterList(
                "llm_model",
                Array.isArray(items) ? items : [],
              );
            } catch (candidateError: any) {
              allowedKnowledgeSearchModelsError = candidateError.message;
            }
          }

          return withHints(
            {
              error: `Failed to update Knowledge AI settings: ${error.message}`,
              ...(allowedKnowledgeSearchModels
                ? { allowedKnowledgeSearchModels }
                : {}),
              ...(allowedKnowledgeSearchModelsError
                ? {
                    allowedKnowledgeSearchModelsError,
                  }
                : {}),
            },
            {
              action: `Verify the projectId, same-project llm_model referenceIds, and content parser connection details, then retry. For Knowledge Search, call list_resources { resourceType: "llm_model", projectId: "${data.projectId}", useCase: "knowledgeSearch" } to match the Settings UI dropdown before choosing another model. If you are reusing another project's knowledge workflow, ensure the exact source-project Knowledge Search model has already been imported into this project before trying a different model.`,
            },
          );
        }

        return {
          updated: true,
          updatedFields,
          ...(data.knowledgeSearchModelId
            ? { knowledgeSearchModelId: data.knowledgeSearchModelId }
            : {}),
          ...(data.answerExtractionModelId
            ? { answerExtractionModelId: data.answerExtractionModelId }
            : {}),
          ...(data.contentParser ? { contentParser: data.contentParser } : {}),
          ...(data.azureDIConnectionId
            ? { azureDIConnectionId: data.azureDIConnectionId }
            : {}),
          ...(data.knowledgeSearchModelId || data.answerExtractionModelId
            ? { generativeAIEnabled: true }
            : {}),
          _hint:
            "Knowledge AI settings configured. If you are preparing a new project, ensure the referenced LLMs already exist in this project before creating knowledge stores or answer extraction flows.",
        };
      }

      default:
        throw new Error(`Unknown operation: ${(data as any).operation}`);
    }
  }

  private buildVoiceGatewayResponse(opts: {
    created?: boolean;
    updated?: boolean;
    endpointId: string;
    endpoint: any;
    webrtcProvisioned: boolean;
    note?: string;
  }): any {
    const { endpoint } = opts;
    const webrtcDemoUrl = this.buildWebrtcDemoUrl(endpoint);
    const wsEndpointUrl = this.buildVoiceGatewayWsUrl(endpoint);

    const result: any = {};
    if (opts.created) result.created = true;
    if (opts.updated) result.updated = true;
    result.endpointId = opts.endpointId;
    result.name = endpoint.name;
    result.channel = "voiceGateway2";
    result.webrtcProvisioned = opts.webrtcProvisioned;
    result.webrtcDemoUrl = webrtcDemoUrl;
    if (opts.note) result.note = opts.note;

    result._integration = {
      wsEndpointUrl,
      embeddingSnippet: `<script src="https://github.com/Cognigy/WebRTCWidget/releases/latest/download/webRTCWidget.js"></script>\n<script>\n  addEventListener("load", (event) => {\n    if (window.initWebRTCWidget) {\n      window.initWebRTCWidget("${wsEndpointUrl}");\n    }\n  });\n</script>`,
    };

    result._instruction =
      "ALWAYS show webrtcDemoUrl to the user as a clickable link. This is the live demo page they can open in a browser to talk to the agent via voice. Only mention _integration details if the user asks about embedding.";

    result._speechProviderHint =
      "Voice preview requires a speech provider. Ensure one is configured in Settings > Voice Preview Settings > Speech Provider, or use manage_settings { operation: 'set_voice_preview', projectId, provider } to set it via API.";

    return result;
  }

  private buildWebrtcDemoUrl(endpoint: any): string | undefined {
    if (!endpoint.URLToken || !this.staticFilesBaseUrl) return undefined;
    return `${this.staticFilesBaseUrl}/webrtc/?token=${endpoint.URLToken}`;
  }

  private buildVoiceGatewayWsUrl(endpoint: any): string | undefined {
    if (!endpoint.URLToken || !this.endpointBaseUrl) return undefined;
    const base = `${this.endpointBaseUrl}/${endpoint.URLToken}/voiceGateway`;
    return base.replace(/^http/, "ws");
  }

  // =========================================================================
  // Tool 16: audit_voice_agent
  // =========================================================================
  async handleAuditVoiceAgent(args: any): Promise<any> {
    const data = schemas.auditVoiceAgentSchema.parse(args);
    const { aiAgentId, endpointId, projectId, apply, only } = data;

    // Resolve the flow to audit.
    let flowId = data.flowId;
    if (!flowId) {
      const resolved = await resolveFlowForAgent(this.apiClient, aiAgentId!);
      if (!resolved) {
        return withHints(
          { error: "Could not resolve a flow for this agent." },
          {
            action:
              "Provide flowId directly, or ensure the agent was created via create_ai_agent.",
          },
        );
      }
      flowId = resolved.flowId;
    }

    // The `/chart/nodes` index returns NO `config` and NO ordering — only
    // id/type/label/preview/isEntryPoint/parentId. The checklist reads
    // `node.config.*` and the auto-fix PATCH merges against existing config, so
    // we must (a) enrich the inspected nodes with their per-node `config` and
    // (b) derive the true first node from the chart `next` chain. Using the bare
    // index would yield false failures and let the fix PATCH clobber config.
    const CONFIG_RELEVANT_TYPES = new Set(["setSessionConfig", "aiAgentJob"]);

    const fetchNodeIndex = async (): Promise<any[]> => {
      const res: any = await this.apiClient.get(
        `/v2.0/flows/${flowId}/chart/nodes`,
        { params: { limit: 200 } },
      );
      const items = res.items ?? res;
      return Array.isArray(items) ? items : [];
    };

    // Full `config` only comes from the per-node read. Enrich the node types the
    // checklist actually inspects; leave the rest as cheap index entries.
    const enrichConfig = async (index: any[]): Promise<any[]> =>
      Promise.all(
        index.map(async (n: any) => {
          if (!CONFIG_RELEVANT_TYPES.has(n?.type)) return n;
          try {
            const full: any = await this.apiClient.get(
              `/v2.0/flows/${flowId}/chart/nodes/${voiceNodeId(n)}`,
            );
            return { ...n, config: full?.config ?? n.config ?? {} };
          } catch {
            return n;
          }
        }),
      );

    // The true first node is the one the `start` node points at in the chart
    // `next` chain — NOT whatever reports isEntryPoint. Returns undefined if it
    // cannot be derived (the evaluator then warns instead of guessing).
    const fetchFirstNodeId = async (): Promise<string | undefined> => {
      try {
        const chart: any = await this.apiClient.get(
          `/new/v2.0/flows/${flowId}/chart`,
        );
        const rels = Array.isArray(chart?.relations) ? chart.relations : [];
        const chartNodes = Array.isArray(chart?.nodes) ? chart.nodes : [];
        const startNode = chartNodes.find((n: any) => n?.type === "start");
        const startId = startNode ? voiceNodeId(startNode) : undefined;
        if (!startId) return undefined;
        const startRel = rels.find((r: any) => r?.node === startId);
        const next = startRel?.next;
        const firstRef = Array.isArray(next) ? next[0] : next;
        if (!firstRef) return undefined;
        return typeof firstRef === "string" ? firstRef : voiceNodeId(firstRef);
      } catch {
        return undefined;
      }
    };

    const loadFlowState = async (): Promise<{
      nodes: any[];
      firstNodeId: string | undefined;
    }> => {
      const [nodes, firstNodeId] = await Promise.all([
        fetchNodeIndex().then(enrichConfig),
        fetchFirstNodeId(),
      ]);
      return { nodes, firstNodeId };
    };

    // Tri-state: undefined = not requested, null = fetch failed, object = resolved.
    const fetchEndpoint = async (): Promise<any | null | undefined> => {
      if (!endpointId) return undefined;
      try {
        return await this.apiClient.get(`/v2.0/endpoints/${endpointId}`);
      } catch {
        return null;
      }
    };

    let { nodes, firstNodeId } = await loadFlowState();
    let endpoint = await fetchEndpoint();

    // Best-effort LLM resolution for the fallback check (advisory only).
    // Tri-state: undefined = not requested, null = could not resolve, object = resolved.
    let llm: any = undefined;
    if (projectId) {
      llm = null;
      try {
        const agentNode = nodes.find((n: any) => n.type === "aiAgentJob");
        const ref = agentNode?.config?.llmProviderReferenceId;
        const res: any = await this.apiClient.get("/v2.0/largelanguagemodels", {
          params: { projectId, limit: 100 },
        });
        const models = res.items ?? res;
        if (Array.isArray(models) && models.length > 0) {
          // llmProviderReferenceId may hold either a referenceId or an _id/id
          // (create_ai_agent can set it to either), so match on all of them —
          // otherwise the lookup misses and the advisory inspects the wrong model.
          const matchesRef = (m: any) =>
            m.referenceId === ref || m._id === ref || m.id === ref;
          llm =
            (ref && ref !== "default" ? models.find(matchesRef) : undefined) ??
            models.find((m: any) => m.isDefault) ??
            null;
        }
      } catch {
        llm = null;
      }
    }

    const describeFix = (fix: VoiceFix): Record<string, any> =>
      fix.kind === "patchNode"
        ? { kind: "patchNode", nodeId: fix.nodeId, config: fix.config }
        : {
            kind: "createSessionConfig",
            beforeNodeId: fix.targetNodeId,
            label: fix.label,
            config: fix.config,
          };

    const formatCheck = (c: VoiceCheck): Record<string, any> => {
      const out: Record<string, any> = {
        id: c.id,
        section: c.section,
        title: c.title,
        status: c.status,
        detail: c.detail,
        autoFixable: c.autoFixable,
      };
      if (c.fix) out.proposedFix = describeFix(c.fix);
      return out;
    };

    const checks = evaluateChecks({ nodes, firstNodeId, endpoint, llm });

    if (!apply) {
      return {
        flowId,
        mode: "dry-run",
        summary: summarize(checks),
        checks: checks.map(formatCheck),
        _note:
          "Dry-run: no changes made. Re-run with apply: true to apply the auto-fixable fixes (the checks with a proposedFix). Use only: [ids] to apply a subset.",
      };
    }

    // Apply the auto-fixable fixes.
    //
    // The cache maps nodeId → its current config snapshot. `undefined` means the
    // config was never captured (enrichment missed/failed) — distinct from an
    // empty config — so the apply path re-fetches before patching rather than
    // PATCHing a partial config that would clobber unrelated fields.
    const nodeConfigById = new Map<string, Record<string, any> | undefined>(
      nodes.map((n: any) => [voiceNodeId(n), n.config]),
    );
    const toApply = checks.filter(
      (c) => c.autoFixable && c.fix && (!only || only.includes(c.id)),
    );
    const appliedFixes: any[] = [];

    for (const c of toApply) {
      const fix = c.fix!;
      try {
        if (fix.kind === "patchNode") {
          // Resolve the current config. If it was never captured, re-fetch the
          // full node so the merge below preserves existing fields.
          let existing = nodeConfigById.get(fix.nodeId);
          if (existing === undefined) {
            try {
              const full: any = await this.apiClient.get(
                `/v2.0/flows/${flowId}/chart/nodes/${fix.nodeId}`,
              );
              existing = full?.config ?? {};
            } catch {
              existing = {};
            }
          }
          const merged = { ...existing, ...fix.config };
          await this.apiClient.patch(
            `/v2.0/flows/${flowId}/chart/nodes/${fix.nodeId}`,
            { config: merged },
          );
          // Update the snapshot so a later fix on the SAME node builds on this
          // merge instead of reverting it to the original config.
          nodeConfigById.set(fix.nodeId, merged);
          appliedFixes.push({
            id: c.id,
            applied: true,
            nodeId: fix.nodeId,
            fields: Object.keys(fix.config),
          });
        } else {
          // `prepend` (not `insertBefore`): a top-level node lives on the chart's
          // `next` chain (start → agent → …), not in any node's `children`.
          // insertBefore searches `children` and throws "Error while reading
          // ChartData" on a top-level target. prepend rewires the next chain so
          // the new node lands immediately before the AI Agent node.
          const created: any = await this.apiClient.post(
            `/v2.0/flows/${flowId}/chart/nodes`,
            {
              type: "setSessionConfig",
              extension: "@cognigy/voicegateway2",
              mode: "prepend",
              target: fix.targetNodeId,
              label: fix.label,
              config: fix.config,
            },
          );
          appliedFixes.push({
            id: c.id,
            applied: true,
            createdNodeId: created._id || created.id,
          });
        }
      } catch (err: any) {
        appliedFixes.push({ id: c.id, applied: false, error: err.message });
      }
    }

    // Re-audit so the response reflects the post-fix state. Re-derive ordering
    // too — a created Set Session Config node changes the first node.
    ({ nodes, firstNodeId } = await loadFlowState());
    endpoint = await fetchEndpoint();
    const postChecks = evaluateChecks({ nodes, firstNodeId, endpoint, llm });

    return {
      flowId,
      mode: "apply",
      appliedFixes,
      summary: summarize(postChecks),
      checks: postChecks.map(formatCheck),
      _note:
        "Applied auto-fixable fixes and re-audited. Verify the flow in the UI — especially node ordering when a Set Session Config node was created. Advisory checks (warn) and manual items are not auto-fixed.",
    };
  }

  // =========================================================================
  // Tool 17: manage_snapshots
  // =========================================================================

  /**
   * Intercept the FIRST change to an existing agent in a session so the user
   * gets the chance to take a backup while a backup is still worth taking.
   *
   * This has to happen BEFORE the handler runs. An earlier version attached an
   * advisory hint to the RESULT instead, which could not work: by the time a
   * result exists the change has already been made, so a snapshot taken from
   * that hint captured the already-changed state. The offer has to interrupt,
   * not annotate.
   *
   * Returns the offer to send back instead of performing the call, or null to
   * let the call through. Deliberately trips only ONCE per session: if the
   * client retries without creating or declining, the retry proceeds. A gate
   * that held out for compliance could deadlock an automated subagent, and one
   * forced pause is what "ask at the start of the session" actually needs.
   */
  /** Record which project a resource belongs to, for gate scoping. */
  private rememberProjectOf(resource: any, projectId?: string): void {
    const project = projectId ?? resource?.projectId;
    if (typeof project !== "string" || !project) return;
    for (const key of ["_id", "id", "referenceId"]) {
      const value = resource?.[key];
      if (typeof value === "string" && value) {
        this.projectOfResource.set(value, project);
      }
    }
  }

  /**
   * Learn resource → project links from a tool result. Reads the model makes
   * anyway (list_resources, get_resource) are enough to scope the gate for the
   * calls that carry no projectId of their own.
   */
  private learnProjectIds(result: any): void {
    if (!result || typeof result !== "object") return;
    const items = (result as any).items;
    if (Array.isArray(items)) {
      for (const item of items) this.rememberProjectOf(item);
    }
    this.rememberProjectOf(result);
  }

  /**
   * The project a gated call acts on, or null when it cannot be told. Pure
   * lookup — the gate never spends an API call to answer this.
   */
  private projectForCall(args: any): string | null {
    if (typeof args?.projectId === "string" && args.projectId) {
      return args.projectId;
    }
    for (const key of ["aiAgentId", "flowId", "id", "endpointId"]) {
      const value = args?.[key];
      if (typeof value === "string") {
        const project = this.projectOfResource.get(value);
        if (project) return project;
      }
    }
    return null;
  }

  /**
   * Once the offer is answered for a project, the answered-check in
   * backupGateFor short-circuits before the held sets are consulted — so the
   * accumulated signatures are dead weight and can be dropped. The
   * without-project set is likewise never consulted once any answer exists.
   */
  private releaseBackupGateHolds(projectId: string): void {
    this.backupGateHeldCallsForProject.delete(projectId);
    this.backupGateHeldCallsWithoutProject.clear();
  }

  private backupGateFor(toolName: string, args: any): any | null {
    const projectId = this.projectForCall(args);
    // Held calls are remembered by signature so a retry of a call that was
    // already held proceeds (anti-deadlock), while a concurrent DIFFERENT
    // mutation is held too. Marking happens synchronously, before any await,
    // so parallel calls in one client message cannot slip past each other.
    const signature = `${toolName} ${JSON.stringify(args ?? null)}`;

    if (projectId) {
      // Answered for THIS project? Let it through. An answer given for another
      // project says nothing about this one.
      if (
        this.snapshotCreatedForProject.has(projectId) ||
        this.backupDeclinedForProject.has(projectId)
      ) {
        return null;
      }
      // Anti-deadlock: hold each distinct call once. A client that ignores
      // the offer and retries proceeds rather than looping forever.
      const held = this.backupGateHeldCallsForProject.get(projectId);
      if (held?.has(signature)) return null;
      if (held) held.add(signature);
      else
        this.backupGateHeldCallsForProject.set(projectId, new Set([signature]));
    } else {
      // Project unknown (e.g. delete_resource on a resource never read this
      // session). Fall back to session-wide state: any answer, anywhere, and
      // one hold per distinct call.
      if (
        this.snapshotCreatedForProject.size ||
        this.backupDeclinedForProject.size ||
        this.backupGateHeldCallsWithoutProject.has(signature)
      ) {
        return null;
      }
      this.backupGateHeldCallsWithoutProject.add(signature);
    }

    return withHints(
      {
        error: "backup_not_offered",
        tool: toolName,
        changed: false,
        ...(projectId ? { projectId } : {}),
      },
      {
        warning: `NOTHING WAS CHANGED. This is the first change to an existing agent in this session, and no backup exists yet — so ${toolName} was not run.`,
        action:
          'Ask the user, in one short line, whether they want a restorable backup first — mentioning that it covers the whole project but not Endpoints or Knowledge AI. If yes: manage_snapshots { operation: "create", projectId, label: "<why>" }. If no: manage_snapshots { operation: "decline", projectId }. Then retry this exact call. If you do not have the projectId, read it from get_resource { resourceType: "agent", id: "<aiAgentId>" }.',
      },
    );
  }

  /** Read a snapshot, or return null when the platform 404s. */
  private async readSnapshot(snapshotId: string): Promise<any | null> {
    try {
      return await this.apiClient.get(`/new/v2.0/snapshots/${snapshotId}`);
    } catch (error: any) {
      if (error?.status === 404) return null;
      throw error;
    }
  }

  private async listSnapshots(
    projectId: string,
    params: Record<string, any> = {},
  ): Promise<any[]> {
    const response: any = await this.apiClient.get("/new/v2.0/snapshots", {
      params: { projectId, limit: 100, ...params },
    });
    const items = response?.items ?? response;
    return Array.isArray(items) ? items : [];
  }

  /**
   * Every snapshot in the project, following pagination. The limit evaluation
   * and the ownership check both have to see ALL of them: a page-sized view
   * reports "room left" on a full project and can hide the oldest backup, which
   * is the one we are required to evict first.
   */
  private async listAllSnapshots(projectId: string): Promise<any[]> {
    const pageSize = 100;
    const all: any[] = [];

    for (let page = 0; page < ToolHandlers.MAX_SNAPSHOT_PAGES; page++) {
      const items = await this.listSnapshots(projectId, {
        limit: pageSize,
        skip: page * pageSize,
      });
      all.push(...items);
      if (items.length < pageSize) break;
    }

    return all;
  }

  /**
   * restore and delete address a snapshot by id ALONE — the platform resolves
   * the project from the snapshot itself (the restore POST carries no body), so
   * a snapshotId belonging to another project would act on that project while
   * every warning, preflight and hint in our response names the passed one, and
   * waitForTask would poll the task with the wrong projectId. The snapshot
   * object carries no project reference of its own (REST schema exposes only
   * name/description/isPackaged/_id/hash/createdBy/createdAt), so ownership is
   * established the only way the API allows: membership in the project's list.
   */
  private async snapshotBelongsToProject(
    snapshotId: string,
    projectId: string,
  ): Promise<boolean> {
    const items = await this.listAllSnapshots(projectId);
    return items.some((s: any) => (s?._id ?? s?.id) === snapshotId);
  }

  /** Shared response for a snapshotId that is not in the passed project. */
  private snapshotProjectMismatchResult(
    operation: "restore" | "delete",
    projectId: string,
    snapshotId: string,
    snapshot: any,
  ): any {
    return withHints(
      {
        operation,
        error: "snapshot_project_mismatch",
        projectId,
        snapshotId,
        ...(operation === "restore" ? { applied: false } : { deleted: false }),
        snapshot: summarizeSnapshot(snapshot),
      },
      {
        warning: `Snapshot "${snapshot?.name ?? snapshotId}" does not belong to project ${projectId}, so nothing was done. Acting on it would have ${operation === "restore" ? "rolled back a DIFFERENT project" : "deleted another project's snapshot"}.`,
        action: `Confirm which project the user means, then use manage_snapshots { operation: "list", projectId: "${projectId}" } to get a snapshot id from THAT project.`,
      },
    );
  }

  /**
   * Run a snapshot task to completion. Snapshot create/restore/delete all return
   * 202 + a task id, exactly like packages, so this leans on the existing
   * waitForTask poller. The one wrinkle: waitForTask THROWS on a failed task,
   * but several snapshot failures are things we want to report as structured
   * results rather than as exceptions (hitting the snapshot cap, deleting a
   * snapshot that an endpoint is using). So catch and hand the reason back.
   */
  private async runSnapshotTask(
    taskResponse: any,
    projectId: string,
    opts: { waitForCompletion?: boolean; timeoutMs?: number },
  ): Promise<{
    taskId: string;
    task: any | null;
    timedOut: boolean;
    failReason: string | null;
    pollFailed: boolean;
    pollError: string | null;
  }> {
    const taskId = taskResponse?._id ?? taskResponse?.id;
    if (!taskId) {
      throw new Error("Snapshot operation did not return a task ID");
    }

    if (opts.waitForCompletion === false) {
      return {
        taskId,
        task: null,
        timedOut: false,
        failReason: null,
        pollFailed: false,
        pollError: null,
      };
    }

    try {
      const { task, timedOut } = await this.waitForTask(
        taskId,
        projectId,
        opts.timeoutMs ?? ToolHandlers.DEFAULT_PACKAGE_TIMEOUT_MS,
      );
      return {
        taskId,
        task: normalizeTask(task),
        timedOut,
        failReason: null,
        pollFailed: false,
        pollError: null,
      };
    } catch (error: any) {
      // Only a TaskFailedError means the operation itself failed. A polling
      // error says nothing about the operation — reporting it as a failure is
      // what let a create claim "nothing was backed up" for a snapshot that
      // exists, and let freeSnapshotSlot delete a second backup after the
      // first one had already gone.
      if (error instanceof TaskFailedError) {
        return {
          taskId,
          task: null,
          timedOut: false,
          failReason: error.message,
          pollFailed: false,
          pollError: null,
        };
      }

      return {
        taskId,
        task: null,
        timedOut: false,
        failReason: null,
        pollFailed: true,
        pollError: error?.message ?? "Could not read the task status",
      };
    }
  }

  /** Remaining budget against a shared deadline, floored at zero. */
  private static remainingMs(deadline: number): number {
    return Math.max(0, deadline - Date.now());
  }

  /**
   * The task was accepted but its status could not be read. The operation may
   * well have succeeded, so the caller must be told to poll rather than told it
   * failed.
   */
  private snapshotPollFailedResult(
    operation: "create" | "restore" | "delete",
    projectId: string,
    taskId: string,
    pollError: string,
    extra: Record<string, any> = {},
  ): any {
    const subject =
      operation === "create"
        ? "The backup may or may not exist"
        : operation === "restore"
          ? "The project may be mid-restore or fully restored"
          : "The snapshot may or may not be deleted";

    return withHints(
      {
        operation,
        projectId,
        error: "task_status_unknown",
        outcomeUnknown: true,
        taskId,
        pollError,
        ...extra,
      },
      {
        warning: `The ${operation} task was started, but its status could not be read (${pollError}). ${subject} — do NOT assume either way.`,
        action: `Poll manage_snapshots { operation: "read_task", projectId: "${projectId}", taskId: "${taskId}" } until it reports done or error, and only then tell the user what happened.${operation === "create" ? " Do not create another backup before that resolves — a duplicate eats a snapshot slot." : ""}`,
      },
    );
  }

  private snapshotLimitResult(
    projectId: string,
    evaluation: ReturnType<typeof evaluateSnapshotLimit>,
    detail?: string,
    // A slot may ALREADY have been freed before this result is built (the
    // installation cap turned out lower than assumedMax, or a racing create
    // took the freed slot). That deletion is irreversible, so it must appear in
    // the response and the warning must not claim nothing was deleted.
    eviction?: { freedSlot: SnapshotSummary | null; skippedCandidates: any[] },
  ): any {
    const oldest = evaluation.oldestDeletable;
    const freedSlot = eviction?.freedSlot ?? null;
    const evictionFields = {
      ...(freedSlot ? { deletedToFreeSlot: freedSlot } : {}),
      ...(eviction?.skippedCandidates?.length
        ? { skippedCandidates: eviction.skippedCandidates }
        : {}),
    };
    const nothingDeleted = freedSlot
      ? `A backup ("${freedSlot.name}") was already permanently deleted to free a slot, but the snapshot still could not be created.`
      : "No snapshot was created and nothing was deleted.";

    if (!oldest) {
      return withHints(
        {
          operation: "create",
          error: "snapshot_limit_reached",
          projectId,
          created: false,
          count: evaluation.count,
          assumedMax: evaluation.assumedMax,
          deletableBackups: [],
          ...evictionFields,
          ...(detail ? { detail } : {}),
        },
        {
          warning: `The project is at its snapshot limit (${evaluation.count}) and none of the remaining snapshots were created by this plugin. ${nothingDeleted}`,
          action:
            "Do NOT delete any snapshot. Tell the user the plugin only ever deletes its own [AI Backup] snapshots, and ask them to delete one themselves in the Cognigy UI under Deploy > Snapshots, then retry.",
        },
      );
    }

    return withHints(
      {
        operation: "create",
        error: "snapshot_limit_reached",
        projectId,
        created: false,
        count: evaluation.count,
        assumedMax: evaluation.assumedMax,
        oldestDeletable: oldest,
        deletableBackups: evaluation.deletable,
        ...evictionFields,
        ...(detail ? { detail } : {}),
      },
      {
        warning: `The project is at its snapshot limit (${evaluation.count}). ${nothingDeleted}`,
        action: `Ask the user whether to delete the oldest plugin-created backup ("${oldest.name}") to make room. Only if they agree, retry with manage_snapshots { operation: "create", projectId: "${projectId}", confirmDeleteOldest: true }.`,
      },
    );
  }

  /**
   * Delete the oldest plugin-created backup to free a slot. A snapshot that an
   * endpoint uses as its entrypoint cannot be deleted (the platform raises an
   * InputOutputError that only surfaces on the task), so walk to the next-oldest
   * candidate rather than giving up on the first refusal.
   *
   * Walking on is only safe when the platform DEFINITIVELY refused. If a delete
   * timed out or its status could not be read, the snapshot may already be
   * gone — moving to the next candidate would then destroy a second backup to
   * free one slot. Those cases halt the loop instead.
   *
   * All candidates plus the create that follows share ONE deadline, so a call
   * cannot stack N x timeoutMs.
   */
  private async freeSnapshotSlot(
    projectId: string,
    candidates: SnapshotSummary[],
    opts: { deadline: number },
  ): Promise<{
    deleted: SnapshotSummary | null;
    skipped: any[];
    halted: {
      kind: "timed_out" | "poll_failed" | "budget_exhausted";
      snapshot: SnapshotSummary;
      taskId: string | null;
      reason: string | null;
    } | null;
  }> {
    const skipped: any[] = [];

    for (const candidate of candidates) {
      if (!candidate.id) continue;

      const remaining = ToolHandlers.remainingMs(opts.deadline);
      if (remaining <= 0) {
        return {
          deleted: null,
          skipped,
          halted: {
            kind: "budget_exhausted",
            snapshot: candidate,
            taskId: null,
            reason: "No time budget left to attempt another deletion.",
          },
        };
      }

      const response = await this.apiClient.delete(
        `/new/v2.0/snapshots/${candidate.id}`,
      );
      const { taskId, timedOut, failReason, pollFailed, pollError } =
        await this.runSnapshotTask(response, projectId, {
          waitForCompletion: true,
          timeoutMs: remaining,
        });

      if (pollFailed || timedOut) {
        return {
          deleted: null,
          skipped,
          halted: {
            kind: pollFailed ? "poll_failed" : "timed_out",
            snapshot: candidate,
            taskId,
            reason: pollError,
          },
        };
      }

      if (!failReason) return { deleted: candidate, skipped, halted: null };

      skipped.push({
        snapshot: candidate,
        reason: failReason,
        ...(failReason.includes(SNAPSHOT_IN_USE_FAIL_REASON)
          ? { inUseByEndpoint: true }
          : {}),
      });
    }

    return { deleted: null, skipped, halted: null };
  }

  async handleManageSnapshots(args: any): Promise<any> {
    const data = schemas.manageSnapshotsSchema.parse(args);

    switch (data.operation) {
      case "list": {
        // The limit view must describe the WHOLE project, never the caller's
        // page: a paged count reads as "there is room" on a full project, and
        // the eviction candidate we show has to really be the oldest backup.
        // Pagination applies to the returned array only.
        const all = await this.listAllSnapshots(data.projectId);
        const evaluation = evaluateSnapshotLimit(all);
        const skip = data.skip ?? 0;
        const limit = data.limit ?? 100;
        const page = all.slice(skip, skip + limit);

        return {
          operation: "list",
          projectId: data.projectId,
          count: evaluation.count,
          assumedMax: evaluation.assumedMax,
          atLimit: evaluation.atLimit,
          snapshots: filterList("snapshot", page),
          ...(page.length < evaluation.count
            ? { shown: page.length, skip }
            : {}),
          oldestDeletableBackup: evaluation.oldestDeletable,
        };
      }

      case "create": {
        // One deadline for the whole call: every eviction attempt AND the
        // create itself draw from it, so a single call can never stack
        // candidates x timeoutMs.
        const deadline =
          Date.now() +
          (data.timeoutMs ?? ToolHandlers.DEFAULT_PACKAGE_TIMEOUT_MS);
        const existing = await this.listAllSnapshots(data.projectId);
        const evaluation = evaluateSnapshotLimit(existing);
        let freedSlot: SnapshotSummary | null = null;
        let skippedCandidates: any[] = [];

        // No deletable backup means there is nothing to confirm: report the
        // limit rather than the "every delete failed" case, which would be
        // misleading when nothing was ever attempted.
        if (evaluation.atLimit) {
          if (!data.confirmDeleteOldest || !evaluation.deletable.length) {
            return this.snapshotLimitResult(data.projectId, evaluation);
          }

          const freed = await this.freeSnapshotSlot(
            data.projectId,
            evaluation.deletable,
            { deadline },
          );
          freedSlot = freed.deleted;
          skippedCandidates = freed.skipped;

          // A deletion we could not confirm stops the eviction: the snapshot
          // may already be gone, so neither claiming the slot was freed nor
          // deleting the next backup is safe.
          if (freed.halted) {
            const halted = freed.halted;
            const what =
              halted.kind === "poll_failed"
                ? `could not be confirmed (${halted.reason ?? "its task status could not be read"})`
                : halted.kind === "timed_out"
                  ? "is still running"
                  : "was not attempted (the call ran out of time budget)";

            return withHints(
              {
                operation: "create",
                error: "eviction_incomplete",
                projectId: data.projectId,
                created: false,
                count: evaluation.count,
                assumedMax: evaluation.assumedMax,
                haltedOn: halted,
                ...(skippedCandidates.length ? { skippedCandidates } : {}),
              },
              {
                warning: `Freeing a slot stopped: deleting "${halted.snapshot.name}" ${what}. That backup may or may not still exist, so no other backup was deleted and no snapshot was created.`,
                action: halted.taskId
                  ? `Poll manage_snapshots { operation: "read_task", projectId: "${data.projectId}", taskId: "${halted.taskId}" } until it resolves, then re-run manage_snapshots { operation: "list" } before retrying create.`
                  : `Re-run manage_snapshots { operation: "list", projectId: "${data.projectId}" } to see the current state before retrying create.`,
              },
            );
          }

          if (!freedSlot) {
            return withHints(
              {
                operation: "create",
                error: "snapshot_limit_reached",
                projectId: data.projectId,
                created: false,
                count: evaluation.count,
                assumedMax: evaluation.assumedMax,
                skippedCandidates,
              },
              {
                warning:
                  "Could not free a slot: every plugin-created backup failed to delete (a snapshot in use by an endpoint cannot be deleted).",
                action:
                  "Report the skippedCandidates reasons to the user and ask them to free a slot in the Cognigy UI under Deploy > Snapshots.",
              },
            );
          }
        }

        const version = nextBackupVersion(
          existing,
          this.highestBackupVersionThisSession,
        );
        this.highestBackupVersionThisSession = version;
        const fields = buildAutoBackupFields(data.label, new Date(), version);
        const response: any = await this.apiClient.post("/new/v2.0/snapshots", {
          projectId: data.projectId,
          name: fields.name,
          description: fields.description,
        });

        const { taskId, task, timedOut, failReason, pollFailed, pollError } =
          await this.runSnapshotTask(response, data.projectId, {
            waitForCompletion: data.waitForCompletion,
            timeoutMs: ToolHandlers.remainingMs(deadline),
          });

        if (pollFailed) {
          return this.snapshotPollFailedResult(
            "create",
            data.projectId,
            taskId,
            pollError!,
            {
              // NOT false: `created: false` is what every other outcome uses to
              // mean "no backup exists, safe to retry", and a caller keying on
              // the boolean would mint the duplicate this path exists to avoid.
              created: null,
              name: fields.name,
              ...(freedSlot ? { deletedToFreeSlot: freedSlot } : {}),
              ...(skippedCandidates.length ? { skippedCandidates } : {}),
            },
          );
        }

        // The cap is enforced inside the resources service, so a create that got
        // past our pre-check (different installation limit, or a race) fails on
        // the TASK rather than the POST. Translate it into the same shape the
        // pre-check returns so the model only has one error to understand.
        if (failReason?.includes(SNAPSHOT_LIMIT_FAIL_REASON)) {
          const refreshed = evaluateSnapshotLimit(
            await this.listAllSnapshots(data.projectId),
          );
          return this.snapshotLimitResult(
            data.projectId,
            refreshed,
            failReason,
            { freedSlot, skippedCandidates },
          );
        }

        if (failReason) {
          return withHints(
            {
              operation: "create",
              projectId: data.projectId,
              created: false,
              taskId,
              failReason,
              ...(freedSlot ? { deletedToFreeSlot: freedSlot } : {}),
            },
            {
              warning: "The snapshot creation task failed.",
              action:
                "Report the failReason to the user. Nothing was backed up, so do not proceed as if a backup exists.",
            },
          );
        }

        if (data.waitForCompletion === false || timedOut) {
          return withHints(
            {
              operation: "create",
              projectId: data.projectId,
              created: false,
              pending: true,
              taskId,
              name: fields.name,
              task,
              ...(freedSlot ? { deletedToFreeSlot: freedSlot } : {}),
            },
            {
              warning:
                "Snapshot creation is still running; the backup does not exist yet.",
              action: `Poll manage_snapshots { operation: "read_task", projectId: "${data.projectId}", taskId: "${taskId}" } until it is done, then list to get the snapshot id.`,
            },
          );
        }

        // The create task does not carry the new snapshot's id — it is minted
        // inside the resources controller — so resolve it by name. `filter` is a
        // substring match on name, and the generated name carries a
        // second-resolution timestamp, so this is unambiguous.
        const matches = await this.listSnapshots(data.projectId, {
          filter: fields.name,
        });
        // Exact match only. A near-match would put the WRONG snapshot id into
        // the restore hint below — a restore to the wrong point in time wipes
        // the very changes this backup was taken to protect. The null path
        // already tells the caller to find the id with list.
        const created = matches.find((s: any) => s?.name === fields.name);

        this.snapshotCreatedForProject.add(data.projectId);
        this.releaseBackupGateHolds(data.projectId);

        return withHints(
          {
            operation: "create",
            projectId: data.projectId,
            created: true,
            taskId,
            snapshot: created ? summarizeSnapshot(created) : null,
            name: fields.name,
            notIncluded: SNAPSHOT_EXCLUSIONS,
            ...(freedSlot ? { deletedToFreeSlot: freedSlot } : {}),
            ...(skippedCandidates.length ? { skippedCandidates } : {}),
          },
          {
            warning:
              "This backup covers the WHOLE PROJECT but does NOT include Endpoints or Knowledge AI (stores, sources, chunks). Tell the user that, briefly, if the agent uses knowledge.",
            action: created
              ? `To roll back later, call manage_snapshots { operation: "restore", projectId: "${data.projectId}", snapshotId: "${summarizeSnapshot(created).id}" } for a preflight first.`
              : 'The snapshot was created but could not be resolved by name; use manage_snapshots { operation: "list" } to find its id.',
          },
        );
      }

      case "restore": {
        const snapshot = await this.readSnapshot(data.snapshotId);
        if (!snapshot) {
          return withHints(
            {
              operation: "restore",
              error: "snapshot_not_found",
              projectId: data.projectId,
              snapshotId: data.snapshotId,
              applied: false,
            },
            {
              action: `Use manage_snapshots { operation: "list", projectId: "${data.projectId}" } to find valid snapshot ids.`,
            },
          );
        }

        if (
          !(await this.snapshotBelongsToProject(
            data.snapshotId,
            data.projectId,
          ))
        ) {
          return this.snapshotProjectMismatchResult(
            "restore",
            data.projectId,
            data.snapshotId,
            snapshot,
          );
        }

        // Preflight: report and change nothing. This is the default on purpose —
        // restore is irreversible.
        if (!data.confirm) {
          return withHints(buildRestorePreflight(snapshot, data.projectId), {
            warning:
              "PREFLIGHT ONLY — nothing has been changed. Restoring is irreversible.",
            action: `Show the user the warnings above and get explicit agreement. Only then call manage_snapshots { operation: "restore", projectId: "${data.projectId}", snapshotId: "${data.snapshotId}", confirm: true }.`,
          });
        }

        // No request body: the platform resolves the project from the snapshot
        // id path param, and passing projectId here as well raises
        // "ProjectId was specified in multiple locations".
        const response: any = await this.apiClient.post(
          `/new/v2.0/snapshots/${data.snapshotId}/restore`,
        );

        const { taskId, task, timedOut, failReason, pollFailed, pollError } =
          await this.runSnapshotTask(response, data.projectId, {
            waitForCompletion: data.waitForCompletion,
            timeoutMs: data.timeoutMs,
          });

        if (pollFailed) {
          return this.snapshotPollFailedResult(
            "restore",
            data.projectId,
            taskId,
            pollError!,
            {
              snapshotId: data.snapshotId,
              warnings: RESTORE_WARNINGS,
            },
          );
        }

        if (failReason) {
          return withHints(
            {
              operation: "restore",
              projectId: data.projectId,
              snapshotId: data.snapshotId,
              applied: false,
              taskId,
              failReason,
            },
            {
              warning:
                "The restore task failed. The project may be in a partially restored state.",
              action:
                "Report the failReason and tell the user to check the project in the Cognigy UI before making further changes.",
            },
          );
        }

        if (data.waitForCompletion === false || timedOut) {
          return withHints(
            {
              operation: "restore",
              projectId: data.projectId,
              snapshotId: data.snapshotId,
              applied: true,
              pending: true,
              taskId,
              task,
            },
            {
              warning:
                "The restore is running. The project is mid-rebuild — do not read or change resources until it finishes.",
              action: `Poll manage_snapshots { operation: "read_task", projectId: "${data.projectId}", taskId: "${taskId}" } until it is done.`,
            },
          );
        }

        return withHints(
          {
            operation: "restore",
            projectId: data.projectId,
            snapshotId: data.snapshotId,
            applied: true,
            taskId,
            task,
            snapshot: summarizeSnapshot(snapshot),
            warnings: RESTORE_WARNINGS,
          },
          {
            warning:
              "Every resource id in this project changed. Ids from earlier in this conversation are now stale.",
            action:
              "Re-list the project's agents and flows before doing anything else, and remind the user to check Endpoints on non-primary locales in the UI.",
          },
        );
      }

      case "delete": {
        const snapshot = await this.readSnapshot(data.snapshotId);
        if (!snapshot) {
          return withHints(
            {
              operation: "delete",
              error: "snapshot_not_found",
              projectId: data.projectId,
              snapshotId: data.snapshotId,
              deleted: false,
            },
            {
              action: `Use manage_snapshots { operation: "list", projectId: "${data.projectId}" } to find valid snapshot ids.`,
            },
          );
        }

        // The deletion gate. Only snapshots carrying BOTH plugin markers may be
        // deleted here; a human-created snapshot is never the plugin's to remove.
        if (!isAutoBackup(snapshot)) {
          return withHints(
            {
              operation: "delete",
              error: "not_a_plugin_backup",
              projectId: data.projectId,
              snapshotId: data.snapshotId,
              deleted: false,
              snapshot: summarizeSnapshot(snapshot),
            },
            {
              warning: `"${snapshot.name}" was not created by this plugin, so the plugin will not delete it.`,
              action: `Tell the user that only snapshots named "${AUTO_BACKUP_NAME_PREFIX}…" and created by this plugin can be deleted here, and that they can delete this one themselves in the Cognigy UI under Deploy > Snapshots.`,
            },
          );
        }

        if (
          !(await this.snapshotBelongsToProject(
            data.snapshotId,
            data.projectId,
          ))
        ) {
          return this.snapshotProjectMismatchResult(
            "delete",
            data.projectId,
            data.snapshotId,
            snapshot,
          );
        }

        const response: any = await this.apiClient.delete(
          `/new/v2.0/snapshots/${data.snapshotId}`,
        );

        const { taskId, task, timedOut, failReason, pollFailed, pollError } =
          await this.runSnapshotTask(response, data.projectId, {
            waitForCompletion: data.waitForCompletion,
            timeoutMs: data.timeoutMs,
          });

        if (pollFailed) {
          return this.snapshotPollFailedResult(
            "delete",
            data.projectId,
            taskId,
            pollError!,
            { snapshotId: data.snapshotId, deleted: false },
          );
        }

        if (failReason) {
          const inUse = failReason.includes(SNAPSHOT_IN_USE_FAIL_REASON);
          return withHints(
            {
              operation: "delete",
              projectId: data.projectId,
              snapshotId: data.snapshotId,
              deleted: false,
              taskId,
              failReason,
              ...(inUse ? { inUseByEndpoint: true } : {}),
            },
            {
              warning: inUse
                ? "This snapshot is deployed to an endpoint, so the platform refuses to delete it."
                : "The snapshot deletion task failed.",
              action: inUse
                ? "Tell the user to point that endpoint at a different snapshot in the Cognigy UI first, then retry."
                : "Report the failReason to the user.",
            },
          );
        }

        // waitForCompletion:false returns before the task runs, so the
        // snapshot is NOT gone yet — same pending shape as create/restore.
        const stillRunning = data.waitForCompletion === false || timedOut;
        if (stillRunning) {
          return withHints(
            {
              operation: "delete",
              projectId: data.projectId,
              snapshotId: data.snapshotId,
              deleted: false,
              pending: true,
              taskId,
              task,
            },
            {
              warning:
                "The deletion task is still running; the snapshot has not been deleted yet.",
              action: `Poll manage_snapshots { operation: "read_task", projectId: "${data.projectId}", taskId: "${taskId}" } until it is done.`,
            },
          );
        }

        return {
          operation: "delete",
          projectId: data.projectId,
          snapshotId: data.snapshotId,
          deleted: true,
          taskId,
          task,
        };
      }

      // Records that the user was asked and said no, so the backup gate stops
      // holding calls FOR THIS PROJECT. Another project touched later in the
      // same session is still held once. Touches no API.
      case "decline": {
        this.backupDeclinedForProject.add(data.projectId);
        this.releaseBackupGateHolds(data.projectId);
        return {
          operation: "decline",
          projectId: data.projectId,
          acknowledged: true,
          note: "No backup will be taken for this project. Changes to it are not reversible through this plugin. A different project touched later still gets its own backup offer.",
        };
      }

      case "read_task": {
        const task = await this.readTask(data.taskId, data.projectId);
        return {
          operation: "read_task",
          projectId: data.projectId,
          task: normalizeTask(task),
        };
      }
    }
  }

  // =========================================================================
  // Main dispatcher
  // =========================================================================
  async handleToolCall(toolName: string, args: any): Promise<any> {
    logger.info(`Handling tool call: ${toolName}`, {
      args: this.sanitizeArgs(args),
    });

    try {
      // Before anything mutates an existing agent, give the user one chance to
      // take a backup. Must precede the switch — a post-hoc hint arrives after
      // the change and is therefore useless.
      if (
        ToolHandlers.isBackupWorthyCall(toolName, args) &&
        !this.targetsNewResource(args)
      ) {
        const gate = this.backupGateFor(toolName, args);
        if (gate) {
          logger.info(`Backup gate held ${toolName} for a backup offer`);
          return gate;
        }
      }

      let result: any;
      switch (toolName) {
        case "create_ai_agent":
          result = await this.handleCreateAiAgent(args);
          break;
        case "update_ai_agent":
          result = await this.handleUpdateAiAgent(args);
          break;
        case "setup_llm":
          result = await this.handleSetupLlm(args);
          break;
        case "talk_to_agent":
          result = await this.handleTalkToAgent(args);
          break;
        case "list_resources":
          result = await this.handleListResources(args);
          break;
        case "get_resource":
          result = await this.handleGetResource(args);
          break;
        case "delete_resource":
          result = await this.handleDeleteResource(args);
          break;
        case "manage_knowledge":
          result = await this.handleManageKnowledge(args);
          break;
        case "create_tool":
          result = await this.handleCreateTool(args);
          break;
        case "update_tool":
          result = await this.handleUpdateTool(args);
          break;
        case "manage_flow_nodes":
          result = await this.handleManageFlowNodes(args);
          break;
        case "manage_packages":
          result = await this.handleManagePackages(args);
          break;
        case "manage_webchat":
          result = await this.handleManageWebchat(args);
          break;
        case "manage_voice_gateway":
          result = await this.handleManageVoiceGateway(args);
          break;
        case "manage_settings":
          result = await this.handleManageSettings(args);
          break;
        case "audit_voice_agent":
          result = await this.handleAuditVoiceAgent(args);
          break;
        case "manage_snapshots":
          result = await this.handleManageSnapshots(args);
          break;
        default:
          throw new Error(`Unknown tool: ${toolName}`);
      }
      // Reads teach the gate which project a resource belongs to, so a later
      // update_ai_agent { aiAgentId } is scoped to the right project instead of
      // falling back to session-wide state.
      this.learnProjectIds(result);

      logger.info(`Tool call successful: ${toolName}`);
      return result;
    } catch (error: any) {
      logger.error(`Tool call failed: ${toolName}`, { error: error.message });
      throw error;
    }
  }
}

// Reserved: per-type detail-view filters for get_resource (falls back to RESOURCE_FILTERS when empty)
const RESOURCE_FILTERS_GET: Record<string, (raw: any) => any> = {};
