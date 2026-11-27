# NiCE Cognigy Plugin

> Distributed exclusively through each client's native plugin mechanism — a **plugin** on **Claude Code**, **Claude Desktop**, **ChatGPT + Codex**, and **Antigravity**, a **plugin** on **Cursor**, and an [**Agent Plugins**](https://agent-plugins.org)-standard plugin on any conformant host (**Kiro**, **VS Code + Copilot**, …) — with more clients to come. Each package installs the server engine and ships skills + agents.

A plugin that connects your AI assistant to the [Cognigy.AI](https://www.cognigy.com) REST API. Create, test, and improve LLM-based AI Agents through a self-improvement loop — without leaving your client.

## Contents

- [Features](#features)
- [Installation](#installation)
- [Staying up to date](#staying-up-to-date)
- [Configuration](#configuration)
  - [Audit attribution](#audit-attribution)
  - [Corporate proxies](#corporate-proxies)
  - [Self-hosted and local clusters](#self-hosted-and-local-clusters)
  - [Several Cognigy environments](#several-cognigy-environments)
- [Usage Examples](#usage-examples)
- [Tools](#tools)
- [Security](#security)
- [Privacy Policy](#privacy-policy)
- [Support](#support)
- [Documentation](#documentation)
- [License](#license)

## Features

- **22 workflow tools** for agent creation, deployment, packaging, backup, voice setup, agent-to-agent (A2A) delegation and Simulator testing
- **One-call agent setup**: creates Agent + Flow + AI Agent Job Node + REST Endpoint automatically
- **Self-improvement loop**: talk to your agent, evaluate responses, update the job description, repeat
- **Simulator testing**: create, run and schedule simulations that test an agent with simulated conversations, read the results, generate personas, and turn a CSV transcript into test scenarios
- **Knowledge store support**: attach RAG knowledge stores to agents as tools
- **Browser voice deployment**: create Voice Gateway endpoints with WebRTC demo URLs
- **Voice preview setup**: configure supported speech providers for voice experiences
- **Several Cognigy environments**: work in a trial, a customer tenant and production from one conversation, for example to compare them or copy an agent from one to another ([how to add them](#how-to-add-environments))
- **Skills + agents**: workflow guidance auto-loads as skills in supporting clients; build/go-live loops run as subagents
- **Built-in docs lookup**: bundles the official [Cognigy documentation](https://docs.cognigy.com) MCP server — your assistant searches and reads the docs before answering platform questions, instead of guessing from training data
- Built-in rate limiting, Zod input validation, and RFC 7807 error responses

## Installation

**Two steps.** Step 1 is the same for every client. Step 2 is where you check what your client still needs from you — for most clients that's nothing, but the answer is in the table, so look your client up rather than assuming.

### Step 1 — run the installer

One installer covers every client. Run it, pick your client(s), enter your Cognigy API base URL (Enter for the trial default) and API key (masked as you type), then restart the client. At the end it asks whether to add [more Cognigy environments](#several-cognigy-environments); Enter skips it. To manage environments without installing anything, press `e` on its first screen.

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
  --client antigravity --client other-hosts \
  --api-base-url https://api-trial.cognigy.ai --api-key <key>
```

`--client` is repeatable; valid values are `claude-code`, `claude-desktop`, `codex`, `antigravity`, and `other-hosts`. Omit it in interactive mode to pick from the menu.

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

- **Skills** (`/skills` in Claude Code) — one per workflow (agent creation, knowledge/RAG, voice gateway, speech-to-speech (S2S) voice demos, voice go-live checklist, webchat, flow nodes, packages, settings, LLM providers, tools, red-teaming, troubleshooting). Your AI client loads the matching skill automatically when your request fits. Red-teaming runs in your main session — not as a subagent — so it can agree the scope contract, get approval before applying fixes, and open the finished report for you.
- **Agents** (`/agents` in Claude Code) — `cognigy-agent-builder` runs the full build-and-test loop for a new agent, `cognigy-voice-go-live` audits a voice agent against the Go-Live Checklist and applies the safe fixes, and `cognigy-s2s-demo-builder` builds a speech-to-speech (S2S) voice demo and returns its click-to-call link. Each runs in its own context and reports back a summary.

## Configuration

The [installer](#installation) collects your **Cognigy API base URL** and **API key** and stores them per client:

- **Claude Code:** in the system **keychain**.
- **Claude Desktop:** in `claude_desktop_config.json` (`chmod 600`).
- **Every client:** in `~/.cognigy-plugin/config.json` (`chmod 600`). ChatGPT + Codex, Antigravity and other hosts use only this file, so their client configs carry no secrets.

How the engine finds them:

- **Environment variables first.** Claude Code and Claude Desktop pass `COGNIGY_API_BASE_URL` and `COGNIGY_API_KEY` to the engine.
- **Then the file.** If either is missing for a launch, the engine reads `~/.cognigy-plugin/config.json`.
- **Placeholders count as missing.** Hosts other than Claude Code don't implement `userConfig` and pass the manifest's `${user_config.cognigy_api_key}` through literally. Treating that as a real key would fail the request and hide the file.

The optional variables below can be set in the MCP server `env` if you need to override defaults.

| Variable                            | Required | Default | Description                                                    |
| ----------------------------------- | -------- | ------- | -------------------------------------------------------------- |
| `COGNIGY_API_BASE_URL`              | Yes      | —       | Your Cognigy API base URL                                      |
| `COGNIGY_API_KEY`                   | Yes      | —       | Your Cognigy API key                                           |
| `LOG_LEVEL`                         | No       | `info`  | `debug`, `info`, `warn`, `error`                               |
| `RATE_LIMIT_MAX_REQUESTS`           | No       | `100`   | Max requests per window                                        |
| `RATE_LIMIT_WINDOW_MS`              | No       | `60000` | Rate limit window in ms                                        |
| `COGNIGY_DISABLE_AUDIT_ATTRIBUTION` | No       | unset   | Set to `1` to stop naming the plugin in Cognigy's audit events |
| `HTTPS_PROXY` / `HTTP_PROXY`        | No       | unset   | Corporate proxy to tunnel Cognigy requests through             |
| `NO_PROXY`                          | No       | unset   | Comma-separated hosts to reach directly, bypassing the proxy   |
| `NODE_EXTRA_CA_CERTS`               | No       | unset   | Path to your corporate root CA, for TLS-inspecting proxies     |
| `COGNIGY_PROXY_CONNECT_TIMEOUT_MS`  | No       | `30000` | Deadline for reaching the proxy and completing the tunnel      |
| `COGNIGY_ENDPOINT_BASE_URL`         | No       | derived | Endpoint host, when it cannot be derived from the API host     |
| `COGNIGY_WEBCHAT_BASE_URL`          | No       | derived | Webchat host, when it cannot be derived from the API host      |
| `COGNIGY_STATIC_FILES_BASE_URL`     | No       | derived | Static-files host, when it cannot be derived from the API host |

### Audit attribution

Everything this plugin changes is recorded in **Admin Center → Audit Events**:

- **Marked as the plugin's.** Plugin changes carry `performedBy.actor = "mcp-plugin"`. Changes people make by hand carry no `performedBy`.
- **Grouped per tool call.** Each MCP tool call gets its own `taskId` and each engine run its own `sessionId`, so the writes of one tool call group together.
- **Needs Cognigy.AI 2026.17.0 or newer.** Older versions ignore the attribution and record the action normally.
- **Readable without the UI column.** The "Performed by" column is behind the platform's `FEATURE_ENABLE_PLATFORM_AGENT_MFE` flag, but the attribution is always recorded and readable through `list_resources { resourceType: "audit_event", actor: ["mcp-plugin"] }`.
- **Opt out** with `COGNIGY_DISABLE_AUDIT_ATTRIBUTION=1`. Plugin actions are then recorded like any other API action.

### Corporate proxies

If your network requires a proxy, set it in the MCP server `env` block (or export it before starting your client) and the plugin tunnels every Cognigy request through it:

```json
"env": {
  "HTTPS_PROXY": "http://proxy.corp.example:8080",
  "NO_PROXY": "localhost,127.0.0.1",
  "NODE_EXTRA_CA_CERTS": "/etc/ssl/certs/corporate-root-ca.pem"
}
```

- **Supported:** HTTP and HTTPS proxies, lower-case spellings (`https_proxy`) and credentials in the URL (`http://user:password@proxy.corp.example:8080`). SOCKS proxies are not supported.
- **Chosen per request.** `NO_PROXY` can exclude one host while another still goes through the proxy. A package download link, for example, points at wherever the platform staged the archive, not at the API host.
- **No silent direct connection.** If a proxy is configured but unusable (a malformed URL, a SOCKS proxy), requests **fail with a configuration error** instead of connecting directly, which would send your API key outside the sanctioned path. To connect directly on purpose, exclude the host with `NO_PROXY`.
- **30-second limit.** Connecting through the proxy is limited to 30 seconds, so a proxy that never completes the tunnel can't hang a tool call. Raise `COGNIGY_PROXY_CONNECT_TIMEOUT_MS` if your proxy is just slow.
- **If your proxy inspects TLS** (Zscaler, Netskope, BlueCoat and similar), it presents a certificate signed by a corporate root CA that Node doesn't trust by default. Point `NODE_EXTRA_CA_CERTS` at that CA file and restart your client, since Node reads it only at startup. Never set `NODE_TLS_REJECT_UNAUTHORIZED=0` instead: that turns off certificate checks for every connection the engine makes.
- **Check it works.** Set `LOG_LEVEL=debug` and look for `Cognigy API requests route through a proxy` in your client's MCP log.
- **GUI clients** (Claude Desktop, Antigravity) start the engine with a minimal environment and often don't inherit your shell's proxy variables. Set them in the client's config file, not in your shell profile.

### Self-hosted and local clusters

The engine talks to four Cognigy hosts: the API for everything, the endpoint host for `talk_to_agent`, and the webchat and static-files hosts for embed snippets. It derives the other three from `COGNIGY_API_BASE_URL` by swapping its `api` segment:

- `api-dev.cognigy.ai` → `endpoint-dev.cognigy.ai`
- `cognigy-api-na1.nicecxone.com` → `cognigy-endpoint-na1.nicecxone.com`
- a local cluster's `api.test` → `endpoint.test`

When that doesn't fit your setup:

- **Hostnames without that pattern:** set `COGNIGY_ENDPOINT_BASE_URL`, `COGNIGY_WEBCHAT_BASE_URL` and `COGNIGY_STATIC_FILES_BASE_URL` explicitly. The engine warns at startup (`Could not derive the endpoint host`) when it had to fall back to the API host.
- **Self-signed certificates** are rejected with `DEPTH_ZERO_SELF_SIGNED_CERT`, because Node doesn't use the operating system's trust store. Point `NODE_EXTRA_CA_CERTS` at the certificate (or the local CA that issued it), as for a TLS-inspecting proxy above.

### Several Cognigy environments

Most users work in one Cognigy environment and need nothing here. If you work in several (a trial, a customer tenant, a staging cluster), add them once and your AI client can use any of them in the same conversation, for example to compare two deployments or copy an agent from one to another.

#### How to add environments

1. **Open the menu.** Run this in a terminal:

   ```
   npx -y -p @cognigy/plugin-engine@latest cognigy-envs
   ```

   The installer opens the same menu: answer `y` when it asks "Add more Cognigy environments now?" at the end, or press `e` on its first screen to skip the install.

2. **Add your environments.** Pick "+ Add an environment", then enter a name you choose (for example `trial`), the API base URL and the API key (typed hidden). In the menu, ↑/↓ moves, Enter adds or changes, `d` deletes and `q` quits.
3. **Restart your AI client.** In Claude Code, a new session is enough. Open conversations keep the environments they started with.
4. **Test it.** Ask your AI client "Which Cognigy environments do you have access to?" It should list `default` and the environments you added, each with its URL.

![The cognigy-envs menu: the default login above a dotted line, then trial and "+ Add an environment"](docs/cognigy-envs.png)

Your environments are stored in `~/.cognigy-plugin/environments.json`, readable only by you:

```json
{
  "trial": { "apiBaseUrl": "https://api-trial.cognigy.ai", "apiKey": "…" },
  "acme": { "apiBaseUrl": "https://api-acme.cognigy.ai", "apiKey": "…" }
}
```

How it works once you have added an environment:

- **`default` is the plugin's own login**: the one you gave the installer, or in Cursor the one under Plugins → Configure. To change it, run the installer again with `npx -y -p @cognigy/plugin-engine@latest cognigy-setup`. In Cursor, change the two variables under Plugins → Configure instead, then reload Cursor.
- **Picked once per conversation.** Your AI client asks which environment to use at the start of a conversation and keeps it.
- **One step, or the rest of the conversation.** Name another environment for a single step ("copy this agent to acme"), or switch for the rest of the conversation ("from now on use trial").
- **Every result names its environment**, so you can always tell where a change was made.
- **Keys stay out of the conversation.** Your AI client only ever sees names and URLs.

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

When a reply is empty or stops halfway, ask why:

```
That reply stopped halfway. Read the logs for that turn and tell me what failed.
```

A flow that fails mid-turn still answers with what it sent before the error, so the project logs are often the only place the failure shows. `talk_to_agent` returns a `traceId` for each turn, and `list_resources { resourceType: "log", projectId, traceId }` reads every log entry of that turn, including a failing node's error. `sessionId` reads the newest entries of a conversation (25 by default, at most 100) from the last 12 hours, and `level` with `startDate` finds recent problems in a project (without dates, only the last hour). Cognigy keeps logs for 24 hours, and the API key's user needs the `logs` or `developer` project role.

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

### 9. AI Agents and legacy AI Agents

Cognigy has two kinds of agent. The plugin calls both "AI Agents" and says "legacy" only when it has
to tell them apart. At the start of a conversation it calls `check_capabilities`, which reports
whether this environment and organisation offer AI Agents, the custom system prompt, speech-to-speech
(S2S, GPT Live) and NiCE-provided speech. Where they
do, it builds AI Agents with `manage_agent`; it uses `create_ai_agent` only when you ask for a legacy
agent or the project has only legacy agents. Elsewhere it builds legacy agents without comment.

```
In project <projectId>, create an agent "Weather Bot" with an HTTP tool that GETs
https://wttr.in/Berlin?format=j1, then ask it what the weather is.
```

- `manage_agent` creates and updates an agent: role, description, instructions, LLM and its
  settings, knowledge, guardrails, a pre-turn hook Flow, a brand persona, and the custom system
  prompt where the environment offers it.
- `manage_agent_components` manages skills, tools (from the builtin catalog), MCP servers and
  brand personas, and attaches skills and tools to agents. Its `voice_settings` component is an
  agent's speech (TTS, STT, NiCE-provided or the project's own credential) and call behaviour
  (greeting, barge-in, silence).
- Speech-to-speech (S2S, also called voice-to-voice or V2V): `manage_agent` takes a `gpt-live-1` voice model, a voice and a voice prompt, and
  `setup_llm` creates the voice model. `audit_voice_agent { agentId, projectId }` runs the Go-Live
  Checklist for AI Agents.
- `talk_to_agent { agentId, projectId, message }` tests an AI Agent; `manage_webchat` and
  `manage_voice_gateway` take `agentId` to deploy one; `delete_resource` marks one for deletion.
- `list_resources { resourceType: 'agent', projectId }` lists both kinds. When a project has AI
  Agents, they are the `items` and legacy agents move to `legacyAgents` (`legacy: true`). Each item
  says which argument to pass on (`use`).

## Tools

| Tool                      | Type  | Description                                                                                                           |
| ------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------- |
| `check_capabilities`      | Read  | Report whether this environment offers AI Agents, the custom system prompt, speech-to-speech and NiCE-provided speech |
| `manage_agent`            | Write | Create and configure AI Agents: settings, LLM, knowledge, guardrails, custom system prompt, speech-to-speech          |
| `manage_agent_components` | Write | Skills, builtin tools, MCP servers, brand personas and voice settings for AI Agents; attach and detach                |
| `create_ai_agent`         | Write | Create a complete legacy AI Agent with auto-provisioned flow, job node, and REST endpoint                             |
| `update_ai_agent`         | Write | Update a legacy agent's persona, guardrails, job config (role, procedures, LLM, temperature)                          |
| `setup_llm`               | Write | Create an LLM resource (GPT-4, Claude, Mistral, etc.) with automatic connection validation                            |
| `talk_to_agent`           | Write | Send a message to an AI Agent and get its response (uses Endpoint Test Mode, so it is not counted as billable)        |
| `list_resources`          | Read  | List projects, agents, flows, endpoints, LLMs, knowledge stores, project logs, and more                               |
| `get_resource`            | Read  | Get detailed information about a single resource                                                                      |
| `delete_resource`         | Write | Permanently delete a resource                                                                                         |
| `manage_knowledge`        | Write | Create knowledge stores, add sources (URL, text, file), list chunks for RAG                                           |
| `create_tool`             | Write | Add a tool (HTTP, knowledge, email, MCP, A2A) to an agent's job node                                                  |
| `update_tool`             | Write | Update an existing tool node's configuration                                                                          |
| `manage_webchat`          | Write | Create or configure a Webchat v3 endpoint for website deployment                                                      |
| `manage_flow_nodes`       | Write | Create, update, delete, or list flow nodes for conversation logic                                                     |
| `manage_packages`         | Write | List exportable resources, upload, inspect, import, export, and download Cognigy package zip files                    |
| `manage_voice_gateway`    | Write | Create or configure a Voice Gateway endpoint with WebRTC for browser-based voice interaction                          |
| `manage_a2a_server`       | Write | Deploy a Flow as an A2A (Agent2Agent) server endpoint that other agents can discover and call                         |
| `manage_settings`         | Write | Manage project-level settings including voice preview and Knowledge AI configuration                                  |
| `audit_voice_agent`       | Write | Audit a voice agent against the Go-Live Checklist; reports by default, applies safe fixes on demand                   |
| `manage_snapshots`        | Write | Create and restore project Snapshots so agent changes can be rolled back                                              |
| `manage_simulations`      | Write | Create, run and schedule Simulator tests, read batch and run results, generate personas, import CSV transcripts       |

Detailed workflow guidance (agent creation, knowledge/RAG, voice, webchat, A2A, flow nodes, packages, settings, LLM providers, tools, troubleshooting) ships as **skills** that load automatically when your request matches, in clients that support them (e.g. Claude Code) — see the **Skills** column in the client table under [Installation](#installation). The tools are built to be used with these skills: if the assistant skips steps or gets a Cognigy workflow wrong, check that the skills are loaded (in Claude Code, `/skills` lists them) and reinstall the plugin if they are missing.

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

- [docs/install/](https://github.com/Cognigy/cognigy-plugin/tree/main/docs/install) — per-client install guides ([Claude Code](docs/install/claude-code.md), [Claude Desktop](docs/install/claude-desktop.md), [ChatGPT + Codex](docs/install/chatgpt-codex.md), [Antigravity](docs/install/antigravity.md), [Cursor](docs/install/cursor.md), [other hosts](docs/install/other-hosts.md))
- [docs/ARCHITECTURE.md](https://github.com/Cognigy/cognigy-plugin/blob/main/docs/ARCHITECTURE.md) — tool design, self-improvement loop, ID formats
- [docs/USAGE.md](https://github.com/Cognigy/cognigy-plugin/blob/main/docs/USAGE.md) — detailed usage reference
- [docs/TESTING.md](https://github.com/Cognigy/cognigy-plugin/blob/main/docs/TESTING.md) — how to test the plugin and a local engine build
- [docs/CONTRIBUTING.md](https://github.com/Cognigy/cognigy-plugin/blob/main/docs/CONTRIBUTING.md) — development setup and contribution guide

## License

[MIT](LICENSE)
