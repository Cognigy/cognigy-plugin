# Testing

This guide covers the two ways to test the NiCE Cognigy Plugin: installing it through a marketplace
like an end user, and the fast local-engine loop you use during development.

## Prerequisites

You will need:

- A Cognigy API base URL
- A Cognigy API key
- Node.js 20+
- A supported client — Claude Code or Codex today (more to come). The steps below use Claude Code.

## 1. Test via the Marketplace + Plugin (end-user path)

Use this to verify the plugin the way end users install it.

**Published marketplace (real end-user flow):**

```
/plugin marketplace add Cognigy/cognigy-plugin
/plugin install cognigy@cognigy-plugin
```

**Local checkout (test your branch as a plugin):** add the marketplace from your repo directory
instead — it reads `.claude-plugin/marketplace.json` at the path you give:

```
/plugin marketplace add /absolute/path/to/cognigy-plugin
/plugin install cognigy@cognigy-plugin
```

Then:

1. On first boot, the plugin's launcher (`plugin/bin/launch.mjs`) installs `@cognigy/plugin-engine`
   pinned to the plugin's own version into `${CLAUDE_PLUGIN_DATA}` (only when the installed version
   differs), then launches it. No `@latest` float, no install hook.
2. Provide your `COGNIGY_API_BASE_URL` and `COGNIGY_API_KEY` when prompted.
3. Verify the tools are available under the `mcp__plugin_cognigy_platform__` prefix and that
   skills auto-load on intent.

**Picking up changes:**

- For most `plugin/` edits (skills, agents, `plugin.json`, the launcher), run `/reload-plugins`.
- To re-test a clean install (e.g. after `marketplace.json` changes), remove and re-add:

  ```
  /plugin marketplace remove cognigy-plugin
  /plugin marketplace add /absolute/path/to/cognigy-plugin
  /plugin install cognigy@cognigy-plugin
  ```

> **Heads-up:** the launcher fetches `@cognigy/plugin-engine@<plugin version>` from npm, so the
> marketplace path runs the **released** engine for that version — not your local `src/` changes. To
> test engine changes you haven't released, use the local-engine loop below — it bypasses the
> launcher and runs your local build.

## 2. Local Engine Build (dev — the fast loop)

Use this whenever you change the engine (`src/`). It runs your local build directly, bypassing the
launcher and npm so you don't need a published engine.

1. Clone and build:

   ```bash
   git clone https://github.com/Cognigy/cognigy-plugin.git
   cd cognigy-plugin
   npm ci
   npm run build
   ```

2. Temporarily point the plugin at your local build. In `plugin/.claude-plugin/plugin.json`, set
   `mcpServers.platform.args` to your local `dist/index.js` (absolute path) instead of the launcher:

   ```json
   "args": ["/absolute/path/to/cognigy-plugin/dist/index.js"]
   ```

   **Revert this before committing** — it is for local testing only.

3. Reload the plugin:

   ```
   /reload-plugins
   ```

4. Exercise the tools and skills. After each `src/` change, repeat `npm run build` + `/reload-plugins`.

### Optional: exercise the launcher with your local build

The loop above skips the launcher. The marketplace path (section 1) exercises the launcher but pulls
the **released** engine. To run the launcher against **your local build**, pre-populate the install
dir from a local tarball so its version matches the pin and the launcher hands off without fetching:

```bash
npm run build
npm pack                                   # -> cognigy-plugin-engine-<version>.tgz
npm install ./cognigy-plugin-engine-*.tgz --prefix "$CLAUDE_PLUGIN_DATA"
```

Then `/reload-plugins` with `plugin.json` pointing back at the launcher: it sees the installed
version equals the plugin version, skips the npm fetch, and hands off. (Find `${CLAUDE_PLUGIN_DATA}`
from the plugin's runtime env; it's the per-plugin data dir the host assigns.)

There is no `init --client` installer, `.mcpb` bundle, or standalone-client config — the paths above
are the only local test paths.

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
4. Verify the marketplace + plugin install path end to end (against a published engine version)
