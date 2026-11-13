#!/usr/bin/env node
/**
 * `cognigy-envs`: one arrow-key menu to add, change and delete the extra
 * Cognigy environments the plugin can work with, kept in
 *   ~/.cognigy-plugin/environments.json   { "<name>": { apiBaseUrl, apiKey } }
 *
 * No subcommands to learn. The `default` row is the plugin's own login, set by
 * cognigy-setup; it is shown for reference and never edited here. Keys are
 * typed hidden and never printed in full. Outside a terminal it prints the list.
 */
import { join } from "path";
import {
  DEFAULT_ENVIRONMENT,
  readEnvironmentsFile,
  reservedNameIn,
  updateEnvironmentsFile,
  validateEnvironmentName,
  type EnvironmentsFile,
} from "./environmentsFile.js";
import { readUserConfigFile, USER_CONFIG_DIR } from "./userConfigFile.js";
import {
  askOrEscape,
  bold,
  cyan,
  dim,
  green,
  isMainModule,
  PromptEscaped,
  readKey,
} from "./utils/cli.js";

export interface EnvsIo {
  write(text: string): void;
  /** Both prompts reject with PromptEscaped when the user presses Esc. */
  ask(question: string): Promise<string>;
  askHidden(question: string): Promise<string>;
  /** One key press in raw mode, e.g. "\x1b[A" for the up arrow. */
  readKey(): Promise<string>;
  isTTY: boolean;
  /** The directory holding environments.json and config.json. */
  dir: string;
}

const UP = new Set(["\x1b[A", "\x1bOA", "k"]);
const DOWN = new Set(["\x1b[B", "\x1bOB", "j"]);
const ENTER = new Set(["\r", "\n"]);
const DELETE = new Set(["d", "\x1b[3~"]);
const QUIT = new Set(["q", "\x1b", "\x03"]);
// Clear the screen and home the cursor: each frame redraws from the top, so
// long lines that wrap can never leave a stale frame behind.
const CLEAR = "\x1b[H\x1b[2J";

const LOGO = [
  "┌─┐┌─┐┌─┐┌┐┌┬┌─┐┬ ┬  ┌─┐┌┐┌┬  ┬┌─┐",
  "│  │ ││ ┬│││││ ┬└┬┘  ├┤ │││└┐┌┘└─┐",
  "└─┘└─┘└─┘┘└┘┴└─┘ ┴   └─┘┘└┘ └┘ └─┘",
];
const DEFAULT_NOTE = "the plugin's own login, set with cognigy-setup";

/** First 4 and last 4 characters of a long key; never the whole key. */
function mask(key: string): string {
  return key.length > 12 ? `${key.slice(0, 4)}…${key.slice(-4)}` : "…";
}

/** A typed base URL, scheme optional ("api-trial.cognigy.ai" works); undefined if unusable. */
export function parseBaseUrl(raw: string): string | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text)
    ? text
    : `https://${text}`;
  try {
    const url = new URL(withScheme);
    if (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.hostname
    ) {
      return withScheme.replace(/\/+$/, "");
    }
  } catch {
    // fall through
  }
  return undefined;
}

const nameWidth = (file: EnvironmentsFile) =>
  Math.max(
    DEFAULT_ENVIRONMENT.length,
    ...Object.keys(file).map((n) => n.length),
  );

const defaultUrl = (dir: string) =>
  readUserConfigFile(join(dir, "config.json")).COGNIGY_API_BASE_URL ||
  "(your AI client's plugin settings)";

/** The plain list, printed outside a terminal. */
function list(file: EnvironmentsFile, dir: string): string {
  const width = nameWidth(file);
  return [
    `${DEFAULT_ENVIRONMENT.padEnd(width)}  ${defaultUrl(dir)}  — ${DEFAULT_NOTE}`,
    ...Object.keys(file).map(
      (n) => `${n.padEnd(width)}  ${file[n].apiBaseUrl}`,
    ),
  ].join("\n");
}

/** One screen of the menu: logo, the default login, the environments, help. */
function frame(
  file: EnvironmentsFile,
  dir: string,
  cursor: number,
  status: string,
): string {
  const names = Object.keys(file);
  const width = nameWidth(file);
  const item = (i: number, text: string) =>
    i === cursor ? `  ${cyan("❯")} ${bold(text)}` : `    ${text}`;
  return [
    "",
    ...LOGO.map((line) => `  ${cyan(line)}`),
    "",
    `  ${green("●")} ${bold(DEFAULT_ENVIRONMENT.padEnd(width))}  ${defaultUrl(dir)}`,
    `    ${" ".repeat(width)}  ${dim(DEFAULT_NOTE)}`,
    // Dotted divider from the dot to the end of the note: default above, the rest below.
    `  ${dim("·".repeat(width + DEFAULT_NOTE.length + 4))}`,
    ...names.map((n, i) =>
      item(i, `${n.padEnd(width)}  ${file[n].apiBaseUrl}`),
    ),
    item(names.length, "+ Add an environment"),
    "",
    `  ${dim("↑/↓ move · Enter add or change · d delete · q quit")}`,
    status ? `  ${status.startsWith("✔") ? green(status) : status}` : "",
  ].join("\n");
}

function load(path: string): EnvironmentsFile {
  const state = readEnvironmentsFile(path);
  if (state.state === "invalid") throw new Error(state.reason);
  return state.state === "ok" ? state.file : {};
}

const exists = (file: EnvironmentsFile, name: string) =>
  Object.keys(file).some((n) => n.toLowerCase() === name.toLowerCase());

