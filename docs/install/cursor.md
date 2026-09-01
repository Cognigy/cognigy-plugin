# Install for Cursor

Cursor is the one Agent Plugins host that can ask you for credentials itself, so it does **not** need the installer. The plugin ships a Cursor manifest whose `variables` block declares the API base URL and key; Cursor collects them in **Plugins → Configure** and injects them into the MCP server's environment.

|                  |                                                                  |
| ---------------- | ---------------------------------------------------------------- |
| **You get**      | Tools, skills, and agents                                        |
| **Credentials**  | Cursor's own plugin config (Plugins → Configure) — no local file |
| **Extra steps**  | Yes — fill in the two variables after installing                 |
| **Auto-updates** | Managed by Cursor                                                |

Because the credentials live in Cursor's plugin config rather than a file on one machine, this is also the only path that works for **Cursor cloud agents**, which cannot read `~/.cognigy-plugin/config.json`.

## Step 1 — Install the plugin

Install from the Cursor Marketplace, or add the repo directly: `Cognigy/cognigy-plugin`. Cursor reads the plugin's Cursor manifest, which points at its skills, agents, and MCP servers.

## Step 2 — Set the two variables

Open **Plugins → Configure** for **Cognigy** and fill in:

| Variable               | Value                                                                 |
| ---------------------- | --------------------------------------------------------------------- |
| `COGNIGY_API_BASE_URL` | Your instance's API URL — `https://api-trial.cognigy.ai` on the trial |
| `COGNIGY_API_KEY`      | Cognigy.AI → User Menu → My Profile → API Keys                        |

Both are required. Reload Cursor and the Cognigy tools are live.

## Updating

Cursor owns the plugin's version — update it the way you update any Cursor plugin. The engine version is pinned by the plugin, so the two always match.

## Uninstall

Remove the plugin in Cursor. Nothing is written outside Cursor's own configuration, so there is nothing else to clean up — unless you also ran the installer, in which case:

```
npx -y -p @cognigy/plugin-engine@latest cognigy-setup uninstall --client other-hosts --purge
```

`--purge` deletes `~/.cognigy-plugin`, which every client shares — don't pass it while another client is still installed.

## Troubleshooting

**`COGNIGY_API_KEY is not set`**

The variables are empty, or Cursor loaded the plugin from the vendor-neutral [Agent Plugins](https://agent-plugins.org) manifests instead of the Cursor one — those ship credential-less by design, since a plugin manifest is public text. Fill in **Plugins → Configure** first; if the fields aren't offered, fall back to the credentials file that every spec host uses:

```
npx -y -p @cognigy/plugin-engine@latest cognigy-setup --client other-hosts
```

That writes `~/.cognigy-plugin/config.json` (`chmod 600`) and touches no Cursor config. See [other-hosts.md](other-hosts.md).

**`npx: command not found` when the server starts**

Your Node is from nvm, fnm, or volta, whose `bin` directory is added by your shell profile — which a GUI-launched Cursor need not have sourced. Quit Cursor completely and relaunch it from a terminal, or replace `npx` in the MCP entry with an absolute path (`which npx` on macOS/Linux, `where npx` on Windows).
