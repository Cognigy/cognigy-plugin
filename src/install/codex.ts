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
 *   codex plugin marketplace add Cognigy/cognigy-plugin --ref main
 *   codex plugin add cognigy@cognigy-plugin
 * Without the CLI we print the equivalent GUI steps.
 *
 * `--ref main` is not optional, and it is what makes updates work at all.
 * Codex auto-upgrades git marketplaces on plugin startup (openai/codex#17425,
 * default-on since April 2026): it runs `git ls-remote`, compares against the
 * recorded `last_revision`, and replaces the cached plugin when the ref has
 * moved. A new plugin.json then carries a new exact engine pin, so npx fetches
 * the matching engine — the whole chain updates on its own.
 *
 * That only holds if the ref MOVES. Given a bare `owner/repo`, Codex resolves
 * the ref from the git checkout it is invoked in, so running the installer
 * from a clone of THIS repo on a feature branch pins the marketplace to that
 * branch. Once the branch merges and stops moving, `ls-remote` keeps returning
 * the same revision and auto-upgrade correctly does nothing — forever.
 * Observed live: a snapshot stuck at 1.8.3 while npm and main were at 1.10.0.
 *
 * So the fix is the pin, not a manual update path. `updateCodex` exists only
 * to force the refresh immediately rather than at the next app start.
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
/** The only ref users should ever be pinned to. See the note at the top. */
export const MARKETPLACE_REF = "main";
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

/** `codex plugin marketplace add Cognigy/cognigy-plugin --ref main`. */
export function buildCodexMarketplaceAddArgs(): string[] {
  return [
    "plugin",
    "marketplace",
    "add",
    MARKETPLACE_SOURCE,
    "--ref",
    MARKETPLACE_REF,
  ];
}

/** `codex plugin marketplace upgrade` — refresh every git snapshot. */
export function buildCodexMarketplaceUpgradeArgs(): string[] {
  return ["plugin", "marketplace", "upgrade"];
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

/**
 * The ref our marketplace is currently pinned to, or null when it is not
 * registered as a git source (absent, or a local path a developer wired by
 * hand — which we must leave alone).
 *
 * Scoped to the `[marketplaces.cognigy-plugin]` table on purpose: config.toml
 * is the user's file and holds unrelated secrets, so we read the one block we
 * own and never parse or rewrite the rest (the codex CLI does the writing).
 */
export function readCodexMarketplaceRef(
  configPath: string = CODEX_CONFIG_PATH,
): string | null {
  if (!existsSync(configPath)) return null;
  let block: string;
  try {
    const toml = readFileSync(configPath, "utf8");
    const start = toml.search(
      new RegExp(`^\\[marketplaces\\.${MARKETPLACE_NAME}\\]`, "m"),
    );
    if (start === -1) return null;
    const rest = toml.slice(start);
    // Index 0 is our own table header, so search from 1 for the next one.
    const next = rest.slice(1).search(/^\[/m);
    block = next === -1 ? rest : rest.slice(0, next + 1);
  } catch {
    return null;
  }
  if (!/^source_type\s*=\s*"git"/m.test(block)) return null;
  return /^ref\s*=\s*"([^"]*)"/m.exec(block)?.[1] ?? null;
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

  // A marketplace already registered under this name from a *different* source
  // string makes `marketplace add` a hard error, so a stale git ref would
  // survive every re-run of the installer — and `marketplace upgrade` would
  // keep reporting it up to date, because a merged branch really is. Drop the
  // registration first so the add below can re-pin it to main. Only for git
  // sources on the wrong ref: a local source is a developer's own wiring.
  const ref = readCodexMarketplaceRef();
  if (ref !== null && ref !== MARKETPLACE_REF) {
    process.stderr.write(
      `[cognigy] marketplace '${MARKETPLACE_NAME}' is pinned to '${ref}'; ` +
        `re-pinning to '${MARKETPLACE_REF}' so updates can reach you.\n`,
    );
    // The plugin holds a reference to the marketplace, so it goes first.
    runCliTool("codex", codexPath, buildCodexPluginRemoveArgs());
    runCliTool("codex", codexPath, buildCodexMarketplaceRemoveArgs());
  }

  // Re-adding the SAME source exits 0; anything else is not fatal for us,
  // because the marketplace we need is registered either way. Fall through and
  // let `plugin add` be the judge.
  const mp = runCliTool("codex", codexPath, buildCodexMarketplaceAddArgs());
  if (mp.status !== 0 || mp.error) {
    process.stderr.write(
      `[cognigy] 'codex ${buildCodexMarketplaceAddArgs().join(" ")}' exited ${mp.status}; ` +
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

export interface CodexUpdateResult {
  method: CodexMethod;
  /** Whether the git snapshot refresh succeeded. */
  refreshed?: boolean;
  /** Whether re-adding the plugin from the refreshed snapshot succeeded. */
  reinstalled?: boolean;
}

/**
 * Update the Codex install. Neither half of it auto-updates: the marketplace
 * is a pinned git snapshot, and the manifest pins the engine to an exact
 * version. So refresh the snapshot, then re-add the plugin — `plugin add` is
 * idempotent and copies the snapshot's current version into a versioned cache
 * directory, which is what actually moves the installed version forward.
 */
export function updateCodex(): CodexUpdateResult {
  // Without the CLI there is nothing to fall back to, and nothing to worry
  // about: Codex refreshes the marketplace itself when plugins next start up.
  // Printing `codex ...` commands to someone who has no `codex` would be worse
  // than saying so — the caller reports the restart instead.
  const codexPath = detectCodexPath();
  if (!codexPath) return { method: "fallback" };

  const up = runCliTool("codex", codexPath, buildCodexMarketplaceUpgradeArgs());
  const refreshed = up.status === 0 && !up.error;

  const add = runCliTool("codex", codexPath, buildCodexPluginAddArgs());
  const reinstalled = add.status === 0 && !add.error;

  return { method: "cli", refreshed, reinstalled };
}
