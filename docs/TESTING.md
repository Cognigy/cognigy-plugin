# Testing

This guide covers the two ways to test the Cognigy MCP plugin: installing it through the marketplace like an end user, and testing a local engine build during development.

## Prerequisites

You will need:

- A Cognigy API base URL
- A Cognigy API key
- Node.js 20+
- A supported client — Claude Code or Codex today (more to come). The steps below use Claude Code.

## 1. Test via the Marketplace + Plugin (end-user path)

Use this to verify the plugin the way end users install it.

1. Add the marketplace:

   ```
   /plugin marketplace add Cognigy/cognigy-plugin
   ```

2. Install the plugin:

   ```
   /plugin install cognigy-mcp@cognigy-plugin
   ```

3. On install, the plugin's `SessionStart` hook runs `npm install cognigy-plugin-engine@latest` into `${CLAUDE_PLUGIN_DATA}`, and `plugin.json` launches the engine from `${CLAUDE_PLUGIN_DATA}/node_modules/cognigy-plugin-engine/dist/index.js`.

4. Provide your `COGNIGY_API_BASE_URL` and `COGNIGY_API_KEY` when prompted.

5. Verify the tools are available under the `mcp__plugin_cognigy-mcp_platform__` prefix and that skills auto-load on intent.

## 2. Test a Local Engine Build (dev-only)

Use this when you want to test changes to the engine before publishing, without going through npm.

1. Clone the repo and build:

   ```bash
   git clone https://github.com/Cognigy/cognigy-plugin.git
   cd cognigy-plugin
   npm ci
   npm run build
   ```

2. Temporarily point the plugin at your local build. Edit `plugin/.claude-plugin/plugin.json` so `mcpServers.platform.args` references your local `dist/index.js` directly, instead of the launcher (`${CLAUDE_PLUGIN_ROOT}/bin/launch.mjs`) that resolves the pinned engine from npm.

   **Revert this change before committing** — it is for local testing only.

3. Reload the plugin in Claude Code:

   ```
   /reload-plugins
   ```

4. Exercise the tools and skills against your local engine build.

There is no `init --client` installer, `.mcpb` bundle, or standalone-client config — the local-engine path above is the only local test path.

## 3. Run Automated Checks

Before opening a PR, run the usual checks:

```bash
npm test
npm run lint
npx tsc --noEmit
```

## Recommended Workflow Before Release

1. Run `npm run build`
2. Run `npm test`, `npm run lint`, and `npx tsc --noEmit`
3. Test the local engine build by pointing `plugin.json` at local `dist/index.js`, then revert the change
4. Verify the marketplace + plugin install path end to end
