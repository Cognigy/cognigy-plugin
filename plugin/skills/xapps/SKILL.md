---
name: xapps
description: "Use when the user wants to add xApps to a Cognigy flow — interactive HTML / Adaptive Card mini-apps rendered to the user, with the submitted data flowing back into the conversation. Covers the xApp flow nodes, the Init Session rule, and accessing xApp data."
---

# xApps

xApps are interactive in-conversation mini-apps: you render an HTML page or an Adaptive
Card to the user, they interact, and their submitted data flows back into the conversation.
xApps are built as **flow nodes** managed with `manage_flow_nodes` (extension
`@cognigy/basic-nodes`).

## Two hard rules

1. **`xApp: Init Session` (`initAppSession`) must run before any other xApp node.** It
   creates the session and populates `input.apps.url` (session URL) and `input.apps.baseUrl`.
   Every other xApp node depends on a live session. Creating an xApp node without a preceding
   `initAppSession` in the flow returns a `_hints.warning` — add Init Session first.
2. **Data comes back via `input`/`context`**, not a return value — see "Accessing xApp data".

## Where xApp nodes go

Like all `manage_flow_nodes` nodes, xApp nodes live **inside a tool branch** — never before
the AI Agent Job node (see the `flow-nodes` guide). "Init Session at the beginning" means the
**beginning of the xApp sequence inside the tool branch**, not the flow's absolute start.

Typical chain inside a tool:

```
tool node ──appendChild──▶ initAppSession
          ──append──────▶ showXAppAdaptiveCard { waitForInput: true, storeResultInContext: true, contextKey: "result" }
          ──append──────▶ code / say  (reads context.result or input.data._cognigy._app.payload)
                          ▶ Resolve Tool Action
```

## Workflow

```
1. Create a tool — create_tool { aiAgentId, toolType: 'tool', name: 'Collect Details', config: { toolId: 'collect_details', description: 'Collect details via an xApp' } } → toolNodeId
2. Init the session — manage_flow_nodes { operation: 'create', flowId, parentNodeId: '<toolNodeId>', mode: 'appendChild', nodeType: 'initAppSession', label: 'xApp: Init Session' }
3. Show a UI + wait — manage_flow_nodes { operation: 'create', flowId, parentNodeId: '<initSessionNodeId>', mode: 'append', nodeType: 'showXAppAdaptiveCard', label: 'xApp: Show Card', config: { card: { ... }, waitForInput: true, storeResultInContext: true, contextKey: 'result' } }
4. Use the result — add a code/say node after it that reads context.result or input.data._cognigy._app.payload
5. List nodes — manage_flow_nodes { operation: 'list', flowId }
```

## Node types

### initAppSession — xApp: Init Session

Creates the session. Place first among the xApp nodes. All fields optional.

| Field | Type | Description |
|-------|------|-------------|
| backgroundColor / textColor | string | CSS color for the shell page |
| logo | `"default"` \| `"none"` \| `"custom"` | Shell logo. `custom` requires `logoUrl` |
| logoUrl | string | Custom logo URL (when `logo: "custom"`) |
| faviconUrl | string | Browser-tab icon URL |
| pageTitle | string | Browser-tab title |
| appLoadingText / appLaunchErrorText / appErrorText | string | Screen texts |
| intermediateScreenCustomizationType | `"none"` \| `"override"` \| `"app"` | Intermediate screen mode |
| intermediateScreenOverrideText | string | When `...Type: "override"` |
| intermediateScreenAppTemplateId / intermediateScreenAppTemplateData | string / object | When `...Type: "app"` |
| connectionScreenCustomizationType | `"none"` \| `"override"` \| `"app"` | Connection screen mode |
| connectionScreenOverrideConnectingText / ...InvalidText / ...UnavailableText | string | When `...Type: "override"` |
| connectionScreenAppTemplateId / connectionScreenAppTemplateData | string / object | When `...Type: "app"` |

```json
{
  "operation": "create",
  "flowId": "<flowId>",
  "parentNodeId": "<toolNodeId>",
  "mode": "appendChild",
  "nodeType": "initAppSession",
  "label": "xApp: Init Session",
  "config": { "pageTitle": "Booking", "logo": "default" }
}
```

### showXAppAdaptiveCard — xApp: Show Adaptive Card

Render an Adaptive Card. `card` is required.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| card | object | Yes | Adaptive Card JSON (build with the Adaptive Card Designer) |
| primaryColor / primaryContrastColor | string | No | Style overrides |
| waitForInput | boolean | No | Pause the flow until the user submits |
| storeResultInContext | boolean | No | Store the submit payload in context (needs `waitForInput`) |
| contextKey | string | No | Context key for the result (default `"result"`) |
| autoOpen, closeOnSubmit, feedbackMessage, screenTitle, sendEventOnCloseIconClick, showCloseIcon | — | No | Webchat v3 overlay settings |

```json
{
  "operation": "create",
  "flowId": "<flowId>",
  "parentNodeId": "<initSessionNodeId>",
  "mode": "append",
  "nodeType": "showXAppAdaptiveCard",
  "label": "xApp: Show Card",
  "config": {
    "card": { "type": "AdaptiveCard", "version": "1.5", "body": [{ "type": "Input.Text", "id": "nickname", "label": "Nickname" }], "actions": [{ "type": "Action.Submit", "title": "Submit" }] },
    "waitForInput": true,
    "storeResultInContext": true,
    "contextKey": "result"
  }
}
```

### showXAppHtml — xApp: Show HTML

Render custom HTML. All fields optional (`mode` defaults to `body`).

| Field | Type | Description |
|-------|------|-------------|
| mode | `"body"` \| `"full"` | `body` = HTML body only (Cognigy wraps it + injects the xApp SDK). `full` = full HTML document (you must include the SDK yourself) |
| body | string | HTML body (when `mode: "body"`) |
| html | string | Full HTML document (when `mode: "full"`) |
| waitForInput / storeResultInContext / contextKey | boolean / boolean / string | Same waiting behavior as above |
| autoOpen, closeOnSubmit, feedbackMessage, screenTitle, sendEventOnCloseIconClick, showCloseIcon | — | Webchat v3 overlay settings |

In HTML, return data to the flow via the injected `SDK` global: `<button onclick="SDK.submit({ variant: 'a' })">A</button>`, or submit the first `<form>`.

### setXAppState — xApp: Set State

Render a Cognigy App Template by id. `appTemplateId` required.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| appTemplateId | string | Yes | Reference id of the App Template |
| appTemplateData | object | No | Data passed to the template (default `{}`) |

### getXAppSessionPin — xApp: Get Session PIN

No config. Populates `input.apps.session.pin` and the PIN page URL into `input.apps.baseUrl`,
so the user can open the xApp on another device via a PIN.

## Accessing xApp data

- **Session URL** — `input.apps.url`. Use it as a Say-node button/quick-reply payload of type
  `openXApp` with value `{{input.apps.url}}` to give the user a link into the xApp.
- **Session PIN** — `input.apps.session.pin` (after `getXAppSessionPin`); PIN page at
  `input.apps.baseUrl`.
- **Submitted data** — `input.data._cognigy._app.payload`. When the show node has
  `waitForInput` + `storeResultInContext`, it's also written to `context.<contextKey>`
  (default `context.result`).

## Prerequisite

Rendering requires an xApp-capable endpoint (Cognigy App Session Manager / Webchat v3). Node
creation succeeds regardless, but the xApp only renders end-to-end on a supported endpoint.
