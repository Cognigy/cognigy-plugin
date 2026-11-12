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
 *  - The pinned config is fixed at the switch: editing the file afterwards (a
 *    rotated key) changes nothing until the user switches again.
 *  - A switch builds fresh tool handlers, which hold per-environment session
 *    state (such as which projects already have a backup).
 */
import { CognigyApiClient } from "./api/client.js";
import {
  loadConfigForEnvironment,
  normalizeApiBaseUrl,
  type Config,
} from "./config.js";
import {
  findEnvironmentName,
  readEnvironmentsFile,
  type EnvironmentsFile,
  type EnvironmentsFileState,
} from "./environmentsFile.js";
import { agentsV2BaseUrl } from "./tools/agentsV2.js";
import { ToolHandlers } from "./tools/handlers.js";
import { logProxyConfiguration } from "./utils/proxy.js";

/** A problem with the environment selection. Messages never contain keys. */
export class EnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvironmentError";
  }
}

export interface Runtime {
  config: Config;
  toolHandlers: ToolHandlers;
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

function quotedNames(file: EnvironmentsFile): string {
  const names = Object.keys(file);
  return names.length > 0 ? names.map((n) => `"${n}"`).join(", ") : "(none)";
}

function buildRuntime(config: Config, environment: string | null): Runtime {
  logProxyConfiguration(config.apiBaseUrl);
  const apiClient = new CognigyApiClient({
    baseUrl: config.apiBaseUrl,
    apiKey: config.apiKey,
    auditAttribution: config.auditAttribution,
  });
  return {
    config,
    toolHandlers: new ToolHandlers(
      apiClient,
      config.endpointBaseUrl,
      config.webchatBaseUrl,
      config.staticFilesBaseUrl,
      agentsV2BaseUrl(config.apiBaseUrl),
    ),
    environment,
  };
}

export class EnvironmentRuntime {
  private runtime: Runtime;

  /**
   * @param startConfig what the process starts on (`loadConfig()`)
   * @param readFile injectable for tests; defaults to the real environments file
   */
  constructor(
    private readonly startConfig: Config,
    private readonly readFile: () => EnvironmentsFileState = () =>
      readEnvironmentsFile(),
  ) {
    this.runtime = buildRuntime(startConfig, null);
  }

  /** The runtime for the next tool call. */
  current(): Runtime {
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
    this.runtime = buildRuntime(loadConfigForEnvironment(file[found]), found);
    return {
      previous,
      current: {
        name: found,
        apiBaseUrl: this.runtime.config.apiBaseUrl,
        active: true,
      },
    };
  }

  /** The defined environments, without keys. Throws if the file is unusable. */
  list(): { environments: EnvironmentInfo[]; source: EnvironmentSource } {
    const file = this.readUsableFile();
    if (file === undefined) return { environments: [], source: this.source() };
    const active = this.nameIn(file);
    return {
      environments: Object.entries(file).map(([name, entry]) => ({
        name,
        apiBaseUrl: entry.apiBaseUrl,
        active: name === active,
      })),
      source: this.source(),
    };
  }

  /** What the next call targets. */
  describe(): {
    name: string | null;
    apiBaseUrl: string;
    source: EnvironmentSource;
  } {
    const { environment, config } = this.runtime;
    const state = this.readFile();
    return {
      name:
        environment ??
        (state.state === "ok" ? this.matchStart(state.file) : null),
      apiBaseUrl: config.apiBaseUrl,
      source: this.source(),
    };
  }

  private source(): EnvironmentSource {
    return this.runtime.environment === null ? "plugin-config" : "session";
  }

  /** The name in use: the pinned one, else the entry the process started on. */
  private nameIn(file: EnvironmentsFile): string | null {
    return this.runtime.environment ?? this.matchStart(file);
  }

  /** The file entry equal to the starting credentials, like the script's active_name. */
  private matchStart(file: EnvironmentsFile): string | null {
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

  /** The parsed file, undefined when absent; throws when it is unusable. */
  private readUsableFile(): EnvironmentsFile | undefined {
    const state = this.readFile();
    if (state.state === "invalid") throw new EnvironmentError(state.reason);
    return state.state === "ok" ? state.file : undefined;
  }
}
