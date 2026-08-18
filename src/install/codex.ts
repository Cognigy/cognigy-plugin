/**
 * Install the Cognigy plugin into ChatGPT + Codex. OpenAI merged the
 * standalone Codex app into the ChatGPT desktop app (July 2026), and one
 * `~/.codex/config.toml` serves that app, the Codex CLI, and the IDE
 * extension, so a single install reaches all three.
 *
 * We deliberately do NOT write a global `[mcp_servers.cognigy]` entry. The
 * plugin already declares its own `platform` server (plugin/.codex-plugin/
 * mcp.json) and Codex starts it once the plugin is installed, so a global
 * entry would be a second copy of the same engine — 32 tools in the picker for
 * 16 real ones, against a tool surface kept deliberately small. Claude Code
 * works the same way: the plugin is the whole install.
 *
 * Credentials are the one thing Codex cannot supply. config.toml has no
 * keychain and Codex has no `userConfig` equivalent (no `${...}` interpolation
 * anywhere in its manifest loader), so the plugin's server entry carries no
 * `env` and the engine reads ~/.cognigy-plugin/config.json instead
 * (src/config.ts).
 *
 * Everything else is `codex plugin`, which is fully non-interactive:
 *   codex plugin marketplace add Cognigy/cognigy-plugin
 *   codex plugin add cognigy@cognigy-plugin
 * Without the CLI we print the equivalent GUI steps.
 */
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { UserConfigFile } from "../userConfigFile.js";
import { writeUserConfigFile } from "../userConfigFile.js";
import { detectOnPath, runCliTool } from "./cliRunner.js";

const PLUGIN_NAME = "cognigy";
/** Marketplace *source* — what `marketplace add` takes (owner/repo). */
const MARKETPLACE_SOURCE = "Cognigy/cognigy-plugin";
/**
 * Marketplace *name* — the `name` field of .claude-plugin/marketplace.json,
 * which is what Codex registers it as and what `marketplace remove` takes.
 * Not interchangeable with the source above.
 */
const MARKETPLACE_NAME = "cognigy-plugin";
/** Plugin selector for `plugin add` / `plugin remove`. */
const PLUGIN_SELECTOR = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;

export const CODEX_CONFIG_PATH = join(homedir(), ".codex", "config.toml");

/** Resolve `codex` on PATH, or null. */
export function detectCodexPath(): string | null {
  return detectOnPath("codex");
}

/** `codex plugin marketplace add Cognigy/cognigy-plugin`. */
export function buildCodexMarketplaceAddArgs(): string[] {
  return ["plugin", "marketplace", "add", MARKETPLACE_SOURCE];
}

/** `codex plugin marketplace remove cognigy-plugin` (by name, not source). */
export function buildCodexMarketplaceRemoveArgs(): string[] {
  return ["plugin", "marketplace", "remove", MARKETPLACE_NAME];
}

/** `codex plugin add cognigy@cognigy-plugin`. */
export function buildCodexPluginAddArgs(): string[] {
  return ["plugin", "add", PLUGIN_SELECTOR];
}

/** `codex plugin remove cognigy@cognigy-plugin`. */
export function buildCodexPluginRemoveArgs(): string[] {
  return ["plugin", "remove", PLUGIN_SELECTOR];
}

/**
 * Whether the plugin looks installed. Codex records installed plugins in
 * config.toml as `[plugins."<name>@<marketplace>"]`; a string probe is enough
 * (we never parse or write that TOML — the codex CLI owns it).
 */
export function codexHasCognigyPlugin(
  configPath: string = CODEX_CONFIG_PATH,
): boolean {
  if (!existsSync(configPath)) return false;
  try {
    return new RegExp(`^\\[plugins\\."${PLUGIN_SELECTOR}"\\]`, "m").test(
      readFileSync(configPath, "utf8"),
    );
  } catch {
    return false;
  }
}

/** The in-app steps, for when the codex CLI isn't available. */
export function codexGuiSteps(): string[] {
  return [
    "Click Plugins in the sidebar of the ChatGPT app.",
    "Click Add at the top right, then 'Add a Marketplace'.",
    `Enter ${MARKETPLACE_SOURCE} as the source and click 'Add Marketplace'.`,
    "Click Install on the Cognigy plugin.",
  ];
}

export type CodexMethod = "cli" | "fallback";

export interface CodexResult {
  method: CodexMethod;
  /** Always written — the plugin's server has no env, so this is its only source. */
  configFile: string;
  /** CLI path: whether the plugin itself got installed. */
  installedPlugin?: boolean;
  /** Fallback path: the in-app steps to follow instead. */
  guiSteps?: string[];
}

/**
 * Install into Codex: creds file first (it is the load-bearing part and must
 * exist before the server ever boots), then register the marketplace and
 * install the plugin. Never throws — if the CLI half fails the user can finish
 * in the app, and the printed steps say so.
 */
export function installCodex(creds: UserConfigFile): CodexResult {
  const configFile = writeUserConfigFile(creds);
  const codexPath = detectCodexPath();

  if (!codexPath) {
    return { method: "fallback", configFile, guiSteps: codexGuiSteps() };
  }

  // Re-adding the SAME source exits 0, but a marketplace already registered
  // under this name from a *different* source string — the HTTPS URL the GUI
  // writes, or a branch ref used for testing — is a hard error. That is not a
  // failure for us: the marketplace we need is there either way, so fall
  // through and let `plugin add` be the judge.
  const mp = runCliTool("codex", codexPath, buildCodexMarketplaceAddArgs());
  if (mp.status !== 0 || mp.error) {
    process.stderr.write(
      `[cognigy] 'codex plugin marketplace add ${MARKETPLACE_SOURCE}' exited ${mp.status}; ` +
        `continuing — '${MARKETPLACE_NAME}' may already be registered from another source.\n`,
    );
  }

  const add = runCliTool("codex", codexPath, buildCodexPluginAddArgs());
  const installedPlugin = add.status === 0 && !add.error;
  if (!installedPlugin) {
    process.stderr.write(
      `[cognigy] 'codex plugin add ${PLUGIN_SELECTOR}' exited ${add.status}; ` +
        "install it from the Plugins directory or /plugins instead.\n",
    );
  }

  return { method: "cli", configFile, installedPlugin };
}

export interface CodexUninstallResult {
  method: CodexMethod;
  /** CLI path: whether the plugin was actually removed. */
  removedPlugin?: boolean;
  /** CLI path: whether the marketplace registration was dropped. */
  removedMarketplace?: boolean;
}

/**
 * Remove the plugin, then the marketplace registration (in that order — a
 * marketplace with an installed plugin still attached is not worth removing
 * first). Without the CLI there is nothing to do here: the caller prints the
 * in-app steps.
 */
export function uninstallCodex(): CodexUninstallResult {
  const codexPath = detectCodexPath();
  if (!codexPath) return { method: "fallback" };

  const rmPlugin = runCliTool("codex", codexPath, buildCodexPluginRemoveArgs());
  const removedPlugin = rmPlugin.status === 0 && !rmPlugin.error;

  const rmMarket = runCliTool(
    "codex",
    codexPath,
    buildCodexMarketplaceRemoveArgs(),
  );
  const removedMarketplace = rmMarket.status === 0 && !rmMarket.error;

  return { method: "cli", removedPlugin, removedMarketplace };
}
