import { describe, it, expect, afterEach } from "@jest/globals";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readUserConfigFile, writeUserConfigFile } from "../userConfigFile.js";

const tmpDirs: string[] = [];
function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cognigy-cfg-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) {
    rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
  }
});

describe("writeUserConfigFile", () => {
  it("writes the values as JSON and returns the file path", () => {
    const dir = freshDir();
    const file = writeUserConfigFile(
      {
        COGNIGY_API_BASE_URL: "https://api-trial.cognigy.ai",
        COGNIGY_API_KEY: "k",
      },
      dir,
    );
    expect(file).toBe(join(dir, "config.json"));
    expect(readUserConfigFile(file)).toEqual({
      COGNIGY_API_BASE_URL: "https://api-trial.cognigy.ai",
      COGNIGY_API_KEY: "k",
    });
  });

  it("creates the file owner-only (0600)", () => {
    const dir = freshDir();
    const file = writeUserConfigFile({ COGNIGY_API_KEY: "secret" }, dir);
    // Low 9 permission bits should be rw for owner only.
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("re-tightens permissions when overwriting an existing file", () => {
    const dir = freshDir();
    const file = join(dir, "config.json");
    writeFileSync(file, "{}", { mode: 0o644 });
    writeUserConfigFile({ COGNIGY_API_KEY: "secret" }, dir);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("re-tightens a pre-existing directory to 0700", () => {
    const parent = freshDir();
    const dir = join(parent, "cfg");
    mkdirSync(dir, { mode: 0o755 });
    chmodSync(dir, 0o755); // umask can loosen mkdir's mode; force it broad
    writeUserConfigFile({ COGNIGY_API_KEY: "secret" }, dir);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });
});

describe("readUserConfigFile", () => {
  it("returns {} when the file is absent", () => {
    const dir = freshDir();
    expect(readUserConfigFile(join(dir, "config.json"))).toEqual({});
  });

  it("returns {} for malformed JSON", () => {
    const dir = freshDir();
    const file = join(dir, "config.json");
    writeFileSync(file, "{ not json");
    expect(readUserConfigFile(file)).toEqual({});
  });

  it("ignores non-string values and arrays", () => {
    const dir = freshDir();
    const file = join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({ COGNIGY_API_KEY: "k", nested: { a: 1 }, n: 5 }),
    );
    expect(readUserConfigFile(file)).toEqual({ COGNIGY_API_KEY: "k" });

    writeFileSync(file, JSON.stringify(["a", "b"]));
    expect(readUserConfigFile(file)).toEqual({});
  });
});
