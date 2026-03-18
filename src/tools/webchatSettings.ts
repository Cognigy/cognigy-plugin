import type { z } from 'zod';
import type { manageWebchatSchema } from '../schemas/tools.js';

type ManageWebchatInput = z.infer<typeof manageWebchatSchema>;

/**
 * Style presets apply sensible defaults for layout + behavior groups.
 * User-provided fields override anything a preset sets.
 */
const STYLE_PRESETS: Record<string, Partial<ManageWebchatInput>> = {
  classic: {
    layout: {
      disableBotOutputBorder: false,
      botOutputMaxWidth: 73,
      chatWindowWidth: 460,
      enableInputCollation: false,
      colors: { agentMessageBg: '#ffffff' },
    },
    behavior: {
      scrollingBehavior: 'alwaysScroll',
      collateStreamedOutputs: false,
      progressiveMessageRendering: false,
      renderMarkdown: true,
    },
  },
  modern: {
    layout: {
      disableBotOutputBorder: true,
      botOutputMaxWidth: 100,
      chatWindowWidth: 900,
      enableInputCollation: true,
      colors: { agentMessageBg: '#ffffff' },
    },
    behavior: {
      scrollingBehavior: 'scrollToLastInput',
      collateStreamedOutputs: true,
      progressiveMessageRendering: true,
      renderMarkdown: true,
    },
  },
  slick: {
    layout: {
      disableBotOutputBorder: false,
      botOutputMaxWidth: 100,
      chatWindowWidth: 600,
      enableInputCollation: true,
      colors: { agentMessageBg: '#cccccc' },
    },
    behavior: {
      scrollingBehavior: 'scrollToLastInput',
      collateStreamedOutputs: true,
      progressiveMessageRendering: false,
      renderMarkdown: true,
    },
  },
};

export function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] !== undefined) {
      if (
        typeof source[key] === 'object' &&
        source[key] !== null &&
        !Array.isArray(source[key]) &&
        typeof result[key] === 'object' &&
        result[key] !== null &&
        !Array.isArray(result[key])
      ) {
        result[key] = deepMerge(result[key], source[key]);
      } else {
        result[key] = source[key];
      }
    }
  }
  return result;
}

interface ConversationStarter {
  title: string;
  type: 'postback' | 'url';
  value: string;
}

function mapStarters(starters?: ConversationStarter[]): any[] | undefined {
  if (!starters) return undefined;
  return starters.map((s) => ({
    title: s.title,
    type: s.type === 'postback' ? 'postbackValue' : 'url',
    ...(s.type === 'postback' ? { postbackValue: s.value } : { url: s.value }),
  }));
}

const SCROLLING_MAP: Record<string, string> = {
  alwaysScroll: 'alwaysScrollToBottom',
  scrollToLastInput: 'scrollUntilLastInputAtTop',
};

/**
 * Build the nested `settings` object for the Cognigy Webchat v3 POST/PATCH endpoint API.
 *
 * The v3 write API uses nested groups: colors, layout, behavior, startBehavior,
 * homeScreen, teaserMessage, chatOptions, privacyNotice, businessHours,
 * unreadMessages, maintenance, demoWebchat, fileStorageSettings, etc.
 */
