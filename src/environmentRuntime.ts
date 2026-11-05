/**
 * Which Cognigy environment this engine process talks to, and the objects built
 * for it (config, API client, tool handlers).
 *
 * The rules, in short:
 *  - The process STARTS on the plugin's own credentials (environment variables,
 *    then config.json), exactly as it always has. It does not read the
 *    environments file at start, so that file can never stop the engine booting.
 *  - `switchTo` pins a named environment from the environments file for THIS
 *    process, in memory only. It never writes a file, so other sessions are
 *    unaffected.
 *  - Edits to the pinned environment's entry (a rotated key) apply on the next
 *    `current()`. Anything unusable — a removed entry, a broken or vanished file
 *    — throws `EnvironmentError`; it never falls back to other credentials,
 *    because that would silently aim writes at a different tenant.
 *  - A switch builds fresh `parts` (the tool handlers hold per-environment
 *    session state, such as which projects already have a backup) unless the
 *    connection settings are identical to the ones already in use.
 */
import { normalizeApiBaseUrl, type Config } from "./config.js";
import {
  ENVIRONMENTS_FILE,
  findEnvironmentName,
  readEnvironmentsFile,
  type EnvironmentEntry,
  type EnvironmentsFile,
  type EnvironmentsFileState,
} from "./environmentsFile.js";

/** A problem with the environment selection. Messages never contain keys. */
export class EnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvironmentError";
  }
}

export interface Runtime<T> {
  config: Config;
  parts: T;
  /** The pinned environment's name, or null while on the plugin's own credentials. */
  environment: string | null;
}

export interface EnvironmentInfo {
  name: string;
  apiBaseUrl: string;
  active: boolean;
}

/**
 * "plugin-config": still on the credentials the process started with.
 * "session": switched onto a file environment in this process.
 */
export type EnvironmentSource = "session" | "plugin-config";

export interface EnvironmentRuntimeOptions<T> {
  loadLegacyConfig: () => Config;
  configForEnvironment: (entry: EnvironmentEntry) => Config;
  buildParts: (config: Config) => T;
  /** Injectable for tests; defaults to reading the real environments file. */
  readFile?: () => EnvironmentsFileState;
}

function fingerprint(config: Config): string {
  return JSON.stringify([
    config.apiBaseUrl,
    config.apiKey,
    config.endpointBaseUrl,
    config.webchatBaseUrl,
    config.staticFilesBaseUrl,
  ]);
}

function quotedNames(file: EnvironmentsFile): string {
  const names = Object.keys(file);
  return names.length > 0 ? names.map((n) => `"${n}"`).join(", ") : "(none)";
}

export class EnvironmentRuntime<T> {
  private readonly readFile: () => EnvironmentsFileState;
  private readonly startConfig: Config;
  private pinned: string | null = null;
  private source: EnvironmentSource = "plugin-config";
  private runtime: Runtime<T>;

  constructor(private readonly options: EnvironmentRuntimeOptions<T>) {
    this.readFile = options.readFile ?? (() => readEnvironmentsFile());
    this.startConfig = options.loadLegacyConfig();
    this.runtime = {
      config: this.startConfig,
      parts: options.buildParts(this.startConfig),
      environment: null,
    };
  }

  /**
   * The runtime for the next tool call. Until a switch this is the starting
   * runtime and the file is not read. After a switch it re-reads the file and
   * rebuilds the parts only when the pinned environment's resolved settings
   * changed since the last call.
   */
  current(): Runtime<T> {
    if (this.pinned === null) return this.runtime;

    const entry = this.pinnedEntry(this.pinned);
    const config = this.options.configForEnvironment(entry);
    if (fingerprint(config) !== fingerprint(this.runtime.config)) {
      this.runtime = {
        config,
        parts: this.options.buildParts(config),
        environment: this.pinned,
      };
    }
    return this.runtime;
  }

