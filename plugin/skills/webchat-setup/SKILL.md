---
name: webchat-setup
description: "Use when the user wants to deploy a Cognigy agent to Webchat v3 — creating or updating the endpoint, style presets, layout/behavior settings, and the embed snippet."
---

# Webchat v3 Setup Guide

## What is Webchat v3?
Webchat v3 is Cognigy's embeddable chat widget for websites. It connects to a Webchat v3 Endpoint, which links a Flow to the widget and holds all appearance/behavior configuration.

## Quick Start — Minimal Webchat

1. Ensure an agent + flow exist: create_ai_agent { name: "My Agent" }
2. Create a webchat endpoint:
   manage_webchat { projectId: "...", flowId: "...", name: "My Webchat" }
3. The response includes demoWebchatUrl — open it in a browser to test immediately.
4. Always show demoWebchatUrl to the user by default. Only provide configUrl/embeddingSnippet when asked about embedding or production deployment.

## Quick Start — Update Existing Webchat

manage_webchat {
  endpointId: "...",
  layout: { colors: { primaryColor: "#0052cc" } },
  behavior: { renderMarkdown: true }
}

CREATE vs UPDATE:
- To create: omit endpointId and provide projectId + flowId. A new webchat3 endpoint is always created.
- To update: provide endpointId. Only the specified fields are changed; everything else is preserved.
- The tool never auto-detects or modifies existing endpoints. To update, first find the endpointId using list_resources { resourceType: "endpoint", projectId }.

## Style Presets

Use stylePreset to apply a predefined look in one call:

manage_webchat { endpointId: "...", stylePreset: "modern" }

### classic (default)
- Chat window: 460px, bot output max-width: 73%, bot output border: on
- Agent message bg: #ffffff, always scroll, no streaming collation, no progressive rendering, markdown on

### modern
- Chat window: 900px, bot output max-width: 100%, bot output border: off
- Agent message bg: #ffffff, scroll to last input, streaming collation on, progressive rendering on, markdown on, input collation on

### slick
- Chat window: 600px, bot output max-width: 100%, bot output border: off
- Agent message bg: #cccccc, scroll to last input, streaming collation on, progressive rendering off, markdown on, input collation on

Presets set layout + behavior fields. You can override individual fields after applying a preset by including them in the same call.

## Settings Reference

### layout
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| title | string | agent name | Webchat title bar text |
| logoUrl | string | — | URL to header logo image (28x28px recommended, JPG/PNG/SVG/GIF) |
| chatWindowWidth | number | 460 | Chat window width in px |
| botOutputMaxWidth | number | 73 | Bot output max-width as percentage (1-100) |
| disableBotOutputBorder | boolean | false | Hide chat bubble border around bot output |
| maxInputRows | number | — | Max lines in the reply input field before scrollbar |
| enableInputCollation | boolean | false | Combine rapid typed inputs into one message |
| inputCollationTimeout | number | 1000 | Delay (ms) before collating inputs |
| dynamicImageAspectRatio | boolean | false | Maintain original image proportions |
| disableInputAutocomplete | boolean | false | Disable browser autocomplete in input |
| enableGenericHtml | boolean | false | Apply styling to HTML in text messages |
| allowJsInHtml | boolean | false | Allow onclick/onload in HTML messages |
| allowJsInUrls | boolean | false | Allow javascript: URLs in buttons |
| useAgentAvatars | boolean | false | Show separate avatar/name for bot vs human |
| botAvatarName | string | — | Name above bot messages |
| botAvatarLogoUrl | string | — | Logo above bot messages |
| humanAvatarName | string | — | Name above human agent messages |
| humanAvatarLogoUrl | string | — | Logo above human agent messages |

### layout.colors
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| primaryColor | string | — | Primary color (hex, e.g. "#0052cc") |
| secondaryColor | string | — | Secondary color |
| chatBackground | string | — | Chat interface background color |
| agentMessageBg | string | "#ffffff" | Bot message background |
| userMessageBg | string | — | User message background |
| textLink | string | — | Text link color |

