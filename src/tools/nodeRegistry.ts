/**
 * Flow Node Registry — allowlist of node types exposed through manage_flow_nodes.
 *
 * To support a new node type:
 *   1. Add an entry here
 *   2. Document it in plugin/skills/flow-nodes/SKILL.md
 *
 * The registry is intentionally separate from tool definitions so new node
 * types never require schema or tool-definition changes.
 */

export interface NodeRegistryEntry {
  /** Internal Cognigy node type string (e.g. 'say') */
  type: string;
  /** Extension that provides this node */
  extension: string;
  /** Human-readable category for docs */
  category: "message" | "logic" | "data" | "service" | "handover" | "nlu";
  /** Short description (shown in error messages) */
  summary: string;
  /**
   * Where this node can be placed:
   *   'flow'  — direct child of entry node / after any sibling
   *   'child' — must be appended inside a parent node (e.g. If-then branch)
   * Most nodes use 'flow'.
   */
  placement: "flow" | "child";
  /** Config keys that the API accepts. Used for validation hints — not enforced. */
  configKeys: string[];
  /** Keys that are required for the node to function. */
  requiredConfigKeys: string[];
}

export const NODE_REGISTRY: Record<string, NodeRegistryEntry> = {
  say: {
    type: "say",
    extension: "@cognigy/basic-nodes",
    category: "message",
    summary:
      "Send a text message (with optional quick replies, buttons, gallery, list, audio, video, image, or adaptive card output)",
    placement: "flow",
    configKeys: [
      "text",
      "quickReplies",
      "buttons",
      "gallery",
      "list",
      "audio",
      "video",
      "image",
      "adaptiveCard",
      "data",
      "alternateChannel",
    ],
    requiredConfigKeys: ["text"],
  },

  question: {
    type: "question",
    extension: "@cognigy/basic-nodes",
    category: "message",
    summary: "Ask the user a question and store the answer in the input object",
    placement: "flow",
    configKeys: [
      "text",
      "type",
      "quickReplies",
      "buttons",
      "gallery",
      "list",
      "validation",
      "resultLocation",
      "data",
    ],
    requiredConfigKeys: ["text", "type"],
  },

  ifThenElse: {
    type: "if",
    extension: "@cognigy/basic-nodes",
    category: "logic",
    summary: "Branch flow based on a CognigyScript condition",
    placement: "flow",
    configKeys: ["condition"],
    requiredConfigKeys: ["condition"],
  },

  lookup: {
    type: "switch",
    extension: "@cognigy/basic-nodes",
    category: "logic",
    summary:
      "Multi-branch switch on intent, state, type, or CognigyScript expression",
    placement: "flow",
    configKeys: ["type", "condition", "cases"],
    requiredConfigKeys: ["type"],
  },

  setSessionContext: {
    type: "addToContext",
    extension: "@cognigy/basic-nodes",
    category: "data",
    summary: "Store a key-value pair in the session context object",
    placement: "flow",
    configKeys: ["key", "value", "contextEntries"],
    requiredConfigKeys: ["key", "value"],
  },

  code: {
    type: "code",
    extension: "@cognigy/basic-nodes",
    category: "data",
    summary:
      "Execute custom TypeScript (transpiled server-side) with access to input, context, actions, and profile objects",
    placement: "flow",
    configKeys: ["code"],
    requiredConfigKeys: ["code"],
  },

  goTo: {
    type: "goTo",
    extension: "@cognigy/basic-nodes",
    category: "logic",
    summary:
      "Transfer execution to another flow or a specific node within the current flow",
    placement: "flow",
    configKeys: [
      "flowNode",
      "absorbContext",
      "executionMode",
      "injectedText",
      "injectedData",
    ],
    requiredConfigKeys: [],
  },

  sleep: {
    type: "sleep",
    extension: "@cognigy/basic-nodes",
    category: "logic",
    summary: "Pause execution for a specified duration in milliseconds",
    placement: "flow",
    configKeys: ["milliseconds"],
    requiredConfigKeys: ["milliseconds"],
  },

  httpRequest: {
    type: "httpRequest",
    extension: "@cognigy/basic-nodes",
    category: "service",
    summary: "Make an HTTP request to an external API",
    placement: "flow",
    configKeys: [
      "url",
      "type",
      "headers",
      "payloadType",
      "payloadJSON",
      "payloadText",
      "contextStore",
      "inputStore",
      "storeLocation",
      "contextKey",
      "inputKey",
    ],
    requiredConfigKeys: ["url"],
  },

  initAppSession: {
    type: "initAppSession",
    extension: "@cognigy/basic-nodes",
    category: "message",
    summary:
      "xApp: Init Session — creates an xApp session and populates input.apps.url / input.apps.baseUrl. MUST run before any other xApp node (setHTMLAppState, setAdaptiveCardAppState, setAppState, getAppSessionPin).",
    placement: "flow",
    configKeys: [
      "backgroundColor",
      "textColor",
      "logo",
      "logoUrl",
      "faviconUrl",
      "pageTitle",
      "appLoadingText",
      "appLaunchErrorText",
      "appErrorText",
      "intermediateScreenCustomizationType",
      "intermediateScreenOverrideText",
      "intermediateScreenAppTemplateId",
      "intermediateScreenAppTemplateData",
      "connectionScreenCustomizationType",
      "connectionScreenOverrideConnectingText",
      "connectionScreenOverrideInvalidText",
      "connectionScreenOverrideUnavailableText",
      "connectionScreenAppTemplateId",
      "connectionScreenAppTemplateData",
    ],
    requiredConfigKeys: [],
  },

  showXAppHtml: {
    type: "setHTMLAppState",
    extension: "@cognigy/basic-nodes",
    category: "message",
    summary:
      "xApp: Show HTML — render custom HTML in the xApp. Optionally wait for the user's SDK.submit() result. Requires a preceding initAppSession node.",
    placement: "flow",
    configKeys: [
      "mode",
      "html",
      "body",
      "waitForInput",
      "storeResultInContext",
      "contextKey",
      "autoOpen",
      "closeOnSubmit",
      "feedbackMessage",
      "screenTitle",
      "sendEventOnCloseIconClick",
      "showCloseIcon",
    ],
    requiredConfigKeys: [],
  },

  showXAppAdaptiveCard: {
    type: "setAdaptiveCardAppState",
    extension: "@cognigy/basic-nodes",
    category: "message",
    summary:
      "xApp: Show Adaptive Card — render an Adaptive Card in the xApp. Optionally wait for the user's submit result. Requires a preceding initAppSession node.",
    placement: "flow",
    configKeys: [
      "card",
      "primaryColor",
      "primaryContrastColor",
      "waitForInput",
      "storeResultInContext",
      "contextKey",
      "autoOpen",
      "closeOnSubmit",
      "feedbackMessage",
      "screenTitle",
      "sendEventOnCloseIconClick",
      "showCloseIcon",
    ],
    requiredConfigKeys: ["card"],
  },

  setXAppState: {
    type: "setAppState",
    extension: "@cognigy/basic-nodes",
    category: "message",
    summary:
      "xApp: Set State — render a Cognigy App Template by id with data. Requires a preceding initAppSession node.",
    placement: "flow",
    configKeys: ["appTemplateId", "appTemplateData"],
    requiredConfigKeys: ["appTemplateId"],
  },

  getXAppSessionPin: {
    type: "getAppSessionPin",
    extension: "@cognigy/basic-nodes",
    category: "service",
    summary:
      "xApp: Get Session PIN — retrieve a short-lived session PIN into input.apps.session.pin (and PIN page URL into input.apps.baseUrl). Requires a preceding initAppSession node.",
    placement: "flow",
    configKeys: [],
    requiredConfigKeys: [],
  },

  setSessionConfig: {
    type: "setSessionConfig",
    extension: "@cognigy/voicegateway2",
    category: "service",
    summary:
      "Set per-session Voice Gateway speech config (barge-in, ASR, STT/TTS, input timeouts). For voice flows this should be the FIRST node, before the AI Agent node — the one documented exception to the no-pre-agent-nodes rule.",
    placement: "flow",
    configKeys: [
      "bargeInOnSpeech",
      "bargeInOnDtmf",
      "asrEnabled",
      "userNoInputTimeoutEnable",
      "userNoInputTimeout",
      "userNoInputRetries",
      "flowNoInputTimeoutEnable",
      "flowNoInputTimeout",
      "flowNoInputSpeech",
      "flowNoInputFail",
      "sttVendor",
      "sttLabel",
      "sttHints",
      "sttHintsDynamicHints",
      "ttsVendor",
      "ttsLabel",
      "silenceOverlayAction",
      "silenceOverlayURL",
      "silenceOverlayDelay",
      "atmosphereAction",
      "atmosphereUrl",
      "atmosphereLoop",
      "atmosphereVolume",
    ],
    requiredConfigKeys: [],
  },
};

/** Return a registry entry or null if the node type is not supported. */
export function getNodeEntry(nodeType: string): NodeRegistryEntry | null {
  return NODE_REGISTRY[nodeType] ?? null;
}

/** List all supported node type keys. */
export function supportedNodeTypes(): string[] {
  return Object.keys(NODE_REGISTRY);
}
