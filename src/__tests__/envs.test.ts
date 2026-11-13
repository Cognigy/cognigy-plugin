import { afterAll, describe, expect, it } from "@jest/globals";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseBaseUrl, runEnvs, type EnvsIo } from "../envs.js";

const UP = "\x1b[A";
const DOWN = "\x1b[B";
const ENTER = "\r";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function freshDir(environments?: object | string): string {
  const dir = mkdtempSync(join(tmpdir(), "cognigy-envs-menu-"));
  dirs.push(dir);
  if (environments !== undefined) {
    writeFileSync(
      join(dir, "environments.json"),
      typeof environments === "string"
        ? environments
        : JSON.stringify(environments),
    );
  }
  return dir;
}

/** Scripted terminal: key presses, typed answers and hidden answers, in order. */
function scripted(
  dir: string,
  script: { keys?: string[]; answers?: string[]; hidden?: string[] },
  isTTY = true,
) {
  const keys = [...(script.keys ?? []), "q"];
  const answers = [...(script.answers ?? [])];
  const hidden = [...(script.hidden ?? [])];
  let output = "";
  const io: EnvsIo = {
    write: (text) => {
      output += text;
    },
    ask: async () => answers.shift() ?? "",
    askHidden: async () => hidden.shift() ?? "",
    readKey: async () => keys.shift() ?? "q",
    isTTY,
    dir,
  };
  return { io, output: () => output };
}

const saved = (dir: string) =>
  JSON.parse(readFileSync(join(dir, "environments.json"), "utf-8"));

const TRIAL = {
  apiBaseUrl: "https://api-trial.cognigy.ai",
  apiKey: "FAKE-TRIAL-KEY-0001",
};

describe("cognigy-envs menu", () => {
  it("adds an environment, accepting a URL without https://", async () => {
    const dir = freshDir();
    const t = scripted(dir, {
      keys: [ENTER], // the only item is "+ Add an environment"
      answers: ["trial", "api-trial.cognigy.ai/"],
      hidden: ["FAKE-TRIAL-KEY-0001"],
    });
    expect(await runEnvs(t.io)).toBe(0);
    expect(saved(dir)).toEqual({ trial: TRIAL });
    expect(t.output()).toContain("✔ Added trial.");
    expect(t.output()).not.toContain("FAKE-TRIAL-KEY-0001");
  });

  it("shows the default login and every environment", async () => {
    const dir = freshDir({ trial: TRIAL });
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ COGNIGY_API_BASE_URL: "https://api-app.cognigy.ai" }),
    );
    const t = scripted(dir, {});
    await runEnvs(t.io);
    expect(t.output()).toMatch(/default\s+https:\/\/api-app\.cognigy\.ai/);
    expect(t.output()).toMatch(/trial\s+https:\/\/api-trial\.cognigy\.ai/);
    expect(t.output()).toContain("+ Add an environment");
  });

  it("refuses the reserved name and a duplicate in any case", async () => {
    const dir = freshDir({ trial: TRIAL });
    const t = scripted(dir, {
      keys: [DOWN, ENTER, ENTER],
      answers: ["Default", "TRIAL"],
    });
    await runEnvs(t.io);
    expect(t.output()).toContain("reserved for the plugin's own credentials");
    expect(t.output()).toContain('"TRIAL" already exists');
    expect(saved(dir)).toEqual({ trial: TRIAL });
  });

  it("changes the key and keeps the URL when Enter is pressed", async () => {
    const dir = freshDir({ trial: TRIAL });
    const t = scripted(dir, {
      keys: [ENTER],
      answers: [""],
      hidden: ["FAKE-ROTATED-KEY-0002"],
    });
    await runEnvs(t.io);
    expect(saved(dir)).toEqual({
      trial: { apiBaseUrl: TRIAL.apiBaseUrl, apiKey: "FAKE-ROTATED-KEY-0002" },
    });
    expect(t.output()).not.toContain("FAKE-ROTATED-KEY-0002");
    expect(t.output()).not.toContain(TRIAL.apiKey);
  });

  it("deletes only after a yes", async () => {
    const dir = freshDir({ trial: TRIAL, app: TRIAL });
    const t = scripted(dir, {
      keys: ["d", DOWN, UP, "d"],
      answers: ["n", "y"],
    });
    await runEnvs(t.io);
    expect(saved(dir)).toEqual({ app: TRIAL });
    expect(t.output()).toContain("Nothing deleted.");
    expect(t.output()).toContain("✔ Deleted trial.");
  });

  it("renames a stored environment called default before opening", async () => {
    const dir = freshDir({ Default: TRIAL });
    const t = scripted(dir, { answers: ["main"] });
    expect(await runEnvs(t.io)).toBe(0);
    expect(saved(dir)).toEqual({ main: TRIAL });
    expect(t.output()).toContain("reserved for the plugin's own login");
  });

  it("keeps a stored default when the new name is not usable", async () => {
    const dir = freshDir({ default: TRIAL, trial: TRIAL });
    const t = scripted(dir, { answers: ["TRIAL"] });
    expect(await runEnvs(t.io)).toBe(1);
    expect(saved(dir)).toEqual({ default: TRIAL, trial: TRIAL });
    expect(t.output()).toContain('"TRIAL" already exists. Nothing changed.');
  });

  it("explains a stored default outside a terminal and changes nothing", async () => {
    const dir = freshDir({ default: TRIAL });
    const t = scripted(dir, {}, false);
    expect(await runEnvs(t.io)).toBe(1);
    expect(saved(dir)).toEqual({ default: TRIAL });
  });

  it("stops on a broken file without quoting it", async () => {
    const dir = freshDir('{"trial": FAKE-BROKEN');
    const t = scripted(dir, {});
    expect(await runEnvs(t.io)).toBe(1);
    expect(t.output()).toContain("not valid JSON");
    expect(t.output()).not.toContain("FAKE-BROKEN");
  });

  it("prints the list when it is not attached to a terminal", async () => {
    const dir = freshDir({ trial: TRIAL });
    const t = scripted(dir, {}, false);
    expect(await runEnvs(t.io)).toBe(0);
    expect(t.output()).toMatch(/trial\s+https:\/\/api-trial\.cognigy\.ai/);
    expect(t.output()).not.toContain("Add an environment");
  });
});

describe("parseBaseUrl", () => {
  it("adds https:// when missing and drops trailing slashes", () => {
    expect(parseBaseUrl(" api-trial.cognigy.ai/ ")).toBe(
      "https://api-trial.cognigy.ai",
    );
    expect(parseBaseUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("rejects what is not an http(s) URL", () => {
    expect(parseBaseUrl("")).toBeUndefined();
    expect(parseBaseUrl("ftp://example.com")).toBeUndefined();
    expect(parseBaseUrl("https://")).toBeUndefined();
  });
});
