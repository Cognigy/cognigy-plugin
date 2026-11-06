import { describe, it, expect, beforeEach } from "@jest/globals";
import { loadConfigForEnvironment } from "../config.js";
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

describe("EnvironmentRuntime", () => {
  // What the process "starts with" (env vars / config.json), and the file.
  let start: EnvironmentEntry;
  let fileState: EnvironmentsFileState;

  const runtime = () =>
    new EnvironmentRuntime(loadConfigForEnvironment(start), () => fileState);

  beforeEach(() => {
    start = trial;
    fileState = ok();
  });

  describe("starting state", () => {
    it("starts on the given credentials and never reads the file to do so", () => {
      const r = new EnvironmentRuntime(loadConfigForEnvironment(trial), () => {
        throw new Error("the file must not be read");
      });
      const first = r.current();
      expect(first.environment).toBeNull();
      expect(first.config.apiKey).toBe(trial.apiKey);
      expect(r.current().toolHandlers).toBe(first.toolHandlers);
    });

    it("is unaffected by a corrupt or absent file", () => {
      fileState = { state: "invalid", reason: "/x/environments.json is bad." };
      expect(runtime().current().environment).toBeNull();
      fileState = { state: "absent" };
      expect(runtime().current().environment).toBeNull();
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
    it("is case-insensitive, returns previous and current, and builds fresh handlers", () => {
      const r = runtime();
      const before = r.current().toolHandlers;
      expect(r.switchTo("APP")).toEqual({
        previous: "trial",
        current: { name: "app", apiBaseUrl: app.apiBaseUrl, active: true },
      });
      expect(r.current().toolHandlers).not.toBe(before);
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

    it("reports the environment already pinned as previous", () => {
      const r = runtime();
      r.switchTo("app");
      expect(r.switchTo("trial").previous).toBe("app");
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

  describe("after a switch the session is pinned to what it switched to", () => {
    it("keeps the same handlers across calls", () => {
      const r = runtime();
      r.switchTo("app");
      const first = r.current();
      expect(r.current().toolHandlers).toBe(first.toolHandlers);
    });

    it("does not read the file again on a call", () => {
      let reads = 0;
      const r = new EnvironmentRuntime(loadConfigForEnvironment(trial), () => {
        reads += 1;
        return ok();
      });
      r.switchTo("app");
      const afterSwitch = reads;
      r.current();
      r.current();
      expect(reads).toBe(afterSwitch);
    });

    it("keeps using the key it switched with after the file rotates it, until switched again", () => {
      const r = runtime();
      r.switchTo("app");
      const before = r.current();

      fileState = ok(files({ app: { ...app, apiKey: "FAKE-ROTATED" } }));
      expect(r.current().config.apiKey).toBe(app.apiKey);
      expect(r.current().toolHandlers).toBe(before.toolHandlers);

      r.switchTo("app");
      expect(r.current().config.apiKey).toBe("FAKE-ROTATED");
    });

    it("keeps working when its entry is removed or the file breaks or vanishes", () => {
      const r = runtime();
      r.switchTo("app");
      const before = r.current();

      const { app: _removed, ...rest } = files();
      fileState = ok(rest);
      expect(r.current()).toBe(before);
      fileState = { state: "invalid", reason: "/x/environments.json is bad." };
      expect(r.current()).toBe(before);
      fileState = { state: "absent" };
      expect(r.current()).toBe(before);
      expect(r.describe()).toEqual({
        name: "app",
        apiBaseUrl: app.apiBaseUrl,
        source: "session",
      });
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
