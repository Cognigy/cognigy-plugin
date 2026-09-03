import { z } from "zod";
import { validateCodeNode } from "../tools/codeNodeValidation.js";

const idSchema = z.string().regex(/^[a-f0-9]{24}$/, "Must be a 24-char hex ID");

/**
 * Rejects a Code Node `code` field that is certain to fail on the platform
 * (see codeNodeValidation.ts). Non-blocking warnings are not raised here — a
 * refinement can only reject — the handler attaches them after the write.
 * No-ops when the field is absent (the caller isn't setting this code).
 */
function refineCodeField(
  ctx: z.RefinementCtx,
  code: unknown,
  path: (string | number)[],
) {
  if (code === undefined) return;
  if (typeof code !== "string") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: "must be a string of TypeScript/JavaScript source",
    });
    return;
  }
  const { errors } = validateCodeNode(code);
  if (errors.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: errors.join(" "),
    });
  }
}

const paginationSchema = {
  limit: z.number().int().min(1).max(100).optional(),
  skip: z.number().int().min(0).optional(),
};

// Tool 1: create_ai_agent
export const createAiAgentSchema = z.object({
  projectId: idSchema.optional(),
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  knowledgeStoreReferenceId: z.string().optional(),
});

// Tool 2: update_ai_agent
export const updateAiAgentSchema = z.object({
  aiAgentId: idSchema,
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  instructions: z.string().optional(),
  jobConfig: z
    .object({
      llmProviderReferenceId: z.string().optional(),
      jobName: z.string().optional(),
      jobDescription: z.string().optional(),
      jobInstructions: z.string().optional(),
      temperature: z.number().min(0).max(1).optional(),
      maxTokens: z.number().int().min(100).max(8000).optional(),
    })
    .optional(),
});

