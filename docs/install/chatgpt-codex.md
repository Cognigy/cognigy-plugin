# Install for ChatGPT + Codex

One install covers the **ChatGPT desktop app**, the **Codex CLI**, and the **IDE extension** — they all read the same config.

|                  |                                                        |
| ---------------- | ------------------------------------------------------ |
| **You get**      | Tools and skills                                       |
| **Agents**       | Not supported — Codex subagents use a different format |
| **Credentials**  | `~/.cognigy-plugin/config.json` (`chmod 600`)          |
| **Auto-updates** | Yes — restart to pick up a new release                 |

## Install

[Run the installer](../../README.md#installation) and pick **ChatGPT + Codex**.

Then **start a new thread**. That's it — you have tools and skills everywhere.

An already-open thread won't see the plugin; Codex loads plugins when a session starts.

The installer is not optional: it is the only thing that supplies your Cognigy API key. The ChatGPT app has no field for it, because Codex cannot prompt a plugin for secrets.

## If the installer couldn't install the plugin

The installer needs the `codex` CLI on PATH to install the plugin for you. Without it, it writes your credentials and stops — finish in the ChatGPT app:

1. Click **Plugins** in the sidebar.
2. Click **Add** at the top right, then **Add a Marketplace**.
3. Enter `Cognigy/cognigy-plugin` as the source and click **Add Marketplace**.
4. Click **Install** on the **Cognigy** plugin.
5. Start a new thread.

In a Codex session you can do the same with `/plugins`.

You can also install the plugin here first and run the installer afterwards — order doesn't matter, but **both halves are required**.

## Uninstall

```
npx -y -p @cognigy/plugin-engine@latest cognigy-setup uninstall --client codex
```

Or in the app: **Plugins** in the sidebar → **⋯** on Cognigy → **Uninstall**.

Drop `--client` to uninstall from every client. Add `--purge` to also delete `~/.cognigy-plugin` — the credentials file every client shares.

## Troubleshooting

**The tools don't appear.** Start a new thread first. If they still don't, check that the plugin shows as installed and enabled in the Plugins sidebar.

**`npx: command not found`.** GUI apps launch with a reduced `PATH`, so a Node installed via nvm, fnm, or volta can be invisible to the ChatGPT app. Quit the app completely and relaunch it from a terminal.

**"Environment variables" is empty under Settings → MCPs → Cognigy MCP.** That's intended — leave it. Your key lives in `~/.cognigy-plugin/config.json` instead, which is why the tools work with those fields blank. Filling them in would copy the key into `config.toml` as plaintext.

---

## How it works

_Background — you don't need any of this to use the plugin._

**Why one install covers everything.** OpenAI merged the standalone Codex app into the ChatGPT desktop app in July 2026, so Chat, Work, and Codex are tabs in one application. That app, the Codex CLI, and the IDE extension all read the same `~/.codex/config.toml`, so installing once from any of them reaches all three.

**What the installer runs.** With the `codex` CLI on PATH, both steps are non-interactive:

```
codex plugin marketplace add Cognigy/cognigy-plugin
codex plugin add cognigy@cognigy-plugin
```

plus writing your credentials. Without the CLI it writes the credentials and prints the in-app steps.

**Where the tools come from.** The plugin declares its own `platform` MCP server, and Codex starts it once the plugin is installed. That is the whole tool surface — the installer writes **no** global `[mcp_servers.cognigy]` entry, because a second registration of the same engine would put 32 tools in the picker for 16 real ones. Claude Code works the same way. If you wired a global `cognigy` server by hand, or with an older version of this installer, remove it so only one engine runs:

```
codex mcp remove cognigy
```

**Credentials.** `config.toml` has no keychain, and Codex cannot prompt a plugin for secrets, so the installer keeps them out of it entirely: `~/.cognigy-plugin/config.json` (`chmod 600`), which the engine reads whenever `COGNIGY_API_BASE_URL` / `COGNIGY_API_KEY` are absent from the environment. Exported env vars still win if you prefer to set them per shell.

**Updates.** The plugin's server runs the engine at `@latest`, so tools pick up new releases on restart. Skills ship with the plugin and update when it does.

**Project-scoped config is ignored by the desktop app** — it loads only the global `~/.codex/config.toml` ([openai/codex#13025](https://github.com/openai/codex/issues/13025)). Plugins are recorded there, so this doesn't affect you.
