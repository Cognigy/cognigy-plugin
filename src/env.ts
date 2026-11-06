#!/usr/bin/env node
/**
 * `cognigy-env` — switch the Cognigy plugin between named environments.
 * Run: `npx -y -p @cognigy/plugin-engine cognigy-env`.
 *
 * Named environments (API base URL + API key) live in
 *   ~/.cognigy-plugin/environments.json
 * and `use` copies the chosen one into
 *   ~/.cognigy-plugin/config.json
 * which the plugin reads when it starts. That sets the default for sessions that
 * start afterwards; it never moves a running session. To switch a running
 * session, ask Claude ("switch to trial"): the plugin's `manage_environments`
 * tool does that live, for that session only.
 *
 * This is the cross-platform port of the original `cognigy-env.py`: same
 * commands, same two files. Both files hold API keys, so both are written
 * owner-only, and no command ever prints a full key.
 */
import { join } from "path";
import { normalizeApiBaseUrl } from "./config.js";
import {
  findEnvironmentName,
  readEnvironmentsFile,
  validateEnvironmentName,
  updateEnvironmentsFile,
  type EnvironmentsFile,
} from "./environmentsFile.js";
import {
  readUserConfigFile,
  USER_CONFIG_DIR,
  writeUserConfigFile,
  type UserConfigFile,
} from "./userConfigFile.js";
import { ask, askHidden, isMainModule, readKey } from "./utils/cli.js";

const URL_KEY = "COGNIGY_API_BASE_URL";
const API_KEY = "COGNIGY_API_KEY";

const USAGE = [
  "cognigy-env — switch the Cognigy plugin between environments",
  "",
  "  cognigy-env                        interactive menu (↑/↓ or j/k, Enter, q)",
  "  cognigy-env add <name> <base-url>  add an environment, or replace one after asking (key prompted, hidden)",
  "  cognigy-env use <name>             make it the default for new sessions (writes config.json)",
  "  cognigy-env save-current <name>    store what config.json currently holds under <name>",
  "  cognigy-env list                   list environments (* = default)",
  "  cognigy-env current                show which environment config.json points at",
  "  cognigy-env remove <name>          delete a stored environment (config.json untouched)",
  "  cognigy-env help                   this text",
  "",
  'To switch a running Claude session, just ask Claude: "switch to <name>".',
];

export interface EnvCliIo {
  out(line: string): void;
  err(line: string): void;
  ask(question: string): Promise<string>;
  askHidden(question: string): Promise<string>;
  /** One key press (raw mode); used by the menu. */
  readKey(): Promise<string>;
  isTTY: boolean;
  /** The directory holding environments.json and config.json. */
  dir: string;
}

/** First 6 and last 4 characters, like the original script; never the full key. */
function mask(key: string): string {
  return key.length > 14 ? `${key.slice(0, 6)}…${key.slice(-4)}` : "…";
}

const stripSlashes = (url: string): string => url.trim().replace(/\/+$/, "");

/** The environments file, `{}` when absent; null (after saying why) when unusable. */
function loadEnvironments(io: EnvCliIo): EnvironmentsFile | null {
  const state = readEnvironmentsFile(join(io.dir, "environments.json"));
  if (state.state === "invalid") {
    io.err(state.reason);
    return null;
  }
  return state.state === "ok" ? state.file : {};
}

/** Change environments.json; on failure say why and return false. */
function save(io: EnvCliIo, change: (file: EnvironmentsFile) => void): boolean {
  try {
    updateEnvironmentsFile(change, join(io.dir, "environments.json"));
    return true;
  } catch (error: any) {
    io.err(String(error?.message ?? error));
    return false;
  }
}

function readConfig(io: EnvCliIo): UserConfigFile {
  return readUserConfigFile(join(io.dir, "config.json"));
}

/** The environment equal to what config.json holds (URL normalised, key exact). */
function activeName(
  file: EnvironmentsFile,
  cfg: UserConfigFile,
): string | null {
  const url = cfg[URL_KEY];
  const key = cfg[API_KEY];
  if (!url || !key) return null;
  for (const [name, entry] of Object.entries(file)) {
    if (
      normalizeApiBaseUrl(entry.apiBaseUrl) === normalizeApiBaseUrl(url) &&
      entry.apiKey === key
    ) {
      return name;
    }
  }
  return null;
}

