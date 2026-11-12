/**
 * Several Cognigy environments in one engine, chosen per tool call.
 *
 * Users with one environment see no change: without
 * ~/.cognigy-plugin/environments.json there is no `environment` field and
 * every call runs on the plugin's own credentials, exactly as before.
 *
 * Once that file names extra environments, every tool gets a required
 * `environment` field (`default` = the plugin's own credentials, plus each
 * name in the file). The model, not the server, remembers which environment a
 * conversation uses, so engines shared by several chats (Claude Desktop, Codex,
 * Antigravity) hold no "current environment" one chat could move for another.
 * Each environment gets its own API client and `ToolHandlers`, built on first
 * use and kept, so per-environment session state (backup holds, the per-agent
 * change queue) survives across calls and never leaks between environments.
 */
import { CognigyApiClient } from "./api/client.js";
import { loadConfigForEnvironment, type Config } from "./config.js";
import {
  DEFAULT_ENVIRONMENT,
  findEnvironmentName,
  readEnvironmentsFile,
  type EnvironmentEntry,
  type EnvironmentsFile,
  type EnvironmentsFileState,
} from "./environmentsFile.js";
import { agentsV2BaseUrl } from "./tools/agentsV2.js";
import type { ToolDefinition } from "./tools/definitions.js";
import { ToolHandlers } from "./tools/handlers.js";
import { logProxyConfiguration } from "./utils/proxy.js";

export interface Runtime {
  config: Config;
  toolHandlers: ToolHandlers;
}

/** The API client and tool handlers for one environment's config. */
export function buildRuntime(config: Config): Runtime {
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
  };
}

/** A problem choosing the environment. Messages never contain keys. */
export class EnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvironmentError";
  }
}

export interface ResolvedEnvironment {
  name: string;
  runtime: Runtime;
  /** True when environments.json names extra environments. */
  multiple: boolean;
}

export const ENVIRONMENT_FIELD_DESCRIPTION =
  "Cognigy environment (default = the plugin's own login). Unless the user named one, ask once per conversation and reuse it.";

export class Environments {
  private readonly cache = new Map<
    string,
    { entry: EnvironmentEntry; runtime: Runtime }
  >();

  constructor(
    private readonly defaultRuntime: Runtime,
    private readonly readFile: () => EnvironmentsFileState = () =>
      readEnvironmentsFile(),
  ) {}

  /** The extra environments' names; [] when the file is absent or unusable. */
  names(): string[] {
    const state = this.readFile();
    return state.state === "ok" ? Object.keys(state.file) : [];
  }

  /**
   * The environment a call runs on. The file is read on every call (it is
   * tiny), so an environment added or a key rotated in `cognigy-envs` applies
   * to the next call without a restart.
   */
  resolve(requested: unknown): ResolvedEnvironment {
    const state = this.readFile();
    if (state.state === "invalid") {
      // Never fall back to the default: the user meant to use the file, and a
      // silent fallback would aim the call at the wrong tenant.
      throw new EnvironmentError(
        `${state.reason} Fix it with cognigy-envs in a terminal.`,
      );
    }
    const file = state.state === "ok" ? state.file : {};
    const multiple = Object.keys(file).length > 0;
    const wanted = typeof requested === "string" ? requested.trim() : "";

    if (requested != null && typeof requested !== "string") {
      throw new EnvironmentError('"environment" must be a string.');
    }
    if (wanted === "") {
      if (multiple) {
        throw new EnvironmentError(
          `Several Cognigy environments are configured: ${this.describe(file)}. ` +
            `Ask the user which one to use, then pass it as "environment" on this and every later call in this conversation.`,
        );
      }
      return {
        name: DEFAULT_ENVIRONMENT,
        runtime: this.defaultRuntime,
        multiple,
      };
    }
    if (wanted.toLowerCase() === DEFAULT_ENVIRONMENT) {
      return {
        name: DEFAULT_ENVIRONMENT,
        runtime: this.defaultRuntime,
        multiple,
      };
    }

    const found = findEnvironmentName(file, wanted);
    if (found === undefined) {
      throw new EnvironmentError(
        multiple
          ? `Unknown Cognigy environment "${wanted}". Configured: ${this.describe(file)}.`
          : `No Cognigy environment "${wanted}" is configured. The user adds one in a terminal with cognigy-envs.`,
      );
    }
    return {
      name: found,
      runtime: this.runtimeFor(found, file[found]),
      multiple,
    };
  }

  /** The cached runtime, rebuilt only when the entry's URL or key changed. */
  private runtimeFor(name: string, entry: EnvironmentEntry): Runtime {
    const cached = this.cache.get(name);
    if (
      cached &&
      cached.entry.apiBaseUrl === entry.apiBaseUrl &&
      cached.entry.apiKey === entry.apiKey
    ) {
      return cached.runtime;
    }
    const runtime = buildRuntime(loadConfigForEnvironment(entry));
    this.cache.set(name, { entry, runtime });
    return runtime;
  }

  /** "default (https://…), trial (https://…)": names and URLs, never keys. */
  private describe(file: EnvironmentsFile): string {
    return [
      `${DEFAULT_ENVIRONMENT} (${this.defaultRuntime.config.apiBaseUrl})`,
      ...Object.entries(file).map(([n, e]) => `${n} (${e.apiBaseUrl})`),
    ].join(", ");
  }
}

/**
 * The tool list as the model sees it: unchanged without extra environments,
 * otherwise every tool gains a required `environment` field listing them.
 */
export function withEnvironmentField(
  tools: ToolDefinition[],
  names: string[],
): ToolDefinition[] {
  if (names.length === 0) return tools;
  const field = {
    type: "string",
    enum: [DEFAULT_ENVIRONMENT, ...names],
    description: ENVIRONMENT_FIELD_DESCRIPTION,
  };
  return tools.map((tool) => ({
    ...tool,
    inputSchema: {
      ...tool.inputSchema,
      properties: { ...tool.inputSchema.properties, environment: field },
      required: [...(tool.inputSchema.required ?? []), "environment"],
    },
  }));
}

/** Tags a result with the environment it ran on, so the user can always tell. */
export function tagWithEnvironment(result: unknown, name: string): unknown {
  return result && typeof result === "object" && !Array.isArray(result)
    ? { _environment: name, ...result }
    : result;
}
