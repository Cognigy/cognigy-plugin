---
name: add-client-platform
description: Add support for a new client platform (a new AI client/IDE the Cognigy plugin can be installed into) — manifests, installer wiring, release plumbing, docs
---

Add a new client platform to the NiCE Cognigy Plugin — a new AI client the plugin can be installed into (Cursor, Windsurf, Zed, Copilot, JetBrains, …). The four existing clients (`claude-code`, `claude-desktop`, `codex`, `gemini`) are the reference implementations; copy whichever one matches the new client's shape rather than inventing a new pattern.

## Before writing anything: check whether it already works

Several clients read each other's manifests. Codex, for example, resolves plugin manifests in the order `.codex-plugin/plugin.json` → `.claude-plugin/plugin.json` → `.cursor-plugin/plugin.json`, and marketplace manifests as `.agents/plugins/marketplace.json` → `.agents/plugins/api_marketplace.json` → `.claude-plugin/marketplace.json` → `.cursor-plugin/marketplace.json`. So a new client may already discover the plugin through a fallback path.

Verify against the client's **source or official docs**, not blog posts, and check specifically:

1. Does it read an existing manifest of ours as a fallback? If so, what does the fallback *lose* (presentation fields, credential handling)?
2. Does it interpolate credential placeholders (`${user_config.*}` or equivalent)? Most clients do **not** — see the credential rule below.
3. Is there a CLI that owns its config file, or must we merge the file ourselves?
4. **How does the client update an installed plugin?** See the update rule below — this is the question most easily assumed and most often wrong.

Only the parts a fallback can't cover need new code.

## Pick the archetype

| Archetype | Reference | How it works | How updates reach the user |
|---|---|---|---|
| Repo-marketplace plugin | `claude-code`, `codex` | Client discovers `plugin/.<client>-plugin/plugin.json` via a marketplace manifest in this repo. Installer drives the client CLI (`marketplace add`), user finishes in the client's plugin UI. | The client re-checks the repo ref and swaps the cached plugin; the new manifest's engine pin pulls the matching engine. **Only works if the ref moves** — pin it to `main` explicitly. |
| Direct config merge | `claude-desktop` | No CLI. Installer reads/merges the client's own MCP config file, preserving every other key, and chmods it 0600 when it holds secrets. | Nothing in the client updates. The MCP entry points at the launcher, which pulls `@latest` each boot. |
| Packaged extension | `gemini` | A build script emits a release asset; installer runs the client's `extensions install` against the GitHub release. | The client's own extension auto-update, if it has one — install with that flag on. |
| Stage and register | `antigravity` | The installer builds a plugin directory itself and writes the client's own registry entries — no client CLI involved, works before the client's first launch. | Nothing in the client updates — we staged the files, so we own refreshing them. The launcher re-stages them after an engine bump. |
| Credentials only | `other-hosts` | The client installs the plugin itself (or takes a hand-written MCP entry); the installer writes `~/.cognigy-plugin/config.json` and wires nothing. | The host owns the version. Say so and stop. |

Most new clients are archetype 1 or 2. "Stage and register" is the answer when the client has a real plugin format but its install command is unreliable to shell out to — see the Antigravity notes in `.claude/CLAUDE.md` for why reproducing the command beat calling it. Reach for "credentials only" when the client can already find and install the plugin but has no way to ask the user for an API key — that is the whole gap, so filling it is the whole install.

## Files to change

| File | What to add |
|---|---|
| `src/install/<client>.ts` | New module. Detection, arg builders, `install<Client>()`, `uninstall<Client>()`, and an "is it wired?" probe. Mirror `src/install/codex.ts` (CLI-driven) or `src/install/claudeDesktop.ts` (file-merge). |
| `src/setup.ts` | Add the key to `Client`, `ALL_CLIENTS`, `CLIENT_LABELS`, `detectClients()`; a branch in `runInstall()`; a line in `runStatus()` and `runUpdate()`; a `runUninstall<Client>()` function called from `runUninstall()`. |
| `plugin/.<client>-plugin/plugin.json` | Only for archetype 1, and only if the client's own manifest schema carries fields the fallback can't. |
| `scripts/sync-plugin-version.mjs` | Add any **committed** manifest carrying a `version` field or an engine pin to `FILES`. |
| `scripts/check-plugin-manifest.mjs` | Guard the new committed manifest's published form (npx command, alias pin). |
| `.releaserc.json` | Add the same committed manifests to the `@semantic-release/git` assets. Add a build step to `prepareCmd` + a GitHub asset only if the client needs a packaged artifact (see `build-gemini-extension.mjs`). |
| `src/__tests__/install<...>.test.ts` | Arg builders, config merge/remove round-trips, detection. Follow `installCodexGemini.test.ts`. |
| `docs/install/<client>.md` | Install, credentials, update, uninstall — same four sections as the existing guides. |
| `README.md` | Row in the per-client support table — including the **Auto-updates** cell — link in the docs list, and the credentials paragraph if this client uses a different channel. |

Do **not** touch `src/index.ts`, the tools, or the skills — the MCP server itself is client-agnostic.

## Hard rules

**Credentials.** `${user_config.*}` interpolation is a **Claude Code feature**, not an MCP standard. Codex and Gemini have no equivalent. Emitting it in a manifest for a client that doesn't interpolate is worse than omitting it: the engine receives the literal string `${user_config.cognigy_api_key}`, which is non-empty, so `loadConfig()` (`src/config.ts`) treats the environment as configured and **skips the `~/.cognigy-plugin/config.json` fallback** — every API call then fails with a mangled base URL. For any client without verified interpolation, ship the MCP entry with **no `env` block** and rely on `writeUserConfigFile(creds)` in the installer.