### behavior
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| scrollingBehavior | "alwaysScroll" / "scrollToLastInput" | "alwaysScroll" | How chat scrolls on new messages |
| collateStreamedOutputs | boolean | false | Merge streamed text into one bubble |
| progressiveMessageRendering | boolean | false | Show text appearing progressively |
| renderMarkdown | boolean | true | Render markdown in bot outputs |
| enableTypingIndicator | boolean | false | Show typing animation |
| inputPlaceholder | string | "Type something…" | Placeholder text in reply field |
| messageDelay | number | 500 | Delay (ms) before showing bot response |
| focusInputAfterPostback | boolean | false | Focus input after button click |
| enableConnectionStatusIndicator | boolean | false | Show warning on lost connection |
| enableStt | boolean | false | Speech-to-text microphone button |
| enableTts | boolean | false | Text-to-speech for bot messages |
| collectMetadata | boolean | false | Collect browser metadata (language, location, device) |
| displayAIAgentNotice | boolean | true | Show "chatting with AI" notice |
| aiAgentNoticeText | string | "You're now chatting with an AI Agent." | Notice text |
| enableScrollButton | boolean | true | Show scroll-to-bottom button |

### startBehavior
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| mode | "textField" / "button" / "autoSend" | "textField" | How conversation starts |
| textPayload | string | — | First message sent to agent (button/autoSend) |
| dataPayload | string | — | Additional data sent to flow (button/autoSend) |
| displayText | string | — | Simulated user input bubble text (button/autoSend) |
| buttonTitle | string | — | Start button label (button mode only) |

### homeScreen
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| enabled | boolean | false | Show home screen on launch |
| welcomeText | string | "Welcome! How can we help?" | Greeting message |
| backgroundImage | string | — | Background image URL (460x608px) |
| backgroundColor | string | — | CSS color/gradient for background |
| startConversationButtonText | string | "Start conversation" | Button text |
| conversationStarters | array | — | Up to 5 items: { title, type: "postback"/"url", value } |
| previousConversations | object | — | See sub-fields below |

### homeScreen.previousConversations
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| enabled | boolean | false | Show previous conversations button |
| enableDeleteAll | boolean | false | Allow deleting all conversations |
| buttonText | string | "Previous conversations" | Button label |
| title | string | — | Screen header |
| startNewButtonText | string | "Start new conversation" | New conversation button text |

### teaserMessage
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| text | string | — | Message beside webchat icon |
| showInChat | boolean | false | Also show teaser inside chat |
| conversationStarters | array | — | Up to 5: { title, type: "postback"/"url", value } |

### chatOptions
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| enabled | boolean | false | Enable chat options menu |
| title | string | "Chat options" | Options screen title |
| enableDeleteConversation | boolean | false | Let users delete current conversation |

### chatOptions.quickReplies
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| enabled | boolean | false | Show quick replies in options |
| sectionTitle | string | "People are also interested in" | Section header |
| items | array | — | Up to 5: { title, type: "postback"/"url", value } |

### chatOptions.textToSpeech
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| showToggle | boolean | false | Show TTS toggle in options |
| toggleLabel | string | "Enable text-to-speech" | Toggle label |
| activateByDefault | boolean | false | TTS on by default |

### chatOptions.rating
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| enabled | boolean | false | Enable conversation rating |
| titleText | string | "Please rate your chat experience" | Rating prompt |
| commentPlaceholder | string | "Type something here" | Feedback field placeholder |
| submitButtonText | string | "Send feedback" | Submit button text |
| submittedBannerText | string | "Your feedback was submitted" | Confirmation banner |

### chatOptions.footer
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| enabled | boolean | false | Show footer in options |
| items | array | — | Up to 2: { title, url } |

### privacyNotice
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| enabled | boolean | false | Require privacy acceptance before chat |
| title | string | "Privacy Notice" | Notice heading |
| text | string | "Please accept our privacy policy to start your chat" | Notice body (supports Markdown) |
| submitButton | string | "Submit" | Accept button text |
| policyLinkTitle | string | — | Privacy policy link label |
| policyLinkUrl | string | — | Privacy policy URL |

### businessHours
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| enabled | boolean | false | Restrict to business hours |
| mode | "inform" / "disable" / "hide" | "inform" | Out-of-hours behavior |
| informationText | string | — | Message shown outside hours |
| informationTitle | string | — | Title shown outside hours |
| timezone | string | — | IANA timezone (e.g. "Europe/Berlin") |
| schedule | array | — | { dayOfWeek, startTime, endTime } per day |

