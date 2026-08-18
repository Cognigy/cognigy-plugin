# Install for Antigravity

Antigravity has a first-class plugin format, so the installer builds a real plugin and installs it into `~/.gemini/config/plugins/cognigy-plugin/` — a tree shared by the **IDE**, the **`agy` CLI**, and the **SDK**, so one install serves all three.

|                  |                                                                            |
| ---------------- | -------------------------------------------------------------------------- |
| **You get**      | Tools, skills, and agents — the full surface                               |
| **Credentials**  | `~/.cognigy-plugin/config.json` (`chmod 600`) — never in mcp_config        |
| **Extra steps**  | None — restart Antigravity                                                 |
| **Requires**     | Nothing; the installer does not need `agy` on PATH                         |
| **Auto-updates** | Engine yes, on every launch. Skills and agents need `cognigy-setup update` |

## Install

[Run the installer](../../README.md#installation) and pick **Antigravity**:

```
npx -y -p @cognigy/plugin-engine@latest cognigy-setup --client antigravity
```

Restart Antigravity. Tools, skills, and agents are live in the IDE and the `agy` CLI.

It works **before Antigravity's first launch** and without the `agy` binary — see below.

## What gets written

```
~/.gemini/config/plugins/cognigy-plugin/
├── plugin.json            name + version + description
├── mcp_config.json        cognigy (tools) + cognigy-docs (official docs)
├── skills/<id>/SKILL.md   the 13 workflow skills
└── agents/<id>.md         the 2 subagents
```

Plus two registry entries: the `import_manifest.json` record that `agy plugin list` reads, and the `plugins.<name>.enabled` flag in `config.json` that Antigravity's own bundled plugins use.

**Your global `~/.gemini/config/mcp_config.json` is never touched.** The plugin's own `mcp_config.json` is read in place, so installing or removing the plugin cannot disturb your MCP servers. The one exception is cleanup: if an earlier or hand-rolled setup left a `cognigy` server in the global file, the installer removes it so only one engine boots.

Antigravity moved plugin installs into `~/.gemini/config/` in CLI v1.0.2; older builds staged them under `~/.gemini/antigravity-cli/plugins/`. The installer writes the current location and looks in **both** when reporting status or uninstalling, so a plugin an older `agy` put elsewhere is still found.

## Credentials

The API key is **not** written into any `mcp_config.json` — that file is shared, hand-edited, and routinely pasted into bug reports. It goes to `~/.cognigy-plugin/config.json` (`0600`), which the engine reads whenever `COGNIGY_API_BASE_URL` / `COGNIGY_API_KEY` are absent from the environment. The plugin's server entry therefore carries no `env` at all.

## Updating

The engine auto-updates: the plugin's server runs through a launcher that pulls the latest engine on every Antigravity launch, offline-safe.

Skills and agents are different — they are plain files staged at install time, so a newer engine's copies only land when you re-stage:

```
npx -y -p @cognigy/plugin-engine@latest cognigy-setup update
```

`cognigy-setup status` shows the installed plugin version next to the latest on npm.

## Uninstall

```
npx -y -p @cognigy/plugin-engine@latest cognigy-setup uninstall --client antigravity
```

Removes the plugin directory and both registry entries — again without needing `agy`. Drop `--client` to uninstall from every client; add `--purge` to also delete `~/.cognigy-plugin`, the credentials file every client shares.

## Notes and caveats

- **Migrated from Gemini CLI?** `agy plugin import gemini` converts installed Gemini CLI extensions into Antigravity plugins. If you had the Cognigy **extension** installed before [Gemini CLI stopped serving consumer tiers](gemini-cli.md) and then migrated, you may end up with an imported copy alongside this plugin — two engines, duplicate tools. Check `agy plugin list` and remove whichever you did not install here.
- **Why the installer doesn't call `agy plugin install`** — it would make the install depend on a CLI the IDE doesn't ship, add a Windows `agy.cmd` spawn hazard, and, worse, it _merges_ into an existing plugin directory rather than replacing it, so files from a previous version survive an upgrade. The installer reproduces both halves of what that command does — the copy and both registry writes — and the result is byte-identical.
- **`agy plugin validate <dir>`** is the fastest conformance check when changing the plugin layout. It reports `skills / agents / commands / mcpServers / hooks` counts.
- **Remote MCP servers use `serverUrl`**, not `url`, in `mcp_config.json`.
