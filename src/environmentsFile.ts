/**
 * The environments file: named Cognigy environments (API base URL + API key) the
 * user can switch between.
 *
 *   ~/.cognigy-plugin/environments.json   (directory 0700, file 0600)
 *   { "<name>": { "apiBaseUrl": "...", "apiKey": "..." }, ... }
 *
 * This is the flat shape the `cognigy-env` terminal tool has always written; the
 * engine only reads it. Reads never throw: every problem becomes
 * `{ state: "invalid", reason }`, and a reason never quotes file contents (a
 * parse error can carry a snippet of the file, and the file holds API keys). The
 * engine never needs the file to start, so callers decide what an invalid file
 * means for the operation at hand.
 */
import {
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { USER_CONFIG_DIR } from "./userConfigFile.js";

export const ENVIRONMENTS_FILE = join(USER_CONFIG_DIR, "environments.json");

export interface EnvironmentEntry {
  apiBaseUrl: string;
  apiKey: string;
  /** Only for self-hosted layouts whose hosts cannot be derived from apiBaseUrl. */
  endpointBaseUrl?: string;
  webchatBaseUrl?: string;
  staticFilesBaseUrl?: string;
}

export type EnvironmentsFile = Record<string, EnvironmentEntry>;

export type EnvironmentsFileState =
  | { state: "absent" }
  | { state: "ok"; file: EnvironmentsFile }
  | { state: "invalid"; reason: string };

const MAX_NAME_LENGTH = 100;
const HOST_OVERRIDE_FIELDS = [
  "endpointBaseUrl",
  "webchatBaseUrl",
  "staticFilesBaseUrl",
] as const;

/** An error message when `name` cannot be an environment name, else undefined. */
export function validateEnvironmentName(name: string): string | undefined {
  if (name.trim().length === 0) return "An environment name cannot be empty.";
  if (name !== name.trim()) {
    return "An environment name cannot start or end with spaces.";
  }
  // Names become property keys on a plain object; assigning "__proto__" would
  // change the object's prototype instead of adding an entry.
  if (name === "__proto__") {
    return 'An environment name cannot be "__proto__" (reserved).';
  }
  if (name.length > MAX_NAME_LENGTH) {
    return `An environment name can be at most ${MAX_NAME_LENGTH} characters.`;
  }
  if ([...name].some((ch) => ch.charCodeAt(0) < 32 || ch === "\x7f")) {
    return "An environment name cannot contain control characters.";
  }
  return undefined;
}

/**
 * The stored name matching `name`: an exact match, else the single
 * case-insensitive match. Never a prefix or fuzzy match, and never a guess
 * between two candidates — the caller picks the exact name.
 */
export function findEnvironmentName(
  file: EnvironmentsFile,
  name: string,
): string | undefined {
  if (Object.prototype.hasOwnProperty.call(file, name)) return name;
  const wanted = name.toLowerCase();
  const matches = Object.keys(file).filter(
    (stored) => stored.toLowerCase() === wanted,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseEntry(
  name: string,
  raw: unknown,
  path: string,
): EnvironmentEntry | string {
  const where = `${path}: environment "${name}"`;
  if (!isPlainObject(raw)) return `${where} must be an object.`;

  const entry = {} as EnvironmentEntry;
  for (const field of ["apiBaseUrl", "apiKey"] as const) {
    const value = raw[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      return `${where} needs a non-empty "${field}".`;
    }
    entry[field] = value.trim();
  }
  for (const field of HOST_OVERRIDE_FIELDS) {
    const value = raw[field];
    if (value === undefined) continue;
    if (typeof value !== "string") return `${where}: "${field}" must be text.`;
    if (value.trim().length > 0) entry[field] = value.trim();
  }
  return entry;
}

/** Read and validate the file. Never throws; see the module comment. */
export function readEnvironmentsFile(
  path: string = ENVIRONMENTS_FILE,
): EnvironmentsFileState {
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (error: any) {
    if (error?.code === "ENOENT") return { state: "absent" };
    return {
      state: "invalid",
      reason: `${path} cannot be read (${error?.code ?? "unknown error"}).`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Deliberately not the parser's message: it can quote part of the file.
    return { state: "invalid", reason: `${path} is not valid JSON.` };
  }

  if (!isPlainObject(parsed)) {
    return {
      state: "invalid",
      reason: `${path} must be a JSON object mapping environment names to entries.`,
    };
  }

  const file: EnvironmentsFile = {};
  for (const [name, raw] of Object.entries(parsed)) {
    const nameError = validateEnvironmentName(name);
    if (nameError) {
      return { state: "invalid", reason: `${path}: "${name}": ${nameError}` };
    }
    const entry = parseEntry(name, raw, path);
    if (typeof entry === "string") return { state: "invalid", reason: entry };
    file[name] = entry;
  }
  return { state: "ok", file };
}

/**
 * Write the file with owner-only permissions, replacing it atomically (a temp
 * file in the same directory, then a rename) so a concurrent reader or a second
 * writer never sees a half-written file.
 */
export function writeEnvironmentsFile(
  file: EnvironmentsFile,
  path: string = ENVIRONMENTS_FILE,
): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // mkdirSync's mode is ignored for an existing directory; re-tighten only our
  // own directory, never one a caller pointed us at.
  if (path === ENVIRONMENTS_FILE) chmodSync(dir, 0o700);

  const temp = join(dir, `.environments.${process.pid}.${Date.now()}.tmp`);
  try {
    writeFileSync(temp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

const LOCK_NAME = ".environments.lock";
const LOCK_TIMEOUT_MS = 5000;
/** A lock this old was left by a process that died while holding it. */
const STALE_LOCK_MS = 30_000;

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withLock<T>(path: string, timeoutMs: number, fn: () => T): T {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = join(dir, LOCK_NAME);
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      closeSync(openSync(lock, "wx", 0o600));
      break;
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
    }
    try {
      if (Date.now() - statSync(lock).mtimeMs > STALE_LOCK_MS) {
        rmSync(lock, { force: true });
        continue;
      }
    } catch {
      continue; // the holder released it between our two calls; try again
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Another cognigy-env is updating ${path}. Try again in a moment.`,
      );
    }
    sleep(25);
  }

  try {
    return fn();
  } finally {
    rmSync(lock, { force: true });
  }
}

/**
 * Change the environments file without losing anyone else's edit: take a short
 * lock, read the file as it is NOW, let `mutate` change that, and write it back
 * atomically. A prompt (typing a key) must happen before this call, never
 * inside it, so the lock is held for milliseconds. `mutate` may throw to abort;
 * nothing is written then. An unreadable file is never overwritten.
 */
export function updateEnvironmentsFile(
  mutate: (file: EnvironmentsFile) => void,
  path: string = ENVIRONMENTS_FILE,
  options: { timeoutMs?: number } = {},
): void {
  withLock(path, options.timeoutMs ?? LOCK_TIMEOUT_MS, () => {
    const state = readEnvironmentsFile(path);
    if (state.state === "invalid") throw new Error(state.reason);
    const file: EnvironmentsFile = state.state === "ok" ? state.file : {};
    mutate(file);
    writeEnvironmentsFile(file, path);
  });
}
