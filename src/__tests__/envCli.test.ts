import { describe, it, expect, afterEach } from "@jest/globals";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runEnvCli, type EnvCliIo } from "../env.js";

const FAKE_KEY = "FAKE-KEY-1234567890-ABCDEFGH";
const ODD = "cognigy-trial(@nice.com)";
const CX = "cxone-sb41 (AS key)";
const isWindows = process.platform === "win32";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length)
    rmSync(dirs.pop() as string, { recursive: true, force: true });
});

interface Harness {
  io: EnvCliIo;
  dir: string;
  lines: () => string;
  env: () => Record<string, any>;
  config: () => Record<string, any>;
}

/** A fake terminal over a temp dir. `secret` answers askHidden; `answers` answer ask. */
function harness(
  opts: {
    environments?: Record<string, unknown>;
    config?: Record<string, unknown>;
    secret?: string;
    answers?: string[];
    keys?: string[];
    isTTY?: boolean;
  } = {},
): Harness {
  const dir = mkdtempSync(join(tmpdir(), "cognigy-envcli-"));
  dirs.push(dir);
  if (opts.environments) {
    writeFileSync(
      join(dir, "environments.json"),
      JSON.stringify(opts.environments),
    );
  }
  if (opts.config) {
    writeFileSync(join(dir, "config.json"), JSON.stringify(opts.config));
  }
  const out: string[] = [];
  const answers = [...(opts.answers ?? [])];
  const keys = [...(opts.keys ?? [])];
  const io: EnvCliIo = {
    out: (line) => out.push(line),
    err: (line) => out.push(`ERR ${line}`),
    ask: async () => answers.shift() ?? "",
    askHidden: async () => opts.secret ?? "",
    readKey: async () => keys.shift() ?? "q",
    isTTY: opts.isTTY ?? false,
    dir,
  };
  const read = (file: string) => {
    try {
      return JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch {
      return undefined;
    }
  };
  return {
    io,
    dir,
    lines: () => out.join("\n"),
    env: () => read("environments.json"),
    config: () => read("config.json"),
  };
}

const trial = { apiBaseUrl: "https://api-trial.cognigy.ai", apiKey: FAKE_KEY };
const app = {
  apiBaseUrl: "https://api-app.cognigy.ai",
  apiKey: "FAKE-KEY-APP-0987654321",
};
const three = {
  [ODD]: trial,
  [CX]: app,
  dev: {
    apiBaseUrl: "https://api-dev.cognigy.ai",
    apiKey: "FAKE-KEY-DEV-1122334455",
  },
};

describe("cognigy-env help and errors", () => {
  it("help and --help print usage and exit 0", async () => {
    for (const arg of ["help", "--help"]) {
      const h = harness();
      expect(await runEnvCli([arg], h.io)).toBe(0);
      expect(h.lines()).toMatch(/cognigy-env add <name> <base-url>/);
    }
  });

  it("an unknown command prints usage and exits 1", async () => {
    const h = harness();
    expect(await runEnvCli(["frobnicate"], h.io)).toBe(1);
    expect(h.lines()).toMatch(/Unknown command/);
  });

  it("add, use and remove without a name exit 1", async () => {
    for (const cmd of ["add", "use", "remove", "save-current"]) {
      expect(await runEnvCli([cmd], harness().io)).toBe(1);
    }
  });
});

describe("cognigy-env add", () => {
  it("prompts for the key hidden, saves the entry owner-only, and never prints the key", async () => {
    const h = harness({ secret: FAKE_KEY });
    expect(
      await runEnvCli(["add", ODD, "https://api-trial.cognigy.ai"], h.io),
    ).toBe(0);
    expect(h.env()).toEqual({ [ODD]: trial });
    expect(h.lines()).toContain("saved");
    expect(h.lines()).not.toContain(FAKE_KEY);
    if (!isWindows) {
      expect(statSync(join(h.dir, "environments.json")).mode & 0o777).toBe(
        0o600,
      );
    }
  });

  it("trims a pasted URL and key and drops trailing slashes", async () => {
    const h = harness({ secret: `  ${FAKE_KEY}\n` });
    await runEnvCli(
      ["add", "trial", "  https://api-trial.cognigy.ai//  "],
      h.io,
    );
    expect(h.env()).toEqual({ trial });
  });

  it("adds or overwrites: the same name again replaces the entry, other entries stay", async () => {
    const h = harness({
      environments: { trial, dev: three.dev },
      secret: "FAKE-KEY-NEW-999999999",
      answers: ["y"],
    });
    await runEnvCli(["add", "TRIAL", "https://api-trial.cognigy.ai"], h.io);
    expect(h.env()).toEqual({
      trial: { ...trial, apiKey: "FAKE-KEY-NEW-999999999" },
      dev: three.dev,
    });
  });

  it("saves into the file as it is when the key is entered, keeping an environment another terminal added meanwhile", async () => {
    const h = harness({ environments: { trial } });
    h.io.askHidden = async () => {
      writeFileSync(
        join(h.dir, "environments.json"),
        JSON.stringify({ trial, dev: three.dev }),
      );
      return "FAKE-KEY-NEW-999999999";
    };
    expect(
      await runEnvCli(["add", "fresh", "https://api-fresh.cognigy.ai"], h.io),
    ).toBe(0);
    expect(Object.keys(h.env()).sort()).toEqual(["dev", "fresh", "trial"]);
    expect(h.env().dev).toEqual(three.dev);
  });

  describe("replacing an existing environment asks first", () => {
    const withSpy = (answers: string[]) => {
      const h = harness({
        environments: { trial, dev: three.dev },
        secret: "FAKE-KEY-NEW-999999999",
        answers,
      });
      const hiddenPrompts: string[] = [];
      const original = h.io.askHidden;
      h.io.askHidden = async (q) => {
        hiddenPrompts.push(q);
        return original(q);
      };
      return { h, hiddenPrompts };
    };

    it.each([[""], ["n"], ["no"], ["maybe"]])(
      "answer %j leaves the file untouched and never asks for a key",
      async (answer) => {
        const { h, hiddenPrompts } = withSpy([answer]);
        const code = await runEnvCli(
          ["add", "trial", "https://api-trial.cognigy.ai"],
          h.io,
        );
        expect(code).toBe(1);
        expect(h.env()).toEqual({ trial, dev: three.dev });
        expect(hiddenPrompts).toEqual([]);
        expect(h.lines()).toMatch(/nothing (was )?(changed|saved)/i);
      },
    );

    it.each([["y"], ["Y"], ["yes"]])(
      "answer %j replaces the key",
      async (answer) => {
        const { h } = withSpy([answer]);
        expect(
          await runEnvCli(
            ["add", "trial", "https://api-trial.cognigy.ai"],
            h.io,
          ),
        ).toBe(0);
        expect(h.env().trial.apiKey).toBe("FAKE-KEY-NEW-999999999");
      },
    );

    it("shows the existing URL and a masked key, never the full key", async () => {
      const { h } = withSpy(["n"]);
      await runEnvCli(["add", "trial", "https://api-trial.cognigy.ai"], h.io);
      expect(h.lines()).toContain(trial.apiBaseUrl);
      expect(h.lines()).not.toContain(trial.apiKey);
    });

    it("a new name asks nothing", async () => {
      const { h, hiddenPrompts } = withSpy([]);
      expect(
        await runEnvCli(
          ["add", "brand-new", "https://api-new.cognigy.ai"],
          h.io,
        ),
      ).toBe(0);
      expect(hiddenPrompts).toHaveLength(1);
      expect(h.env()["brand-new"].apiKey).toBe("FAKE-KEY-NEW-999999999");
    });
  });

  it("works with names containing spaces, parentheses and @", async () => {
    const h = harness({ secret: FAKE_KEY });
    await runEnvCli(["add", CX, "https://api-sb41.cognigy.cloud"], h.io);
    expect(Object.keys(h.env())).toEqual([CX]);
  });

  it("rejects a missing or empty key, a non-http(s) URL and an invalid name, writing nothing", async () => {
    const empty = harness({ secret: "" });
    expect(
      await runEnvCli(["add", "x", "https://api.cognigy.ai"], empty.io),
    ).toBe(1);
    expect(empty.env()).toBeUndefined();

    const badUrl = harness({ secret: FAKE_KEY });
    expect(await runEnvCli(["add", "x", "ftp://nope"], badUrl.io)).toBe(1);
    expect(await runEnvCli(["add", "x", "not a url"], badUrl.io)).toBe(1);
    expect(badUrl.env()).toBeUndefined();

    const badName = harness({ secret: FAKE_KEY });
    expect(
      await runEnvCli(
        ["add", "__proto__", "https://api.cognigy.ai"],
        badName.io,
      ),
    ).toBe(1);
    expect(badName.env()).toBeUndefined();
  });

  it("refuses to touch a malformed file", async () => {
    const h = harness({ secret: FAKE_KEY });
    writeFileSync(join(h.dir, "environments.json"), "{ not json");
    expect(await runEnvCli(["add", "x", "https://api.cognigy.ai"], h.io)).toBe(
      1,
    );
    expect(readFileSync(join(h.dir, "environments.json"), "utf8")).toBe(
      "{ not json",
    );
  });
});

describe("cognigy-env use", () => {
  it("writes the URL and key into config.json, preserving other keys, with a masked key", async () => {
    const h = harness({
      environments: three,
      config: {
        COGNIGY_API_BASE_URL: "https://old.example",
        COGNIGY_API_KEY: "OLD",
        OTHER: "keep",
      },
    });
    expect(await runEnvCli(["use", "DEV"], h.io)).toBe(0);
    expect(h.config()).toEqual({
      COGNIGY_API_BASE_URL: "https://api-dev.cognigy.ai",
      COGNIGY_API_KEY: "FAKE-KEY-DEV-1122334455",
      OTHER: "keep",
    });
    expect(h.lines()).toContain("active: dev");
    expect(h.lines()).toContain("FAKE-K…4455");
    expect(h.lines()).not.toContain("FAKE-KEY-DEV-1122334455");
    expect(h.lines()).toMatch(/running sessions are unaffected/i);
    if (!isWindows)
      expect(statSync(join(h.dir, "config.json")).mode & 0o777).toBe(0o600);
  });

  it("creates config.json when it does not exist", async () => {
    const h = harness({ environments: three });
    await runEnvCli(["use", ODD], h.io);
    expect(h.config()).toEqual({
      COGNIGY_API_BASE_URL: trial.apiBaseUrl,
      COGNIGY_API_KEY: trial.apiKey,
    });
  });

  it("an unknown name exits 1, lists the names and changes nothing", async () => {
    const h = harness({ environments: three, config: { OTHER: "keep" } });
    expect(await runEnvCli(["use", "nope"], h.io)).toBe(1);
    expect(h.lines()).toContain("dev");
    expect(h.config()).toEqual({ OTHER: "keep" });
  });

  it("works with names containing spaces and parentheses", async () => {
    const h = harness({ environments: three });
    expect(await runEnvCli(["use", "CXONE-SB41 (AS KEY)"], h.io)).toBe(0);
    expect(h.config()?.COGNIGY_API_KEY).toBe(app.apiKey);
  });
});

describe("cognigy-env save-current, list, current, remove", () => {
  it("save-current stores config.json's credentials under a name, then list marks it", async () => {
    const h = harness({
      config: {
        COGNIGY_API_BASE_URL: trial.apiBaseUrl,
        COGNIGY_API_KEY: trial.apiKey,
      },
    });
    expect(await runEnvCli(["save-current", "mine"], h.io)).toBe(0);
    expect(h.env()).toEqual({ mine: trial });
    const listing = harness({ environments: h.env(), config: h.config() });
    await runEnvCli(["list"], listing.io);
    expect(listing.lines()).toMatch(/\* mine/);
  });

  it("save-current fails when config.json holds no credentials", async () => {
    expect(
      await runEnvCli(["save-current", "mine"], harness({ config: {} }).io),
    ).toBe(1);
  });

  it("list marks the entry matching config.json, matching a bare UI URL, and prints no keys", async () => {
    const h = harness({
      environments: {
        ...three,
        trialUi: {
          apiBaseUrl: "https://trial.cognigy.ai/",
          apiKey: "FAKE-KEY-UI",
        },
      },
      config: {
        COGNIGY_API_BASE_URL: "https://api-trial.cognigy.ai",
        COGNIGY_API_KEY: "FAKE-KEY-UI",
      },
    });
    expect(await runEnvCli(["list"], h.io)).toBe(0);
    const marked = h
      .lines()
      .split("\n")
      .filter((l) => l.startsWith("*"));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain("trialUi");
    for (const entry of Object.values({ ...three })) {
      expect(h.lines()).not.toContain((entry as any).apiKey);
    }
  });

  it("list with nothing says how to add one", async () => {
    const h = harness();
    expect(await runEnvCli(["list"], h.io)).toBe(0);
    expect(h.lines()).toMatch(/cognigy-env add <name> <base-url>/);
  });

  it("current names the active environment, or says it is not in the file", async () => {
    const named = harness({
      environments: three,
      config: {
        COGNIGY_API_BASE_URL: trial.apiBaseUrl,
        COGNIGY_API_KEY: trial.apiKey,
      },
    });
    await runEnvCli(["current"], named.io);
    expect(named.lines()).toContain(ODD);

    const unknown = harness({
      environments: three,
      config: {
        COGNIGY_API_BASE_URL: "https://api-else.cognigy.ai",
        COGNIGY_API_KEY: "X",
      },
    });
    await runEnvCli(["current"], unknown.io);
    expect(unknown.lines()).toMatch(/not in environments\.json/);
    expect(unknown.lines()).toContain("https://api-else.cognigy.ai");
  });

  it("remove deletes the entry and leaves config.json untouched", async () => {
    const config = {
      COGNIGY_API_BASE_URL: trial.apiBaseUrl,
      COGNIGY_API_KEY: trial.apiKey,
    };
    const h = harness({ environments: three, config });
    expect(await runEnvCli(["remove", "dev"], h.io)).toBe(0);
    expect(Object.keys(h.env())).toEqual([ODD, CX]);
    expect(h.config()).toEqual(config);
  });

  it("remove of an unknown name exits 1 and changes nothing", async () => {
    const h = harness({ environments: three });
    expect(await runEnvCli(["remove", "nope"], h.io)).toBe(1);
    expect(h.env()).toEqual(three);
  });
});

describe("cognigy-env menu (no arguments)", () => {
  it("on a terminal: down, down, Enter activates the third entry", async () => {
    const h = harness({
      environments: three,
      isTTY: true,
      keys: ["\x1b[B", "j", "\r"],
    });
    expect(await runEnvCli([], h.io)).toBe(0);
    expect(h.config()?.COGNIGY_API_KEY).toBe("FAKE-KEY-DEV-1122334455");
  });

  it("up wraps from the first entry to the last, k moves up", async () => {
    const h = harness({
      environments: three,
      isTTY: true,
      keys: ["\x1b[A", "\r"],
    });
    await runEnvCli([], h.io);
    expect(h.config()?.COGNIGY_API_KEY).toBe("FAKE-KEY-DEV-1122334455");
    const h2 = harness({
      environments: three,
      isTTY: true,
      keys: ["j", "k", "\r"],
    });
    await runEnvCli([], h2.io);
    expect(h2.config()?.COGNIGY_API_KEY).toBe(trial.apiKey);
  });

  it("starts the cursor on the active entry", async () => {
    const h = harness({
      environments: three,
      config: {
        COGNIGY_API_BASE_URL: app.apiBaseUrl,
        COGNIGY_API_KEY: app.apiKey,
      },
      isTTY: true,
      keys: ["\r"],
    });
    await runEnvCli([], h.io);
    expect(h.config()?.COGNIGY_API_KEY).toBe(app.apiKey);
  });

  it("q quits with exit 0 and writes nothing", async () => {
    const h = harness({ environments: three, isTTY: true, keys: ["q"] });
    expect(await runEnvCli([], h.io)).toBe(0);
    expect(h.config()).toBeUndefined();
  });

  it("off a terminal it prints the usage and exits 1, writing nothing", async () => {
    const h = harness({ environments: three, answers: ["2"] });
    expect(await runEnvCli([], h.io)).toBe(1);
    expect(h.lines()).toMatch(/cognigy-env add <name> <base-url>/);
    expect(h.config()).toBeUndefined();
  });

  it("with no environments it says how to add one", async () => {
    const h = harness({ isTTY: true });
    expect(await runEnvCli([], h.io)).toBe(0);
    expect(h.lines()).toMatch(/cognigy-env add <name> <base-url>/);
  });
});

describe("cognigy-env output never contains a full key", () => {
  it("across every command", async () => {
    const h = harness({
      environments: three,
      config: {
        COGNIGY_API_BASE_URL: trial.apiBaseUrl,
        COGNIGY_API_KEY: trial.apiKey,
      },
      secret: "FAKE-KEY-NEWLY-ADDED-0001",
      answers: ["1"],
    });
    for (const argv of [
      ["list"],
      ["current"],
      ["use", "dev"],
      ["add", "fresh", "https://api-x.cognigy.ai"],
      ["save-current", "s"],
      ["remove", "fresh"],
      [],
    ]) {
      await runEnvCli(argv, h.io);
    }
    const all = h.lines();
    for (const key of [
      trial.apiKey,
      app.apiKey,
      "FAKE-KEY-DEV-1122334455",
      "FAKE-KEY-NEWLY-ADDED-0001",
    ]) {
      expect(all).not.toContain(key);
    }
  });
});

describe("package.json", () => {
  it("maps the cognigy-env bin to dist/env.js", () => {
    const pkg = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    );
    expect(pkg.bin["cognigy-env"]).toBe("dist/env.js");
  });
});
