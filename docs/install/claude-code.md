# Install for Claude Code

Covers the **Claude Code CLI** and the **Claude Desktop "Code" tab** — since the April 2026 Desktop redesign both read `~/.claude`, so one install serves both. For Claude Desktop **chat**, see [claude-desktop.md](claude-desktop.md).

|                  |                                             |
| ---------------- | ------------------------------------------- |
| **You get**      | Tools, skills, and agents                   |
| **Credentials**  | OS keychain (via the `claude` plugin CLI)   |
| **Extra steps**  | None — one command                          |
| **Auto-updates** | Off by default; one-time opt-in (see below) |

## Install

[Run the installer](../../README.md#installation) and pick **Claude Code**.

It adds the `Cognigy/cognigy-plugin` marketplace, installs the plugin at user scope, and routes your API key into the OS keychain via `claude plugin install --config`. Restart Claude Code (or run `/reload-plugins`) and you're done.

**No `claude` CLI on PATH?** The installer falls back to writing `~/.cognigy-plugin/config.json` (`chmod 600`) and prints the commands to finish by hand:

```
/plugin marketplace add Cognigy/cognigy-plugin
/plugin install cognigy@cognigy-plugin
```

In the Claude Desktop **"Code"** tab there is no slash-command install — use the plugin browser instead: **+** near the prompt → **Plugins** → **Add plugin** → marketplace `Cognigy/cognigy-plugin`.

## Turn on auto-updates

Claude Code leaves auto-update **off** for third-party marketplaces, so new releases won't reach you until you opt in once:

```
/plugin → Marketplaces → cognigy-plugin → enable auto-update
```

Without it, update manually with `/plugin update cognigy@cognigy-plugin` or `cognigy-setup update`.

## Windows

A normal restart often isn't enough — the old process lingers and the plugin won't load:

1. **Fully quit** Claude Code: end every **Claude** process in **Task Manager** (closing the window can leave it running).
2. Reopen it.
3. If the tools, skills, and agents still don't appear, **restart your machine**.

## Uninstall

```
npx -y -p @cognigy/plugin-engine@latest cognigy-setup uninstall
```

Add `--purge` to also delete `~/.cognigy-plugin`. By hand: `/plugin uninstall cognigy@cognigy-plugin` then `/plugin marketplace remove cognigy-plugin`.

## Troubleshooting

- **Tools missing in a brand-new session** — the first session downloads the engine from npm. Run `/mcp` and reconnect, or restart; later sessions start instantly because npx caches by version.
- **Everything loads but calls fail with a credentials error** — re-run the installer; it rewrites the keychain entry.
