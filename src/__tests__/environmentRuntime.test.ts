import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type { Config } from "../config.js";
import type {
  EnvironmentEntry,
  EnvironmentsFile,
  EnvironmentsFileState,
} from "../environmentsFile.js";
import { EnvironmentError, EnvironmentRuntime } from "../environmentRuntime.js";

const ODD = "cognigy-trial(@nice.com)";
const CX = "cxone-sb41 (AS key)";

const trial: EnvironmentEntry = {
  apiBaseUrl: "https://api-trial.cognigy.ai",
  apiKey: "FAKE-KEY-123",
};
const app: EnvironmentEntry = {
  apiBaseUrl: "https://api-app.cognigy.ai",
  apiKey: "FAKE-KEY-456",
};
const odd: EnvironmentEntry = {
  apiBaseUrl: "https://api-eu.cognigy.ai",
  apiKey: "FAKE-KEY-789",
};
const cx: EnvironmentEntry = {
  apiBaseUrl: "https://api-sb41.cognigy.cloud",
  apiKey: "FAKE-KEY-000",
};
const stranger: EnvironmentEntry = {
  apiBaseUrl: "https://api-elsewhere.cognigy.ai",
  apiKey: "FAKE-KEY-STRANGER",
};

type Parts = { id: number };

const files = (extra: EnvironmentsFile = {}): EnvironmentsFile => ({
  trial,
  app,
  [ODD]: odd,
  [CX]: cx,
  ...extra,
});
const ok = (file: EnvironmentsFile = files()): EnvironmentsFileState => ({
  state: "ok",
  file,
});

function fakeConfig(entry: EnvironmentEntry): Config {
  return {
    apiBaseUrl: entry.apiBaseUrl,
    apiKey: entry.apiKey,
    endpointBaseUrl: entry.endpointBaseUrl ?? "derived-endpoint",
    webchatBaseUrl: entry.webchatBaseUrl ?? "derived-webchat",
    staticFilesBaseUrl: entry.staticFilesBaseUrl ?? "derived-static",
  } as unknown as Config;
}

