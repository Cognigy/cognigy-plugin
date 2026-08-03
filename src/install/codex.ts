/**
 * Install the Cognigy MCP server into ChatGPT + Codex. OpenAI merged the
 * standalone Codex app into the ChatGPT desktop app (July 2026), and one
 * `~/.codex/config.toml` serves that app, the Codex CLI, and the IDE
 * extension, so a single `codex mcp add` wires all three. We never write the TOML ourselves —
 * the codex CLI owns it; without the CLI we print the exact command and a
 * config snippet for the user to apply.
 *
 * Credentials are NOT put in config.toml (it has no keychain): the installer
 * writes ~/.cognigy-plugin/config.json and the engine falls back to it when
 * the env vars are absent (src/config.ts).
 *
 * The engine spec is `@latest` (not the release pin): config.toml is a
 * user-global file never re-synced by our releases — same auto-update
 * philosophy as the Claude Desktop launcher. The alias form is still required
 * (repo-name collision → `cognigy-mcp: command not found`, MCP -32000).
 *
 * Skills arrive separately via Codex's plugin system: `codex plugin
 * marketplace add Cognigy/cognigy-plugin` (log-and-continue — older Codex
 * versions lack the subcommand), then the user installs "cognigy" in the
 * `/plugins` TUI.
 */
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { UserConfigFile } from "../userConfigFile.js";
import { writeUserConfigFile } from "../userConfigFile.js";
import { detectOnPath, runCliTool } from "./cliRunner.js";

const SERVER_KEY = "cognigy";
const MARKETPLACE = "Cognigy/cognigy-plugin";
const ENGINE_SPEC = "cognigy-engine@npm:@cognigy/plugin-engine@latest";

export const CODEX_CONFIG_PATH = join(homedir(), ".codex", "config.toml");

/** Resolve `codex` on PATH, or null. */
export function detectCodexPath(): string | null {
  return detectOnPath("codex");
}

/** `codex mcp add cognigy -- npx …` — writes [mcp_servers.cognigy] for us. */
export function buildCodexMcpAddArgs(): string[] {
  return [
    "mcp",
    "add",
    SERVER_KEY,
    "--",
    "npx",
    "-y",
    "-p",
    ENGINE_SPEC,
    "cognigy-mcp",
  ];
}

/** `codex mcp remove cognigy`. */
export function buildCodexMcpRemoveArgs(): string[] {
  return ["mcp", "remove", SERVER_KEY];
}

/** `codex plugin marketplace add <owner/repo>` — makes skills installable. */
export function buildCodexMarketplaceAddArgs(): string[] {
  return ["plugin", "marketplace", "add", MARKETPLACE];
}

/** The [mcp_servers.cognigy] block a user pastes when the CLI isn't there. */
export function codexConfigSnippet(): string {
  return [
    `[mcp_servers.${SERVER_KEY}]`,
    `command = "npx"`,
    `args = ["-y", "-p", "${ENGINE_SPEC}", "cognigy-mcp"]`,
  ].join("\n");
}

/** Whether ~/.codex/config.toml already has our server (string probe only). */
export function codexHasCognigyEntry(
  configPath: string = CODEX_CONFIG_PATH,
): boolean {
  if (!existsSync(configPath)) return false;
  try {
    return /^\[mcp_servers\.cognigy\]/m.test(readFileSync(configPath, "utf8"));
  } catch {
    return false;
  }
}

export type CodexMethod = "cli" | "fallback";

export interface CodexResult {
  method: CodexMethod;
  /** Always written — the engine's only cred source for Codex. */
  configFile: string;
  /** Fallback only: the command + TOML snippet to apply by hand. */
  commands?: string[];
}

/** Manual steps when the codex CLI isn't on PATH. */
export function codexFallbackCommands(): string[] {
  return [
    `codex mcp add ${SERVER_KEY} -- npx -y -p ${ENGINE_SPEC} cognigy-mcp`,
    `— or add to ${CODEX_CONFIG_PATH}:\n${codexConfigSnippet()}`,
  ];
}

/**
 * Install into Codex. Creds file first, always (config.toml never carries
 * secrets). CLI present → `mcp add` (throws on failure — the creds file is
 * already in place, so the error message can point at the manual commands);
 * then `plugin marketplace add` log-and-continue. CLI absent → manual steps.
 */
export function installCodex(creds: UserConfigFile): CodexResult {
  const configFile = writeUserConfigFile(creds);
  const codexPath = detectCodexPath();

  if (!codexPath) {
    return {
      method: "fallback",
      configFile,
      commands: codexFallbackCommands(),
    };
  }

  const add = runCliTool("codex", codexPath, buildCodexMcpAddArgs());
  if (add.status !== 0 || add.error) {
    const reason = add.error ? add.error.message : `exit ${add.status}`;
    throw new Error(
      `'codex mcp add' failed (${reason}). Creds are in ${configFile}; ` +
        `wire the server by hand:\n  ${codexFallbackCommands().join("\n  ")}`,
    );
  }

  // Older Codex builds (< 0.117.0) have no plugin subcommand — log-and-continue;
  // tools already work via the mcp add above.
  const mp = runCliTool("codex", codexPath, buildCodexMarketplaceAddArgs());
  if (mp.status !== 0 || mp.error) {
    process.stderr.write(
      `[cognigy] 'codex plugin marketplace add ${MARKETPLACE}' exited ${mp.status}; ` +
        "skills need Codex >= 0.117.0 — tools are wired regardless.\n",
    );
  }

  return { method: "cli", configFile };
}

export interface CodexUninstallResult {
  method: CodexMethod;
  /** CLI only: whether `mcp remove` actually removed the entry (exit 0). */
  removedServer?: boolean;
  /** Fallback only: manual steps. */
  commands?: string[];
}

/**
 * Remove the config.toml server entry via the CLI; else manual instructions.
 * Plugin/skills removal stays a printed `/plugins` step either way — there is
 * no non-interactive plugin uninstall.
 */
export function uninstallCodex(): CodexUninstallResult {
  const codexPath = detectCodexPath();
  if (!codexPath) {
    return {
      method: "fallback",
      commands: [
        `codex mcp remove ${SERVER_KEY}`,
        `— or delete the [mcp_servers.${SERVER_KEY}] block from ${CODEX_CONFIG_PATH}`,
      ],
    };
  }
  const rm = runCliTool("codex", codexPath, buildCodexMcpRemoveArgs());
  const removedServer = rm.status === 0 && !rm.error;
  if (!removedServer) {
    process.stderr.write(
      `[cognigy] 'codex mcp remove ${SERVER_KEY}' did not remove anything (exit ${rm.status}); continuing.\n`,
    );
  }
  return { method: "cli", removedServer };
}
