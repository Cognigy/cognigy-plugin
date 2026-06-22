---
name: voice-gateway-setup
description: "Use when the user wants to set up a voice agent or a Voice Gateway endpoint with WebRTC for browser-based voice interaction."
---

# Voice Gateway Setup Guide

Deploy an AI Agent as a voice-enabled endpoint with WebRTC support. Users can talk to the agent directly in their browser.

## Prerequisites

1. **A Project** — use `list_resources { resourceType: "project" }` to find one, or let `create_ai_agent` create one automatically.
2. **A Flow** — the conversation logic the voice endpoint connects to. Use `list_resources { resourceType: "flow", projectId }` to find existing flows.
3. **An LLM** — the agent needs an LLM to generate responses. Use `setup_llm` if not configured.

## Quick Start

### 1. Create a Voice Gateway endpoint

```json
{
  "projectId": "<24-char hex>",
  "flowId": "<flow referenceId>",
  "name": "My Voice Agent"
}
```

This automatically:

- Creates a `voiceGateway2` endpoint
- Provisions a WebRTC client
- Returns a `webrtcDemoUrl` the user can open in a browser

### 2. Customize the WebRTC widget (optional)

```json
{
  "projectId": "<24-char hex>",
  "flowId": "<flow referenceId>",
  "name": "My Voice Agent",
  "webrtcWidgetConfig": {
    "label": "Support Agent",
    "theme": "AI_PURPLE",
    "transcription": { "enabled": true },
    "tagline": "How can I help you today?",
    "avatarLogoUrl": "https://example.com/avatar.png"
  }
}
```

### 3. Update an existing endpoint

```json
{
  "endpointId": "<24-char hex>",
  "webrtcWidgetConfig": {
    "theme": "CLEAN_WHITE"
  }
}
```

## WebRTC Widget Themes

| Theme         | Description               |
| ------------- | ------------------------- |
| `DARK_MODE`   | Dark background (default) |
| `CLEAN_WHITE` | Light/white background    |
| `AI_PURPLE`   | Purple accent theme       |

## URLs in the Response

| Field                           | Purpose                                                              |
| ------------------------------- | -------------------------------------------------------------------- |
| `webrtcDemoUrl`                 | Open in browser to talk to the agent — **always show this to users** |
| `_integration.wsEndpointUrl`    | WebSocket URL for programmatic/embedded use                          |
| `_integration.embeddingSnippet` | HTML code to embed the voice widget on a website                     |

## Embedding on a Website

Copy the `embeddingSnippet` from the response into your HTML page. It loads the Cognigy WebRTC widget and connects to the voice endpoint automatically.

## Typical Full Workflow

1. `create_ai_agent` → get `flowId` and `projectId`
2. `setup_llm` → configure LLM for the project
3. `manage_voice_gateway { projectId, flowId }` → get `webrtcDemoUrl`
4. Share the URL with the user
