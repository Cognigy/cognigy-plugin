/**
 * Install the Cognigy MCP server into the standalone Claude Desktop app.
 *
 * Desktop launches MCP servers by command from claude_desktop_config.json. It
 * has no keychain and no `${user_config}` interpolation, so credentials are
 * stored literally in that file (a Desktop limitation) and the file is tightened
 * to 0600 after writing.
 *
 * Rather than point the config at `npx` (which GUI apps' minimal PATH often
 * can't resolve) or at the versioned engine's dist/index.js (which would freeze
 * the version), we point it at an absolute node + our Desktop launcher, which
 * auto-updates the engine on every boot. See desktopLauncher.ts.
 */
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import { join } from "path";
import type { UserConfigFile } from "../userConfigFile.js";
import { runNpm } from "./npmRunner.js";
import {
  DESKTOP_LAUNCHER_FILE,
  USER_HOME_DIR,
  writeDesktopLauncher,
} from "./desktopLauncher.js";

const PKG = "@cognigy/plugin-engine";
export const ENGINE_PREFIX = join(USER_HOME_DIR, "engine");

export interface DesktopServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * Resolve the platform's claude_desktop_config.json path. `env` and `home` are
 * injectable for testing; defaults read the real process.
 */
export function resolveDesktopConfigPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  if (platform === "win32") {
    const appData = env.APPDATA || join(home, "AppData", "Roaming");
    return join(appData, "Claude", "claude_desktop_config.json");
  }
  if (platform === "darwin") {
    return join(
      home,
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json",
    );
  }
  // Linux and anything else.
  return join(home, ".config", "claude-desktop", "claude_desktop_config.json");
}

/** Build the `mcpServers.cognigy` entry: absolute node + launcher + creds env. */
export function buildDesktopServerEntry(
  creds: UserConfigFile,
  nodePath: string = process.execPath,
  launcherPath: string = DESKTOP_LAUNCHER_FILE,
): DesktopServerEntry {
  return {
    command: nodePath,
    args: [launcherPath],
    env: {
      COGNIGY_API_BASE_URL: creds.COGNIGY_API_BASE_URL ?? "",
      COGNIGY_API_KEY: creds.COGNIGY_API_KEY ?? "",
    },
  };
}

/**
 * Merge our server entry into existing config text, preserving every other
 * server and top-level key. `existingText` is the raw file contents (or null
 * when the file is absent). A malformed/non-object file is treated as empty so
 * we never throw — but callers should back it up first. Returns pretty JSON.
 */
export function mergeDesktopConfig(
  existingText: string | null,
  entry: DesktopServerEntry,
): string {
  let root: Record<string, unknown> = {};
  if (existingText && existingText.trim()) {
    try {
      const parsed: unknown = JSON.parse(existingText);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        root = parsed as Record<string, unknown>;
      }
    } catch {
      // Malformed — start fresh (caller has backed the original up).
    }
  }
  const existingServers = root.mcpServers;
  const servers: Record<string, unknown> =
    existingServers &&
    typeof existingServers === "object" &&
    !Array.isArray(existingServers)
      ? (existingServers as Record<string, unknown>)
      : {};
  root.mcpServers = { ...servers, cognigy: entry };
  return `${JSON.stringify(root, null, 2)}\n`;
}

export interface DesktopInstallResult {
  configPath: string;
  backupPath?: string;
  launcherPath: string;
  enginePrefix: string;
}

/**
 * Full Desktop install: install the engine into the per-user prefix, write the
 * launcher, then merge the server entry into claude_desktop_config.json
 * (backing up any existing file first). Throws on a hard failure.
 */
export function installClaudeDesktop(
  creds: UserConfigFile,
  configPath: string = resolveDesktopConfigPath(),
): DesktopInstallResult {
  // 1. Install the engine into the per-user prefix (avoids global perms).
  mkdirSync(ENGINE_PREFIX, { recursive: true, mode: 0o700 });
  const res = runNpm([
    "install",
    `${PKG}@latest`,
    "--prefix",
    ENGINE_PREFIX,
    "--no-fund",
    "--no-audit",
    "--loglevel=error",
  ]);
  if (res.status !== 0 || res.error) {
    const reason = res.error ? res.error.message : `exit ${res.status}`;
    throw new Error(
      `Failed to install ${PKG} into ${ENGINE_PREFIX} (${reason}). ` +
        `Check network/registry access and retry.`,
    );
  }

  // 2. Write the auto-updating launcher.
  const launcherPath = writeDesktopLauncher();

  // 3. Merge the server entry into the Desktop config (backup existing first).
  const dir = join(configPath, "..");
  mkdirSync(dir, { recursive: true });
  let backupPath: string | undefined;
  let existingText: string | null = null;
  if (existsSync(configPath)) {
    existingText = readFileSync(configPath, "utf-8");
    backupPath = `${configPath}.bak`;
    // Keep the first backup pristine: a re-run's config already contains our
    // merged entry, so overwriting .bak would discard the user's original.
    if (!existsSync(backupPath)) copyFileSync(configPath, backupPath);
  }
  const merged = mergeDesktopConfig(
    existingText,
    buildDesktopServerEntry(creds, process.execPath, launcherPath),
  );
  writeFileSync(configPath, merged, { mode: 0o600 });
  // Creds live in this file in plaintext — keep it owner-only.
  chmodSync(configPath, 0o600);

  return { configPath, backupPath, launcherPath, enginePrefix: ENGINE_PREFIX };
}
