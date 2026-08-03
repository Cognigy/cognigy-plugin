# Install for Claude Desktop (chat)

Covers the **chat** side of the standalone Claude Desktop app. The Desktop **"Code"** tab shares its install with the CLI — see [claude-code.md](claude-code.md).

|                  |                                                                   |
| ---------------- | ----------------------------------------------------------------- |
| **You get**      | Tools from the installer; skills and agents need one in-app step  |
| **Credentials**  | `claude_desktop_config.json` (`chmod 600`)                        |
| **Extra steps**  | Yes — install the plugin inside the app (below)                   |
| **Auto-updates** | Automatic: the connector refreshes its engine on every app launch |

## Step 1 — Run the installer

```
npx -y -p @cognigy/plugin-engine@latest cognigy-setup
```

Pick **Claude Desktop chat**. The installer merges a `Cognigy` connector into `claude_desktop_config.json` (backing up any existing file to `.bak` first) pointing at an auto-updating, offline-safe launcher. Restart Claude Desktop — **the tools work now**.

## Step 2 — Install the plugin in the app (skills + agents)

The connector serves tools only. Skills and agents arrive exclusively through the in-app plugin install:

1. Click **Customize** in the left sidebar.
2. Next to **Personal plugins**, click **+**, hover **Add**, and click **Add marketplace**.
3. In the URL field enter `Cognigy/cognigy-plugin`, select the result, and click **Sync**.
4. The `cognigy-plugin` marketplace is now added.
5. Install the **Cognigy** plugin by clicking **+**.
6. On the local-MCP warning, click **Continue**.

Leave the plugin's own `platform` connector **unconnected** — the `Cognigy` connector from Step 1 already serves the tools.

<details>
<summary>Why the extra step? (for the technically curious)</summary>

The plugin ships its own connector (`platform`), but on Claude Desktop chat it can't be given credentials — Desktop stores plugin config in your claude.ai account rather than a local file, and offers no field to enter the API key, so that connector stays a no-op. To make tools work regardless, the installer wires a standalone `Cognigy` connector directly into `claude_desktop_config.json` behind an auto-updating launcher. The plugin install then adds only the parts Desktop _can_ deliver — skills and agents. Claude Code has none of these limitations, which is why it's a single step there.

</details>

## Windows

To make the connector appear:

1. If the install hit a permissions error, re-run it in a terminal opened **as Administrator**.
2. **Fully quit** Claude Desktop from the system tray — closing the window leaves it running.
3. Confirm **Cognigy** shows under Settings → Connectors.
4. **Disable it and re-enable it once** — this forces a tool refresh so the Cognigy tools load.

## Uninstall

```
npx -y -p @cognigy/plugin-engine@latest cognigy-setup uninstall
```

Removes the connector entry (add `--purge` to also delete `~/.cognigy-plugin`, which holds the launcher and engine). Remove the plugin itself from **Customize → Plugins**.
