import { describe, it, expect, afterEach } from "@jest/globals";
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  findEnvironmentName,
  readEnvironmentsFile,
  validateEnvironmentName,
  writeEnvironmentsFile,
  type EnvironmentsFile,
} from "../environmentsFile.js";

const FAKE_KEY = "FAKE-KEY-123";
const isWindows = process.platform === "win32";

const tmpDirs: string[] = [];
function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cognigy-envs-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) {
    rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
  }
});

/** Write raw content (object → JSON) and return the file path. */
function rawFile(content: unknown): string {
  const path = join(freshDir(), "environments.json");
  writeFileSync(
    path,
    typeof content === "string" ? content : JSON.stringify(content),
  );
  return path;
}

const trial = { apiBaseUrl: "https://api-trial.cognigy.ai", apiKey: FAKE_KEY };

const flat: EnvironmentsFile = {
  "cognigy-trial(@nice.com)": trial,
  "cxone-sb41 (AS key)": {
    apiBaseUrl: "https://api-sb41.cognigy.cloud",
    apiKey: "FAKE-KEY-456",
  },
  dev: { apiBaseUrl: "https://api-dev.cognigy.ai", apiKey: "FAKE-KEY-789" },
};

describe("readEnvironmentsFile", () => {
  it("reports absent when the file does not exist", () => {
    expect(readEnvironmentsFile(join(freshDir(), "nope.json"))).toEqual({
      state: "absent",
    });
  });

  it("reads the flat name → entry shape, including names with spaces, parentheses and @", () => {
    expect(readEnvironmentsFile(rawFile(flat))).toEqual({
      state: "ok",
      file: flat,
    });
  });

  it("reads an empty object as an empty set of environments", () => {
    expect(readEnvironmentsFile(rawFile({}))).toEqual({
      state: "ok",
      file: {},
    });
  });

  it("keeps the optional host overrides", () => {
    const withHosts: EnvironmentsFile = {
      onprem: {
        apiBaseUrl: "https://api.test",
        apiKey: FAKE_KEY,
        endpointBaseUrl: "https://ep.test",
        webchatBaseUrl: "https://wc.test",
        staticFilesBaseUrl: "https://st.test",
      },
    };
    expect(readEnvironmentsFile(rawFile(withHosts))).toEqual({
      state: "ok",
      file: withHosts,
    });
  });

  it("trims whitespace around apiBaseUrl and apiKey", () => {
    expect(
      readEnvironmentsFile(
        rawFile({
          trial: {
            apiBaseUrl: "  https://api-trial.cognigy.ai\n",
            apiKey: `\t${FAKE_KEY}\r\n`,
          },
        }),
      ),
    ).toEqual({ state: "ok", file: { trial } });
  });

  it("ignores unknown fields", () => {
    expect(
      readEnvironmentsFile(
        rawFile({ trial: { ...trial, comment: "mine", extra: 1 } }),
      ),
    ).toEqual({ state: "ok", file: { trial } });
  });

  it("accepts names that differ only by case", () => {
    const state = readEnvironmentsFile(
      rawFile({ Trial: trial, trial: { ...trial, apiKey: "FAKE-KEY-2" } }),
    );
    expect(state.state).toBe("ok");
  });

  it("is invalid for malformed JSON, naming the path but quoting nothing from the file", () => {
    const path = rawFile(`{ "trial": { "apiKey": "${FAKE_KEY}" `);
    const state = readEnvironmentsFile(path);
    expect(state.state).toBe("invalid");
    if (state.state === "invalid") {
      expect(state.reason).toContain(path);
      expect(state.reason).not.toContain(FAKE_KEY);
    }
  });

  it("is invalid when an entry lacks apiKey, naming the entry but never printing a key", () => {
    const state = readEnvironmentsFile(
      rawFile({
        good: trial,
        broken: { apiBaseUrl: "https://api-eu.cognigy.ai" },
      }),
    );
    expect(state.state).toBe("invalid");
    if (state.state === "invalid") {
      expect(state.reason).toContain("broken");
      expect(state.reason).not.toContain(FAKE_KEY);
    }
  });

  it("is invalid when an apiKey is only whitespace", () => {
    const state = readEnvironmentsFile(
      rawFile({ trial: { apiBaseUrl: trial.apiBaseUrl, apiKey: "  " } }),
    );
    expect(state.state).toBe("invalid");
    if (state.state === "invalid") expect(state.reason).toContain('"trial"');
  });

  it("is invalid when the top level or an entry is not an object", () => {
    for (const content of [[], '"text"']) {
      const state = readEnvironmentsFile(rawFile(content));
      expect(state.state).toBe("invalid");
      if (state.state === "invalid") expect(state.reason).toMatch(/object/);
    }
    const entry = readEnvironmentsFile(rawFile({ trial: "x" }));
    expect(entry.state).toBe("invalid");
    if (entry.state === "invalid") expect(entry.reason).toContain('"trial"');
  });
});

describe("writeEnvironmentsFile", () => {
  it("creates the directory 0700 and the file 0600 and round-trips", () => {
    const path = join(freshDir(), "nested", "environments.json");
    writeEnvironmentsFile(flat, path);
    expect(readEnvironmentsFile(path)).toEqual({ state: "ok", file: flat });
    if (!isWindows) {
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(statSync(join(path, "..")).mode & 0o777).toBe(0o700);
    }
  });

  it("replaces atomically: no temp files left, file stays 0600 on overwrite", () => {
    const dir = freshDir();
    const path = join(dir, "environments.json");
    writeEnvironmentsFile(flat, path);
    if (!isWindows) chmodSync(path, 0o644);
    writeEnvironmentsFile({ only: trial }, path);

    expect(readdirSync(dir)).toEqual(["environments.json"]);
    expect(readEnvironmentsFile(path)).toEqual({
      state: "ok",
      file: { only: trial },
    });
    if (!isWindows) expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

describe("findEnvironmentName", () => {
  it("matches exactly, else by a single case-insensitive match", () => {
    expect(findEnvironmentName(flat, "dev")).toBe("dev");
    expect(findEnvironmentName(flat, "DEV")).toBe("dev");
    expect(findEnvironmentName(flat, "cxone-sb41 (as key)")).toBe(
      "cxone-sb41 (AS key)",
    );
  });

  it("prefers an exact match over a case-insensitive one", () => {
    const file: EnvironmentsFile = { Dev: trial, dev: trial };
    expect(findEnvironmentName(file, "dev")).toBe("dev");
    expect(findEnvironmentName(file, "Dev")).toBe("Dev");
  });

  it("returns undefined when ambiguous, unknown, or only a prefix", () => {
    const file: EnvironmentsFile = { Dev: trial, dev: trial };
    expect(findEnvironmentName(file, "DEV")).toBeUndefined();
    expect(findEnvironmentName(flat, "missing")).toBeUndefined();
    expect(findEnvironmentName(flat, "cognigy")).toBeUndefined();
  });
});

describe("validateEnvironmentName", () => {
  it("rejects empty, whitespace-only, padded, over-long and control-character names", () => {
    for (const bad of ["", "   ", " x", "x ", "x".repeat(101), "bad\nname"]) {
      expect(validateEnvironmentName(bad)).toEqual(expect.any(String));
    }
  });

  it("accepts ordinary names, including parentheses, spaces and @", () => {
    for (const good of [
      "cognigy-trial(@nice.com)",
      "cxone-sb41 (AS key)",
      "tenant n",
      "x".repeat(100),
    ]) {
      expect(validateEnvironmentName(good)).toBeUndefined();
    }
  });
});