// Tool 3: setup_llm
export const setupLlmSchema = z
  .object({
    projectId: idSchema,
    provider: z.enum([
      "openAI",
      "azureOpenAI",
      "anthropic",
      "google",
      "mistral",
      "openAICompatible",
    ]),
    modelType: z.string().min(1),
    name: z.string().optional(),
    apiKey: z.string().optional(),
    connectionId: z.string().optional(),
    isDefault: z.boolean().optional(),
    baseCustomUrl: z.string().url().optional(),
    customModel: z.string().min(1).optional(),
    customAuthHeader: z.string().min(1).optional(),
    apiType: z.enum(["chatCompletion", "responses"]).optional(),
    dangerouslySkipConnectionTest: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.provider === "openAICompatible") {
      if (!data.baseCustomUrl) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["baseCustomUrl"],
          message:
            "Provider 'openAICompatible' requires baseCustomUrl — the provider's OpenAI-compatible API base URL (e.g. https://my-llm-host.example.com/v1).",
        });
      }
      if (!data.customModel) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["customModel"],
          message:
            "Provider 'openAICompatible' requires customModel — the model name as known by the provider (e.g. 'llama-3.3-70b-instruct').",
        });
      }
      if (
        data.modelType !== "custom-model" &&
        data.modelType !== "custom-embedding-model"
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["modelType"],
          message:
            "Provider 'openAICompatible' requires modelType 'custom-model' (chat) or 'custom-embedding-model' (embedding). Put the provider's model name in customModel instead.",
        });
      }
      if (
        data.modelType === "custom-embedding-model" &&
        data.apiType !== undefined
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["apiType"],
          message:
            "apiType is only supported for chat models; omit it when modelType is 'custom-embedding-model'.",
        });
      }
    } else {
      for (const field of [
        "baseCustomUrl",
        "customModel",
        "customAuthHeader",
      ] as const) {
        if (data[field] !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} is only supported for provider 'openAICompatible'.`,
          });
        }
      }
      if (
        data.apiType !== undefined &&
        data.provider !== "openAI" &&
        data.provider !== "azureOpenAI"
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["apiType"],
          message:
            "apiType is only supported for providers 'openAI', 'azureOpenAI', and 'openAICompatible'.",
        });
      }
    }
  });

// Tool 4: talk_to_agent
export const talkToAgentSchema = z
  .object({
    endpointUrl: z.string().url().optional(),
    aiAgentId: idSchema.optional(),
    projectId: idSchema.optional(),
    message: z.string().min(1),
    sessionId: z.string().optional(),
    userId: z.string().optional(),
    data: z.record(z.any()).optional(),
    verbose: z.boolean().optional(),
  })
  .refine((d) => d.endpointUrl || d.aiAgentId, {
    message: "Either endpointUrl or aiAgentId must be provided",
    path: ["endpointUrl"],
  });

/** Actor values Cognigy records in `auditEvent.performedBy.actor`. */
export const AUDIT_ACTORS = [
  "human",
  "ask-ai",
  "mcp-plugin",
  "system",
] as const;

/** Audit event operation types (`auditEvent.type`). */
export const AUDIT_EVENT_TYPES = [
  "action",
  "create",
  "replace",
  "patch",
  "delete",
  "authentication",
  "authorization",
] as const;

// Tool 5: list_resources
export const listResourcesSchema = z.object({
  resourceType: z.enum([
    "project",
    "agent",
    "flow",
    "endpoint",
    "llm_model",
    "knowledge_store",
    "conversation",
    "extension",
    "function",
    "tool",
    "audit_event",
  ]),
  projectId: idSchema.optional(),
  aiAgentId: idSchema.optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  channel: z.string().optional(),
  useCase: z.string().optional(),
  // audit_event filters. `actor` and `eventType` are sent as repeatable query
  // params (actor[]=…), which the platform supports from 2026.17.0 onwards.
  // Named `eventType` rather than `type` so it cannot be confused with
  // `resourceType` at the call site.
  actor: z.array(z.enum(AUDIT_ACTORS)).nonempty().optional(),
  eventType: z.array(z.enum(AUDIT_EVENT_TYPES)).nonempty().optional(),
  user: z.string().min(1).optional(),
  sort: z
    .string()
    .regex(
      /^[A-Za-z][A-Za-z0-9_]*:(asc|desc)$/,
      "Must be 'field:direction', e.g. 'lastChanged:desc'",
    )
    .optional(),
  ...paginationSchema,
});

// Tool 6: get_resource
export const getResourceSchema = z.object({
  resourceType: z.enum([
    "agent",
    "flow",
    "endpoint",
    "project",
    "conversation",
    "session_state",
    "llm_model",
    "knowledge_store",
    "extension",
    "function",
    "user",
    "audit_event",
  ]),
  id: z.string().min(1),
  projectId: idSchema.optional(),
  raw: z.boolean().optional(),
});

// Tool 7: delete_resource
export const deleteResourceSchema = z.object({
  resourceType: z.enum([
    "agent",
    "flow",
    "project",
    "endpoint",
    "llm_model",
    "knowledge_store",
    "function",
    "tool",
  ]),
  id: idSchema,
  projectId: idSchema.optional(),
  aiAgentId: idSchema.optional(),
  cascade: z.boolean().optional(),
});

// Tool 8: manage_knowledge
export const manageKnowledgeSchema = z.object({
  operation: z.enum([
    "create_store",
    "create_source",
    "list_chunks",
    "list_sources",
  ]),
  projectId: idSchema.optional(),
  knowledgeStoreId: idSchema.optional(),
  sourceId: idSchema.optional(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  type: z.enum(["url", "manual", "file"]).optional(),
  url: z.string().url().optional(),
  text: z.string().optional(),
  filePath: z.string().optional(),
  filter: z.string().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

// Tool 9: create_tool (includes http tool type, formerly create_custom_http_tool)
export const createToolSchema = z
  .object({
    aiAgentId: idSchema,
    toolType: z.enum(["tool", "knowledge", "send_email", "mcp", "http"]),
    name: z.string().min(1).max(200),
    config: z.object({
      toolId: z.string().optional(),
      description: z.string().optional(),
      parameters: z.string().optional(),
      knowledgeStoreId: z.string().optional(),
      topK: z.number().int().min(1).max(50).optional(),
      recipient: z.string().optional(),
      mcpServerUrl: z.string().optional(),
      mcpName: z.string().optional(),
      timeout: z.number().optional(),
      url: z.string().optional(),
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
      headers: z.record(z.string()).optional(),
      body: z.string().optional(),
      preProcessCode: z.string().optional(),
      postProcessCode: z.string().optional(),
      toolResponseValue: z.string().optional(),
    }),
  })
  .superRefine((data, ctx) => {
    refineCodeField(ctx, data.config.preProcessCode, [
      "config",
      "preProcessCode",
    ]);
    refineCodeField(ctx, data.config.postProcessCode, [
      "config",
      "postProcessCode",
    ]);
  });

// Tool 10: update_tool
export const updateToolSchema = z
  .object({
    aiAgentId: idSchema,
    toolNodeId: idSchema,
    name: z.string().min(1).max(200).optional(),
    toolType: z
      .enum(["tool", "knowledge", "send_email", "mcp", "http"])
      .optional(),
    config: z
      .object({
        toolId: z.string().optional(),
        description: z.string().optional(),
        parameters: z.string().optional(),
        knowledgeStoreId: z.string().optional(),
        topK: z.number().int().min(1).max(50).optional(),
        recipient: z.string().optional(),
        mcpServerUrl: z.string().optional(),
        mcpName: z.string().optional(),
        timeout: z.number().optional(),
        url: z.string().optional(),
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
        headers: z.record(z.string()).optional(),
        body: z.string().optional(),
        preProcessCode: z.string().optional(),
        postProcessCode: z.string().optional(),
        toolResponseValue: z.string().optional(),
        httpNodeId: idSchema.optional(),
        preProcessNodeId: idSchema.optional(),
        postProcessNodeId: idSchema.optional(),
        resolveNodeId: idSchema.optional(),
      })
      .optional(),
  })
  .superRefine((data, ctx) => {
    refineCodeField(ctx, data.config?.preProcessCode, [
      "config",
      "preProcessCode",
    ]);
    refineCodeField(ctx, data.config?.postProcessCode, [
      "config",
      "postProcessCode",
    ]);
  });

// Tool 12: manage_flow_nodes
export const manageFlowNodesSchema = z
  .object({
    operation: z.enum(["list", "get", "create", "update", "delete", "render"]),
    flowId: idSchema,
    nodeId: idSchema.optional(),
    nodeType: z.string().optional(),
    label: z.string().min(1).max(200).optional(),
    parentNodeId: idSchema.optional(),
    mode: z.enum(["append", "appendChild"]).optional(),
    config: z.record(z.any()).optional(),
    // render operation
    focus: z.union([idSchema, z.array(idSchema)]).optional(),
    format: z.enum(["ascii", "mermaid", "both"]).optional(),
    legend: z.boolean().optional(),
    writeHtml: z.boolean().optional(),
    openInBrowser: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    // Only `create` knows the node type up front. On `update` the existing
    // node's type is fetched in handlers.ts, which runs the same check there.
    if (data.operation === "create" && data.nodeType === "code") {
      refineCodeField(ctx, data.config?.code, ["config", "code"]);
    }
  });

// Tool 13: manage_packages
const packageResourceSelectionSchema = z.object({
  id: idSchema,
  import: z.boolean().optional(),
  strategy: z.enum(["replace", "re-identify"]).optional(),
});

const packageLocaleMappingSchema = z.object({
  packageLocaleId: idSchema,
  agentLocaleId: idSchema,
});

const packageResourceIdsSchema = z.array(idSchema).min(1);

export const managePackagesSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("list_exportable"),
    projectId: idSchema,
  }),
  z.object({
    operation: z.literal("upload_and_inspect"),
    projectId: idSchema,
    filePath: z.string().min(1),
    timeoutMs: z.number().int().min(1000).max(3600000).optional(),
  }),
  z.object({
    operation: z.literal("inspect"),
    projectId: idSchema,
    packageId: idSchema,
  }),
  z.object({
    operation: z.literal("import"),
    projectId: idSchema,
    packageId: idSchema,
    resources: z.array(packageResourceSelectionSchema).optional(),
    localeMapping: z.array(packageLocaleMappingSchema).optional(),
    waitForCompletion: z.boolean().optional(),
    timeoutMs: z.number().int().min(1000).max(3600000).optional(),
  }),
  z.object({
    operation: z.literal("export"),
    projectId: idSchema,
    resourceIds: packageResourceIdsSchema,
    dependencyResourceIds: z.array(idSchema).optional(),
    includeDependencies: z.boolean().optional(),
    name: z.string().min(1).max(200),
    description: z.string().optional(),
    outputPath: z.string().min(1).optional(),
    waitForCompletion: z.boolean().optional(),
    timeoutMs: z.number().int().min(1000).max(3600000).optional(),
  }),
  z.object({
    operation: z.literal("download"),
    projectId: idSchema,
    packageId: idSchema,
    outputPath: z.string().min(1).optional(),
  }),
  z.object({
    operation: z.literal("read_task"),
    projectId: idSchema,
    taskId: idSchema,
  }),
]);

// Tool 11: manage_webchat

const conversationStarterSchema = z.object({
  title: z.string(),
  type: z.enum(["postback", "url"]),
  value: z.string(),
});

const webchatColorsSchema = z
  .object({
    primaryColor: z.string().optional(),
    secondaryColor: z.string().optional(),
    chatBackground: z.string().optional(),
    agentMessageBg: z.string().optional(),
    userMessageBg: z.string().optional(),
    textLink: z.string().optional(),
  })
  .optional();

const webchatLayoutSchema = z
  .object({
    title: z.string().optional(),
    logoUrl: z.string().optional(),
    colors: webchatColorsSchema,
    chatWindowWidth: z.number().int().min(200).max(2000).optional(),
    botOutputMaxWidth: z.number().int().min(1).max(100).optional(),
    disableBotOutputBorder: z.boolean().optional(),
    maxInputRows: z.number().int().min(1).max(50).optional(),
    enableInputCollation: z.boolean().optional(),
    inputCollationTimeout: z.number().int().min(100).max(10000).optional(),
    dynamicImageAspectRatio: z.boolean().optional(),
    disableInputAutocomplete: z.boolean().optional(),
    enableGenericHtml: z.boolean().optional(),
    allowJsInHtml: z.boolean().optional(),
    allowJsInUrls: z.boolean().optional(),
    useAgentAvatars: z.boolean().optional(),
    botAvatarName: z.string().optional(),
    botAvatarLogoUrl: z.string().optional(),
    humanAvatarName: z.string().optional(),
    humanAvatarLogoUrl: z.string().optional(),
  })
  .optional();

const webchatBehaviorSchema = z
  .object({
    scrollingBehavior: z.enum(["alwaysScroll", "scrollToLastInput"]).optional(),
    collateStreamedOutputs: z.boolean().optional(),
    progressiveMessageRendering: z.boolean().optional(),
    renderMarkdown: z.boolean().optional(),
    enableTypingIndicator: z.boolean().optional(),
    inputPlaceholder: z.string().optional(),
    messageDelay: z.number().int().min(0).max(10000).optional(),
    focusInputAfterPostback: z.boolean().optional(),
    enableConnectionStatusIndicator: z.boolean().optional(),
    enableStt: z.boolean().optional(),
    enableTts: z.boolean().optional(),
    collectMetadata: z.boolean().optional(),
    displayAIAgentNotice: z.boolean().optional(),
    aiAgentNoticeText: z.string().optional(),
    enableScrollButton: z.boolean().optional(),
  })
  .optional();

const webchatStartBehaviorSchema = z
  .object({
    mode: z.enum(["textField", "button", "autoSend"]).optional(),
    textPayload: z.string().optional(),
    dataPayload: z.string().optional(),
    displayText: z.string().optional(),
    buttonTitle: z.string().optional(),
  })
  .optional();

const webchatHomeScreenSchema = z
  .object({
    enabled: z.boolean().optional(),
    welcomeText: z.string().optional(),
    backgroundImage: z.string().optional(),
    backgroundColor: z.string().optional(),
    startConversationButtonText: z.string().optional(),
    conversationStarters: z.array(conversationStarterSchema).max(5).optional(),
    previousConversations: z
      .object({
        enabled: z.boolean().optional(),
        enableDeleteAll: z.boolean().optional(),
        buttonText: z.string().optional(),
        title: z.string().optional(),
        startNewButtonText: z.string().optional(),
      })
      .optional(),
  })
  .optional();

const webchatTeaserMessageSchema = z
  .object({
    text: z.string().optional(),
    showInChat: z.boolean().optional(),
    conversationStarters: z.array(conversationStarterSchema).max(5).optional(),
  })
  .optional();

const webchatChatOptionsSchema = z
  .object({
    enabled: z.boolean().optional(),
    title: z.string().optional(),
    enableDeleteConversation: z.boolean().optional(),
    quickReplies: z
      .object({
        enabled: z.boolean().optional(),
        sectionTitle: z.string().optional(),
        items: z.array(conversationStarterSchema).max(5).optional(),
      })
      .optional(),
    textToSpeech: z
      .object({
        showToggle: z.boolean().optional(),
        toggleLabel: z.string().optional(),
        activateByDefault: z.boolean().optional(),
      })
      .optional(),
    rating: z
      .object({
        enabled: z.boolean().optional(),
        titleText: z.string().optional(),
        commentPlaceholder: z.string().optional(),
        submitButtonText: z.string().optional(),
        submittedBannerText: z.string().optional(),
      })
      .optional(),
    footer: z
      .object({
        enabled: z.boolean().optional(),
        items: z
          .array(z.object({ title: z.string(), url: z.string() }))
          .max(2)
          .optional(),
      })
      .optional(),
  })
  .optional();

const webchatPrivacyNoticeSchema = z
  .object({
    enabled: z.boolean().optional(),
    title: z.string().optional(),
    text: z.string().optional(),
    submitButton: z.string().optional(),
    policyLinkTitle: z.string().optional(),
    policyLinkUrl: z.string().optional(),
  })
  .optional();

const webchatBusinessHoursSchema = z
  .object({
    enabled: z.boolean().optional(),
    mode: z.enum(["inform", "disable", "hide"]).optional(),
    informationText: z.string().optional(),
    informationTitle: z.string().optional(),
    timezone: z.string().optional(),
    schedule: z
      .array(
        z.object({
          dayOfWeek: z.string(),
          startTime: z.string(),
          endTime: z.string(),
        }),
      )
      .optional(),
  })
  .optional();

const webchatUnreadMessagesSchema = z
  .object({
    enableTitleIndicator: z.boolean().optional(),
    enableBadge: z.boolean().optional(),
    enablePreview: z.boolean().optional(),
    enableSound: z.boolean().optional(),
  })
  .optional();

const webchatMaintenanceSchema = z
  .object({
    enabled: z.boolean().optional(),
    mode: z.enum(["inform", "disable", "hide"]).optional(),
    informationText: z.string().optional(),
    informationTitle: z.string().optional(),
  })
  .optional();

const webchatWatermarkSchema = z
  .object({
    type: z.enum(["default", "custom", "none"]).optional(),
    text: z.string().optional(),
    url: z.string().optional(),
  })
  .optional();

const webchatPersistentMenuSchema = z
  .object({
    enabled: z.boolean().optional(),
    title: z.string().optional(),
    items: z
      .array(z.object({ title: z.string(), payload: z.string() }))
      .optional(),
  })
  .optional();

const webchatAttachmentUploadSchema = z
  .object({
    enabled: z.boolean().optional(),
    dropzoneText: z.string().optional(),
  })
  .optional();

const webchatIconSchema = z
  .object({
    animation: z.enum(["none", "bounce", "swing", "pulse"]).optional(),
    animationInterval: z.number().min(1).max(60).optional(),
    animationSpeed: z.enum(["slow", "normal", "fast", "superfast"]).optional(),
  })
  .optional();

export const manageWebchatSchema = z.object({
  endpointId: idSchema.optional(),
  projectId: idSchema.optional(),
  flowId: z.string().optional(),
  name: z.string().min(1).max(200).optional(),
  stylePreset: z.enum(["classic", "modern", "slick"]).optional(),
  layout: webchatLayoutSchema,
  behavior: webchatBehaviorSchema,
  startBehavior: webchatStartBehaviorSchema,
  homeScreen: webchatHomeScreenSchema,
  teaserMessage: webchatTeaserMessageSchema,
  chatOptions: webchatChatOptionsSchema,
  privacyNotice: webchatPrivacyNoticeSchema,
  businessHours: webchatBusinessHoursSchema,
  unreadMessages: webchatUnreadMessagesSchema,
  maintenance: webchatMaintenanceSchema,
  watermark: webchatWatermarkSchema,
  persistentMenu: webchatPersistentMenuSchema,
  attachmentUpload: webchatAttachmentUploadSchema,
  webchatIcon: webchatIconSchema,
  customJson: z.string().optional(),
});

// Tool 14: manage_voice_gateway

const webrtcTranscriptionSchema = z
  .object({
    enabled: z.boolean().optional(),
    backgroundMode: z.enum(["transparent", "custom"]).optional(),
  })
  .optional();

const webrtcDemoPageSchema = z
  .object({
    background: z
      .object({
        mode: z.enum(["color", "image"]).optional(),
        color: z.string().optional(),
      })
      .optional(),
    position: z.enum(["centered", "bottom-right"]).optional(),
  })
  .optional();

const webrtcWidgetConfigSchema = z
  .object({
    label: z.string().optional(),
    theme: z.enum(["CLEAN_WHITE", "DARK_MODE", "AI_PURPLE"]).optional(),
    transcription: webrtcTranscriptionSchema,
    demoPage: webrtcDemoPageSchema,
    avatarLogoUrl: z.string().optional(),
    tagline: z.string().optional(),
  })
  .optional();

export const manageVoiceGatewaySchema = z.object({
  endpointId: idSchema.optional(),
  projectId: idSchema.optional(),
  flowId: z.string().optional(),
  name: z.string().min(1).max(200).optional(),
  webrtcWidgetConfig: webrtcWidgetConfigSchema,
});

// Tool 15: manage_settings
const speechProviderEnum = z.enum([
  "microsoft",
  "google",
  "aws",
  "deepgram",
  "elevenlabs",
]);

const knowledgeContentParserEnum = z.enum(["default", "legacy", "azure"]);

const manageVoicePreviewSettingsSchema = z.object({
  operation: z.literal("set_voice_preview"),
  projectId: idSchema,
  provider: speechProviderEnum,
  connectionId: z.string().optional(),
});

const manageKnowledgeAiSettingsSchema = z
  .object({
    operation: z.literal("set_knowledge_ai"),
    projectId: idSchema,
    knowledgeSearchModelId: z.string().optional(),
    answerExtractionModelId: z.string().optional(),
    contentParser: knowledgeContentParserEnum.optional(),
    azureDIConnectionId: z.string().optional(),
  })
  .refine(
    (data) =>
      data.knowledgeSearchModelId !== undefined ||
      data.answerExtractionModelId !== undefined ||
      data.contentParser !== undefined ||
      data.azureDIConnectionId !== undefined,
    {
      message: "Provide at least one Knowledge AI setting to update.",
      path: ["operation"],
    },
  )
  .refine(
    (data) => data.contentParser !== "azure" || !!data.azureDIConnectionId,
    {
      message:
        "azureDIConnectionId is required when contentParser is set to azure.",
      path: ["azureDIConnectionId"],
    },
  )
  .refine(
    (data) =>
      !data.contentParser ||
      data.contentParser === "azure" ||
      data.azureDIConnectionId === undefined,
    {
      message:
        "azureDIConnectionId can only be provided when contentParser is azure or omitted.",
      path: ["azureDIConnectionId"],
    },
  );

export const manageSettingsSchema = z.union([
  manageVoicePreviewSettingsSchema,
  manageKnowledgeAiSettingsSchema,
]);

// Tool 16: audit_voice_agent
export const auditVoiceAgentSchema = z
  .object({
    aiAgentId: idSchema.optional(),
    flowId: idSchema.optional(),
    endpointId: idSchema.optional(),
    projectId: idSchema.optional(),
    apply: z.boolean().optional(),
    only: z.array(z.string()).optional(),
  })
  .refine((d) => d.aiAgentId || d.flowId, {
    message: "Either aiAgentId or flowId must be provided",
    path: ["aiAgentId"],
  });

// Tool 17: manage_snapshots
//
// `create` deliberately takes a short `label`, not a full `name`: the plugin
// owns the name so the "[AI Backup] " marker prefix can never be omitted by the
// caller, and so the timestamp that keeps names unique is always present.
const snapshotTimeoutSchema = z.number().int().min(1000).max(3600000);

export const manageSnapshotsSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("list"),
    projectId: idSchema,
    ...paginationSchema,
  }),
  z.object({
    operation: z.literal("create"),
    projectId: idSchema,
    label: z.string().min(1).max(120).optional(),
    confirmDeleteOldest: z.boolean().optional(),
    waitForCompletion: z.boolean().optional(),
    timeoutMs: snapshotTimeoutSchema.optional(),
  }),
  z.object({
    operation: z.literal("restore"),
    projectId: idSchema,
    snapshotId: idSchema,
    confirm: z.boolean().optional(),
    waitForCompletion: z.boolean().optional(),
    timeoutMs: snapshotTimeoutSchema.optional(),
  }),
  z.object({
    operation: z.literal("delete"),
    projectId: idSchema,
    snapshotId: idSchema,
    waitForCompletion: z.boolean().optional(),
    timeoutMs: snapshotTimeoutSchema.optional(),
  }),
  z.object({
    operation: z.literal("decline"),
    projectId: idSchema,
  }),
  z.object({
    operation: z.literal("read_task"),
    projectId: idSchema,
    taskId: idSchema,
  }),
]);
