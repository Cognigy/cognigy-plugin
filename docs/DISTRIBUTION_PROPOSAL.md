# MCP Server Distribution — Proposal

## Distribution channels

We support two distribution methods to cover all MCP clients:

| Channel | Target | User experience | Requires Node.js? |
|---|---|---|---|
| **npm / npx** | All MCP clients (Cursor, Claude, ChatGPT, Windsurf, etc.) | Paste JSON config | Yes |
| **MCPB bundle** | Claude Desktop (macOS, Windows) | Double-click `.mcpb` file, fill in a form | No (Claude ships Node.js) |

---

## Channel 1: npm / npx (all clients)

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

## Why `npx` as the primary channel

- **Standard approach** — this is how MCP servers are distributed across the ecosystem (Stripe, GitHub, etc.)
- **Zero setup for users** — paste config, restart client, done
- **API keys stay local** — credentials never leave the user's machine (env vars only)
- **Automatic updates** — `npx` fetches the latest version periodically
- **No hosting or infrastructure** — we publish once, npm handles distribution
- **Already proven** — the `@cognigy` scope on npmjs.com is active with 20+ existing packages

---

## Channel 2: MCPB bundle (Claude Desktop)

For Claude Desktop users, we also provide an `.mcpb` bundle — a zip archive containing the server, dependencies, and a `manifest.json`. Users double-click the file, Claude Desktop shows an install dialog with a form for API URL and API key, and they're done.

**How it works:**
- `manifest.json` declares `user_config` fields (API URL, API key with `sensitive: true`)
- Claude Desktop auto-generates a settings UI from this config
- User values are injected as environment variables when the server is spawned
- Same `loadConfig()` code path as npx — no code changes needed

**Building the bundle:**
```bash
npm run mcpb:pack
```

This produces a `.mcpb` file that can be attached to GitHub releases or shared directly.

**User experience:**
1. Download the `.mcpb` file
2. Double-click it (or drag into Claude Desktop)
3. Fill in API URL and API key in the install dialog
4. Done — Cognigy tools available in Claude

---

## Why not a universal marketplace?

The ideal experience would be a built-in MCP marketplace within every client — where users search for "Cognigy", click install, enter their API key, and are done. As of today, **no such unified marketplace exists across all clients**:

- **Claude Desktop** — has a Connectors Directory and supports MCPB bundles (one-click install). We support this (see below).
- **ChatGPT** — MCP support is recent, no marketplace for third-party servers yet
- **Cursor / Windsurf** — manual config only, no marketplace
- **Smithery.ai / mcp.so** — community-run registries, fragmented adoption, not integrated natively

---

## Alternatives considered (not adopted)

| Approach | How it works | Why we didn't pick it |
|---|---|---|
| **Remote MCP (HTTP/SSE)** | We host the server, users paste a URL | Requires hosting infrastructure. Users' API keys must be transmitted to and stored on our server — adds auth complexity (OAuth) and security concerns. Overkill for testing phase. |
| **Standalone binary** | Bundle Node.js into a single executable via `pkg`/`bun compile` | Platform-specific builds (macOS/Windows/Linux), large file size (~50MB+), harder to update. Distribution channel unclear (GitHub releases? file sharing?). |
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
3. Bumps `package.json` version
4. Publishes to npm
5. Commits the version change back to `main` and creates a git tag

**PR labels control the bump type:**

| PR label | Version bump | Example |
|---|---|---|
| `major` | Major | 0.1.0 → 1.0.0 |
| `minor` | Minor | 0.1.0 → 0.2.0 |
| No label (default) | Patch | 0.1.0 → 0.1.1 |

**Manual release** is also available: Actions → "Publish to npm" → Run workflow → pick bump type.

### User side (to connect to the MCP)

- **Node.js 20+** installed (check with `node -v`)
- **A Cognigy API key** (Cognigy.AI → User Menu → My Profile → API Keys)
- **An MCP client** that supports stdio transport (Cursor, Claude Desktop, ChatGPT, Windsurf, etc.)
- Paste the config block above into their client's MCP settings
- Restart the client

No npm account, no git, no build tools required.