/** Resolve a typed name to a stored one, or say what is defined. */
function resolveName(
  io: EnvCliIo,
  file: EnvironmentsFile,
  name: string,
): string | null {
  const found = findEnvironmentName(file, name);
  if (found !== undefined) return found;
  const defined = Object.keys(file);
  io.err(
    `Unknown or ambiguous environment "${name}". ` +
      (defined.length > 0
        ? `Defined: ${defined.join(", ")}.`
        : "None are defined yet."),
  );
  return null;
}

const NONE_YET =
  "No environments yet. Add one: cognigy-env add <name> <base-url>";

function activate(io: EnvCliIo, file: EnvironmentsFile, name: string): number {
  const entry = file[name];
  const cfg = readConfig(io); // keeps every other key
  cfg[URL_KEY] = entry.apiBaseUrl;
  cfg[API_KEY] = entry.apiKey;
  writeUserConfigFile(cfg, io.dir);
  io.out(
    `✔ active: ${name}  →  ${entry.apiBaseUrl}   key ${mask(entry.apiKey)}`,
  );
  io.out(
    "  Restart Claude Code (or /mcp → reconnect) so new sessions pick up the change; running sessions are unaffected.",
  );
  io.out(`  To switch a running session, ask Claude: "switch to ${name}".`);
  io.out(
    "  Where a client supplies the credentials itself (such as the Claude Code keychain) this default does not apply; ask Claude to switch instead.",
  );
  return 0;
}

async function cmdAdd(io: EnvCliIo, name?: string, url?: string) {
  if (!name || !url) {
    io.err("Usage: cognigy-env add <name> <base-url>");
    return 1;
  }
  const nameError = validateEnvironmentName(name);
  if (nameError) {
    io.err(nameError);
    return 1;
  }
  const baseUrl = stripSlashes(url);
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("not http(s)");
    }
  } catch {
    io.err(`"${url}" is not an http(s) URL, e.g. https://api-trial.cognigy.ai`);
    return 1;
  }

  const file = loadEnvironments(io);
  if (!file) return 1;

  const stored = findEnvironmentName(file, name) ?? name;

  // Replacing a stored environment needs a deliberate yes, so a mistyped name
  // or a stray Enter can never swap out a working key.
  if (Object.prototype.hasOwnProperty.call(file, stored)) {
    const existing = file[stored];
    io.out(
      `"${stored}" already exists: ${existing.apiBaseUrl}   key ${mask(existing.apiKey)}`,
    );
    const answer = (await io.ask("Replace it? [y/N] ")).trim().toLowerCase();
    if (answer !== "y" && answer !== "yes") {
      io.err("Nothing changed.");
      return 1;
    }
  }

  const apiKey = (await io.askHidden(`API key for ${name} (hidden): `)).trim();
  if (!apiKey) {
    io.err("No key entered; nothing saved.");
    return 1;
  }

  if (
    !save(io, (fresh) => {
      fresh[stored] = { apiBaseUrl: baseUrl, apiKey };
    })
  ) {
    return 1;
  }
  io.out(`✔ saved ${stored}  →  ${baseUrl}   key ${mask(apiKey)}`);
  return 0;
}

function cmdUse(io: EnvCliIo, name?: string) {
  if (!name) {
    io.err("Usage: cognigy-env use <name>");
    return 1;
  }
  const file = loadEnvironments(io);
  if (!file) return 1;
  const stored = resolveName(io, file, name);
  if (!stored) return 1;
  return activate(io, file, stored);
}

function cmdSaveCurrent(io: EnvCliIo, name?: string) {
  if (!name) {
    io.err("Usage: cognigy-env save-current <name>");
    return 1;
  }
  const nameError = validateEnvironmentName(name);
  if (nameError) {
    io.err(nameError);
    return 1;
  }
  const cfg = readConfig(io);
  const url = cfg[URL_KEY]?.trim();
  const key = cfg[API_KEY]?.trim();
  if (!url || !key) {
    io.err("config.json holds no Cognigy credentials to save.");
    return 1;
  }
  const file = loadEnvironments(io);
  if (!file) return 1;
  const stored = findEnvironmentName(file, name) ?? name;
  const entry = { apiBaseUrl: stripSlashes(url), apiKey: key };
  if (
    !save(io, (fresh) => {
      fresh[stored] = entry;
    })
  ) {
    return 1;
  }
  io.out(
    `✔ saved ${stored}  →  ${entry.apiBaseUrl}   key ${mask(entry.apiKey)}`,
  );
  return 0;
}