export function buildWebchatSettings(input: ManageWebchatInput): Record<string, any> {
  let effective = { ...input };

  if (input.stylePreset && STYLE_PRESETS[input.stylePreset]) {
    const preset = STYLE_PRESETS[input.stylePreset];
    effective = deepMerge(preset, effective);
  }

  const s: Record<string, any> = {};

  // --- Colors ---
  const colors = effective.layout?.colors;
  if (colors) {
    const c: Record<string, any> = {};
    if (colors.primaryColor !== undefined) c.primaryColor = colors.primaryColor;
    if (colors.secondaryColor !== undefined) c.secondaryColor = colors.secondaryColor;
    if (colors.chatBackground !== undefined) c.chatInterfaceColor = colors.chatBackground;
    if (colors.agentMessageBg !== undefined) c.botMessageColor = colors.agentMessageBg;
    if (colors.userMessageBg !== undefined) c.userMessageColor = colors.userMessageBg;
    if (colors.textLink !== undefined) c.textLinkColor = colors.textLink;
    if (Object.keys(c).length > 0) s.colors = c;
  }

  // --- Layout ---
  const layout = effective.layout;
  if (layout) {
    const l: Record<string, any> = {};
    if (layout.title !== undefined) l.title = layout.title;
    if (layout.logoUrl !== undefined) l.logoUrl = layout.logoUrl;
    if (layout.maxInputRows !== undefined) l.inputAutogrowMaxRows = layout.maxInputRows;
    if (layout.enableInputCollation !== undefined) l.enableInputCollation = layout.enableInputCollation;
    if (layout.inputCollationTimeout !== undefined) l.inputCollationTimeout = layout.inputCollationTimeout;
    if (layout.dynamicImageAspectRatio !== undefined) l.dynamicImageAspectRatio = layout.dynamicImageAspectRatio;
    if (layout.disableInputAutocomplete !== undefined) l.disableInputAutocomplete = layout.disableInputAutocomplete;
    if (layout.enableGenericHtml !== undefined) l.enableGenericHTMLStyling = layout.enableGenericHtml;
    if (layout.allowJsInHtml !== undefined) l.disableHtmlContentSanitization = layout.allowJsInHtml;
    if (layout.allowJsInUrls !== undefined) l.disableUrlButtonSanitization = layout.allowJsInUrls;
    if (layout.disableBotOutputBorder !== undefined) l.disableBotOutputBorder = layout.disableBotOutputBorder;
    if (layout.botOutputMaxWidth !== undefined) l.botOutputMaxWidthPercentage = layout.botOutputMaxWidth;
    if (layout.chatWindowWidth !== undefined) l.chatWindowWidth = layout.chatWindowWidth;

    if (layout.useAgentAvatars !== undefined) l.useOtherAgentLogo = layout.useAgentAvatars;
    if (layout.botAvatarName !== undefined) l.botAvatarName = layout.botAvatarName;
    if (layout.botAvatarLogoUrl !== undefined) l.botLogoUrl = layout.botAvatarLogoUrl;
    if (layout.humanAvatarName !== undefined) l.agentAvatarName = layout.humanAvatarName;
    if (layout.humanAvatarLogoUrl !== undefined) l.agentLogoUrl = layout.humanAvatarLogoUrl;

    if (Object.keys(l).length > 0) s.layout = l;
  }

  // --- Behavior ---
  const beh = effective.behavior;
  if (beh) {
    const b: Record<string, any> = {};
    if (beh.enableTypingIndicator !== undefined) b.enableTypingIndicator = beh.enableTypingIndicator;
    if (beh.inputPlaceholder !== undefined) b.inputPlaceholder = beh.inputPlaceholder;
    if (beh.enableStt !== undefined) b.enableSTT = beh.enableStt;
    if (beh.enableTts !== undefined) b.enableTTS = beh.enableTts;
    if (beh.focusInputAfterPostback !== undefined) b.focusInputAfterPostback = beh.focusInputAfterPostback;
    if (beh.enableConnectionStatusIndicator !== undefined) b.enableConnectionStatusIndicator = beh.enableConnectionStatusIndicator;
    if (beh.messageDelay !== undefined) b.messageDelay = beh.messageDelay;
    if (beh.collectMetadata !== undefined) b.enableCollectMetadata = beh.collectMetadata;
    if (beh.displayAIAgentNotice !== undefined) b.enableAIAgentNotice = beh.displayAIAgentNotice;
    if (beh.aiAgentNoticeText !== undefined) b.AIAgentNoticeText = beh.aiAgentNoticeText;
    if (beh.scrollingBehavior !== undefined) {
      b.scrollingBehavior = SCROLLING_MAP[beh.scrollingBehavior] ?? beh.scrollingBehavior;
    }
    if (beh.collateStreamedOutputs !== undefined) b.collateStreamedOutputs = beh.collateStreamedOutputs;
    if (beh.progressiveMessageRendering !== undefined) b.progressiveMessageRendering = beh.progressiveMessageRendering;
    if (beh.renderMarkdown !== undefined) b.renderMarkdown = beh.renderMarkdown;
    if (beh.enableScrollButton !== undefined) b.enableScrollButton = beh.enableScrollButton;
    if (Object.keys(b).length > 0) s.behavior = b;
  }

  // --- Start Behavior ---
  const sb = effective.startBehavior;
  if (sb) {
    const sbObj: Record<string, any> = {};
    if (sb.mode !== undefined) {
      const modeMap: Record<string, string> = { textField: 'none', button: 'button', autoSend: 'autoSend' };
      sbObj.startBehavior = modeMap[sb.mode] ?? sb.mode;
    }
    if (sb.textPayload !== undefined) sbObj.getStartedPayload = sb.textPayload;
    if (sb.dataPayload !== undefined) sbObj.getStartedData = sb.dataPayload;
    if (sb.displayText !== undefined) sbObj.getStartedText = sb.displayText;
    if (sb.buttonTitle !== undefined) sbObj.getStartedButtonText = sb.buttonTitle;
    if (Object.keys(sbObj).length > 0) s.startBehavior = sbObj;
  }

  // --- Home Screen ---
  const hs = effective.homeScreen;
  if (hs) {
    const hsObj: Record<string, any> = {};
    if (hs.enabled !== undefined) hsObj.enabled = hs.enabled;
    if (hs.welcomeText !== undefined) hsObj.welcomeText = hs.welcomeText;
    if (hs.backgroundImage !== undefined || hs.backgroundColor !== undefined) {
      hsObj.background = {};
      if (hs.backgroundImage !== undefined) hsObj.background.imageUrl = hs.backgroundImage;
      if (hs.backgroundColor !== undefined) hsObj.background.color = hs.backgroundColor;
    }
    if (hs.startConversationButtonText !== undefined) hsObj.startConversationButtonText = hs.startConversationButtonText;

    const mappedStarters = mapStarters(hs.conversationStarters);
    if (mappedStarters) {
      hsObj.conversationStarters = { enabled: true, starters: mappedStarters };
    }

    if (hs.previousConversations) {
      const pc: Record<string, any> = {};
      if (hs.previousConversations.enabled !== undefined) pc.enabled = hs.previousConversations.enabled;
      if (hs.previousConversations.enableDeleteAll !== undefined) pc.enableDeleteAllConversations = hs.previousConversations.enableDeleteAll;
      if (hs.previousConversations.buttonText !== undefined) pc.buttonText = hs.previousConversations.buttonText;
      if (hs.previousConversations.title !== undefined) pc.title = hs.previousConversations.title;
      if (hs.previousConversations.startNewButtonText !== undefined) pc.startNewConversationButtonText = hs.previousConversations.startNewButtonText;
      if (Object.keys(pc).length > 0) hsObj.previousConversations = pc;
    }

    if (Object.keys(hsObj).length > 0) s.homeScreen = hsObj;
  }

  // --- Teaser Message ---
  const tm = effective.teaserMessage;
  if (tm) {
    const tmObj: Record<string, any> = {};
    if (tm.text !== undefined) tmObj.text = tm.text;
    if (tm.showInChat !== undefined) tmObj.showInChat = tm.showInChat;
    const mappedStarters = mapStarters(tm.conversationStarters);
    if (mappedStarters) {
      tmObj.conversationStarters = { enabled: true, starters: mappedStarters };
    }
    if (Object.keys(tmObj).length > 0) s.teaserMessage = tmObj;
  }

  // --- Chat Options ---
  const co = effective.chatOptions;
  if (co) {
    const coObj: Record<string, any> = {};
    if (co.enabled !== undefined) coObj.enabled = co.enabled;
    if (co.title !== undefined) coObj.title = co.title;
    if (co.enableDeleteConversation !== undefined) coObj.enableDeleteConversation = co.enableDeleteConversation;

    if (co.quickReplies) {
      const qr: Record<string, any> = {};
      if (co.quickReplies.enabled !== undefined) qr.enabled = co.quickReplies.enabled;
      if (co.quickReplies.sectionTitle !== undefined) qr.sectionTitle = co.quickReplies.sectionTitle;
      const mappedItems = mapStarters(co.quickReplies.items);
      if (mappedItems) qr.quickReplies = mappedItems;
      coObj.quickReplyOptions = qr;
    }

    if (co.textToSpeech) {
      if (co.textToSpeech.showToggle !== undefined) coObj.showTTSToggle = co.textToSpeech.showToggle;
      if (co.textToSpeech.activateByDefault !== undefined) coObj.activateTTSToggle = co.textToSpeech.activateByDefault;
      if (co.textToSpeech.toggleLabel !== undefined) coObj.labelTTSToggle = co.textToSpeech.toggleLabel;
    }

    if (co.rating) {
      const r: Record<string, any> = {};
      if (co.rating.enabled !== undefined) r.enabled = co.rating.enabled ? 'once' : 'never';
      if (co.rating.titleText !== undefined) r.title = co.rating.titleText;
      if (co.rating.commentPlaceholder !== undefined) r.commentPlaceholder = co.rating.commentPlaceholder;
      if (co.rating.submitButtonText !== undefined) r.submitButtonText = co.rating.submitButtonText;
      if (co.rating.submittedBannerText !== undefined) r.eventBannerText = co.rating.submittedBannerText;
      if (Object.keys(r).length > 0) coObj.rating = r;
    }

    if (co.footer) {
      const f: Record<string, any> = {};
      if (co.footer.enabled !== undefined) f.enabled = co.footer.enabled;
      if (co.footer.items) f.items = co.footer.items;
      if (Object.keys(f).length > 0) coObj.footer = f;
    }

    if (Object.keys(coObj).length > 0) s.chatOptions = coObj;
  }

  // --- Privacy Notice ---
  const pn = effective.privacyNotice;
  if (pn) {
    const pnObj: Record<string, any> = {};
    if (pn.enabled !== undefined) pnObj.enabled = pn.enabled;
    if (pn.title !== undefined) pnObj.title = pn.title;
    if (pn.text !== undefined) pnObj.text = pn.text;
    if (pn.submitButton !== undefined) pnObj.submitButtonText = pn.submitButton;
    if (pn.policyLinkTitle !== undefined) pnObj.urlText = pn.policyLinkTitle;
    if (pn.policyLinkUrl !== undefined) pnObj.url = pn.policyLinkUrl;
    if (Object.keys(pnObj).length > 0) s.privacyNotice = pnObj;
  }

  // --- Business Hours ---
  const bh = effective.businessHours;
  if (bh) {
    const bhObj: Record<string, any> = {};
    if (bh.enabled !== undefined) bhObj.enabled = bh.enabled;
    if (bh.mode !== undefined) bhObj.mode = bh.mode;
    if (bh.informationText !== undefined) bhObj.text = bh.informationText;
    if (bh.informationTitle !== undefined) bhObj.title = bh.informationTitle;
    if (bh.timezone !== undefined) bhObj.timeZone = bh.timezone;
    if (bh.schedule) {
      bhObj.times = bh.schedule.map((day) => ({
        weekDay: day.dayOfWeek,
        startTime: day.startTime,
        endTime: day.endTime,
      }));
    }
    if (Object.keys(bhObj).length > 0) s.businessHours = bhObj;
  }

  // --- Unread Messages ---
  const um = effective.unreadMessages;
  if (um) {
    const umObj: Record<string, any> = {};
    if (um.enableTitleIndicator !== undefined) umObj.enableIndicator = um.enableTitleIndicator;
    if (um.enableBadge !== undefined) umObj.enableBadge = um.enableBadge;
    if (um.enablePreview !== undefined) umObj.enablePreview = um.enablePreview;
    if (um.enableSound !== undefined) umObj.enableSound = um.enableSound;
    if (Object.keys(umObj).length > 0) s.unreadMessages = umObj;
  }

  // --- Maintenance ---
  const mt = effective.maintenance;
  if (mt) {
    const mtObj: Record<string, any> = {};
    if (mt.enabled !== undefined) mtObj.enabled = mt.enabled;
    if (mt.mode !== undefined) mtObj.mode = mt.mode;
    if (mt.informationText !== undefined) mtObj.text = mt.informationText;
    if (mt.informationTitle !== undefined) mtObj.title = mt.informationTitle;
    if (Object.keys(mtObj).length > 0) s.maintenance = mtObj;
  }

  // --- Watermark ---
  const wm = effective.watermark;
  if (wm) {
    const layout = s.layout ?? {};
    if (wm.type !== undefined) layout.watermark = wm.type;
    if (wm.text !== undefined) layout.watermarkText = wm.text;
    if (wm.url !== undefined) layout.watermarkUrl = wm.url;
    s.layout = layout;
  }

  // --- Webchat Icon ---
  const icon = effective.webchatIcon;
  if (icon) {
    const layout = s.layout ?? {};
    if (icon.animation !== undefined) layout.iconAnimation = icon.animation;
    if (icon.animationInterval !== undefined) layout.iconAnimationInterval = icon.animationInterval;
    if (icon.animationSpeed !== undefined) {
      const speedMap: Record<string, number> = { slow: 0.5, normal: 1, fast: 2, superfast: 3 };
      layout.iconAnimationSpeed = speedMap[icon.animationSpeed] ?? 1;
    }
    s.layout = layout;
  }

  // --- Persistent Menu (goes in layout group) ---
  const pm = effective.persistentMenu;
  if (pm) {
    const layout = s.layout ?? {};
    if (pm.enabled !== undefined) layout.enablePersistentMenu = pm.enabled;
    if (pm.items || pm.title) {
      layout.persistentMenu = {
        title: pm.title ?? '',
        menuItems: (pm.items ?? []).map((item) => ({
          title: item.title,
          payload: item.payload,
        })),
      };
    }
    s.layout = layout;
  }

  // --- Attachment Upload / File Storage ---
  const au = effective.attachmentUpload;
  if (au) {
    const fsObj: Record<string, any> = {};
    if (au.enabled !== undefined) fsObj.enabled = au.enabled;
    if (au.dropzoneText !== undefined) fsObj.dropzoneText = au.dropzoneText;
    if (Object.keys(fsObj).length > 0) s.fileStorageSettings = fsObj;
  }

  // --- Custom JSON ---
  if (effective.customJson !== undefined) {
    s.customJSON = effective.customJson;
  }

  // --- Demo Webchat (always enable) ---
  s.demoWebchat = { enabled: true };

  return s;
}
