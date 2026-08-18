# Install for other hosts (VS Code, Cursor, …)

Any host that can install a Claude-format plugin, or take a hand-written MCP server entry, can run the Cognigy plugin. The installer's job here is narrow: it supplies the credentials such a host cannot ask you for.

|                  |                                                                                |
| ---------------- | ------------------------------------------------------------------------------ |
| **You get**      | Whatever the host supports — tools always; skills and agents where implemented |
| **Credentials**  | `~/.cognigy-plugin/config.json` (`chmod 600`)                                  |
| **Extra steps**  | Install the plugin in the host itself — the installer wires nothing            |
| **Auto-updates** | Managed by the host                                                            |

## Install

[Run the installer](../../README.md#installation) and pick **Other hosts**, or:

```
npx -y -p @cognigy/plugin-engine@latest cognigy-setup --client other-hosts
```

It writes your API base URL and key to `~/.cognigy-plugin/config.json` and stops. Nothing is added to any client config, so it is safe to combine with any other target.

Then install the plugin in your host.

**VS Code / Copilot** — in `settings.json`:

```json
{
  "chat.plugins.enabled": true,
  "chat.plugins.marketplaces": ["Cognigy/cognigy-plugin"]
}
```

Open the Extensions view, search `@agentPlugins`, install **cognigy**, and restart VS Code.

**Anything else** — point the host's MCP config at the engine:

```
npx -y -p cognigy-engine@npm:@cognigy/plugin-engine@latest cognigy-mcp
```

Leave the server's `env` empty; the credentials file covers it. The `cognigy-engine@npm:` alias is required — a plain `@cognigy/plugin-engine` spec makes `npm exec` skip the install when the session is rooted in a checkout of this repo.

## Credentials — leave the plugin's own fields alone

`userConfig` — the plugin-manifest extension that prompts for an API key and substitutes it into the server's environment — is implemented by **Claude Code only**. Every other host copies the manifest text through verbatim, so the engine receives the literal string `${user_config.cognigy_api_key}`.

The engine treats a value that is nothing but a `${...}` placeholder as **unset** and reads `~/.cognigy-plugin/config.json` instead. That is why the installer writes the file, and why you should ignore any credential fields the host shows for this plugin — filling them in changes nothing on a host that cannot expand them.

## Updating

The host owns the plugin's version. To refresh only the credentials, re-run the installer with `--client other-hosts`.

## Uninstall

Remove the plugin in the host, then:

```
npx -y -p @cognigy/plugin-engine@latest cognigy-setup uninstall --client other-hosts --purge
```

There is nothing host-specific to undo, so `--client other-hosts` on its own only reports that. `--purge` is what deletes `~/.cognigy-plugin` — and that file is shared by every client, so don't pass it while another client is still installed.

## Troubleshooting

**`npx: command not found` when the server starts**

Your Node is probably from nvm, fnm, or volta, whose `bin` directory is added by your shell profile — which a GUI-launched host need not have sourced. Either quit the host completely and relaunch it from a terminal, or replace `npx` in the MCP entry with an absolute path (`$(which npx)`).

**`COGNIGY_API_KEY is not set` — but the manifest sets it**

The host passed the placeholder through unexpanded and there is no credentials file. Run the installer with `--client other-hosts`; the error message names the placeholder it received when this is the cause.