function cmdList(io: EnvCliIo) {
  const file = loadEnvironments(io);
  if (!file) return 1;
  const names = Object.keys(file);
  if (names.length === 0) {
    io.out(NONE_YET);
    return 0;
  }
  const active = activeName(file, readConfig(io));
  const width = Math.max(...names.map((n) => n.length));
  for (const name of names) {
    io.out(
      `${name === active ? "*" : " "} ${name.padEnd(width)}  ${file[name].apiBaseUrl}`,
    );
  }
  return 0;
}

function cmdCurrent(io: EnvCliIo) {
  const file = loadEnvironments(io);
  if (!file) return 1;
  const cfg = readConfig(io);
  if (!cfg[URL_KEY] || !cfg[API_KEY]) {
    io.out("config.json holds no Cognigy credentials.");
    return 0;
  }
  io.out(
    `${activeName(file, cfg) ?? "(not in environments.json)"}  →  ${cfg[URL_KEY]}`,
  );
  return 0;
}

function cmdRemove(io: EnvCliIo, name?: string) {
  if (!name) {
    io.err("Usage: cognigy-env remove <name>");
    return 1;
  }
  const file = loadEnvironments(io);
  if (!file) return 1;
  const stored = resolveName(io, file, name);
  if (!stored) return 1;
  if (
    !save(io, (fresh) => {
      delete fresh[stored];
    })
  ) {
    return 1;
  }
  io.out(`✔ removed ${stored} (config.json untouched)`);
  return 0;
}

async function cmdMenu(io: EnvCliIo) {
  if (!io.isTTY) {
    USAGE.forEach((l) => io.err(l));
    return 1;
  }
  const file = loadEnvironments(io);
  if (!file) return 1;
  const names = Object.keys(file);
  if (names.length === 0) {
    io.out(NONE_YET);
    return 0;
  }
  const active = activeName(file, readConfig(io));
  const width = Math.max(...names.map((n) => n.length));
  const line = (name: string, i: number, cursor: number) =>
    `${i === cursor ? ">" : " "} ${name === active ? "*" : " "} ${name.padEnd(width)}  ${file[name].apiBaseUrl}`;

  let cursor = Math.max(0, active ? names.indexOf(active) : 0);
  let drawn = 0;
  for (;;) {
    const frame = [
      "Select an environment  (↑/↓ or j/k, Enter to use, q to quit)",
      ...names.map((name, i) => line(name, i, cursor)),
    ];
    // Redraw in place: back up over the previous frame and clear it.
    io.out((drawn ? `\x1b[${drawn}A\x1b[J` : "") + frame.join("\n"));
    drawn = frame.length;

    const key = await io.readKey();
    if (key === "\r" || key === "\n") {
      return activate(io, file, names[cursor]);
    }
    if (key === "q" || key === "\x03" || key === "\x1b") return 0;
    if (key === "\x1b[A" || key === "k") {
      cursor = (cursor - 1 + names.length) % names.length;
    } else if (key === "\x1b[B" || key === "j") {
      cursor = (cursor + 1) % names.length;
    }
  }
}

/** Run one `cognigy-env` invocation; resolves to the process exit code. */
export async function runEnvCli(argv: string[], io: EnvCliIo): Promise<number> {
  const [command, ...args] = argv;
  switch (command) {
    case undefined:
      return cmdMenu(io);
    case "help":
    case "--help":
    case "-h":
      USAGE.forEach((l) => io.out(l));
      return 0;
    case "add":
      return cmdAdd(io, args[0], args[1]);
    case "use":
      return cmdUse(io, args[0]);
    case "save-current":
      return cmdSaveCurrent(io, args[0]);
    case "list":
      return cmdList(io);
    case "current":
      return cmdCurrent(io);
    case "remove":
      return cmdRemove(io, args[0]);
    default:
      io.err(`Unknown command "${command}".`);
      USAGE.forEach((l) => io.err(l));
      return 1;
  }
}

// Run only when invoked as the bin, not when imported (e.g. by tests).
if (isMainModule(import.meta.url, process.argv[1])) {
  const io: EnvCliIo = {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    ask,
    askHidden,
    readKey,
    isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    dir: USER_CONFIG_DIR,
  };
  runEnvCli(process.argv.slice(2), io).then(
    (code) => process.exit(code),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "cancelled") process.exit(130);
      process.stderr.write(`cognigy-env failed: ${message}\n`);
      process.exit(1);
    },
  );
}
