# Plan: install-UX overhaul (Node bootstrap, Desktop-only, subcommands)

Status: **DRAFT for review** — off `main` after 1.4.1 (PR #10 merged: plugin launches the engine via `npx`, not a committed launcher script).

## Why

The current installer (`cognigy-setup`, `src/setup.ts`) is already a polished interactive TUI (checkbox client select, masked key prompt, per-client wiring). But four gaps surfaced, plus one migration fact:

1. **Node is assumed, not ensured.** The one-liner is `npx -y -p @cognigy/plugin-engine@latest cognigy-setup`. No Node → cryptic failure. (Comparable tools that curl-bootstrap — e.g. the Python `cognigy-vibe` plugin — do this to install their runtime `uv`.)
2. **Desktop-only users hit a dead end.** As of the Apr-2026 Desktop redesign, Claude Desktop has three tabs — **Chat, Cowork, Code** — and the **Code tab is embedded Claude Code**. A Desktop-only user has **no `claude` CLI on PATH** (the CLI is a separate install; no documented bundled binary to shell out to). Our no-CLI fallback prints `/plugin` commands — but `/plugin` is **CLI-only**, so a Desktop-only user cannot run them. Dead end.
3. **No lifecycle commands.** `cognigy-setup` is install-only. No `status` / `update` / `uninstall`.
4. **Client menu predates the redesign.** Labels blur "Claude Code (terminal + desktop app)".
5. **Propagation.** Existing Claude Code plugin users do **not** auto-update (third-party marketplace auto-update defaults OFF). See Migration below.

Key enabling fact from research (docs.claude.com): **Desktop's Code tab shares `~/.claude/` with the standalone CLI** (plugins, skills, settings). Install once → both surfaces see it. Desktop-only plugin installs go through the **Code-tab GUI plugin browser** (`+` → Plugins → Add plugin → marketplace), which is **marketplace-only** and delivers **skills + agents**. That GUI path is exactly the marketplace add PR #10 unblocked.

## Decisions (user-confirmed)

- **Node missing → detect + guide only.** No auto-install. Print clear nodejs.org / nvm instructions and exit non-zero. The script must not mutate the machine's toolchain.
- **Desktop-only → guide to the GUI browser only.** Wire the standalone connector (tools, no CLI needed) + instruct the user to add `Cognigy/cognigy-plugin` via the Desktop Code-tab plugin browser (skills + agents). Do **not** offer to install the native `claude` CLI.
- **One overhaul PR** (this plan), after review of this doc.

## Design

### 1. Node-ensuring bootstrap (detect + guide)

A thin shell/PowerShell bootstrap that is the new headline install command; it does not replace `cognigy-setup`, it fronts it.

- **macOS/Linux:** `bash <(curl -fsSL <URL>)` — process substitution, **not** `curl … | sh`, so stdin stays attached to the terminal and `cognigy-setup`'s interactive masked prompt still works.
- **Windows:** a parallel `.ps1` (`irm <URL> | iex` or a downloaded file).
- Shell script: `set -euo pipefail`. Steps:
  1. Detect Node: `command -v node` and version ≥ 20 (`node -p process.versions.node`).
  2. If missing/old → print install guidance (link to nodejs.org LTS, mention nvm) and `exit 1`. **No install performed.**
  3. If present → `exec npx -y -p @cognigy/plugin-engine@latest cognigy-setup "$@"` (forward args).
- **Hosting / pinning:** serve from `raw.githubusercontent.com/Cognigy/cognigy-plugin/main/<path>`. `main` is branch-protected and reviewed; the bootstrap is tiny and rarely changes, and all real/versioned logic lives in the npm-fetched `cognigy-setup` — so pinning the bootstrap to a tag buys little. (Do NOT point at a `dev`/feature branch — that's the anti-pattern in cognigy-vibe.) Alternative if we want a vanity URL: host on a NiCE domain that redirects to the raw file. Decide at implementation.
- README becomes: "no Node? this bootstrap tells you how to get it, then runs the installer." The bare `npx …` command stays documented for users who already have Node.

### 2. Desktop-only handling

Replace the useless `/plugin`-print fallback in `runInstall("claude-code", …)` / detection.

- **Detection stays:** `claude` on PATH → CLI path (unchanged, best experience: tools + skills + agents to `~/.claude`, shared with the Desktop Code tab).
- **New branch — Desktop present, no CLI:** detect Desktop via its config dir (already have `resolveDesktopConfigPath()`), and:
  - Wire the standalone `Cognigy` connector into `claude_desktop_config.json` → **tools now**, no CLI needed (existing `installClaudeDesktop`).
  - Print explicit **Code-tab GUI plugin browser** steps to add `Cognigy/cognigy-plugin` → **skills + agents** (works post-#10). Distinct from the older Chat-only "Customize → Add marketplace" copy; verify the exact current UI path at implementation.
- **Neither CLI nor Desktop:** print the manual `/plugin` commands + creds-file note (today's fallback), still valid for someone who will install a client later.

### 3. Lifecycle subcommands

`cognigy-setup <command>` (default `install`). Mirrors cognigy-vibe's `install|status|update|uninstall`.

- `status` — resolve installed engine version(s) vs npm `@latest`; report per surface (Code plugin pin, Desktop connector engine in `~/.cognigy-plugin/engine`). Report drift.
- `update` — Desktop connector auto-updates on boot already (no-op + reassurance); for Code, run `claude plugin update cognigy@cognigy-plugin` when CLI present, else print it.
- `uninstall` — reverse each surface: `claude plugin uninstall` / `marketplace remove` (CLI), remove the `Cognigy` entry from `claude_desktop_config.json` (restore `.bak` if present), and optionally remove `~/.cognigy-plugin/`. Confirm before deleting.

### 4. Enable marketplace auto-update on Code install

So future fixes reach Code users without a manual `/plugin update`. **VERIFIED (2026-07): no CLI flag exists.** `claude plugin marketplace add` accepts only `--scope`/`--sparse`; the `autoUpdate:true` seen in `~/.claude/plugins/known_marketplaces.json` is set solely by the interactive `/plugin` toggle. We will **not** hand-edit Claude's internal JSON (fragile/unsupported). So Item 4 = **print the one-time manual toggle** after a CLI install: `/plugin → Marketplaces → cognigy-plugin → enable auto-update` (or `/plugin update cognigy@cognigy-plugin` to pull once).

### 5. Client-menu clarity

Update `CLIENT_LABELS` / detection to the post-redesign reality:

- "Claude Code — CLI / Desktop Code tab" (shared `~/.claude`; the CLI path serves both).
- "Claude Desktop — Chat connector" (standalone `claude_desktop_config.json`, tools only).
  Keep it to the two install mechanisms we actually drive; just name them accurately.

## Migration / auto-update (informational — no forced migration)

- **Desktop standalone connector users:** `desktop-launch.mjs` probes npm and installs-if-newer every boot → **auto-update to the latest engine** on next restart. Unchanged by PR #10; engine 1.4.1 is backward-compatible (the `cognigy-mcp` bin is additive; the launcher imports `dist/index.js` directly). No action.
- **Claude Code plugin users (old version):** stay on their pinned plugin; the cached `launch.mjs` still works (installs the pinned engine, still on npm). They get the npx-based plugin only after enabling marketplace auto-update or running `/plugin update`. Not broken. Item 4 fixes propagation going forward.
- **Desktop marketplace/plugin users:** none existed pre-#10 (the add was broken), so nothing to migrate.

## Files (anticipated)

- New: `install.sh` + `install.ps1` at the **repo root** (bootstraps). Deliberately NOT under `plugin/` — that's the marketplace-scanned surface, and a curl+exec script there could re-trip the #10 Desktop scan. They're for humans to curl, referenced by no manifest. **Still verify** a Desktop marketplace add of the real repo succeeds after these land (a root file _might_ be scanned too).
- `src/setup.ts` — subcommand dispatch; Desktop-only branch; menu labels.
- `src/install/claudeCode.ts` / `claudeDesktop.ts` — uninstall/status helpers; auto-update enable.
- `README.md` — new headline install command + Desktop-only section.
- Tests: subcommand parsing, Desktop-only branch selection, uninstall reversal, bootstrap Node-detection logic (shell — smoke only).

## Non-goals

- No Node auto-install. No native-CLI auto-install. No Codex. No `.mcpb`.

## Open items to verify at implementation

1. Exact current Desktop Code-tab plugin-browser UI steps (screenshots change).
2. Whether `claude` CLI exposes non-interactive per-marketplace auto-update enable.
3. Bootstrap hosting URL (raw `main` vs NiCE domain) + that the bootstrap files don't re-trip Desktop's plugin-file scan.
