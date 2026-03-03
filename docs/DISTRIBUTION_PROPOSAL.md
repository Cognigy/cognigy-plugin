# MCP Server Distribution — Proposal

## Why not a marketplace?

The ideal experience would be a built-in MCP marketplace within clients like Claude Desktop, ChatGPT, or Cursor — where users search for "Cognigy", click install, enter their API key, and are done. No config files, no Node.js prerequisite.

As of today, **no such unified marketplace exists**. MCP clients are still in early stages of server discovery:

- **Claude Desktop** — has a small curated directory, but no open submission process
- **ChatGPT** — MCP support is recent, no marketplace for third-party servers yet
- **Cursor / Windsurf** — manual config only, no marketplace
- **Smithery.ai / mcp.so** — community-run registries exist but adoption is fragmented and none are integrated natively into any major client

Once a dominant MCP marketplace emerges (likely within Claude or ChatGPT), we should list there for a true one-click experience. The `npx`-based approach below is fully compatible with that future — a marketplace would simply auto-generate the same config block behind the scenes.

---

## Decision: Publish to npm, distribute via `npx`

Users add this to their MCP client config (Cursor, Claude Desktop, ChatGPT, etc.):

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

No git clone, no build step, no account needed. `npx` downloads the package once and caches it locally.

---

## Alternatives considered

| Approach | How it works | Why we didn't pick it |
|---|---|---|
| **Remote MCP (HTTP/SSE)** | We host the server, users paste a URL | Requires hosting infrastructure. Users' API keys must be transmitted to and stored on our server — adds auth complexity (OAuth) and security concerns. Overkill for testing phase. |
| **Standalone binary** | Bundle Node.js into a single executable via `pkg`/`bun compile` | Platform-specific builds (macOS/Windows/Linux), large file size (~50MB+), harder to update. Distribution channel unclear (GitHub releases? file sharing?). |
| **Git clone + build** | Users clone the repo, run `npm install && npm run build` | Too many steps for non-developers. Requires git knowledge. Not suitable for customers. |
| **Share a `.tgz` file** | We run `npm pack`, share the archive via Slack/email | Manual distribution, no update mechanism, still requires `npm install -g`. |

## Why `npx`

- **Standard approach** — this is how MCP servers are distributed across the ecosystem (Stripe, GitHub, etc.)
- **Zero setup for users** — paste config, restart client, done
- **API keys stay local** — credentials never leave the user's machine (env vars only)
- **Automatic updates** — `npx` fetches the latest version periodically
- **No hosting or infrastructure** — we publish once, npm handles distribution
- **Already proven** — the `@cognigy` scope on npmjs.com is active with 20+ existing packages

---

## Requirements

### Developer side (one-time publish)

- **npm access**: Publish rights to the `@cognigy` scope on npmjs.com
- **Publish command**: `npm login && npm publish --access public`
- **Updates**: Bump version in `package.json`, then `npm publish` again
- The `prepublishOnly` script auto-builds before every publish

### User side (to connect to the MCP)

- **Node.js 20+** installed (check with `node -v`)
- **A Cognigy API key** (Cognigy.AI → User Menu → My Profile → API Keys)
- **An MCP client** that supports stdio transport (Cursor, Claude Desktop, ChatGPT, Windsurf, etc.)
- Paste the config block above into their client's MCP settings
- Restart the client

No npm account, no git, no build tools required.