describe("EnvironmentRuntime", () => {
  // The credentials the process "starts with" (env vars / config.json).
  let start: EnvironmentEntry;
  let fileState: EnvironmentsFileState;
  let readFile: () => EnvironmentsFileState;
  let nextId: number;
  const loadLegacyConfig = jest.fn<() => Config>();
  const configForEnvironment = jest.fn<(e: EnvironmentEntry) => Config>();
  const buildParts = jest.fn<(c: Config) => Parts>();

  const runtime = () =>
    new EnvironmentRuntime<Parts>({
      loadLegacyConfig,
      configForEnvironment,
      buildParts,
      readFile: () => readFile(),
    });

  beforeEach(() => {
    start = trial;
    fileState = ok();
    readFile = () => fileState;
    nextId = 0;
    loadLegacyConfig.mockReset();
    loadLegacyConfig.mockImplementation(() => fakeConfig(start));
    configForEnvironment.mockReset();
    configForEnvironment.mockImplementation(fakeConfig);
    buildParts.mockReset();
    buildParts.mockImplementation(() => ({ id: ++nextId }));
  });

  describe("starting state", () => {
    it("starts on the plugin's own credentials and builds parts once, never reading the file", () => {
      readFile = () => {
        throw new Error("the file must not be read");
      };
      const r = runtime();
      const first = r.current();
      r.current();
      expect(first.environment).toBeNull();
      expect(first.config.apiKey).toBe(trial.apiKey);
      expect(r.current().parts).toBe(first.parts);
      expect(buildParts).toHaveBeenCalledTimes(1);
      expect(configForEnvironment).not.toHaveBeenCalled();
    });

    it("is unaffected by a corrupt or absent file", () => {
      fileState = { state: "invalid", reason: "/x/environments.json is bad." };
      expect(runtime().current().environment).toBeNull();
      fileState = { state: "absent" };
      expect(runtime().current().environment).toBeNull();
    });

    it("propagates the credentials error when nothing provides credentials", () => {
      loadLegacyConfig.mockImplementation(() => {
        throw new Error("COGNIGY_API_KEY is not set.");
      });
      expect(() => runtime()).toThrow(/COGNIGY_API_KEY is not set/);
    });

    it("names the entry matching the starting credentials", () => {
      expect(runtime().describe()).toEqual({
        name: "trial",
        apiBaseUrl: trial.apiBaseUrl,
        source: "plugin-config",
      });
    });

    it("matches despite a bare UI URL and a trailing slash in the file", () => {
      start = app;
      fileState = ok(
        files({ app: { ...app, apiBaseUrl: "https://app.cognigy.ai/" } }),
      );
      expect(runtime().describe().name).toBe("app");
    });

    it("reports no name when nothing matches, even if the file is broken", () => {
      start = stranger;
      expect(runtime().describe().name).toBeNull();
      fileState = { state: "invalid", reason: "/x/environments.json is bad." };
      expect(runtime().describe().name).toBeNull();
    });
  });

  describe("switchTo", () => {
    it("is case-insensitive, returns previous and current, and builds fresh parts", () => {
      const r = runtime();
      const before = r.current().parts;
      expect(r.switchTo("APP")).toEqual({
        previous: "trial",
        current: { name: "app", apiBaseUrl: app.apiBaseUrl, active: true },
      });
      expect(r.current().parts).not.toBe(before);
      expect(r.current().config.apiKey).toBe(app.apiKey);
      expect(r.current().environment).toBe("app");
      expect(r.describe()).toEqual({
        name: "app",
        apiBaseUrl: app.apiBaseUrl,
        source: "session",
      });
    });

    it("reports previous null when the starting credentials match no entry", () => {
      start = stranger;
      expect(runtime().switchTo("app").previous).toBeNull();
    });

    it("keeps the same parts when switching to the entry matching the starting credentials", () => {
      const r = runtime();
      const before = r.current().parts;
      expect(r.switchTo("trial").previous).toBe("trial");
      expect(r.current().parts).toBe(before);
      expect(buildParts).toHaveBeenCalledTimes(1);
      expect(r.describe().source).toBe("session");
    });

    it("keeps the same parts when switching to the environment already pinned", () => {
      const r = runtime();
      r.switchTo("app");
      const pinned = r.current().parts;
      expect(r.switchTo("app").previous).toBe("app");
      expect(r.current().parts).toBe(pinned);
    });

    it("rejects an unknown name, listing the defined names, and changes nothing", () => {
      const r = runtime();
      let message = "";
      try {
        r.switchTo("nope");
      } catch (error: any) {
        expect(error).toBeInstanceOf(EnvironmentError);
        message = error.message;
      }
      expect(message).toContain('"nope"');
      for (const name of ["trial", "app", ODD, CX]) {
        expect(message).toContain(name);
      }
      expect(message).not.toContain("FAKE-KEY");
      expect(r.describe()).toMatchObject({
        name: "trial",
        source: "plugin-config",
      });
    });

    it("rejects an ambiguous case-insensitive name", () => {
      fileState = ok(files({ Dev: app, dev: odd }));
      expect(() => runtime().switchTo("DEV")).toThrow(EnvironmentError);
    });

    it("says how to add an environment when there is no file", () => {
      fileState = { state: "absent" };
      expect(() => runtime().switchTo("trial")).toThrow(/cognigy-env add/);
    });

    it("surfaces an invalid file's reason", () => {
      fileState = { state: "invalid", reason: "/x/environments.json is bad." };
      expect(() => runtime().switchTo("trial")).toThrow(/is bad/);
    });

    it("keeps two runtimes independent", () => {
      const a = runtime();
      const b = runtime();
      a.switchTo("app");
      expect(a.current().environment).toBe("app");
      expect(b.current().environment).toBeNull();
    });

    it("works with names containing spaces, parentheses and @", () => {
      const r = runtime();
      expect(r.switchTo(ODD).current.name).toBe(ODD);
      expect(r.switchTo("CXONE-SB41 (AS KEY)").current.name).toBe(CX);
      expect(r.switchTo("trial").previous).toBe(CX);
    });
  });

  describe("after a switch", () => {
    it("an unchanged file keeps the same parts across calls", () => {
      const r = runtime();
      r.switchTo("app");
      const first = r.current().parts;
      r.current();
      expect(r.current().parts).toBe(first);
    });

    it("a rotated key rebuilds parts; an edit to another entry does not", () => {
      const r = runtime();
      r.switchTo("app");
      const first = r.current();

      fileState = ok(files({ app: { ...app, apiKey: "FAKE-ROTATED" } }));
      const rotated = r.current();
      expect(rotated.parts).not.toBe(first.parts);
      expect(rotated.config.apiKey).toBe("FAKE-ROTATED");

      fileState = ok(
        files({
          app: { ...app, apiKey: "FAKE-ROTATED" },
          trial: { ...trial, apiKey: "FAKE-OTHER-EDIT" },
        }),
      );
      expect(r.current().parts).toBe(rotated.parts);
    });

    it("throws, and never falls back to the starting credentials, when the pinned entry is removed", () => {
      const r = runtime();
      r.switchTo("app");
      const { app: _removed, ...rest } = files();
      fileState = ok(rest);
      expect(() => r.current()).toThrow(EnvironmentError);
      expect(() => r.current()).toThrow(/app/);
      expect(loadLegacyConfig).toHaveBeenCalledTimes(1);
    });

    it("throws without any key in the message when the file becomes malformed", () => {
      const r = runtime();
      r.switchTo("app");
      fileState = { state: "invalid", reason: "/x/environments.json is bad." };
      let message = "";
      try {
        r.current();
      } catch (error: any) {
        expect(error).toBeInstanceOf(EnvironmentError);
        message = error.message;
      }
      expect(message).toContain("is bad");
      expect(message).not.toContain("FAKE-KEY");
    });

    it("throws when the file disappears", () => {
      const r = runtime();
      r.switchTo("app");
      fileState = { state: "absent" };
      expect(() => r.current()).toThrow(EnvironmentError);
    });
  });

  describe("list", () => {
    it("marks the matched start entry, then the pinned one, and never contains a key", () => {
      const r = runtime();
      expect(r.list().environments.find((e) => e.active)?.name).toBe("trial");
      r.switchTo("app");
      const listed = r.list();
      expect(listed.environments.filter((e) => e.active)).toEqual([
        { name: "app", apiBaseUrl: app.apiBaseUrl, active: true },
      ]);
      expect(listed.source).toBe("session");
      expect(JSON.stringify(listed)).not.toContain("FAKE-KEY");
    });

    it("returns an empty list for an absent file and throws for an invalid one", () => {
      fileState = { state: "absent" };
      expect(runtime().list()).toEqual({
        environments: [],
        source: "plugin-config",
      });
      fileState = { state: "invalid", reason: "/x/environments.json is bad." };
      expect(() => runtime().list()).toThrow(EnvironmentError);
    });
  });
});
