/**
 * Install the Cognigy extension into Google Gemini CLI via
 * `gemini extensions install` (GitHub Releases channel — the release asset
 * cognigy-gemini-extension.zip carries gemini-extension.json at archive root,
 * see scripts/build-gemini-extension.mjs).
 *
 * Credentials: Gemini passes ONLY declared env vars to extension MCP servers
 * (the shell env never reaches them), so the installer always writes
 * ~/.cognigy-plugin/config.json — the engine's file fallback (src/config.ts)
 * is the load-bearing cred channel here. `--skip-settings` suppresses the
 * extension's own install-time prompts (manual installs keep them and get the
 * OS-keychain flow instead).
 */
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { UserConfigFile } from "../userConfigFile.js";
import { writeUserConfigFile } from "../userConfigFile.js";
import { detectOnPath, runCliTool } from "./cliRunner.js";

const EXTENSION_NAME = "cognigy";
const REPO_URL = "https://github.com/Cognigy/cognigy-plugin";

export const GEMINI_EXT_DIR = join(
  homedir(),
  ".gemini",
  "extensions",
  EXTENSION_NAME,
);

/** Resolve `gemini` on PATH, or null. */
export function detectGeminiPath(): string | null {
  return detectOnPath("gemini");
}

/**
 * `gemini extensions install <repo> …`. `--consent` skips the trust prompt
 * (the user already consented by running our installer); `--skip-settings`
 * because creds live in the creds file, not extension settings.
 */
export function buildGeminiInstallArgs(): string[] {
  return [
    "extensions",
    "install",
    REPO_URL,
    "--auto-update",
    "--consent",
    "--skip-settings",
  ];
}

/** `gemini extensions update cognigy`. */
export function buildGeminiUpdateArgs(): string[] {
  return ["extensions", "update", EXTENSION_NAME];
}

/** `gemini extensions uninstall cognigy`. */
export function buildGeminiUninstallArgs(): string[] {
  return ["extensions", "uninstall", EXTENSION_NAME];
}

/** Version of the installed extension, or null (mirrors the Desktop probe). */
export function installedGeminiExtensionVersion(
  extDir: string = GEMINI_EXT_DIR,
): string | null {
  const manifest = join(extDir, "gemini-extension.json");
  if (!existsSync(manifest)) return null;
  try {
    const parsed = JSON.parse(readFileSync(manifest, "utf8"));
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

export type GeminiMethod = "cli" | "fallback";

export interface GeminiResult {
  method: GeminiMethod;
  /** Always written — Gemini extension servers never see the shell env. */
  configFile: string;
  /** Fallback only: the command to run by hand. */
  commands?: string[];
}

/** Manual step when the gemini CLI isn't on PATH. */
export function geminiFallbackCommands(): string[] {
  return [`gemini extensions install ${REPO_URL}`];
}

/**
 * Install into Gemini CLI. Creds file first, always. CLI present → run the
 * install (throws on failure with the manual command); absent → manual step.
 */
export function installGemini(creds: UserConfigFile): GeminiResult {
  const configFile = writeUserConfigFile(creds);
  const geminiPath = detectGeminiPath();

  if (!geminiPath) {
    return {
      method: "fallback",
      configFile,
      commands: geminiFallbackCommands(),
    };
  }

  const res = runCliTool("gemini", geminiPath, buildGeminiInstallArgs());
  if (res.status !== 0 || res.error) {
    const reason = res.error ? res.error.message : `exit ${res.status}`;
    throw new Error(
      `'gemini extensions install' failed (${reason}). Creds are in ${configFile}; ` +
        `install by hand:\n  ${geminiFallbackCommands().join("\n  ")}`,
    );
  }

  return { method: "cli", configFile };
}

export interface GeminiActionResult {
  method: GeminiMethod;
  commands?: string[];
}

/** Update the extension via the CLI when present; else the manual command. */
export function updateGemini(): GeminiActionResult {
  const geminiPath = detectGeminiPath();
  if (!geminiPath) {
    return {
      method: "fallback",
      commands: [`gemini extensions update ${EXTENSION_NAME}`],
    };
  }
  const res = runCliTool("gemini", geminiPath, buildGeminiUpdateArgs());
  if (res.status !== 0 || res.error) {
    const reason = res.error ? res.error.message : `exit ${res.status}`;
    throw new Error(`'gemini extensions update' failed (${reason}).`);
  }
  return { method: "cli" };
}

export interface GeminiUninstallResult {
  method: GeminiMethod;
  /** CLI only: whether the uninstall actually removed the extension. */
  removedExtension?: boolean;
  commands?: string[];
}

/** Uninstall via the CLI when present; else the manual command. */
export function uninstallGemini(): GeminiUninstallResult {
  const geminiPath = detectGeminiPath();
  if (!geminiPath) {
    return {
      method: "fallback",
      commands: [`gemini extensions uninstall ${EXTENSION_NAME}`],
    };
  }
  const res = runCliTool("gemini", geminiPath, buildGeminiUninstallArgs());
  const removedExtension = res.status === 0 && !res.error;
  if (!removedExtension) {
    process.stderr.write(
      `[cognigy] 'gemini extensions uninstall ${EXTENSION_NAME}' did not remove anything (exit ${res.status}); continuing.\n`,
    );
  }
  return { method: "cli", removedExtension };
}
