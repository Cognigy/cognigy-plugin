# Changelog

All notable changes to the Cognigy MCP Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Automatic connection validation for `setup_llm`** — after creating an LLM or embedding model, the connection is tested by sending a minimal probe to the provider. If the test fails, the model is automatically cleaned up to prevent broken references from silently breaking downstream flows (agent conversations, knowledge stores).
- `dangerouslySkipConnectionTest` parameter for `setup_llm` — last-resort escape hatch for environments where the test endpoint is unavailable.
- Provider-specific metadata (`openAI: {}`, etc.) is now included when creating models, fixing a bug where the test endpoint would crash with `Cannot destructure property 'baseCustomUrl' of 'params.metaData'`.

## [0.2.6] - 2025-03-16

### Changed

- Cleaned up outdated v1 documentation (removed QUICK_START.md, DOCUMENTATION_GUIDE.md, and 6 stale docs/ files)
- Updated README.md to reflect current tool set and architecture
- Updated manifest.json tool list to match actual tools
- Fixed broken embed URL in webchat-setup.md guide (`nickcognigy` → `Cognigy`)
- Fixed inaccurate troubleshooting advice for delete_resource

## [0.2.0] - 2025

### Added

- **Redesigned tool architecture** — replaced 9 coarse-grained `manage_*` tools with 12 focused, purpose-built tools:
  - `create_ai_agent` — one-call agent creation with auto-provisioned flow, job node, and REST endpoint
  - `update_ai_agent` — granular agent configuration (persona, guardrails, job config, LLM assignment)
  - `setup_llm` — LLM resource creation with auto-connection provisioning
  - `talk_to_agent` — test agent behavior via REST endpoint
  - `list_resources` — unified resource listing across all Cognigy types
  - `get_resource` — detailed single-resource lookup
  - `delete_resource` — unified resource deletion
  - `manage_knowledge` — knowledge store, source, and chunk management for RAG
  - `create_tool` — tool creation (HTTP, knowledge, email, MCP) with auto-wired flow nodes
  - `update_tool` — tool configuration updates
  - `manage_webchat` — Webchat v3 endpoint creation and configuration with style presets
  - `manage_flow_nodes` — low-level flow node editing (say, question, code, HTTP, etc.)
- **Server instructions** (`instructions.ts`) — build workflow, knowledge store rules, webchat deployment, and operational rules delivered via MCP protocol
- **MCP resource guides** — 7 guides (agent-creation, llm-providers, knowledge-setup, tools-setup, webchat-setup, flow-nodes, troubleshooting) served via `cognigy://guide/*` URIs
- **Response hints** (`_hints`) — contextual error recovery guidance with guide links
- **One-command setup** — `npx @cognigy/mcp-server init --client <client>` for Cursor, Claude Desktop, Claude Code, VS Code
- **MCPB bundle** — one-click Claude Desktop install via `.mcpb` file
- **Webchat style presets** — classic, modern, slick

### Removed

- Legacy `manage_ai_agents`, `manage_flows`, `manage_intents`, `get_analytics`, `manage_projects`, `manage_extensions`, `manage_conversations` tools
- `.env` file configuration (replaced by MCP config `env` block)

## [0.1.0] - 2024

### Added

- Initial release of Cognigy MCP Server
- 9 workflow tools covering major Cognigy.AI API operations
- TypeScript implementation with Zod schema validation
- Rate limiting, structured logging, error handling
- MCP resource-based system prompt
- Claude Desktop configuration support
