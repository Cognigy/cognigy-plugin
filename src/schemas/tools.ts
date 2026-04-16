import { z } from "zod";

const idSchema = z.string().regex(/^[a-f0-9]{24}$/, "Must be a 24-char hex ID");

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
export const setupLlmSchema = z.object({
  projectId: idSchema,
  provider: z.enum(["openAI", "azureOpenAI", "anthropic", "google", "mistral"]),
  modelType: z.string().min(1),
  name: z.string().optional(),
  apiKey: z.string().optional(),
  connectionId: z.string().optional(),
  isDefault: z.boolean().optional(),
  dangerouslySkipConnectionTest: z.boolean().optional(),
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
  ]),
  projectId: idSchema.optional(),
  aiAgentId: idSchema.optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  channel: z.string().optional(),
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
export const createToolSchema = z.object({
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
});

// Tool 10: update_tool
export const updateToolSchema = z.object({
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
    })
    .optional(),
});

// Tool 12: manage_flow_nodes
export const manageFlowNodesSchema = z.object({
  operation: z.enum(["list", "create", "update", "delete"]),
  flowId: idSchema,
  nodeId: idSchema.optional(),
  nodeType: z.string().optional(),
  label: z.string().min(1).max(200).optional(),
  parentNodeId: idSchema.optional(),
  mode: z.enum(["append", "appendChild"]).optional(),
  config: z.record(z.any()).optional(),
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

export const manageSettingsSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("set_voice_preview"),
    projectId: idSchema,
    provider: speechProviderEnum,
    connectionId: z.string().optional(),
  }),
]);