**Engine pinning.** Two different specs, deliberately:

- **Committed manifests** pin the exact release: `cognigy-engine@npm:@cognigy/plugin-engine@<version>`. Add the file to `sync-plugin-version.mjs`, `check-plugin-manifest.mjs`, and the release git assets, or it will drift out of lockstep.
- **User-global config files** (`~/.codex/config.toml`, extension manifests) use `@latest`, because our releases never re-sync a file that lives in the user's home directory.

The **npm alias form is required in both cases**. A plain `@cognigy/plugin-engine@<v>` spec makes `npm exec` treat this repo's own package.json as satisfying the pin when a session is rooted here, skip the install, and fail with `cognigy-mcp: command not found` (MCP `-32000`).

**Never hand-bump versions.** semantic-release owns every `version` field.

**Let the client's CLI own its config.** If the client ships a CLI that writes its own config (`codex mcp add`), drive the CLI and print a paste-able snippet as fallback when the binary isn't on PATH. Only parse and merge a config file yourself when there is no CLI (Claude Desktop). When merging, preserve all other servers and top-level keys, back up the original once (never overwrite an existing `.bak`), and chmod 0600 if it holds secrets.

**A client CLI is not always the right tool.** Driving one costs a PATH dependency, a Windows `.cmd` spawn hazard, and whatever semantics the command happens to have — `agy plugin install`, for instance, *merges* into an existing plugin directory instead of replacing it, so a previous version's files survive an upgrade. When the command does something simple and documented, reproducing it directly is more predictable. Verify byte-equivalence against a real CLI-driven install before choosing this.

**Spawn through `src/install/cliRunner.ts`.** `detectOnPath()` + `runCliTool()` handle the Windows `.cmd` shim quoting. Never call `spawnSync` on a client CLI directly.

**No executable scripts under `plugin/`.** Claude Desktop security-scans plugin files server-side; a committed script that installs packages or spawns processes fails the *entire* marketplace add. Manifest-declared `npx` commands are not scanned files, so they pass.

**Purge is global.** `~/.cognigy-plugin` is shared by every client. Uninstall calls `purgeUserHome()` once, after the per-client loop — never inside a client's uninstall function.

**Fail loud vs. log-and-continue.** Throw when the load-bearing step fails (the MCP server never got wired) — and say in the error that creds are already written and which commands to run by hand. Log-and-continue for optional steps like `marketplace add`, which older client versions may not support; tools still work without it.

**Work out how updates reach the user, and prove it.** This has been wrong twice, in both directions, and each time the docs asserted a behaviour nobody had checked. Answer three questions against the client's source or official docs:

1. *Does the client refresh the plugin source on its own?* Codex does (it re-checks Git marketplaces at plugin startup); Antigravity does not (its CLI has no update command at all, and `agy plugin install` only copies a local directory).
2. *Is anything pinned to something that stops moving?* A Git marketplace registered without an explicit ref inherits the branch of whatever checkout the installer ran in. Auto-update then works perfectly and finds nothing, forever. Pin refs explicitly.
3. *Do plugin **files** update, or only the engine?* Skills and agents staged as plain files never change on their own. If the client won't refresh them, the launcher must — `updateAntigravity()` called from `desktopLauncher.ts`, version-gated so it runs once per release.

Then wire `runUpdate()` to actually do the work. A branch that prints a claim instead of calling something is worse than no branch: it reads as covered in review and in the docs. Record the result in the README's **Auto-updates** column (Automatic / Enable once / Manual) rather than in prose.

**The launcher can't update itself.** `~/.cognigy-plugin/desktop-launch.mjs` lives outside the versioned engine directory, so an engine bump never rewrites it. Any client whose install writes it must also rewrite it on update, or launcher fixes will never reach existing installs.

**Detection probes both PATH and config dir.** A client's IDE extension or desktop app often shares the config directory without exposing a CLI. See the `codex`/`gemini` entries in `detectClients()`.

**Every entry in `ALL_CLIENTS` needs a full lifecycle.** `runUninstall()` iterates the list, so a client with only an `install` branch silently does nothing when the user targets it with `--client`. If there is genuinely nothing to undo, say that and point at what does own the cleanup — don't leave the branch out.

**Uninstall says what it cannot remove.** When the plugin half of an install lives in an account or a GUI rather than a local file, the installer cannot touch it — print the manual step (Claude Desktop and Codex both do this) so the leftover isn't a surprise.

## Steps

1. Research the client: manifest schema, marketplace/discovery path, CLI surface, credential handling, **and how it updates an installed plugin**. Confirm against source or official docs.
2. Decide the archetype and the credential channel.
3. Write `src/install/<client>.ts`, copying the closest existing module's structure and doc-comment style — the header comment should explain *why* the approach was chosen, not just what it does.
4. Wire it into `src/setup.ts` (all seven touch points listed above).
5. Add manifests + release plumbing only if the client needs a committed manifest or a build artifact.
6. Tests, then `docs/install/<client>.md`, then the README table.
7. Verify: `npx tsc -p tsconfig.json --noEmit`, `npm test -- --runInBand`, `npm run check:manifest`, `npx prettier --write <changed files>`.
8. Commit with a `feat(installer):` scope so semantic-release ships it.

## Notes

- `.agents/plugins/marketplace.json` (Codex's canonical repo-marketplace path) is intentionally absent: `.claude-plugin/marketplace.json` is a supported entry in Codex's lookup list, so a second copy would only add drift. Add it if we ever need Codex-native per-plugin fields such as `policy` or a non-local `source`.
- `npm run plugin:dev` generates a Claude-Code-only dev marketplace and skips `.codex-plugin`. Extending it to a new client is optional; if you don't, say so in the client's doc.
