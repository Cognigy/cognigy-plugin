# Testing

This guide covers the two ways to test the NiCE Cognigy Plugin: installing it through a marketplace
like an end user, and the one-command local dev loop you use during development.

## Prerequisites

You will need:

- A Cognigy API base URL
- A Cognigy API key
- Node.js 20+
- A supported client — Claude Code or Codex today (more to come). The steps below use Claude Code.

## 1. Local Dev Loop (dev — the fast path)

Use this whenever you change the engine (`src/`), skills, agents, or the plugin manifest. One
command installs a dev copy of the plugin that serves your working tree — no build step, no manual
manifest edits:

```bash
npm run plugin:dev
```

What it does (see `scripts/dev-plugin.mjs`):

- Generates a gitignored dev marketplace under `.dev-plugin/` whose manifest is a copy of
  `plugin/.claude-plugin/plugin.json` with one change: the `platform` server runs `src/index.ts`
  directly via **tsx** (no `npm run build` needed). Skills and agents are **symlinked** to the
  working tree, so edits are live. Remote servers (e.g. the bundled `docs` server) are unchanged.
- Uninstalls the prod plugin (avoids duplicate tool names) and installs `cognigy@cognigy-dev`.

Then, in Claude Code:

1. `/plugin configure cognigy@cognigy-dev` — enter your API base URL + key (once).
2. `/reload-plugins` (or restart the session).
3. Iterate: edit `src/**` or `plugin/**`, then `/reload-plugins`. That's the whole loop.

Done testing? Restore the published plugin:

```bash
npm run plugin:dev:off
```

> **Never edit the tracked `plugin/.claude-plugin/plugin.json` for testing.** Its published form
> (`npx -y -p @cognigy/plugin-engine@<version> cognigy-mcp`, version in lockstep with
> `package.json`) is enforced by `npm run check:manifest`, which runs in pre-commit and PR CI — a
> dev-edited manifest cannot be committed.

The dev manifest is generated from the current branch's `plugin.json` — after switching branches,
re-run `npm run plugin:dev`.

This path is **Claude Code only**: Claude Desktop syncs marketplaces server-side and stores plugin
config in your claude.ai account, so there is no scriptable local install. For a Desktop
engine-only smoke test, point the installer-wired `Cognigy` connector in
`claude_desktop_config.json` at a local `dist/index.js` (requires `npm run build` and a full
Desktop restart), and point it back at `~/.cognigy-plugin/desktop-launch.mjs` when done.

## 2. Test via the Marketplace + Plugin (end-user path)

Use this to verify the plugin the way end users install it.

**Published marketplace (real end-user flow):**

```
/plugin marketplace add Cognigy/cognigy-plugin
/plugin install cognigy@cognigy-plugin
```

Then:

1. On first boot, the plugin's `mcpServers` command runs `npx -y -p @cognigy/plugin-engine@<version> cognigy-mcp`,
   which fetches the engine pinned to the plugin's own version (kept in lockstep by semantic-release)
   and launches it. npx caches by version, so repeat boots are fast/offline once fetched. No `@latest` float.
2. Provide your `COGNIGY_API_BASE_URL` and `COGNIGY_API_KEY` when prompted.
3. Verify the tools are available under the `mcp__plugin_cognigy_platform__` prefix and that
   skills auto-load on intent.

> **Heads-up:** this path runs the **released** engine for the pinned version — not your local
> `src/` changes. Unreleased engine changes are only testable via the local dev loop above; the
> published path can be re-verified end to end after the release.

**Picking up changes / re-testing a clean install:**

```
/plugin marketplace remove cognigy-plugin
/plugin marketplace add Cognigy/cognigy-plugin
/plugin install cognigy@cognigy-plugin
```

(`npm run plugin:dev:off` runs exactly this restore for you.)

There is no `init --client` installer, `.mcpb` bundle, or standalone-client config — the paths above
are the only test paths.

## 3. Run Automated Checks

Before opening a PR, run the usual checks:

```bash
npm test
npm run lint
npx tsc --noEmit
npm run check:manifest
```

## Recommended Workflow Before Release

1. Run `npm run build`
2. Run `npm test`, `npm run lint`, `npx tsc --noEmit`, and `npm run check:manifest`
3. Test your changes with the local dev loop (`npm run plugin:dev`), then restore with `npm run plugin:dev:off`
4. Verify the marketplace + plugin install path end to end (against a published engine version)
