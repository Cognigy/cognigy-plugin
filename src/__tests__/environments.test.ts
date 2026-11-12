import { describe, expect, it } from "@jest/globals";
import {
  Environments,
  ENVIRONMENT_FIELD_DESCRIPTION,
  tagWithEnvironment,
  withEnvironmentField,
  type Runtime,
} from "../environments.js";
import type { EnvironmentsFileState } from "../environmentsFile.js";
import { tools } from "../tools/definitions.js";

const defaultRuntime = {
  config: { apiBaseUrl: "https://api-app.cognigy.ai", apiKey: "FAKE-DEFAULT" },
} as unknown as Runtime;

const TRIAL = {
  apiBaseUrl: "https://api-trial.cognigy.ai",
  apiKey: "FAKE-TRIAL",
};

function envs(state: () => EnvironmentsFileState) {
  return new Environments(defaultRuntime, state);
}
const absent = () => ({ state: "absent" }) as const;
const withTrial = () => ({ state: "ok", file: { trial: TRIAL } }) as const;

describe("Environments.resolve without extra environments", () => {
  it("runs on the default credentials, untagged, as before", () => {
    for (const requested of [undefined, null, "", "default", "Default"]) {
      const target = envs(absent).resolve(requested);
      expect(target).toEqual({
        name: "default",
        runtime: defaultRuntime,
        multiple: false,
      });
    }
  });

  it("explains how to add an environment when one is named", () => {
    expect(() => envs(absent).resolve("trial")).toThrow(/cognigy-envs/);
  });
});

describe("Environments.resolve with extra environments", () => {
  it("requires a choice and lists names and URLs, never keys", () => {
    let message = "";
    try {
      envs(withTrial).resolve(undefined);
    } catch (error: any) {
      message = error.message;
    }
    expect(message).toContain("default (https://api-app.cognigy.ai)");
    expect(message).toContain("trial (https://api-trial.cognigy.ai)");
    expect(message).toContain('pass it as "environment"');
    expect(message).not.toMatch(/FAKE-/);
  });

  it("builds one runtime per environment and reuses it", () => {
    const environments = envs(withTrial);
    const first = environments.resolve("trial");
    expect(first.name).toBe("trial");
    expect(first.multiple).toBe(true);
    expect(first.runtime.config.apiBaseUrl).toBe(TRIAL.apiBaseUrl);
    expect(first.runtime.config.apiKey).toBe(TRIAL.apiKey);
    // Case-insensitive, and the same handlers (backup state, agent queue).
    expect(environments.resolve(" Trial ").runtime).toBe(first.runtime);
  });

  it("rebuilds the runtime when the key was changed in the file", () => {
    let key = "FAKE-OLD";
    const environments = envs(() => ({
      state: "ok",
      file: { trial: { apiBaseUrl: TRIAL.apiBaseUrl, apiKey: key } },
    }));
    const before = environments.resolve("trial").runtime;
    key = "FAKE-NEW";
    const after = environments.resolve("trial").runtime;
    expect(after).not.toBe(before);
    expect(after.config.apiKey).toBe("FAKE-NEW");
  });

  it("keeps the default reachable by name", () => {
    expect(envs(withTrial).resolve("default")).toEqual({
      name: "default",
      runtime: defaultRuntime,
      multiple: true,
    });
  });

  it("rejects an unknown name and a non-string value", () => {
    expect(() => envs(withTrial).resolve("acme")).toThrow(
      /Unknown Cognigy environment "acme"/,
    );
    expect(() => envs(withTrial).resolve(42)).toThrow(/must be a string/);
  });
});

describe("Environments with an unusable file", () => {
  const invalid = () =>
    ({
      state: "invalid",
      reason: "environments.json is not valid JSON.",
    }) as const;

  it("fails every call instead of falling back to the default", () => {
    for (const requested of [undefined, "default", "trial"]) {
      expect(() => envs(invalid).resolve(requested)).toThrow(
        /not valid JSON\. Fix it with cognigy-envs/,
      );
    }
  });

  it("offers no environment field", () => {
    expect(envs(invalid).names()).toEqual([]);
  });
});

describe("withEnvironmentField", () => {
  it("returns the tools unchanged without extra environments", () => {
    expect(withEnvironmentField(tools, [])).toBe(tools);
  });

  it("adds a required environment field to every tool, leaving the originals alone", () => {
    const listed = withEnvironmentField(tools, ["trial", "acme"]);
    expect(listed).toHaveLength(tools.length);
    for (const [i, tool] of listed.entries()) {
      expect(tool.inputSchema.properties.environment).toEqual({
        type: "string",
        enum: ["default", "trial", "acme"],
        description: ENVIRONMENT_FIELD_DESCRIPTION,
      });
      expect(tool.inputSchema.required).toEqual([
        ...(tools[i].inputSchema.required ?? []),
        "environment",
      ]);
      expect(tools[i].inputSchema.properties.environment).toBeUndefined();
    }
  });

  it("costs multi-environment users little context", () => {
    // Only users with extra environments pay this; everyone else gets the
    // tools unchanged. Keep the field terse: it repeats on every tool.
    const names = ["trial", "app", "customer-acme"];
    const extra =
      JSON.stringify(withEnvironmentField(tools, names)).length -
      JSON.stringify(tools).length;
    expect(extra / tools.length).toBeLessThanOrEqual(250);
  });
});

describe("tagWithEnvironment", () => {
  it("names the environment on object results only", () => {
    expect(tagWithEnvironment({ ok: true }, "trial")).toEqual({
      _environment: "trial",
      ok: true,
    });
    expect(tagWithEnvironment([1], "trial")).toEqual([1]);
    expect(tagWithEnvironment("text", "trial")).toBe("text");
  });
});
