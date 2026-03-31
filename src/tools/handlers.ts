import { createReadStream, readFileSync, existsSync, statSync } from "fs";
import { basename, isAbsolute } from "path";
import { randomUUID } from "crypto";
import axios from "axios";
import { CognigyApiClient } from "../api/client.js";
import { logger } from "../utils/logger.js";
import { filterResponse, filterList, withHints } from "./filters.js";
import { buildWebchatSettings, deepMerge } from "./webchatSettings.js";
import { getNodeEntry, supportedNodeTypes } from "./nodeRegistry.js";
import * as schemas from "../schemas/tools.js";
import { buildPackageImportPreview, normalizeTask } from "./packageImport.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_AGENT_IMAGE = "default-avatar:1";

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

const PROVIDER_CONNECTION_TYPE: Record<string, string> = {
  openAI: "OpenAIProvider",
  azureOpenAI: "AzureOpenAIProviderV2",
  anthropic: "AnthropicProvider",
  google: "GoogleVertexAIProvider",
  mistral: "MistralProvider",
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
  const projectId = agent.projectId || agent.project?._id || agent.project?.id;
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
  private static readonly TASK_POLL_INTERVAL_MS = 3000;

  constructor(
    private apiClient: CognigyApiClient,
    private endpointBaseUrl: string,
    private webchatBaseUrl: string = "",
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
      throw new Error(task.failReason || `Task ${taskId} failed`);
    }

    if (task.status === "cancelled" || task.status === "cancelling") {
      throw new Error(`Task ${taskId} was cancelled`);
    }

    if (task.status !== "done") {
      throw new Error(
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
              { config: { llmProviderReferenceId: llmRefId } },
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

      // Step 4c: Patch the node preview so the flow editor displays the agent image
      try {
        await this.apiClient.patch(
          `/v2.0/flows/${flowId}/chart/nodes/${jobNodeId}`,
          {
            preview: {
              keyValue: data.name,
              aiAgentName: agent.name ?? data.name,
              aiAgentImage: agent.image ?? DEFAULT_AGENT_IMAGE,
              aiAgentImageOptimizedFormat: agent.imageOptimizedFormat ?? true,
            },
          },
        );
      } catch (previewError: any) {
        logger.warn(
          "Failed to set job node preview — agent image may not appear in the flow editor",
          { error: previewError.message },
        );
      }

      // Step 4d: If knowledge store provided, create a knowledge tool on the job node
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
        return withHints(result, {
          warning:
            "Could not verify LLM resource in project. Agent may not generate responses.",
          resource: "cognigy://guide/agent-creation",
          action: `Run setup_llm with projectId "${projectId}" before talk_to_agent if no LLM is configured.`,
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
          resource: "cognigy://guide/troubleshooting",
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
              resource: "cognigy://guide/agent-creation",
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
                resource: "cognigy://guide/agent-creation",
                action: "Ensure the agent was created via create_ai_agent.",
              },
            );
          }
        } else {
          const jobNodeId = jobNode._id || jobNode.id;
          const nodePatch: Record<string, any> = {};

          if (needsJobPatch) {
            const nodeConfigPatch: Record<string, any> = {};
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
            nodePatch.config = nodeConfigPatch;
          }

          if (needsPreviewPatch) {
            const currentAgent = agentResult ?? resolved.agent;
            const previewName =
              jobConfig?.jobName ??
              jobNode.config?.name ??
              currentAgent?.name ??
              rest.name;
            nodePatch.preview = {
              keyValue: previewName,
              aiAgentName: currentAgent?.name ?? rest.name,
              aiAgentImage: currentAgent?.image ?? DEFAULT_AGENT_IMAGE,
              aiAgentImageOptimizedFormat:
                currentAgent?.imageOptimizedFormat ?? true,
            };
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
          resource: "cognigy://guide/llm-providers",
          action: "Read the provider guide for credential requirements.",
        },
      );
    }

    let connectionRefId = data.connectionId;

    // If apiKey is provided, auto-create a Connection first
    if (data.apiKey && !connectionRefId) {
      try {
        const connection: any = await this.apiClient.post("/v2.0/connections", {
          projectId: data.projectId,
          name: `${data.provider} - auto`,
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
            resource: "cognigy://guide/llm-providers",
            action: "Check API key and provider, then retry.",
          },
        );
      }
    }

    const displayName = data.name || data.modelType;

    let result: any;
    try {
      result = await this.apiClient.post("/v2.0/largelanguagemodels", {
        projectId: data.projectId,
        name: displayName,
        modelType: data.modelType,
        provider: data.provider,
        connectionId: connectionRefId,
        isDefault: data.isDefault ?? true,
        [data.provider]: {},
      });
    } catch (error: any) {
      return withHints(
        { error: error.message },
        {
          resource: "cognigy://guide/llm-providers",
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
          resource: "cognigy://guide/llm-providers",
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
            resource: "cognigy://guide/llm-providers",
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
          resource: "cognigy://guide/llm-providers",
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

    const payload: any = { userId, sessionId, text: data.message };
    if (data.data) payload.data = data.data;

    try {
      const response = await axios.post(data.endpointUrl, payload, {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        timeout: 30000,
      });

      let agentResponse = response.data.text || "";
      const outputStack = response.data.outputStack || [];
      const textOutputs = outputStack
        .filter((o: any) => o.text?.trim())
        .map((o: any) => o.text);
      if (textOutputs.length > 0) agentResponse = textOutputs.join(" ");

      const result: any = { agentResponse, sessionId };

      if (data.verbose) {
        result.rawResponse = response.data;
      }

      if (!agentResponse) {
        return withHints(result, {
          likely_cause:
            "Agent returned no text. Possible causes: 1) no LLM configured, 2) empty agent description, 3) endpoint not connected to flow.",
          resource: "cognigy://guide/troubleshooting",
          action: "Read the troubleshooting guide for diagnostic steps.",
        });
      }

      return result;
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
        },
        {
          likely_cause: "Endpoint URL invalid or expired.",
          resource: "cognigy://guide/troubleshooting",
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
    const { resourceType, projectId, aiAgentId, limit, skip } = data;
    const paging = { limit: limit ?? 25, skip: skip ?? 0 };

    // Validate projectId requirement
    if (resourceType !== "project" && resourceType !== "tool" && !projectId) {
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
        const res: any = await this.apiClient.get("/v2.0/largelanguagemodels", {
          params: { projectId, ...paging },
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
              resource: "cognigy://guide/tools-setup",
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

    if (filtered.length === 0 && resourceType === "agent") {
      return withHints(result, {
        hint: "No agents found.",
        resource: "cognigy://guide/agent-creation",
      });
    }

    return result;
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
    };

    const url = endpointMap[resourceType];
    if (!url) throw new Error(`Unknown resourceType: ${resourceType}`);

    const result = await this.apiClient.get(url);
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
            resource: "cognigy://guide/tools-setup",
            action: "Ensure agent was created via create_ai_agent.",
          },
        );
      }
      await this.apiClient.delete(
        `/v2.0/flows/${resolved.flowId}/chart/nodes/${id}`,
      );
      return { deleted: true, resourceType: "tool", id };
    }

    // Agent deletion requires cascade: endpoints → flow → agent.
    // The Cognigy API rejects agent deletion while referencing resources exist.
    if (resourceType === "agent") {
      if (cascade === false) {
        await this.apiClient.delete(`/v2.0/aiagents/${id}`);
        return { deleted: true, resourceType, id };
      }
      return this.cascadeDeleteAgent(id);
    }

    const deleteMap: Record<string, string> = {
      flow: `/v2.0/flows/${id}`,
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
   * Cascade-delete an AI Agent and all resources provisioned alongside it:
   * 1. Resolve the agent's flow
   * 2. Delete every endpoint pointing at that flow
   * 3. Delete the flow itself
   * 4. Delete the agent resource
   */
  private async cascadeDeleteAgent(agentId: string): Promise<any> {
    const deleted: string[] = [];
    const failed: { resource: string; error: string }[] = [];

    const resolved = await resolveFlowForAgent(this.apiClient, agentId);
    const agent = resolved?.agent;
    const flowId = resolved?.flowId;
    const projectId =
      agent?.projectId ?? agent?.project?._id ?? agent?.project?.id;

    // Step 1: delete endpoints that reference the agent's flow
    if (flowId && projectId) {
      try {
        const flowRef =
          agent?.flowReferenceId ??
          ((await this.apiClient.get(`/v2.0/flows/${flowId}`)) as any)
            .referenceId;
        if (flowRef) {
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
              if (ep.flowId === flowRef || ep.flowId === flowId) {
                const epId = ep._id || ep.id;
                try {
                  await this.apiClient.delete(`/v2.0/endpoints/${epId}`);
                  deleted.push(`endpoint:${epId}`);
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
        }
      } catch (e: any) {
        // best-effort — continue with flow/agent deletion, but record partial failure
        failed.push({
          resource: `endpoints:list:${projectId}`,
          error: e?.message ?? String(e),
        });
      }
    }

    // Step 2: delete the flow
    if (flowId) {
      try {
        await this.apiClient.delete(`/v2.0/flows/${flowId}`);
        deleted.push(`flow:${flowId}`);
      } catch (e: any) {
        failed.push({
          resource: `flow:${flowId}`,
          error: e.message ?? String(e),
        });
      }
    }

    // Step 3: delete the agent
    try {
      await this.apiClient.delete(`/v2.0/aiagents/${agentId}`);
      deleted.push(`agent:${agentId}`);
    } catch (e: any) {
      failed.push({
        resource: `agent:${agentId}`,
        error: e.message ?? String(e),
      });
    }

    const allSucceeded =
      failed.length === 0 && deleted.includes(`agent:${agentId}`);
    return {
      deleted: allSucceeded,
      resourceType: "agent",
      id: agentId,
      cascade: { deleted, failed: failed.length > 0 ? failed : undefined },
    };
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
              resource: "cognigy://guide/knowledge-setup",
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
              resource: "cognigy://guide/knowledge-setup",
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
            resource: "cognigy://guide/knowledge-setup",
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
                resource: "cognigy://guide/knowledge-setup",
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
          resource: "cognigy://guide/tools-setup",
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
          resource: "cognigy://guide/tools-setup",
          action:
            "Ensure the agent was created via create_ai_agent (which provisions the aiAgentJob node).",
        },
      );
    }

    // Step 3: Create the tool node
    const mapping = TOOL_TYPE_MAP[data.toolType];
    if (!mapping) throw new Error(`Unknown toolType: ${data.toolType}`);

    const nodeConfig: any = {};
    const cfg = data.config;
    switch (data.toolType) {
      case "tool":
        if (cfg.toolId) nodeConfig.toolId = cfg.toolId;
        if (cfg.description) nodeConfig.description = cfg.description;
        if (cfg.parameters) {
          nodeConfig.useParameters = true;
          nodeConfig.parameters = cfg.parameters;
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
          nodeConfig.useParameters = true;
          nodeConfig.parameters = cfg.parameters;
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
          const resolveNode: any = await this.apiClient.post(
            `/v2.0/flows/${flowId}/chart/nodes`,
            {
              type: resolveSpec.type,
              extension: "@cognigy/basic-nodes",
              mode: "append",
              target: toolNodeId,
              label: resolveSpec.label,
              config: resolveConfig,
            },
          );
          resolveNodeId = resolveNode._id || resolveNode.id;
          if (resolveNodeId) createdNodeIds.push(resolveNodeId);
        }

        return {
          toolId: toolNodeId,
          name: data.name,
          toolType: data.toolType,
          ...(resolveNodeId ? { resolveNodeId } : {}),
        };
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
        return withHints(
          { error: error.message },
          { resource: "cognigy://guide/tools-setup", action },
        );
      }
    }

    // HTTP tool: parent aiAgentJobTool + child httpRequest (+ optional Code nodes)
    if (!cfg.url) {
      return withHints(
        { error: "url is required in config for http tool type." },
        {
          resource: "cognigy://guide/tools-setup",
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
          label: "Resolve Tool Action",
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

      return {
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
      return withHints(
        { error: error.message },
        { resource: "cognigy://guide/tools-setup", action },
      );
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
          resource: "cognigy://guide/tools-setup",
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
    if (data.name) patchPayload.label = data.name;

    if (cfg) {
      const nodeConfig: any = {};

      if (toolType === "tool" || toolType === "http" || !toolType) {
        if (cfg.toolId) nodeConfig.toolId = cfg.toolId;
        if (cfg.description) nodeConfig.description = cfg.description;
        if (cfg.parameters) {
          nodeConfig.useParameters = true;
          nodeConfig.parameters = cfg.parameters;
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
          params: { limit: 100 },
        },
      );
      const allNodes = nodes.items ?? nodes;
      const childNodes = (Array.isArray(allNodes) ? allNodes : []).filter(
        (n: any) =>
          n.parentId === data.toolNodeId || n.parent === data.toolNodeId,
      );

      if (hasHttpUpdates) {
        const httpNode = childNodes.find((n: any) => n.type === "httpRequest");
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
            "HTTP node not found — http config was not updated",
          );
        }
      }

      if (cfg.preProcessCode !== undefined) {
        const codeNodes = childNodes.filter((n: any) => n.type === "code");
        const preNode =
          codeNodes.find(
            (n: any) =>
              n.label?.includes("Pre-Process") ||
              n.label?.includes("pre-process"),
          ) ?? codeNodes[0];
        if (preNode) {
          await this.apiClient.patch(
            `/v2.0/flows/${flowId}/chart/nodes/${preNode._id || preNode.id}`,
            { config: { code: cfg.preProcessCode } },
          );
          updatedFields.push("preProcessCode");
        } else {
          skippedUpdates.push(
            "Pre-process Code node not found — preProcessCode was not updated",
          );
        }
      }

      if (cfg.postProcessCode !== undefined) {
        const codeNodes = childNodes.filter((n: any) => n.type === "code");
        const postNode =
          codeNodes.find(
            (n: any) =>
              n.label?.includes("Post-Process") ||
              n.label?.includes("post-process"),
          ) ??
          (codeNodes.length > 1 ? codeNodes[codeNodes.length - 1] : undefined);
        if (postNode) {
          await this.apiClient.patch(
            `/v2.0/flows/${flowId}/chart/nodes/${postNode._id || postNode.id}`,
            { config: { code: cfg.postProcessCode } },
          );
          updatedFields.push("postProcessCode");
        } else {
          skippedUpdates.push(
            "Post-process Code node not found — postProcessCode was not updated",
          );
        }
      }

      if (cfg.toolResponseValue !== undefined) {
        const resolveNode = childNodes.find(
          (n: any) => n.type === "aiAgentToolAnswer",
        );
        if (resolveNode) {
          await this.apiClient.patch(
            `/v2.0/flows/${flowId}/chart/nodes/${resolveNode._id || resolveNode.id}`,
            { config: { answer: cfg.toolResponseValue } },
          );
          updatedFields.push("toolResponseValue");
        } else {
          skippedUpdates.push(
            "Resolve Tool Action node not found — toolResponseValue was not updated",
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
        warning: `Some updates were skipped: ${skippedUpdates.join("; ")}`,
        action:
          "Child nodes may not exist yet. Use create_tool with http type to create the full node tree, or verify the tool structure.",
      });
    }

    return response;
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

      // ----- CREATE -----
      case "create": {
        if (!data.nodeType) {
          return withHints(
            { error: "nodeType is required for create operation." },
            {
              resource: "cognigy://guide/flow-nodes",
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
              resource: "cognigy://guide/flow-nodes",
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
              resource: "cognigy://guide/flow-nodes",
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

        return {
          nodeId,
          type: entry.type,
          label: data.label,
          ...(actualParentId ? { parentId: actualParentId } : {}),
          targetNodeId,
          mode,
          configApplied: data.config ? Object.keys(data.config) : [],
        };
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
              const existingConfig = existingNode?.config ?? {};
              patchPayload.config = deepMerge(existingConfig, transformed);
            }
            if (Object.keys(patchPayload).length > 0) {
              await this.apiClient.patch(
                `/v2.0/flows/${flowId}/chart/nodes/${data.nodeId}`,
                patchPayload,
              );
            }
            return {
              updated: true,
              nodeId: data.nodeId,
              ...(data.label ? { label: data.label } : {}),
              ...(data.config
                ? { configUpdated: Object.keys(data.config) }
                : {}),
              casesUpdated: caseResults,
            };
          } else {
            const transformed = transformConfigForApi(nodeType, data.config);
            const existingConfig = existingNode?.config ?? {};
            patchPayload.config = deepMerge(existingConfig, transformed);
          }
        }

        await this.apiClient.patch(
          `/v2.0/flows/${flowId}/chart/nodes/${data.nodeId}`,
          patchPayload,
        );

        return {
          updated: true,
          nodeId: data.nodeId,
          ...(data.label ? { label: data.label } : {}),
          ...(data.config ? { configUpdated: Object.keys(data.config) } : {}),
        };
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

        return { deleted: true, nodeId: data.nodeId };
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
            resource: "cognigy://guide/webchat-setup",
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
            resource: "cognigy://guide/webchat-setup",
            action:
              "Provide flowId. Use list_resources { resourceType: 'flow', projectId } to find one, or create an agent first with create_ai_agent.",
          },
        );
      }

      let localeId: string | undefined;
      try {
        const flow: any = await this.apiClient.get(
          `/v2.0/flows/${data.flowId}`,
        );
        localeId = flow?.localeReference;
      } catch {
        // Non-critical
      }

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
            resource: "cognigy://guide/webchat-setup",
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
          resource: "cognigy://guide/webchat-setup",
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
          resource: "cognigy://guide/webchat-setup",
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
  // Main dispatcher
  // =========================================================================
  async handleToolCall(toolName: string, args: any): Promise<any> {
    logger.info(`Handling tool call: ${toolName}`, {
      args: this.sanitizeArgs(args),
    });

    try {
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
        default:
          throw new Error(`Unknown tool: ${toolName}`);
      }
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
