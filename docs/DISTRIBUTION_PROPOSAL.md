# MCP Server Distribution — Proposal

## Distribution channels

We support three installation methods to cover all MCP clients:

| Channel | Target | User experience | Requires Node.js? |
|---|---|---|---|
| **CLI init command** | Cursor, Claude Desktop, Claude Code, VS Code | Run one command, answer 2 prompts | Yes |
| **MCPB bundle** | Claude Desktop (macOS, Windows) | Double-click `.mcpb` file, fill in a form | No (Claude ships Node.js) |
| **Manual JSON config** | Any MCP client with stdio support | Copy-paste config into client settings | Yes |

---

## Channel 1: One-command setup (recommended)

Users install [Node.js 20+](https://nodejs.org), then run a single command for their MCP client:

| MCP Client | Command |
|---|---|
| Cursor | `npx @cognigy/mcp-server init --client cursor` |
| Claude Desktop | `npx @cognigy/mcp-server init --client claude` |
| Claude Code | `npx @cognigy/mcp-server init --client claude-code` |
| VS Code (Copilot) | `npx @cognigy/mcp-server init --client vscode` |

The command prompts for the Cognigy API URL and API key, then automatically writes the correct config file for that client. The user restarts their client and the Cognigy tools are available.

**What happens under the hood:**
1. `npx` downloads `@cognigy/mcp-server` from npm (cached after first use)
2. The `init` command detects the client's config file path (platform-aware)
3. Prompts for API base URL (default: `https://api-trial.cognigy.ai`) and API key
4. Merges the Cognigy MCP server entry into the config file (preserves other MCP servers)
5. Done — user restarts the client

**API keys stay local** — credentials are stored in the client's local config file and injected as environment variables when the MCP server starts. They never leave the user's machine.

---

## Channel 2: MCPB bundle (Claude Desktop)

For Claude Desktop users, we also provide an `.mcpb` bundle — a zip archive containing the server, dependencies, and a `manifest.json`. Users download the file from a GitHub release, double-click it, and Claude Desktop shows an install dialog with a form for API URL and API key.

**User experience:**
1. Download the `.mcpb` file from the [GitHub release](https://github.com/Cognigy/cognigy-mcp/releases/latest)
2. Double-click it (or drag into Claude Desktop)
3. Fill in API URL and API key in the install dialog
4. Done — Cognigy tools available in Claude

**No Node.js installation required** — Claude Desktop ships its own Node.js runtime.

**How it works internally:**
- `manifest.json` declares `user_config` fields (API URL, API key with `sensitive: true`)
- Claude Desktop auto-generates a settings UI from this config
- User values are injected as environment variables when the server is spawned
- Same code path as the npx method — no separate server implementation

---

## Channel 3: Manual JSON config (fallback)

For any MCP client not covered by the init command, users add this block to their client's MCP settings:

```json
{
  "mcpServers": {
    "cognigy": {
      "command": "npx",
      "args": ["-y", "@cognigy/mcp-server"],
      "env": {
        "COGNIGY_API_BASE_URL": "https://api-trial.cognigy.ai",
        "COGNIGY_API_KEY": "<their-api-key>"
      }
    }
  }
}
```

This is the same config that the init command writes automatically.

---

## Why not a universal marketplace?

The ideal experience would be a built-in MCP marketplace within every client — where users search for "Cognigy", click install, enter their API key, and are done. As of today, **no such unified marketplace exists across all clients**:

- **Claude Desktop** — has a Connectors Directory and supports MCPB bundles (one-click install). We support this.
- **ChatGPT** — supports remote MCP servers only (HTTP/SSE). Requires hosting infrastructure and OAuth for API key handling. Planned as a future channel once OAuth is available.
- **Cursor / Windsurf** — manual config only, no marketplace
- **Smithery.ai / mcp.so** — community-run registries, fragmented adoption, not integrated natively

---

## Alternatives considered (not adopted)

| Approach | How it works | Why we didn't pick it |
|---|---|---|
| **Remote MCP (HTTP/SSE)** | We host the server, users paste a URL | Requires hosting infrastructure. Users' API keys must be transmitted to and stored on our server — adds auth complexity (OAuth) and security concerns. Overkill for testing phase. |
| **Standalone binary** | Bundle Node.js into a single executable via `pkg`/`bun compile` | Platform-specific builds (macOS/Windows/Linux), large file size (~50MB+), harder to update. Distribution channel unclear. |
| **Git clone + build** | Users clone the repo, run `npm install && npm run build` | Too many steps for non-developers. Requires git knowledge. Not suitable for customers. |
| **Share a `.tgz` file** | We run `npm pack`, share the archive via Slack/email | Manual distribution, no update mechanism, still requires `npm install -g`. |

---

## Requirements

### Developer side (one-time setup)

- **npm access**: Publish rights to the `@cognigy` scope on npmjs.com
- **GitHub secret**: Add `NPM_TOKEN` to the repo (Settings → Secrets → Actions)

### Releasing (automated)

Publishing is fully automated via GitHub Actions (`.github/workflows/release.yml`).

**On every push to `main`**, the workflow:
1. Runs tests
2. Detects the version bump type from the merged PR's label
3. Bumps `package.json` and `manifest.json` version
4. Publishes to npm
5. Builds the `.mcpb` bundle
6. Commits the version change back to `main` and creates a git tag
7. Creates a GitHub release with the `.mcpb` file attached

**PR labels control the bump type:**

| PR label | Version bump | Example |
|---|---|---|
| `major` | Major | 0.1.0 → 1.0.0 |
| `minor` | Minor | 0.1.0 → 0.2.0 |
| No label (default) | Patch | 0.1.0 → 0.1.1 |

**Manual release** is also available: Actions → "Release" → Run workflow → pick bump type.

### User side (to connect to the MCP)

- **Node.js 20+** installed ([nodejs.org](https://nodejs.org)) — not needed for the MCPB method
- **A Cognigy API key** (Cognigy.AI → User Menu → My Profile → API Keys)
- **An MCP client**: Cursor, Claude Desktop, Claude Code, VS Code, Windsurf, or any client with stdio support
- Run the init command for their client, or use the MCPB bundle for Claude Desktop
- Restart the client

No npm account, no git, no build tools required.