  /** Point this process at a file environment. Never writes any file. */
  switchTo(name: string): {
    previous: string | null;
    current: EnvironmentInfo;
  } {
    const file = this.readUsableFile();
    if (file === undefined) {
      throw new EnvironmentError(
        `No environments are defined. Add one with "cognigy-env add <name> <base-url>" in a terminal.`,
      );
    }
    const found = findEnvironmentName(file, name);
    if (found === undefined) {
      throw new EnvironmentError(
        `Unknown or ambiguous environment "${name}". Defined: ${quotedNames(file)}.`,
      );
    }

    const previous = this.nameIn(file);
    const config = this.options.configForEnvironment(file[found]);
    // Identical connection settings (switching to the environment already in
    // use, or to the entry the process started on): the handlers' session state
    // is still valid, so keep it.
    const parts =
      fingerprint(config) === fingerprint(this.runtime.config)
        ? this.runtime.parts
        : this.options.buildParts(config);
    this.runtime = { config, parts, environment: found };
    this.pinned = found;
    this.source = "session";

    return {
      previous,
      current: { name: found, apiBaseUrl: config.apiBaseUrl, active: true },
    };
  }

  /** The defined environments, without keys. Throws if the file is unusable. */
  list(): { environments: EnvironmentInfo[]; source: EnvironmentSource } {
    const file = this.readUsableFile();
    if (file === undefined) return { environments: [], source: this.source };
    const active = this.nameIn(file);
    return {
      environments: Object.entries(file).map(([name, entry]) => ({
        name,
        apiBaseUrl: entry.apiBaseUrl,
        active: name === active,
      })),
      source: this.source,
    };
  }

  /**
   * What the next call would target. For a pinned session this refreshes and
   * validates first (like current()), so it never reports a URL the next call
   * would not use, and throws when the pinned entry or the file is unusable.
   */
  describe(): {
    name: string | null;
    apiBaseUrl: string;
    source: EnvironmentSource;
  } {
    const { config } = this.current();
    return {
      name: this.pinned ?? this.matchStartName(),
      apiBaseUrl: config.apiBaseUrl,
      source: this.source,
    };
  }

  /** The name in use: the pinned one, else the entry the process started on. */
  private nameIn(file: EnvironmentsFile): string | null {
    return this.pinned ?? this.matchIn(file);
  }

  /** The file entry equal to the starting credentials, like the script's active_name. */
  private matchIn(file: EnvironmentsFile): string | null {
    for (const [name, entry] of Object.entries(file)) {
      if (
        normalizeApiBaseUrl(entry.apiBaseUrl) === this.startConfig.apiBaseUrl &&
        entry.apiKey === this.startConfig.apiKey
      ) {
        return name;
      }
    }
    return null;
  }

  /** Like matchIn, but an unreadable file simply means "no name". */
  private matchStartName(): string | null {
    try {
      const state = this.readFile();
      return state.state === "ok" ? this.matchIn(state.file) : null;
    } catch {
      return null;
    }
  }

  /** The parsed file, undefined when absent; throws when it is unusable. */
  private readUsableFile(): EnvironmentsFile | undefined {
    const state = this.readFile();
    if (state.state === "invalid") throw new EnvironmentError(state.reason);
    return state.state === "ok" ? state.file : undefined;
  }

  private pinnedEntry(name: string): EnvironmentEntry {
    const file = this.readUsableFile();
    if (file === undefined) {
      throw new EnvironmentError(
        `${ENVIRONMENTS_FILE} no longer exists, but this session is using the environment "${name}". ` +
          `Restore the file, or restart the session.`,
      );
    }
    // Exact name only. The case-insensitive match is for an explicit switch; a
    // pinned session whose entry was deleted must fail, not land on another
    // entry that differs only in letter case (it could be another tenant).
    if (!Object.prototype.hasOwnProperty.call(file, name)) {
      throw new EnvironmentError(
        `The environment "${name}" this session is using is no longer defined in ${ENVIRONMENTS_FILE}. ` +
          `Defined: ${quotedNames(file)}. Switch to one of them.`,
      );
    }
    return file[name];
  }
}
