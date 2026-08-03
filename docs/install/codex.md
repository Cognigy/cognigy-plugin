# Install for OpenAI Codex

Covers every Codex surface — the **Codex CLI**, the **IDE extension**, and Codex inside the **ChatGPT desktop app** (the standalone Codex app was merged into ChatGPT in July 2026). All three read the same `~/.codex/config.toml`, so one install serves all of them.

|                  |                                                                      |
| ---------------- | -------------------------------------------------------------------- |
| **You get**      | Tools from the installer; skills need one in-app step                |
| **Agents**       | Not supported — Codex subagents use a different (TOML) format        |
| **Credentials**  | `~/.cognigy-plugin/config.json` (`chmod 600`) — never in config.toml |
| **Requires**     | Codex CLI 0.117.0+ for the plugin (skills) step                      |
| **Auto-updates** | Automatic for tools: the server runs the engine at `@latest`         |

## Step 1 — Run the installer

[Run the installer](../../README.md#installation) and pick **OpenAI Codex**. It runs `codex mcp add`, which writes:

```toml
[mcp_servers.cognigy]
command = "npx"
args = ["-y", "-p", "cognigy-engine@npm:@cognigy/plugin-engine@latest", "cognigy-mcp"]
```

Restart Codex — **the tools work now**.

No `codex` CLI on PATH? The installer writes the credentials file anyway and prints both the command and the TOML block above so you can apply either by hand.

## Step 2 — Install the plugin for skills

The MCP server serves tools only. Skills come from the plugin:

1. In a Codex session, run `/plugins`.
2. Find **cognigy** in the **cognigy-plugin** marketplace and install it.
3. Start a new thread — Codex injects plugins at session start and has no hot reload.

The installer already added the marketplace (`codex plugin marketplace add Cognigy/cognigy-plugin`); on older Codex builds without the `plugin` subcommand that step is skipped with a warning and tools still work.

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
- **Updates** — the engine spec is `@latest`, so tools pick up new releases on restart. Skills update through `/plugins`.

## Uninstall

```
npx -y -p @cognigy/plugin-engine@latest cognigy-setup uninstall
```

Runs `codex mcp remove cognigy`. Remove the plugin itself from the `/plugins` screen — there is no non-interactive plugin uninstall.
