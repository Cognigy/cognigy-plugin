# Install for ChatGPT + Codex

Covers **ChatGPT** and **Codex** together. OpenAI merged the standalone Codex app into the ChatGPT desktop app in July 2026, so Chat, Work, and Codex are now tabs in one application you switch between — and the plugin works across it, the **Codex CLI**, and the **IDE extension**. All three surfaces read the same `~/.codex/config.toml`, so one install serves all of them.

|                  |                                                                      |
| ---------------- | -------------------------------------------------------------------- |
| **You get**      | Tools and skills, both from the plugin — one install                 |
| **Agents**       | Not supported — Codex subagents use a different (TOML) format        |
| **Credentials**  | `~/.cognigy-plugin/config.json` (`chmod 600`) — never in config.toml |
| **Requires**     | Codex CLI 0.117.0+ to automate the plugin install; else do it in-app |
| **Auto-updates** | The plugin's server runs the engine at `@latest`                     |

## Step 1 — Run the installer

[Run the installer](../../README.md#installation) and pick **ChatGPT + Codex**. With the `codex` CLI on PATH it does everything non-interactively:

```
codex plugin marketplace add Cognigy/cognigy-plugin
codex plugin add cognigy@cognigy-plugin
```

and writes your credentials to `~/.cognigy-plugin/config.json` (`chmod 600`).

Start a **new thread** — Codex loads plugins at session start, so an already-open thread won't see them. You now have **tools and skills**.

## Step 2 — only if the installer couldn't finish

No `codex` on PATH, or a step failed? The credentials file is written regardless, so the rest is in the app:

1. Click **Plugins** in the sidebar.
2. Click **Add** at the top right, then **Add a Marketplace**.
3. Enter `Cognigy/cognigy-plugin` as the source and click **Add Marketplace**.
4. Click **Install** on the **Cognigy** plugin.
5. Start a new thread.

Or, in a Codex session: `/plugins` → install **cognigy** from the **cognigy-plugin** marketplace. Both routes reach the same place; the GUI needs no Codex CLI at all.

## Where the tools come from

The plugin declares its own `platform` MCP server, and Codex starts it once the plugin is installed. That is the whole tool surface — **the installer writes no global `[mcp_servers.cognigy]` entry**, because a second registration of the same engine would put 32 tools in the picker for 16 real ones. Claude Code works the same way.

If you wired a global `cognigy` server by hand (or with an older version of this installer), remove it so only one engine runs:

```
codex mcp remove cognigy
```

## Credentials

`config.toml` has no keychain, so the installer keeps secrets out of it entirely: it writes `~/.cognigy-plugin/config.json` (`chmod 600`) and the engine falls back to that file whenever `COGNIGY_API_BASE_URL` / `COGNIGY_API_KEY` are absent from the environment. Exported env vars still win if you prefer to set them per shell.

> **The empty "Environment variables" fields are intentional.** In the ChatGPT app under Settings → MCPs → Cognigy MCP you'll find that section blank — leave it that way. Filling it in would copy your API key into `config.toml` as plaintext, where nothing protects it; the credentials file above already reaches the server, which is why the tools work with those fields empty.

## Notes and caveats

- **ChatGPT desktop app / minimal PATH** — GUI apps launch with a reduced `PATH`. If the `cognigy` server fails there with an `npx`-not-found error, run the installer once from a terminal (it writes the config the app reads) and prefer Codex from the terminal or IDE.
- **Project-scoped config is ignored by the desktop app** — it loads only the global `~/.codex/config.toml` ([openai/codex#13025](https://github.com/openai/codex/issues/13025)). Plugins are recorded there, so this doesn't affect you.
- **Updates** — the plugin's server runs the engine at `@latest`, so tools pick up new releases on restart. Skills update with the plugin: the Plugins directory in the ChatGPT app, or `/plugins` in a Codex session.

## Uninstall

```
npx -y -p @cognigy/plugin-engine@latest cognigy-setup uninstall --client codex
```

Runs `codex plugin remove cognigy@cognigy-plugin` and drops the marketplace registration. Without the `codex` CLI, remove it in the app instead: **Plugins** in the sidebar → **⋯** on Cognigy → **Uninstall**.

Drop `--client` to uninstall from every client. Add `--purge` to also delete `~/.cognigy-plugin` — the credentials file every client shares.
