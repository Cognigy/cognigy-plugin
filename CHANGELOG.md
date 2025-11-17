# Changelog

All notable changes to the Cognigy MCP Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024-11-17

### Added

- Initial release of Cognigy MCP Server
- 9 high-level workflow tools covering major Cognigy.AI API operations (97.5% reduction from 359 endpoints):
  - `manage_ai_agents`: AI agent management ⭐ **WITH AUTOMATIC SETUP**
  - `manage_knowledge`: Knowledge store and search operations
  - `manage_conversations`: Conversation querying and session management
  - `manage_flows`: Flow and node creation/modification
  - `manage_intents`: Intent management and NLU training (LEGACY - use AI Agents instead)
  - `get_analytics`: Analytics, logs, and audit events
  - `manage_projects`: Project and endpoint management
  - `manage_extensions`: Extension and function management
  - `talk_to_agent`: 🔄 **THE IMPROVEMENT LOOP** - Talk to agents via REST endpoint
- **100% Automatic AI Agent Setup**: One tool call creates Agent + Flow + Job Node + Endpoint
- **Self-Improvement Loop**: `talk_to_agent` tool enables iterative refinement
- **System Prompt as MCP Resource**: AI assistants automatically gain Cognigy expertise
- TypeScript implementation with full type safety
- Zod schema validation for all inputs
- Rate limiting to prevent API abuse
- Comprehensive error handling following RFC 7807
- MCP resources for documentation, examples, and system prompt
- Authentication via API key (OAuth2 support planned)
- **Tested End-to-End**: Complete create → test → improve → test cycle validated
- Structured logging with configurable levels
- Unit tests for all major components
- Integration test framework
- Complete documentation:
  - README with quick start guide
  - API reference with all tool operations
  - Deployment guide for various environments
  - Usage guide with common workflows
- Claude Desktop configuration example
- Docker support (Dockerfile ready)
- PM2 process manager support
- Kubernetes deployment manifests

### Verified & Working

- ✅ AI Agent creation with automatic flow/node/endpoint setup
- ✅ REST endpoint creation and configuration
- ✅ Talk to agent via endpoint with proper response parsing
- ✅ Agent updates and behavior changes
- ✅ Complete improvement loop: Create → Test → Improve → Test
- ✅ All 9 tools tested and functional
- ✅ System prompt loaded by AI assistants
- ✅ Production deployment ready

### Security

- API key authentication (configured via MCP, never logged)
- Environment-based configuration
- No secrets in logs (all logging to stderr)
- Input validation on all parameters (Zod schemas)
- Rate limiting protection (100 req/min default)
- RFC 7807 error responses (no sensitive data exposed)

### Performance

- Stateless design for horizontal scaling
- Connection pooling via axios
- Efficient rate limiter with automatic cleanup
- Optimized for low latency

## [Unreleased]

### Planned

- OAuth2 authentication flow
- Webhooks for real-time updates
- Batch operation support
- Caching layer for frequently accessed data
- Prometheus metrics export
- OpenTelemetry tracing
- Additional MCP resources (more examples, interactive tutorials)
- GraphQL support alongside REST
- WebSocket transport for MCP
- Multi-tenant support with organization-level rate limiting

[1.0.0]: https://github.com/Cognigy/cognigy/releases/tag/mcp-server-v1.0.0

