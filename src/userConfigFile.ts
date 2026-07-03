/**
 * On-disk fallback config for clients whose plugin installer does not prompt
 * for `userConfig` (e.g. the GUI app today). The `cognigy-plugin` setup CLI
 * (src/setup.ts) writes this file; `loadConfig()` reads it only when the
 * matching environment variable is absent, so the terminal/keychain path is
 * never overridden.
 *
 * Keys mirror the environment variable names on purpose: the file is just a
 * persisted set of "env vars" the engine would otherwise receive.
 */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export const USER_CONFIG_DIR = join(homedir(), ".cognigy-plugin");
export const USER_CONFIG_FILE = join(USER_CONFIG_DIR, "config.json");

export type UserConfigFile = Record<string, string>;

/**
 * Read the fallback config file. Returns `{}` when the file is absent or
 * unreadable/malformed — callers treat a missing value the same as an unset
 * env var, so a bad file must never throw during server boot.
 */
export function readUserConfigFile(
  path: string = USER_CONFIG_FILE,
): UserConfigFile {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: UserConfigFile = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "string") out[k] = v;
      }
      return out;
    }
  } catch {
    // Missing or malformed — behave as if nothing was configured.
  }
  return {};
}

/**
 * Write the fallback config file with owner-only permissions (dir 0700,
 * file 0600) so the API key is not world-readable. Returns the file path.
 */
export function writeUserConfigFile(
  values: UserConfigFile,
  dir: string = USER_CONFIG_DIR,
): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // mkdirSync's mode is ignored when the directory already exists, so
  // re-tighten it in case a pre-existing dir had broader permissions.
  chmodSync(dir, 0o700);
  const file = join(dir, "config.json");
  writeFileSync(file, `${JSON.stringify(values, null, 2)}\n`, { mode: 0o600 });
  // writeFileSync's mode is likewise ignored when the file already exists.
  chmodSync(file, 0o600);
  return file;
}
