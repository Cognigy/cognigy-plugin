# NiCE Cognigy Plugin

> Distributed exclusively through each client's native plugin mechanism — a **plugin** on **Claude Code**, **Claude Desktop**, **ChatGPT + Codex**, and **Antigravity**, an **extension** on **Google Gemini CLI**, a **plugin** on **Cursor**, and an [**Agent Plugins**](https://agent-plugins.org)-standard plugin on any conformant host (**Kiro**, **VS Code + Copilot**, …) — with more clients to come. Each package installs the server engine and ships skills + agents.

A plugin that connects your AI assistant to the [Cognigy.AI](https://www.cognigy.com) REST API. Create, test, and improve LLM-based AI Agents through a self-improvement loop — without leaving your client.

**Quick links:** [Installation](#installation) · [Staying up to date](#staying-up-to-date)

## Features

- **17 workflow tools** for agent creation, deployment, packaging, backup, and voice setup
- **One-call agent setup**: creates Agent + Flow + AI Agent Job Node + REST Endpoint automatically
- **Self-improvement loop**: talk to your agent, evaluate responses, update the job description, repeat
- **Knowledge store support**: attach RAG knowledge stores to agents as tools
- **Browser voice deployment**: create Voice Gateway endpoints with WebRTC demo URLs
- **Voice preview setup**: configure supported speech providers for voice experiences
- **Skills + agents**: workflow guidance auto-loads as skills in supporting clients; build/go-live loops run as subagents
- **Built-in docs lookup**: bundles the official [Cognigy documentation](https://docs.cognigy.com) MCP server — your assistant searches and reads the docs before answering platform questions, instead of guessing from training data
- Built-in rate limiting, Zod input validation, and RFC 7807 error responses

## Installation

**Two steps.** Step 1 is the same for every client. Step 2 is where you check what your client still needs from you — for most clients that's nothing, but the answer is in the table, so look your client up rather than assuming.

### Step 1 — run the installer

One installer covers every client. Run it, pick your client(s), enter your Cognigy API base URL (Enter for the trial default) and API key (masked as you type), then restart the client.

**macOS / Linux** — one line (checks for Node.js, then runs the installer):

```
bash <(curl -fsSL https://raw.githubusercontent.com/Cognigy/cognigy-plugin/main/install.sh)
```

**Windows (PowerShell)** — open as **Administrator**, then:

```
irm https://raw.githubusercontent.com/Cognigy/cognigy-plugin/main/install.ps1 | iex
```

> The bootstrap only checks that Node.js 20+ is present (it tells you how to install it if not — it never installs it for you), then runs exactly the command below. Use whichever you prefer; they do the same thing.

Already have [Node.js 20+](https://nodejs.org)? Skip the bootstrap:

```
npx -y -p @cognigy/plugin-engine@latest cognigy-setup
```

### Step 2 — check your client's row

The installer wires your credentials everywhere and installs the plugin wherever it can, but some clients need one manual step from you. Find your client below and do what **Extra step after the installer** says — **None** means step 1 finished the job. Each guide has the full instructions, Windows notes, how to verify it worked, and troubleshooting.

Cursor is the one client that needs no installer at all: it collects your credentials itself, so you can start at its guide and skip step 1.

| Client                                                                    | Tools | Skills | Agents | Extra step after the installer           | Auto-updates             |
| ------------------------------------------------------------------------- | ----- | ------ | ------ | ---------------------------------------- | ------------------------ |
| **[Claude Code](docs/install/claude-code.md)** (CLI + Desktop "Code" tab) | ✅    | ✅     | ✅     | None                                     | Enable once <sup>1</sup> |
| **[Claude Desktop chat](docs/install/claude-desktop.md)**                 | ✅    | ✅     | ✅     | Install the plugin in-app                | Automatic                |
| **[ChatGPT + Codex](docs/install/chatgpt-codex.md)** (CLI + IDE)          | ✅    | ✅     | —      | None                                     | Automatic                |
| **[Google Gemini CLI](docs/install/gemini-cli.md)** (Code Assist only)    | ✅    | ✅     | ✅     | None                                     | Automatic                |
| **[Antigravity](docs/install/antigravity.md)** (IDE + `agy` CLI)          | ✅    | ✅     | ✅     | None                                     | Automatic                |
| **[Cursor](docs/install/cursor.md)**                                      | ✅    | ✅     | ✅     | Install + set two variables <sup>2</sup> | Managed by Cursor        |
| **[Other hosts](docs/install/other-hosts.md)** (VS Code, Kiro, …)         | ✅    | ✅     | ✅     | Install the plugin in the host itself    | Manual <sup>3</sup>      |

<sup>1</sup> Claude Code leaves auto-update off for third-party marketplaces — turn it on once under `/plugin → Marketplaces → cognigy-plugin`.
<sup>2</sup> Cursor asks for the credentials itself (Plugins → Configure), so it doesn't need the installer — see its guide.
<sup>3</sup> The host owns the plugin version.

<details>
<summary>Scripting / CI</summary>

Skip the prompts with flags:

```
npx -y -p @cognigy/plugin-engine@latest cognigy-setup \
  --client claude-code --client claude-desktop --client codex \
  --client gemini --client antigravity --client other-hosts \
  --api-base-url https://api-trial.cognigy.ai --api-key <key>
```

`--client` is repeatable; valid values are `claude-code`, `claude-desktop`, `codex`, `gemini`, `antigravity`, and `other-hosts`. Omit it in interactive mode to pick from the menu.

</details>

## Staying up to date

See the **Auto-updates** column in the table above for what each client does on its own. To pull a new release now instead of waiting for the client to notice:

```
npx -y -p @cognigy/plugin-engine@latest cognigy-setup update
```

The installer doubles as a manager:

```
npx -y -p @cognigy/plugin-engine@latest cognigy-setup status      # what's installed, per client, + latest available
npx -y -p @cognigy/plugin-engine@latest cognigy-setup update      # pull the latest where it isn't automatic
npx -y -p @cognigy/plugin-engine@latest cognigy-setup uninstall   # remove from every client (--client narrows it; --purge also clears ~/.cognigy-plugin)
```

Beyond the MCP tools, the plugin ships **skills** and **agents** that surface the workflows automatically:

- **Skills** (`/skills`) — one per workflow (agent creation, knowledge/RAG, voice gateway, voice go-live checklist, webchat, flow nodes, packages, settings, LLM providers, tools, red-teaming, troubleshooting). Claude loads the matching skill automatically when your request fits. Red-teaming runs in your main session — not as a subagent — so it can agree the scope contract, get approval before applying fixes, and open the finished report for you.
- **Agents** (`/agents`) — `cognigy-agent-builder` runs the full build-and-test loop for a new agent, and `cognigy-voice-go-live` audits a voice agent against the Go-Live Checklist and applies the safe fixes. Each runs in its own context and reports back a summary.

## Configuration

The [installer](#installation) collects your **Cognigy API base URL** and **API key** and wires them per client: on Claude Code into the system **keychain**, on Claude Desktop into `claude_desktop_config.json` (`chmod 600`). The engine receives them as environment variables. If either is missing for a given launch, the engine falls back to `~/.cognigy-plugin/config.json` (`chmod 600`), which the installer also writes — so credentials resolve from the environment first, then that file. ChatGPT + Codex, Gemini CLI, and other hosts rely on that file exclusively: their client configs carry no secrets (and Gemini never passes your shell environment to extension MCP servers anyway).

A value that arrives as an unexpanded `${...}` placeholder counts as missing. Hosts other than Claude Code don't implement `userConfig` and pass the manifest's `${user_config.cognigy_api_key}` through literally; treating that as a real credential would both fail the request and shadow the file fallback. The optional variables below can be set in the MCP server `env` if you need to override defaults.

| Variable                            | Required | Default | Description                                                    |
| ----------------------------------- | -------- | ------- | -------------------------------------------------------------- |
| `COGNIGY_API_BASE_URL`              | Yes      | —       | Your Cognigy API base URL                                      |
| `COGNIGY_API_KEY`                   | Yes      | —       | Your Cognigy API key                                           |
| `LOG_LEVEL`                         | No       | `info`  | `debug`, `info`, `warn`, `error`                               |
| `RATE_LIMIT_MAX_REQUESTS`           | No       | `100`   | Max requests per window                                        |
| `RATE_LIMIT_WINDOW_MS`              | No       | `60000` | Rate limit window in ms                                        |
| `COGNIGY_DISABLE_AUDIT_ATTRIBUTION` | No       | unset   | Set to `1` to stop naming the plugin in Cognigy's audit events |

### Audit attribution

Everything this plugin changes is recorded in **Admin Center → Audit Events** with `performedBy.actor = "mcp-plugin"`, so plugin-made changes are distinguishable from ones people made by hand (which carry no `performedBy`). Each MCP tool call gets its own `taskId` and each engine run its own `sessionId`, so the writes of one tool call group together.

Requires Cognigy.AI 2026.17.0 or newer; older versions ignore the attribution and record the action normally. The "Performed by" column in the UI is gated behind the platform's `FEATURE_ENABLE_PLATFORM_AGENT_MFE` flag, but the attribution is always recorded and always readable through `list_resources { resourceType: "audit_event", actor: ["mcp-plugin"] }`.

Set `COGNIGY_DISABLE_AUDIT_ATTRIBUTION=1` to opt out; plugin actions are then recorded like any other API action.

## Usage Examples

### 1. Create a customer support agent

```
Create a Cognigy AI Agent called "Support Bot" in project <projectId> with a helpful
customer support persona. If the project has no working LLM, first look for another
project with an llm_model that has a connectionId, import that LLM and its connection
via manage_packages, and only fall back to setup_llm if no reusable LLM exists.
Return the endpoint URL only after the project has a confirmed working LLM.
```

The MCP server should first check whether the target project already has a working LLM. If not, it should prefer reusing the required LLM resource set plus its connection resources from another project via `manage_packages`, and only use `setup_llm` as the last resort before calling `create_ai_agent`.

### 2. Test and improve the agent

```
Talk to my Support Bot at <endpointUrl> and ask "How do I reset my password?".
Then update the job description to make the response more concise and actionable.
Talk to it again and compare the responses.
```

This triggers the self-improvement loop: `talk_to_agent` → evaluate → `update_ai_agent` → `talk_to_agent` again.

### 3. Add a knowledge store for RAG

```
Create a knowledge store in project <projectId>, add the URL
https://docs.example.com/faq as a source, then attach it to my Support Bot
so the agent can search it when answering questions.
```

The server will call `manage_knowledge` to create the store and ingest the URL,
then `create_tool` to attach it as a knowledge search tool on the agent's job
node.

If the project will use Knowledge Search, the server should first configure
Knowledge AI Settings with `manage_settings { operation: 'set_knowledge_ai',
... }` using model IDs from the same project.

For normal AI-agent knowledge flows, this should happen before
`manage_knowledge { operation: 'create_store', ... }`.

The model roles are different:

- The knowledge store itself needs an embedding-capable model for the index.
- `knowledgeSearchModelId` is a separate Knowledge AI setting for search
  behavior, but the accepted model type is instance-dependent.
- If reusing another project's knowledge setup, identify the exact source-project
  Knowledge Search model first and import it into the target project before the
  first `set_knowledge_ai` attempt.
- Import the full required knowledge model set in one pass. If the embedding
  model, Knowledge Search model, and agent model share one connection, transfer
  that single connection once alongside all of those models.
- After importing LLMs into the target project, enumerate the target
  project's `llm_model` resources and try those same-project IDs before
  creating a new model.
- For Knowledge Search specifically, use `list_resources` with
  `resourceType: 'llm_model'` and `useCase: 'knowledgeSearch'` so the
  candidates match the Settings UI dropdown rather than the unfiltered
  project-wide LLM list.
- Do not substitute a fresh or generic model for `knowledgeSearchModelId`
  unless the user explicitly asks for that and existing same-project candidates
  have already failed API validation.
- If the exact source-project Knowledge Search model is missing from the target
  project, import it before trying a different model.
- If all same-project candidates fail, report the exact attempted model IDs
  and API errors rather than claiming a platform-side bug.
- Do not describe an untried model as "likely" unsupported or rejected.
- Treat model names in examples as examples only, not as the source of truth.

### 4. List all projects and agents

```
List all my Cognigy projects and show which AI Agents exist in each one.
```

Uses `list_resources` with `resourceType: 'project'` and `resourceType: 'agent'`.

### 5. Import a package into a project

```
Upload the package at /absolute/path/to/support-bot.zip into project <projectId>,
show me the import preview, then import it using the default selections.
```

Uses `manage_packages` with `operation: 'upload_and_inspect'`, then `operation: 'import'`.

### 6. Export a package from project resources

```
Create a package named "support-bot" from these resource IDs in project <projectId>,
include dependencies, and save the zip to /absolute/path/to/exports/.
```

Uses `manage_packages` with `operation: 'list_exportable'` to discover candidates, then `operation: 'export'`, then `operation: 'download'` when needed.

### 7. Configure voice preview and create a browser voice endpoint

```
Set the voice preview provider for project <projectId> to Microsoft, then create
a Voice Gateway endpoint for flow <flowId> named "Support Voice" and give me the
WebRTC demo URL I can open in the browser.
```

This uses `manage_settings` with `operation: 'set_voice_preview'` to configure speech, then `manage_voice_gateway` to provision a `voiceGateway2` endpoint with a `webrtcDemoUrl`.

### 8. Configure Knowledge AI settings for search

```
Configure Knowledge AI settings for project <projectId> by setting the Knowledge Search
model and the Content Parser. If I am creating a new project and another project already
has a working knowledge setup, reproduce that exact Knowledge Search model and Content
Parser choice in the new project before trying generic defaults.
```

This uses `manage_settings` with `operation: 'set_knowledge_ai'` to configure
`knowledgeSearch` and `contentParser` at the project-settings level. Reusing
settings does not mean copying another project's settings alone; the required
model must exist in the target project first, either by import or by creating it there.
For knowledge workflows, the MCP should import the full required source-project model set
in one pass, reuse shared connections only once, and try the imported same-project model
IDs before falling back to `setup_llm`.

## Tools

| Tool                   | Type  | Description                                                                                         |
| ---------------------- | ----- | --------------------------------------------------------------------------------------------------- |
| `create_ai_agent`      | Write | Create a complete AI Agent with auto-provisioned flow, job node, and REST endpoint                  |
| `update_ai_agent`      | Write | Update persona, guardrails, job config (role, procedures, LLM, temperature)                         |
| `setup_llm`            | Write | Create an LLM resource (GPT-4, Claude, Mistral, etc.) with automatic connection validation          |
| `talk_to_agent`        | Write | Send a message to an AI Agent and get its response                                                  |
| `list_resources`       | Read  | List projects, agents, flows, endpoints, LLMs, knowledge stores, and more                           |
| `get_resource`         | Read  | Get detailed information about a single resource                                                    |
| `delete_resource`      | Write | Permanently delete a resource                                                                       |
| `manage_knowledge`     | Write | Create knowledge stores, add sources (URL, text, file), list chunks for RAG                         |
| `create_tool`          | Write | Add a tool (HTTP, knowledge, email, MCP) to an agent's job node                                     |
| `update_tool`          | Write | Update an existing tool node's configuration                                                        |
| `manage_webchat`       | Write | Create or configure a Webchat v3 endpoint for website deployment                                    |
| `manage_flow_nodes`    | Write | Create, update, delete, or list flow nodes for conversation logic                                   |
| `manage_packages`      | Write | List exportable resources, upload, inspect, import, export, and download Cognigy package zip files  |
| `manage_voice_gateway` | Write | Create or configure a Voice Gateway endpoint with WebRTC for browser-based voice interaction        |
| `manage_settings`      | Write | Manage project-level settings including voice preview and Knowledge AI configuration                |
| `audit_voice_agent`    | Write | Audit a voice agent against the Go-Live Checklist; reports by default, applies safe fixes on demand |
| `manage_snapshots`     | Write | Create and restore project Snapshots so agent changes can be rolled back                            |

Detailed workflow guidance (agent creation, knowledge/RAG, voice, webchat, flow nodes, packages, settings, LLM providers, tools, troubleshooting) ships as **skills** that load automatically when your request matches, in clients that support them (e.g. Claude Code) — see the **Skills** column in the client table under [Installation](#installation).

## Security

- API keys are passed via environment variables and never logged
- All inputs are validated using Zod schemas before reaching the API
- Rate limiting is built in to prevent API abuse

## Privacy Policy

This MCP server transmits requests to the Cognigy.AI API endpoint configured via `COGNIGY_API_BASE_URL`. No data is collected, stored, or shared by this MCP server itself — all data remains between your AI client and your Cognigy.AI instance.

Full privacy policy: [https://www.cognigy.com/privacy-policy](https://www.cognigy.com/privacy-policy)

## Support

- **Issues**: [GitHub Issues](https://github.com/Cognigy/cognigy-plugin/issues)
- **Documentation**: see [`docs/`](https://github.com/Cognigy/cognigy-plugin/tree/main/docs) folder

## Documentation

- [docs/install/](https://github.com/Cognigy/cognigy-plugin/tree/main/docs/install) — per-client install guides ([Claude Code](docs/install/claude-code.md), [Claude Desktop](docs/install/claude-desktop.md), [ChatGPT + Codex](docs/install/chatgpt-codex.md), [Gemini CLI](docs/install/gemini-cli.md), [Antigravity](docs/install/antigravity.md), [Cursor](docs/install/cursor.md), [other hosts](docs/install/other-hosts.md))
- [docs/ARCHITECTURE.md](https://github.com/Cognigy/cognigy-plugin/blob/main/docs/ARCHITECTURE.md) — tool design, self-improvement loop, ID formats
- [docs/USAGE.md](https://github.com/Cognigy/cognigy-plugin/blob/main/docs/USAGE.md) — detailed usage reference
- [docs/TESTING.md](https://github.com/Cognigy/cognigy-plugin/blob/main/docs/TESTING.md) — how to test the plugin and a local engine build
- [docs/CONTRIBUTING.md](https://github.com/Cognigy/cognigy-plugin/blob/main/docs/CONTRIBUTING.md) — development setup and contribution guide

## License

[MIT](LICENSE)