async function addEnvironment(io: EnvsIo, path: string): Promise<string> {
  const name = (await io.ask("  Name (e.g. trial, acme): ")).trim();
  if (!name) return "Nothing added.";
  const nameError = validateEnvironmentName(name);
  if (nameError) return nameError;
  if (exists(load(path), name))
    return `"${name}" already exists. Select it to change it.`;
  const url = parseBaseUrl(
    await io.ask("  API base URL (e.g. https://api-trial.cognigy.ai): "),
  );
  if (!url) return "That is not an http(s) URL. Nothing added.";
  const apiKey = (await io.askHidden("  API key (hidden): ")).trim();
  if (!apiKey) return "No key entered. Nothing added.";
  updateEnvironmentsFile((file) => {
    // Re-checked on the fresh file: another terminal may have added it meanwhile.
    if (exists(file, name))
      throw new Error(`"${name}" was added meanwhile. Nothing changed.`);
    file[name] = { apiBaseUrl: url, apiKey };
  }, path);
  return `✔ Added ${name}.`;
}

async function changeEnvironment(
  io: EnvsIo,
  path: string,
  name: string,
): Promise<string> {
  const entry = load(path)[name];
  if (!entry) return `"${name}" no longer exists.`;
  const urlAnswer = await io.ask(`  API base URL [${entry.apiBaseUrl}]: `);
  const url = urlAnswer.trim() ? parseBaseUrl(urlAnswer) : entry.apiBaseUrl;
  if (!url) return "That is not an http(s) URL. Nothing changed.";
  const apiKey =
    (
      await io.askHidden(
        `  API key [${mask(entry.apiKey)}] (hidden, Enter keeps it): `,
      )
    ).trim() || entry.apiKey;
  if (url === entry.apiBaseUrl && apiKey === entry.apiKey)
    return "Nothing changed.";
  updateEnvironmentsFile((file) => {
    if (!Object.prototype.hasOwnProperty.call(file, name)) {
      throw new Error(`"${name}" was deleted meanwhile. Nothing changed.`);
    }
    file[name] = { apiBaseUrl: url, apiKey };
  }, path);
  return `✔ Updated ${name}.`;
}

async function deleteEnvironment(
  io: EnvsIo,
  path: string,
  name: string,
): Promise<string> {
  const answer = (await io.ask(`  Delete ${name}? [y/N] `))
    .trim()
    .toLowerCase();
  if (answer !== "y" && answer !== "yes") return "Nothing deleted.";
  updateEnvironmentsFile((file) => {
    delete file[name];
  }, path);
  return `✔ Deleted ${name}.`;
}

/** Run the menu; resolves to the process exit code. */
export async function runEnvs(io: EnvsIo): Promise<number> {
  const path = join(io.dir, "environments.json");
  let file: EnvironmentsFile;
  try {
    file = load(path);
  } catch (error: any) {
    io.write(
      `${error.message}\nFix or delete that file, then run cognigy-envs again.\n`,
    );
    return 1;
  }

  // A file from the cognigy-env.py script may use the now-reserved name.
  const clash = reservedNameIn(file);
  if (clash) {
    io.write(
      `Your environment "${clash}" uses a name reserved for the plugin's own login. Rename it to keep using it; until then the plugin refuses every call.\n`,
    );
    if (!io.isTTY) return 1;
    const renamed = (await io.ask(`New name for "${clash}": `)).trim();
    const problem =
      validateEnvironmentName(renamed) ??
      (exists(file, renamed) ? `"${renamed}" already exists.` : undefined);
    if (problem) {
      io.write(`${problem} Nothing changed.\n`);
      return 1;
    }
    updateEnvironmentsFile((fresh) => {
      fresh[renamed] = fresh[clash];
      delete fresh[clash];
    }, path);
    file = load(path);
  }

  if (!io.isTTY) {
    io.write(`${list(file, io.dir)}\n`);
    return 0;
  }

  let cursor = 0;
  let status = "";
  for (;;) {
    const names = Object.keys(file);
    const items = names.length + 1; // the environments, then "+ Add"
    cursor = Math.min(cursor, items - 1);
    io.write(`${CLEAR}${frame(file, io.dir, cursor, status)}\n`);

    const key = await io.readKey();
    status = "";
    if (QUIT.has(key)) break;
    if (UP.has(key)) cursor = (cursor - 1 + items) % items;
    else if (DOWN.has(key)) cursor = (cursor + 1) % items;
    else if (ENTER.has(key) || (DELETE.has(key) && cursor < names.length)) {
      try {
        status = ENTER.has(key)
          ? cursor === names.length
            ? await addEnvironment(io, path)
            : await changeEnvironment(io, path, names[cursor])
          : await deleteEnvironment(io, path, names[cursor]);
      } catch (error: any) {
        if (error?.message === "cancelled") throw error;
        status = String(error?.message ?? error);
      }
      // What is on disk is the truth: another terminal may have changed it too.
      file = load(path);
    }
  }
  io.write("\n");
  return 0;
}

// Run only when invoked as the bin, not when imported (e.g. by tests).
if (isMainModule(import.meta.url, process.argv[1])) {
  runEnvs({
    write: (text) => process.stdout.write(text),
    ask: (question) => askOrEscape(question),
    askHidden: (question) => askOrEscape(question, true),
    readKey,
    isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    dir: USER_CONFIG_DIR,
  }).then(
    (code) => process.exit(code),
    (error: unknown) => {
      // Esc at the rename prompt shown before the menu.
      if (error instanceof PromptEscaped) {
        process.stdout.write(`${error.message}\n`);
        process.exit(1);
      }
      const message = error instanceof Error ? error.message : String(error);
      if (message === "cancelled") process.exit(130);
      process.stderr.write(`cognigy-envs failed: ${message}\n`);
      process.exit(1);
    },
  );
}
