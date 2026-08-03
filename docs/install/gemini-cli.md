# Install for Google Gemini CLI

Shipped as a **Gemini CLI extension** — one installable unit carrying everything.

|                  |                                                                           |
| ---------------- | ------------------------------------------------------------------------- |
| **You get**      | Tools, skills, agents, and an always-on `GEMINI.md` context file          |
| **Credentials**  | `~/.cognigy-plugin/config.json` (`chmod 600`), or the OS keychain — below |
| **Extra steps**  | None — the extension install is all-in-one                                |
| **Requires**     | A plugin release of 1.9.0 or newer (see Troubleshooting)                  |
| **Auto-updates** | Enabled by the installer (`--auto-update`)                                |

## Install

Either run the installer and pick **Google Gemini CLI**:

```
npx -y -p @cognigy/plugin-engine@latest cognigy-setup
```

or install the extension directly:

```
gemini extensions install https://github.com/Cognigy/cognigy-plugin
```

Restart `gemini` afterwards. Verify with `gemini extensions list` — you should see `cognigy`.

## Credentials — two paths

Gemini passes **only the environment variables an extension declares** to its MCP servers; your shell environment never reaches them. The two supported paths both work around that:

- **Via the installer** — writes `~/.cognigy-plugin/config.json` (`chmod 600`) and installs with `--skip-settings`. The engine reads that file directly from disk.
- **Manual install** — Gemini prompts for the API base URL and key, storing the key in the **OS keychain** and injecting both as declared env vars.

Re-run the prompts at any time with `gemini extensions config cognigy`.

## Updating

The installer enables auto-update, so new releases arrive on their own. To force one:

```
gemini extensions update cognigy
```

`cognigy-setup update` does the same, and skips the step when the extension isn't installed.

## Uninstall

```
gemini extensions uninstall cognigy
```

`cognigy-setup uninstall` does this too (add `--purge` to also delete `~/.cognigy-plugin`).

## Troubleshooting

**`Configuration file not found at /var/folders/.../gemini-extension.json`**

Gemini installs from the newest GitHub release: it looks for an extension archive attached to that release, and when none is attached it falls back to GitHub's auto-generated source tarball — which has no `gemini-extension.json` at its root, producing exactly this error. It means the newest release predates Gemini support. Upgrade to plugin **1.9.0 or newer**, which ships `cognigy-gemini-extension.zip` as a release asset.

**Testing an unreleased build** — build the extension locally and link it instead of installing:

```
npm run build
node scripts/build-gemini-extension.mjs "$(node -p "require('./package.json').version")"
gemini extensions link .gemini-extension
```

Linked extensions are served from the working tree; restart `gemini` after each rebuild. See [../TESTING.md](../TESTING.md).