### unreadMessages
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| enableTitleIndicator | boolean | false | Show count in browser tab |
| enableBadge | boolean | false | Show unread count badge |
| enablePreview | boolean | false | Show preview bubble |
| enableSound | boolean | false | Play notification sound |

### maintenance
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| enabled | boolean | false | Activate maintenance mode |
| mode | "inform" / "disable" / "hide" | "inform" | Maintenance behavior |
| informationText | string | — | Maintenance message |
| informationTitle | string | — | Maintenance title |

### watermark
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| type | "default" / "custom" / "none" | "default" | Watermark type |
| text | string | "Powered by Cognigy.AI" | Custom watermark text |
| url | string | "https://www.cognigy.com/" | Custom watermark URL |

### persistentMenu
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| enabled | boolean | false | Show persistent menu |
| title | string | — | Menu title |
| items | array | — | { title, payload } pairs |

### attachmentUpload
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| enabled | boolean | false | Allow file uploads |
| dropzoneText | string | "Drop to attach" | Dropzone label |

### webchatIcon
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| animation | "none" / "bounce" / "swing" / "pulse" | "none" | Icon animation |
| animationInterval | number | 5 | Seconds between animations |
| animationSpeed | "slow" / "normal" / "fast" / "superfast" | "normal" | Animation speed |

### customJson
Type: string (raw JSON). Escape-hatch for advanced Webchat Custom Settings not covered above. Example:
manage_webchat {
  endpointId: "...",
  customJson: "{\"colors\":{\"primaryColor\":\"red\"},\"customTranslations\":{\"network_error\":\"Netzwerkfehler\"}}"
}

## Common Recipes

### Branded Webchat
manage_webchat {
  projectId: "...", flowId: "...", name: "Support Chat",
  layout: {
    title: "Acme Support",
    logoUrl: "https://acme.com/logo.png",
    colors: { primaryColor: "#0052cc", userMessageBg: "#e3f2fd" }
  }
}

### Modern Streaming Chat
manage_webchat {
  endpointId: "...",
  stylePreset: "modern",
  behavior: { enableTypingIndicator: true }
}

### Support Bot with Business Hours
manage_webchat {
  endpointId: "...",
  businessHours: {
    enabled: true, mode: "inform", timezone: "America/New_York",
    informationText: "We're available Mon-Fri 9-5 ET.",
    schedule: [
      { dayOfWeek: "Monday", startTime: "09:00", endTime: "17:00" },
      { dayOfWeek: "Tuesday", startTime: "09:00", endTime: "17:00" },
      { dayOfWeek: "Wednesday", startTime: "09:00", endTime: "17:00" },
      { dayOfWeek: "Thursday", startTime: "09:00", endTime: "17:00" },
      { dayOfWeek: "Friday", startTime: "09:00", endTime: "17:00" }
    ]
  },
  chatOptions: {
    enabled: true,
    rating: { enabled: true }
  },
  privacyNotice: { enabled: true, policyLinkUrl: "https://acme.com/privacy" }
}

### Home Screen with Conversation Starters
manage_webchat {
  endpointId: "...",
  homeScreen: {
    enabled: true,
    welcomeText: "Hi! What can I help you with?",
    conversationStarters: [
      { title: "Track my order", type: "postback", value: "track order" },
      { title: "Return an item", type: "postback", value: "return item" },
      { title: "Help Center", type: "url", value: "https://acme.com/help" }
    ]
  }
}

## Testing

The manage_webchat response includes demoWebchatUrl — a direct browser link to the Cognigy Demo Webchat page where the user can interact with the configured widget immediately. Always present this URL to the user by default.

You can also append query parameters for testing:
- ?user=testuser — set a specific user ID
- ?user=testuser&sessionId=mysession — set user and session

## Embedding (Production)

When the user asks about deploying to their website, use the configUrl and embeddingSnippet from the response:

```html
<script src="https://github.com/Cognigy/Webchat/releases/latest/download/webchat.js"></script>
<script>
  window.cognigyWebchat.open({
    configUrl: "CONFIG_URL_HERE"
  });
</script>
```

Replace CONFIG_URL_HERE with the configUrl from the manage_webchat response.

## Prerequisites
- A Flow must exist (from create_ai_agent or manual creation)
- An LLM must be configured in the project for the agent to generate responses
- Use list_resources { resourceType: "endpoint", projectId } to find existing webchat endpoints
