import { describe, it, expect } from "@jest/globals";
import { loadConfigForEnvironment } from "../config.js";
import type {
  EnvironmentEntry,
  EnvironmentsFileState,
} from "../environmentsFile.js";
import { EnvironmentError, EnvironmentRuntime } from "../environmentRuntime.js";
import { handleManageEnvironments } from "../tools/environments.js";
import { manageEnvironmentsSchema } from "../schemas/tools.js";
import { tools } from "../tools/definitions.js";

const ODD = "cognigy-trial(@nice.com)";
const entries: Record<string, EnvironmentEntry> = {
  trial: { apiBaseUrl: "https://api-trial.cognigy.ai", apiKey: "FAKE-KEY-123" },
  app: { apiBaseUrl: "https://api-app.cognigy.ai", apiKey: "FAKE-KEY-456" },
  [ODD]: { apiBaseUrl: "https://api-eu.cognigy.ai", apiKey: "FAKE-KEY-789" },
};
const stranger: EnvironmentEntry = {
  apiBaseUrl: "https://api-elsewhere.cognigy.ai",
  apiKey: "FAKE-KEY-STRANGER",
};

/** A runtime that starts on `start` and reads `state` as the environments file. */
function runtimeFor(
  state: EnvironmentsFileState,
  start: EnvironmentEntry = entries.trial,
) {
  return new EnvironmentRuntime(loadConfigForEnvironment(start), () => state);
}

const withFile: EnvironmentsFileState = { state: "ok", file: entries };

describe("handleManageEnvironments", () => {
  it("list returns names, base URLs and the active flag, never keys", () => {
    const result: any = handleManageEnvironments(
      { operation: "list" },
      runtimeFor(withFile),
    );
    expect(result.source).toBe("plugin-config");
    expect(result.environments).toEqual([
      {
        name: "trial",
        apiBaseUrl: "https://api-trial.cognigy.ai",
        active: true,
      },
      { name: "app", apiBaseUrl: "https://api-app.cognigy.ai", active: false },
      { name: ODD, apiBaseUrl: "https://api-eu.cognigy.ai", active: false },
    ]);
  });

  it("list with no environments says how to add one", () => {
    const result: any = handleManageEnvironments(
      { operation: "list" },
      runtimeFor({ state: "absent" }),
    );
    expect(result.environments).toEqual([]);
    expect(result.note).toMatch(/cognigy-env add/);
  });

  it("current names the environment the session started on when it matches an entry", () => {
    expect(
      handleManageEnvironments({ operation: "current" }, runtimeFor(withFile)),
    ).toEqual({
      environment: "trial",
      apiBaseUrl: "https://api-trial.cognigy.ai",
      source: "plugin-config",
    });
  });

  it("current reports no name when the starting credentials match no entry", () => {
    expect(
      handleManageEnvironments(
        { operation: "current" },
        runtimeFor(withFile, stranger),
      ),
    ).toEqual({
      environment: null,
      apiBaseUrl: "https://api-elsewhere.cognigy.ai",
      source: "plugin-config",
    });
  });

  it("use switches and returns previous, current, scope and a hint", () => {
    const runtime = runtimeFor(withFile);
    const result: any = handleManageEnvironments(
      { operation: "use", name: "APP" },
      runtime,
    );
    expect(result.previous).toBe("trial");
    expect(result.current).toEqual({
      name: "app",
      apiBaseUrl: "https://api-app.cognigy.ai",
    });
    expect(result.scope).toMatch(/engine process/i);
    expect(result.scope).toMatch(/shared by every chat/i);
    expect(result.scope).toMatch(/Claude Code.*this session only/i);
    expect(result._hints.action).toMatch(/IDs/);
    expect(runtime.describe()).toMatchObject({
      name: "app",
      source: "session",
    });
  });

  it("use rejects an unknown name with the defined names", () => {
    const run = () =>
      handleManageEnvironments(
        { operation: "use", name: "nope" },
        runtimeFor(withFile),
      );
    expect(run).toThrow(EnvironmentError);
    expect(run).toThrow(/trial.*app/);
  });

  it("use without a name fails validation", () => {
    expect(() =>
      handleManageEnvironments({ operation: "use" }, runtimeFor(withFile)),
    ).toThrow();
  });

  it("an unknown operation fails validation", () => {
    expect(() =>
      handleManageEnvironments({ operation: "add" }, runtimeFor(withFile)),
    ).toThrow();
  });

  it("works with a name containing parentheses and @", () => {
    const result: any = handleManageEnvironments(
      { operation: "use", name: ODD },
      runtimeFor(withFile),
    );
    expect(result.current.name).toBe(ODD);
  });

  it("no result for any operation contains a key", () => {
    const runtime = runtimeFor(withFile);
    const results = [
      handleManageEnvironments({ operation: "list" }, runtime),
      handleManageEnvironments({ operation: "current" }, runtime),
      handleManageEnvironments({ operation: "use", name: "app" }, runtime),
      handleManageEnvironments({ operation: "current" }, runtime),
    ];
    expect(JSON.stringify(results)).not.toMatch(/FAKE-/);
  });
});

describe("manage_environments definition", () => {
  const definition = tools.find((t) => t.name === "manage_environments");

  it("is registered, writable but not destructive", () => {
    expect(definition).toBeDefined();
    expect(definition!.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
  });

  it("states in the description that it is per session and never handles API keys", () => {
    expect(definition!.description).toMatch(/this session/i);
    expect(definition!.description).toMatch(/never.*keys/i);
  });

  it("names the three operations and the engine-process scope in the operation field", () => {
    const operation = (
      definition!.inputSchema.properties as Record<string, any>
    ).operation.description as string;
    expect(operation).toMatch(/list/);
    expect(operation).toMatch(/current/);
    expect(operation).toMatch(/use.*engine process/i);
    expect(operation).not.toMatch(/other sessions are unaffected/i);
  });

  it("keeps the JSON input schema in step with the zod schema", () => {
    const zodOperations = manageEnvironmentsSchema.options.map(
      (option) => option.shape.operation.value,
    );
    const props = definition!.inputSchema.properties as Record<string, any>;
    expect(props.operation.enum).toEqual(zodOperations);
    expect(zodOperations).toEqual(["list", "current", "use"]);
    expect(definition!.inputSchema.required).toEqual(["operation"]);
  });
});
