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
  ENVS_COMMAND,
  findEnvironmentName,
  readEnvironmentsFile,
  reservedNameIn,
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

  /** The extra environments the tools offer, fixed by start(). */
  private offered: string[] = [];

  constructor(
    private readonly defaultRuntime: Runtime,
    private readonly readFile: () => EnvironmentsFileState = () =>
      readEnvironmentsFile(),
  ) {}

  /**
   * Read once when the server starts. The tools' `environment` field and the
   * instructions line come from this one read, so they always match: the
   * instructions cannot change after the client connects. A changed set of
   * environments applies after a restart. `overview` tells the model which URL
   * each name points to, so it can map "dev" to a name before its first call;
   * undefined when there is nothing to choose between.
   */
  start(): { names: string[]; overview?: string } {
    const state = this.readFile();
    const file =
      state.state === "ok" && !reservedNameIn(state.file) ? state.file : {};
    this.offered = Object.keys(file);
    if (this.offered.length === 0) return { names: [] };
    return {
      names: this.offered,
      overview:
        `COGNIGY ENVIRONMENTS: ${this.describe(file)}. ` +
        `"${DEFAULT_ENVIRONMENT}" is the plugin's own login. Map what the user calls a tenant (e.g. "dev") to a name by its URL; ask when it is unclear. ` +
        `Name the environment in the prompt of any subagent you delegate to; it cannot ask the user.`,
    };
  }

  /**
   * The environment a call runs on. The file is read on every call (it is
   * tiny), so a rotated key or a changed URL applies to the next call without
   * a restart, and a deleted environment stops working at once.
   */
  resolve(requested: unknown): ResolvedEnvironment {
    const state = this.readFile();
    if (state.state === "invalid") {
      // Never fall back to the default: the user meant to use the file, and a
      // silent fallback would aim the call at the wrong tenant.
      throw new EnvironmentError(
        // The menu cannot open an unusable file either: the user fixes it by hand.
        `${state.reason} Fix or delete that file, then try again.`,
      );
    }
    const file = state.state === "ok" ? state.file : {};
    const clash = reservedNameIn(file);
    if (clash) {
      // Which one would "default" mean? Refuse rather than guess the tenant.
      throw new EnvironmentError(
        `environments.json has an environment named "${clash}", but "${DEFAULT_ENVIRONMENT}" is reserved for the plugin's own login. Rename it in a terminal with: ${ENVS_COMMAND}`,
      );
    }
    const multiple = Object.keys(file).length > 0;
    const wanted = typeof requested === "string" ? requested.trim() : "";

    if (requested != null && typeof requested !== "string") {
      throw new EnvironmentError('"environment" must be a string.');
    }
    if (wanted === "") {
      if (multiple && this.offered.length === 0) {
        // The tools were listed without the field, so asking for it would be
        // a dead end. Never fall back to the default either.
        throw new EnvironmentError(
          `Nothing was sent: Cognigy environments changed after this conversation's tools were loaded (${this.describe(file)}). ` +
            `Ask the user to restart their AI client (in Claude Code, a new session is enough), so the tools offer the choice.`,
        );
      }
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

    // A hand-edited name can have spaces around it: match it as given first.
    const found =
      findEnvironmentName(file, String(requested)) ??
      findEnvironmentName(file, wanted);
    if (found === undefined) {
      throw new EnvironmentError(
        multiple
          ? `Unknown Cognigy environment "${wanted}". Configured: ${this.describe(file)}.`
          : `No Cognigy environment "${wanted}" is configured. The user adds one in a terminal with: ${ENVS_COMMAND}`,
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

/**
 * Why an explicit `talk_to_agent` endpoint URL is not on the selected
 * environment's endpoint host, else undefined. Endpoint URLs carry no key, so
 * this guards the tenant the message reaches and the `_environment` label, not
 * credentials. Nothing to compare when the environment's endpoint host could
 * not be derived from its API URL (an explicit URL is then the workaround).
 * Limit: it compares hosts only, so two environments on one host are not told
 * apart; that would need an API lookup of the URL token.
 */
export function foreignEndpointError(
  endpointUrl: unknown,
  target: ResolvedEnvironment,
): string | undefined {
  if (typeof endpointUrl !== "string") return undefined;
  // `host` is lowercase and drops a default port, so compare hosts, not raw
  // URLs: derivation cleans up an API URL it cannot derive from.
  const host = (url: string) => {
    try {
      return new URL(url.trim()).host;
    } catch {
      return undefined;
    }
  };
  const { apiBaseUrl, endpointBaseUrl } = target.runtime.config;
  const expected = host(endpointBaseUrl);
  // On the API's own host: no endpoint host was derived, nothing to compare.
  if (!expected || expected === host(apiBaseUrl)) return undefined;
  const given = host(endpointUrl);
  if (!given || given === expected) return undefined;
  return (
    `Nothing was sent: endpointUrl is on ${given}, but the "${target.name}" environment's endpoints are on ${expected}. ` +
    `Pass the environment the endpoint belongs to, or pass agentId/aiAgentId to use this environment's endpoint.`
  );
}

/** Tags a result with the environment it ran on, so the user can always tell. */
export function tagWithEnvironment(result: unknown, name: string): unknown {
  return result && typeof result === "object" && !Array.isArray(result)
    ? // First for readability, and it wins over a result field of that name.
      Object.assign({ _environment: name }, result, { _environment: name })
    : // An array or a plain value cannot carry the field: wrap it.
      { _environment: name, result };
}
