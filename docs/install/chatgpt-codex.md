# Install for ChatGPT + Codex

Covers **ChatGPT** and **Codex** together. OpenAI merged the standalone Codex app into the ChatGPT desktop app in July 2026, so Chat, Work, and Codex are now tabs in one application you switch between — and the plugin works across it, the **Codex CLI**, and the **IDE extension**. All three surfaces read the same `~/.codex/config.toml`, so one install serves all of them.

|                  |                                                                      |
| ---------------- | -------------------------------------------------------------------- |
| **You get**      | Tools from the installer; skills need one step in the GUI or CLI     |
| **Agents**       | Not supported — Codex subagents use a different (TOML) format        |
| **Credentials**  | `~/.cognigy-plugin/config.json` (`chmod 600`) — never in config.toml |
| **Requires**     | Nothing for the GUI path; Codex CLI 0.117.0+ for the `/plugins` path |
| **Auto-updates** | Automatic for tools: the server runs the engine at `@latest`         |

## Step 1 — Run the installer

[Run the installer](../../README.md#installation) and pick **ChatGPT + Codex**. It runs `codex mcp add`, which writes:

```toml
[mcp_servers.cognigy]
command = "npx"
args = ["-y", "-p", "cognigy-engine@npm:@cognigy/plugin-engine@latest", "cognigy-mcp"]
```

Restart the ChatGPT app (or Codex) — **the tools work now**.

No `codex` CLI on PATH? The installer writes the credentials file anyway and prints both the command and the TOML block above so you can apply either by hand.

## Step 2 — Install the plugin for skills

The MCP server serves tools only. Skills come from the plugin, and there are two equivalent ways to install it — the ChatGPT GUI or a Codex session. Pick either; they write to the same place, so doing both is unnecessary.

**In the ChatGPT app (GUI)** — open the **Plugins** directory, switch to the **Personal** tab, add the marketplace `Cognigy/cognigy-plugin`, then install **cognigy** from it. The installed plugin works in Chat, Work, and the Codex tab.

**In a Codex session (CLI, IDE extension, or the Codex tab)** — run `/plugins`, find **cognigy** under the **cognigy-plugin** marketplace, and install it.

Either way, start a new thread afterwards — plugins are injected at session start and there is no hot reload.

The installer already registered the marketplace for the CLI path (`codex plugin marketplace add Cognigy/cognigy-plugin`); on older Codex builds without the `plugin` subcommand that step is skipped with a warning, and tools still work. The GUI path doesn't depend on it — add the marketplace in the Plugins directory instead.

The plugin bundles its own `platform` MCP server. That duplicate is harmless — leave it disabled; the global `cognigy` entry from Step 1 already serves the tools. To silence it explicitly:

```toml
[plugins."cognigy@cognigy-plugin".mcp_servers.platform]
enabled = false
```

## Credentials

`config.toml` has no keychain, so the installer keeps secrets out of it entirely: it writes `~/.cognigy-plugin/config.json` (`chmod 600`) and the engine falls back to that file whenever `COGNIGY_API_BASE_URL` / `COGNIGY_API_KEY` are absent from the environment. Exported env vars still win if you prefer to set them per shell.

> **The empty "Environment variables" fields are intentional.** In the ChatGPT app under Settings → MCPs → Cognigy MCP you'll find that section blank — leave it that way. Filling it in would copy your API key into `config.toml` as plaintext, where nothing protects it; the credentials file above already reaches the server, which is why the tools work with those fields empty.

## Notes and caveats

- **ChatGPT desktop app / minimal PATH** — GUI apps launch with a reduced `PATH`. If the `cognigy` server fails there with an `npx`-not-found error, run the installer once from a terminal (it writes the config the app reads) and prefer Codex from the terminal or IDE.
- **Project-scoped config is ignored by the desktop app** — it loads only the global `~/.codex/config.toml` ([openai/codex#13025](https://github.com/openai/codex/issues/13025)). The installer writes the global file, so this doesn't affect you.
- **Updates** — the engine spec is `@latest`, so tools pick up new releases on restart. Skills update wherever you installed the plugin: the Plugins directory in the ChatGPT app, or `/plugins` in a Codex session.

## Uninstall

```
npx -y -p @cognigy/plugin-engine@latest cognigy-setup uninstall --client codex
```

Runs `codex mcp remove cognigy`. Remove the plugin itself where you installed it — the Plugins directory in the ChatGPT app, or the `/plugins` screen in a Codex session. There is no non-interactive plugin uninstall on either path.

Drop `--client` to uninstall from every client. Add `--purge` to also delete `~/.cognigy-plugin` — the credentials file every client shares.
