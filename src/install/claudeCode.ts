/**
 * Install the Cognigy plugin into Claude Code (terminal + desktop/GUI — one path
 * via the `claude` CLI). When `claude` is on PATH we drive the plugin CLI, which
 * routes the API key to the OS keychain via `--config`. When it isn't (some
 * IDE/desktop installs don't expose the CLI), we fall back to writing the
 * ~/.cognigy-plugin/config.json creds file and printing the `/plugin` commands
 * for the user to paste in-app.
 */
import { spawnSync } from "child_process";
import type { UserConfigFile } from "../userConfigFile.js";
import { writeUserConfigFile } from "../userConfigFile.js";
import { quoteWinArgs } from "./npmRunner.js";

const MARKETPLACE = "Cognigy/cognigy-plugin";
const MARKETPLACE_NAME = "cognigy-plugin";
const PLUGIN_ID = "cognigy@cognigy-plugin";

const isWin = process.platform === "win32";

/** `claude plugin marketplace add <owner/repo>` — idempotent (no-op if present). */
export function buildMarketplaceAddArgs(): string[] {
  return ["plugin", "marketplace", "add", MARKETPLACE];
}

/** `claude plugin update <id>` — pull the latest plugin version. */
export function buildPluginUpdateArgs(): string[] {
  return ["plugin", "update", PLUGIN_ID];
}

/** `claude plugin uninstall <id>`. */
export function buildPluginUninstallArgs(): string[] {
  return ["plugin", "uninstall", PLUGIN_ID];
}

/** `claude plugin marketplace remove <name>`. */
export function buildMarketplaceRemoveArgs(): string[] {
  return ["plugin", "marketplace", "remove", MARKETPLACE_NAME];
}

/** `claude plugin install <id> --scope user --config k=v ...`. */
export function buildPluginInstallArgs(creds: UserConfigFile): string[] {
  return [
    "plugin",
    "install",
    PLUGIN_ID,
    "--scope",
    "user",
    "--config",
    `cognigy_api_base_url=${creds.COGNIGY_API_BASE_URL ?? ""}`,
    "--config",
    `cognigy_api_key=${creds.COGNIGY_API_KEY ?? ""}`,
  ];
}

/** Resolve `claude` on PATH, or null. */
export function detectClaudePath(): string | null {
  const finder = isWin ? "where" : "which";
  const res = spawnSync(finder, ["claude"], { encoding: "utf8" });
  if (res.status !== 0 || !res.stdout) return null;
  const first = res.stdout.split(/\r?\n/).find((l) => l.trim());
  return first ? first.trim() : null;
}

function runClaude(claudePath: string, args: string[]) {
  // claude is a .cmd shim on Windows → needs shell:true + arg quoting (the
  // CVE-2024-27980 lesson). Under a shell the *command* isn't auto-quoted either,
  // so an absolute path with spaces (e.g. under "Program Files") would break —
  // use the bare `claude` name on Windows (PATH already resolved it, since
  // `where` succeeded) and reserve the absolute path for non-Windows.
  // stdin ignored so a stray prompt can't hang the run.
  const command = isWin ? "claude" : claudePath;
  return spawnSync(command, isWin ? quoteWinArgs(args) : args, {
    stdio: ["ignore", "inherit", "inherit"],
    shell: isWin,
  });
}

export type ClaudeCodeMethod = "cli" | "fallback";

export interface ClaudeCodeResult {
  method: ClaudeCodeMethod;
  /** Fallback only: creds file written + commands to paste in-app. */
  configFile?: string;
  commands?: string[];
}

/** The `/plugin` commands a user pastes in-app when the CLI isn't available. */
export function fallbackCommands(): string[] {
  return [
    `/plugin marketplace add ${MARKETPLACE}`,
    `/plugin install ${PLUGIN_ID}`,
  ];
}

/**
 * Install into Claude Code. Uses the CLI when present; otherwise writes the
 * creds file and returns the manual commands. Throws only if the CLI is present
 * but the install step fails outright (after already writing the creds fallback
 * so the user isn't left with nothing).
 */
export function installClaudeCode(creds: UserConfigFile): ClaudeCodeResult {
  const claudePath = detectClaudePath();

  if (!claudePath) {
    const configFile = writeUserConfigFile(creds);
    return { method: "fallback", configFile, commands: fallbackCommands() };
  }

  // Idempotent — a pre-existing marketplace exits 0. Log-and-continue on error
  // rather than abort; the install step below surfaces a real failure.
  const add = runClaude(claudePath, buildMarketplaceAddArgs());
  if (add.status !== 0) {
    process.stderr.write(
      `[cognigy] 'plugin marketplace add ${MARKETPLACE_NAME}' exited ${add.status}; continuing.\n`,
    );
  }

  const install = runClaude(claudePath, buildPluginInstallArgs(creds));
  if (install.status !== 0 || install.error) {
    // Leave the user a working fallback before surfacing the failure.
    const configFile = writeUserConfigFile(creds);
    const reason = install.error
      ? install.error.message
      : `exit ${install.status}`;
    throw new Error(
      `'claude plugin install' failed (${reason}). Wrote creds to ${configFile}; ` +
        `paste these in Claude Code instead:\n  ${fallbackCommands().join("\n  ")}`,
    );
  }

  return { method: "cli" };
}

/** `/plugin` commands to update / uninstall by hand when the CLI isn't present. */
export function updateFallbackCommands(): string[] {
  return [`/plugin update ${PLUGIN_ID}`];
}
export function uninstallFallbackCommands(): string[] {
  return [
    `/plugin uninstall ${PLUGIN_ID}`,
    `/plugin marketplace remove ${MARKETPLACE_NAME}`,
  ];
}

/** The one-time toggle that opts a third-party marketplace into auto-update. */
export function autoUpdateHint(): string {
  return `/plugin → Marketplaces → ${MARKETPLACE_NAME} → enable auto-update`;
}

export interface ClaudeCodeActionResult {
  method: ClaudeCodeMethod;
  commands?: string[];
}

/** Update the plugin via the CLI when present; else return the manual command. */
export function updateClaudeCode(): ClaudeCodeActionResult {
  const claudePath = detectClaudePath();
  if (!claudePath)
    return { method: "fallback", commands: updateFallbackCommands() };
  const res = runClaude(claudePath, buildPluginUpdateArgs());
  if (res.status !== 0 || res.error) {
    const reason = res.error ? res.error.message : `exit ${res.status}`;
    throw new Error(`'claude plugin update' failed (${reason}).`);
  }
  return { method: "cli" };
}

/** Uninstall the plugin + remove the marketplace via the CLI; else manual. */
export function uninstallClaudeCode(): ClaudeCodeActionResult {
  const claudePath = detectClaudePath();
  if (!claudePath)
    return { method: "fallback", commands: uninstallFallbackCommands() };
  // Uninstall the plugin first, then the marketplace. Log-and-continue on the
  // plugin step so a "not installed" state still lets us drop the marketplace.
  const un = runClaude(claudePath, buildPluginUninstallArgs());
  if (un.status !== 0) {
    process.stderr.write(
      `[cognigy] 'plugin uninstall ${PLUGIN_ID}' exited ${un.status}; continuing.\n`,
    );
  }
  runClaude(claudePath, buildMarketplaceRemoveArgs());
  return { method: "cli" };
}
