---
name: flow-nodes
description: "Use when adding custom logic inside a Cognigy tool branch with manage_flow_nodes, or when rendering/visualizing a flow as a diagram — supported node types, config schemas, placement rules, the tool-first workflow, and the render operation."
---

# Flow Node Reference

Use `manage_flow_nodes` to add logic nodes **inside tool branches only**. Nodes are helpers for tools — they must ALWAYS be created under a tool, never as standalone pre-agent nodes.

**CRITICAL: NEVER add nodes before the AI Agent Job node.** Pre-agent nodes cause conversation loops and break the agent's ability to orchestrate. ALL logic — including authentication, data collection, greetings, and conditional behavior — must be implemented as agent tools.

**Voice exception — Set Session Config:** The one node that _should_ run before the AI Agent node is a `setSessionConfig` (Set Session Config) node, and only in **voice** flows. It applies per-session speech settings (barge-in, ASR, STT/TTS, input timeouts) and must be the **first** node. The `audit_voice_agent` tool checks for this and can create it by `prepend`ing before the AI Agent node. Do not add any other pre-agent nodes.

**LLM Prompt exception — explicit request only:** The `llmPrompt` node (`llmPromptV2` — a raw LLM call driven by a freeform system prompt) is the one node type that legitimately lives at the **top level** of a flow, in flows that have **no AI Agent node at all**. It is supported ONLY when the user **explicitly asks for an LLM Prompt node by name**. NEVER offer it, never use it as a fallback for the AI Agent node, and never ask the user to choose between the two — the AI Agent node (via `create_ai_agent`) is always the default for anything agent-shaped. Reading and updating llmPromptV2 nodes that already exist in a flow is always fine. See the [LLM Prompt section](#llmprompt--llm-prompt-explicit-request-only) for config.

## Quick Start (tool-first workflow)

```
1. Create a tool — create_tool { aiAgentId, toolType: 'tool', name: 'Process Order', config: { toolId: 'process_order', description: 'Process a customer order' } } → returns toolNodeId
2. Get the flowId — from create_ai_agent response, or list_resources { resourceType: 'flow', projectId }
3. Add a node inside the tool — manage_flow_nodes { operation: 'create', flowId, parentNodeId: '<toolNodeId>', mode: 'appendChild', nodeType: 'code', label: 'Validate Order', config: { code: '...' } }
4. Add more nodes — manage_flow_nodes { operation: 'create', flowId, parentNodeId: '<previousNodeId>', mode: 'append', nodeType: 'say', label: 'Confirm', config: { text: 'Order processed!' } }
5. List all nodes — manage_flow_nodes { operation: 'list', flowId }
6. Update a node — manage_flow_nodes { operation: 'update', flowId, nodeId: '<id>', config: { text: 'Updated!' } }
7. Delete a node — manage_flow_nodes { operation: 'delete', flowId, nodeId: '<id>' }
```

## Placement

Nodes MUST be placed inside tool branches using `parentNodeId` and `mode`.

- **Inside a tool (primary use case)**: Set `parentNodeId` to the tool node ID (from `create_tool`) and `mode` to `appendChild`. The handler automatically places the node in the correct execution chain (before the Resolve Tool Action node). Both `appendChild` and `append` work correctly when targeting a tool node.
- **After a sibling**: Set `parentNodeId` to an existing node within the branch and `mode` to `append` to place after it.

## Supported Node Types

> **xApp nodes** (`initAppSession`, `showXAppAdaptiveCard`, `showXAppHtml`, `setXAppState`, `getXAppSessionPin`) are also available via `manage_flow_nodes`. They build interactive HTML / Adaptive Card mini-apps. `initAppSession` must precede any other xApp node. See the `xapps` guide for details.

### say — Send Message

Category: message

Send a text message to the user. Supports rich output types.

**Config:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| text | string | Yes | Message text. Supports CognigyScript: `{{context.name}}` |
| quickReplies | array | No | Quick reply buttons: `[{ title, payload }]` |
| buttons | array | No | Persistent buttons: `[{ title, type, value }]` |
| gallery | object | No | Image gallery/carousel |
| list | object | No | List output |
| audio | object | No | Audio output `{ url }` |
| video | object | No | Video output `{ url }` |
| image | object | No | Image output `{ url }` |
| adaptiveCard | object | No | Microsoft Adaptive Card JSON |
| data | object | No | Custom data payload attached to the message |

**Example:**

```json
{
  "operation": "create",
  "flowId": "<flowId>",
  "nodeType": "say",
  "label": "Welcome Message",
  "config": {
    "text": "Welcome! How can I help you today?",
    "quickReplies": [
      { "title": "Check order status", "payload": "check_order" },
      { "title": "Talk to human", "payload": "handover" }
    ]
  }
}
```

---

### question — Ask Question

Category: message

Ask the user a question. The answer is captured and stored.

**Config:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| text | string | Yes | Question text |
| type | string | Yes | Expected answer type: `text`, `yesNo`, `email`, `number`, `date`, `intent`, `regex`, `data` |
| quickReplies | array | No | Suggested answers |
| validation | object | No | Validation rules |
| resultLocation | string | No | Where to store the answer (default: `input.result`) |

**Example:**

```json
{
  "operation": "create",
  "flowId": "<flowId>",
  "nodeType": "question",
  "label": "Ask Email",
  "config": {
    "text": "What is your email address?",
    "type": "email"
  }
}
```

---

### ifThenElse — Conditional Branch

Category: logic

Branch the flow based on a CognigyScript condition. Auto-creates `then` and `else` child nodes.

**Config:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| condition | string | Yes | CognigyScript expression (without `{{ }}`), e.g. `input.intent === "order_status"` or `context.isVIP === true` |

**Example:**

```json
{
  "operation": "create",
  "flowId": "<flowId>",
  "nodeType": "ifThenElse",
  "label": "Check VIP",
  "config": {
    "condition": "context.isVIP === true"
  }
}
```

**Adding nodes inside branches:** See [Branching nodes](#branching-nodes) below.

---

### lookup — Switch / Multi-Branch

Category: logic

Switch on intent, state, type, or a CognigyScript expression. Auto-creates `case` and `default` child nodes.

**Config:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| type | string | Yes | Lookup type: `intent`, `state`, `type`, `cognigyScript` |
| condition | string | No | CognigyScript expression (when type is `cognigyScript`) |

**Updating case values:** Use the `cases` convenience array on the parent switch node update — see [Updating case values](#updating-case-values) below.

**Adding nodes inside branches:** See [Branching nodes](#branching-nodes) below.

---

### setSessionContext — Set Context

Category: data

Store a key-value pair in the persistent session context. Each node stores **one** entry. To store multiple values, create multiple `setSessionContext` nodes.

**Config:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| key | string | Yes | Context key name |
| value | string | Yes | Value to store. Supports CognigyScript: `{{input.result}}` |
| contextEntries | array | No | Convenience alias — `[{ key, value }]`. Only the **first** entry is used; create separate nodes for additional entries. |

**Example — using key/value directly (preferred):**

```json
{
  "operation": "create",
  "flowId": "<flowId>",
  "nodeType": "setSessionContext",
  "label": "Save User Name",
  "config": {
    "key": "userName",
    "value": "{{input.result}}"
  }
}
```

**Example — using contextEntries alias:**

```json
{
  "operation": "create",
  "flowId": "<flowId>",
  "nodeType": "setSessionContext",
  "label": "Save User Name",
  "config": {
    "contextEntries": [{ "key": "userName", "value": "{{input.result}}" }]
  }
}
```

**Note:** Only one key-value pair is stored per node. If you pass multiple entries in `contextEntries`, only the first is used. Create separate `setSessionContext` nodes for each value you need to store.

---

### code — Execute Code

Category: data

Run custom **TypeScript** (a single source string — not multiple files, not HTML). The Cognigy backend transpiles it to JavaScript at save time.

**Runtime objects available inside the code:**

| Object    | What it is                                                             |
| --------- | ---------------------------------------------------------------------- |
| `input`   | The current input — read/write. `input.text`, `input.data`, etc.       |
| `context` | Session-persistent store. Read/write values that survive across turns. |
| `profile` | The contact profile.                                                   |
| `actions` | Helper actions, e.g. `actions.output(text, data)`, `actions.log(...)`. |

**Config:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| code | string | Yes | TypeScript source to execute (the backend enforces a large upper size limit) |

Server-computed, read-only (do NOT send these): `transpiled` (compiled JS output) and `hasError` (`true` if the code failed to transpile). `get` omits `transpiled` and surfaces `hasError`.

**Read before you edit.** `list` returns no config. To see a node's current code, use `get`:

```json
{ "operation": "get", "flowId": "<flowId>", "nodeId": "<nodeId>" }
```

Then send the full new `code` string on `update` (config is merged; `code` is replaced wholesale). After a write, a `_hints.warning` with `hasError` means the code did not compile — `get`, fix, and update again.

**Create example:**

```json
{
  "operation": "create",
  "flowId": "<flowId>",
  "nodeType": "code",
  "label": "Format Response",
  "config": {
    "code": "const items = context.cartItems || [];\ninput.cartSummary = items.map((i: { name: string; price: number }) => `${i.name}: $${i.price}`).join('\\n');"
  }
}
```

---

### goTo — Go To Node/Flow

Category: logic

Jump execution to another flow or a specific node.

**Config:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| flowId | string | No | Target flow reference ID (for cross-flow jumps) |
| nodeId | string | No | Target node ID within the flow |
| executionMode | string | No | `execute` (default) or `goAndDontReturn` |

---

### sleep — Wait

Category: logic

Pause execution for a duration.

**Config:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| milliseconds | number | Yes | Milliseconds to wait |
| delay | number | No | Alias for `milliseconds` (supported for backward compatibility) |

---

### httpRequest — HTTP Request

Category: service

Call an external API.

**Config:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| url | string | Yes | Request URL. Supports CognigyScript: `https://api.example.com/{{context.endpoint}}` |
| type | string | No | HTTP method: `GET`, `POST`, `PUT`, `PATCH`, `DELETE` (default: `GET`) |
| headers | object or string | No | Headers as object `{"Authorization": "Bearer xxx"}` or JSON string |
| payloadType | string | No | `json` or `text` |
| payloadJSON | object | No | JSON body (when payloadType is `json`) |
| payloadText | string | No | Text body (when payloadType is `text`) |
| contextStore | string | No | Context key to store the response (auto-sets storage to context) |
| inputStore | string | No | Input key to store the response (auto-sets storage to input) |

**Example:**

```json
{
  "operation": "create",
  "flowId": "<flowId>",
  "nodeType": "httpRequest",
  "label": "Fetch Order",
  "config": {
    "url": "https://api.example.com/orders/{{context.orderId}}",
    "type": "GET",
    "headers": { "Authorization": "Bearer {{context.apiToken}}" },
    "contextStore": "orderData"
  }
}
```

---

### llmPrompt — LLM Prompt (explicit request ONLY)

Category: service

A raw LLM call driven by a **freeform system prompt** (`config.prompt`). Supports tools, streaming/storage options, image handling, and custom model options.

**STEERING — read first:**

- Create this node ONLY when the user explicitly asked for an "LLM Prompt" node. The AI Agent node is ALWAYS the default for agents — never offer llmPrompt as an alternative, never fall back to it, never ask the user to choose.
- For a **new** agent built on an LLM Prompt node ("create an agent using an LLM Prompt node"), use `create_ai_agent { agentNodeType: "llmPrompt", systemPrompt }` — it provisions project + flow + node + endpoint in one call. Use `manage_flow_nodes create` only to add an llmPrompt node to an **existing** flow.
- Unlike every other node in this guide, llmPrompt is a **top-level flow node** (placed after `start` via `mode: "append"`), not a tool-branch helper. A flow can be driven entirely by it, with no aiAgentJob node.
- `prompt` is a fully freeform system prompt — there are no separate persona/guardrail fields like the AI Agent node has. All behavior AND all guardrails must live in the prompt text itself, so treat it with care: include explicit constraints (what the agent must never do) directly in the prompt.
- The backend auto-creates a `llmPromptDefault` branch (not deletable) and a placeholder tool under every new llmPromptV2 node; the plugin removes the placeholder tool automatically.
- Flows driven by an LLM Prompt node have **no agent resource**: `update_ai_agent` does not apply (update the prompt via `manage_flow_nodes update`), and tools are addressed with `create_tool { flowId }` / `update_tool { flowId }` / `list_resources { resourceType: "tool", flowId }` instead of aiAgentId. Only `tool`, `mcp`, and `http` tool types work under it (no knowledge/send_email).

**Config (key fields — `get` the node for the full set):**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| prompt | string | Yes | Freeform system prompt. Supports CognigyScript and the `@cognigyRecentConversation` / `@cognigyRecentUserInputs` transcript tags (optionally with a turn limit, e.g. `@cognigyRecentConversation:3`) |
| llmProviderReferenceId | string | No | LLM referenceId, or `"default"` for the project's Generative AI default |
| storeLocation | string | No | `stream` (stream to output), `input`, or `context` |
| immediateOutput | boolean | No | Output the result immediately (with `storeLocation: "stream"`) |
| inputKey / contextKey | string | No | Where to store the result for `input`/`context` storage (default `promptResult`) |
| chatTranscriptSteps | number | No | Previous conversation turns included in the request (default 50) |
| usePromptMode | boolean | No | Single-prompt mode — no conversation context; prompt must be non-empty |
| temperature / topP / maxTokens / frequencyPenalty / presencePenalty / seed | number | No | Sampling controls (samplingMethod picks `temperature` vs `topP`) |
| responseFormat | string | No | `default`, `text`, or `json` |
| toolChoice | string | No | `auto`, `required`, or `none` — how tools are selected |
| useStrict | boolean | No | Strict mode for tool argument schemas |
| processImages / transcriptImageHandling | boolean / string | No | Image attachment handling (`minify`, `drop`, `keep`) |
| customModelOptions / customRequestOptions | object | No | Provider-specific overrides (e.g. `{ "model": "..." }`, `{ "stream": true }`) |
| errorHandling / errorMessage / logErrorToSystem | string / string / boolean | No | `continue` (default), `stop`, or go-to error handling |

**Example (only after an explicit user request):**

```json
{
  "operation": "create",
  "flowId": "<flowId>",
  "nodeType": "llmPrompt",
  "label": "Summarize Conversation",
  "parentNodeId": "<startNodeId or preceding top-level node>",
  "mode": "append",
  "config": {
    "prompt": "A user talked to a chatbot:\n@cognigyRecentConversation\n\nSummarize the conversation in two sentences.",
    "storeLocation": "context",
    "contextKey": "summary"
  }
}
```

---

## Branching nodes

`ifThenElse` and `lookup` nodes auto-create child branch nodes when created:

- **ifThenElse** creates `then` and `else` child nodes
- **lookup** creates `case` and `default` child nodes

### Placing nodes inside a branch

To add logic inside a branch (e.g. inside the "then" branch of an if/else):

1. Create the branching node (ifThenElse or lookup)
2. List nodes to find the auto-created child IDs: `manage_flow_nodes { operation: "list", flowId }`
3. Use `mode: "append"` with `parentNodeId` set to the branch child node ID

**CRITICAL:** Do NOT use `mode: "appendChild"` on branch children (then, else, case, default). It creates orphaned nodes with `parentId: null`. Always use `mode: "append"` instead. The handler auto-corrects this when possible, but using `append` directly is the reliable approach.

### Example — add a Say node inside the "then" branch of an ifThenElse

```
Step 1: Create the ifThenElse node
manage_flow_nodes {
  operation: "create", flowId: "<flowId>",
  parentNodeId: "<toolNodeId>", mode: "appendChild",
  nodeType: "ifThenElse", label: "Check VIP",
  config: { condition: "context.isVIP === true" }
}
→ returns nodeId: "if123..."

Step 2: List nodes to find the auto-created then/else child IDs
manage_flow_nodes { operation: "list", flowId: "<flowId>" }
→ find the "then" child node with parentId matching "if123..."
→ thenNodeId: "then456..."

Step 3: Add a node inside the "then" branch using mode: "append"
manage_flow_nodes {
  operation: "create", flowId: "<flowId>",
  parentNodeId: "then456...", mode: "append",
  nodeType: "say", label: "VIP Greeting",
  config: { text: "Welcome back, VIP!" }
}
```

### Example — add nodes inside a lookup case branch

```
Step 1: Create the lookup node
manage_flow_nodes {
  operation: "create", flowId: "<flowId>",
  parentNodeId: "<toolNodeId>", mode: "appendChild",
  nodeType: "lookup", label: "Route by Type",
  config: { type: "cognigyScript", condition: "input.category" }
}
→ returns nodeId: "switch123..."

Step 2: List nodes to find the auto-created case/default child IDs
manage_flow_nodes { operation: "list", flowId: "<flowId>" }
→ find case children with parentId matching "switch123..."
→ caseNodeId: "case456...", defaultNodeId: "default789..."

Step 3: Update case values
manage_flow_nodes {
  operation: "update", flowId: "<flowId>",
  nodeId: "switch123...",
  config: { cases: [{ id: "case456...", value: "billing" }] }
}

Step 4: Add a node inside the case branch using mode: "append"
manage_flow_nodes {
  operation: "create", flowId: "<flowId>",
  parentNodeId: "case456...", mode: "append",
  nodeType: "say", label: "Billing Help",
  config: { text: "Let me help with your billing question." }
}
```

---

## Updating case values

When you create a `lookup` (switch) node, the case child nodes start with empty values. To set what each case matches:

**Option 1 — Update via parent switch with `cases` array (recommended):**

```json
{
  "operation": "update",
  "flowId": "<flowId>",
  "nodeId": "<switchNodeId>",
  "config": {
    "cases": [
      { "id": "<caseNodeId1>", "value": "billing" },
      { "id": "<caseNodeId2>", "value": "shipping" }
    ]
  }
}
```

**Option 2 — Update individual case nodes directly:**

```json
{
  "operation": "update",
  "flowId": "<flowId>",
  "nodeId": "<caseNodeId>",
  "config": { "value": "billing" }
}
```

The handler sends the correct API format (`{ config: { case: { value: "..." } } }`) automatically.

---

## Visualizing a flow (render)

`manage_flow_nodes { operation: "render", flowId }` deterministically serializes the whole flow into a diagram. It is read-only. The engine builds the picture in code, so you never re-derive the graph (no hallucinated edges, ~0 tokens).

Returned fields:

- `ascii` — a text tree of the flow (`next` chain top-to-bottom, `children` nested). Display it inline in **any** client, including a terminal.
- `mermaid` — a `flowchart TD` string. **Deliver it ONLY as a native Mermaid/diagram artifact** (the "Download and open · MERMAID" card). This is the one form that renders zoomably and works on phones.
  - Do **NOT** wrap it in an HTML page/widget or a generic HTML "visualize" connector — an HTML-embedded diagram is not mobile-friendly.
  - Do **NOT** paste it as an inline ` ```mermaid ` fenced code block — it renders as plain text or a tiny thumbnail.
  - Keep commentary, the legend, and the ascii tree **outside** the artifact.
- `legend` — a key of only the shapes/edges present in this flow (also drawn inside the mermaid as a compact strip and in the HTML panel). Toggle with `legend: false`.

Options:

- `focus: "<nodeId>"` or `focus: ["<id1>", "<id2>"]` — highlight one or more nodes (e.g. ones you just created/edited) so the user sees how the change fits.
- `format: "ascii" | "mermaid" | "both"` (default `both`).
- `writeHtml: true` — also write a self-contained, offline rich HTML graph to a tmp file **on the user's own machine** (this MCP server runs locally) and **open it in the browser automatically**. Returns `htmlUrl` (a `file://` link) and `htmlPath`. The file is already complete on that machine — just hand the user the link; do NOT try to fetch, upload, or regenerate it. Pass `openInBrowser: false` to only get the link back without opening.

After a node create/update/delete, offer a render once, in one short line (do not render unprompted, do not repeat the offer).

---

## Notes

- **Tool parameters**: Inside AI Agent tool branches, the LLM's tool call parameters are available at `input.aiAgent.toolArgs`, **NOT** `input.data`. For example, if the tool defines a `city` parameter, access it as `input.aiAgent.toolArgs.city` in Code nodes or `{{input.aiAgent.toolArgs.city}}` in CognigyScript fields.
- **CognigyScript**: Use `{{expression}}` syntax in text/message fields to reference runtime data (`input`, `context`, `profile`). For condition fields (ifThenElse, lookup), use plain expressions without `{{ }}` — e.g. `context.isVIP === true`.
- **Node IDs**: All node IDs are 24-char hex strings. Get them from `manage_flow_nodes { operation: 'list' }`.
- **Ordering**: Nodes execute top-to-bottom within a branch. Use `parentNodeId` to control placement.
- **Nodes belong inside tools**: ALWAYS create a tool first (`create_tool { toolType: "tool" }`), then add nodes inside the tool branch using `parentNodeId` = toolNodeId and `mode` = `appendChild`. NEVER add standalone nodes before the AI Agent Job node — this is an anti-pattern that breaks conversations.
