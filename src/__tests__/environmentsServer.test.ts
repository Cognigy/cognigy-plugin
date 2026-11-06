/**
 * End-to-end: the real server process, started on credentials from the
 * environment (as today) with a flat environments.json in a temp HOME, driven
 * over stdio JSON-RPC. No Cognigy request is ever made: manage_environments is
 * answered locally.
 *
 * Like serverLifecycle.test.ts this runs the TypeScript entry through tsx,
 * because CI runs `npm test` before `npm run build`. HOME is always a temp dir,
 * so these tests never read or write the developer's real ~/.cognigy-plugin.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENTRY = join(REPO_ROOT, "src", "index.ts");
const BOOT_TIMEOUT_MS = 30000;
const TEST_TIMEOUT_MS = 60000;
const TRIAL = {
  apiBaseUrl: "https://api-trial.cognigy.ai",
  apiKey: "FAKE-KEY-TRIAL",
};
const APP = {
  apiBaseUrl: "https://api-app.cognigy.ai",
  apiKey: "FAKE-KEY-APP",
};
const FAKE_KEYS = [TRIAL.apiKey, APP.apiKey];

const homes: string[] = [];
const children: ChildProcessWithoutNullStreams[] = [];

/** A temp HOME, optionally holding an environments.json with this raw content. */
function freshHome(environmentsJson?: string): string {
  const home = mkdtempSync(join(tmpdir(), "cognigy-e2e-"));
  homes.push(home);
  if (environmentsJson !== undefined) {
    mkdirSync(join(home, ".cognigy-plugin"), { recursive: true });
    writeFileSync(
      join(home, ".cognigy-plugin", "environments.json"),
      environmentsJson,
    );
  }
  return home;
}

const flatFile = () => JSON.stringify({ trial: TRIAL, app: APP });

interface Server {
  stdout: () => string;
  stderr: () => string;
  request: (method: string, params?: object) => Promise<any>;
  /** tools/call, parsed from the text content (results and errors are JSON). */
  call: (name: string, args: Record<string, unknown>) => Promise<any>;
  ready: () => Promise<void>;
}

function startServer(home: string): Server {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    LOG_LEVEL: "info",
    COGNIGY_API_BASE_URL: TRIAL.apiBaseUrl,
    COGNIGY_API_KEY: TRIAL.apiKey,
  };
  const child = spawn(process.execPath, ["--import", "tsx", ENTRY], {
    cwd: REPO_ROOT,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.push(child);

  let out = "";
  let err = "";
  const pending = new Map<number, (message: any) => void>();
  child.stdout.on("data", (chunk: Buffer) => {
    out += chunk.toString();
    for (const line of out.split("\n")) {
      if (!line.trim().startsWith("{")) continue;
      try {
        const message = JSON.parse(line);
        pending.get(message.id)?.(message);
      } catch {
        // partial line; wait for more
      }
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    err += chunk.toString();
  });

  let nextId = 1;
  const send = (message: object) =>
    child.stdin.write(`${JSON.stringify(message)}\n`);
  const request = (method: string, params: object = {}) =>
    new Promise<any>((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(
        () => reject(new Error(`no response to ${method}`)),
        BOOT_TIMEOUT_MS,
      );
      pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      send({ jsonrpc: "2.0", id, method, params });
    });

  return {
    stdout: () => out,
    stderr: () => err,
    request,
    call: async (name, args) => {
      const response = await request("tools/call", { name, arguments: args });
      return JSON.parse(response.result.content[0].text);
    },
    ready: async () => {
      const deadline = Date.now() + BOOT_TIMEOUT_MS;
      while (!err.includes("started successfully")) {
        if (Date.now() > deadline) {
          throw new Error(`server did not start: ${err}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await request("initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "environments-e2e", version: "0.0.0" },
      });
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
    },
  };
}

afterAll(() => {
  for (const child of children) child.kill("SIGKILL");
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

describe("server with credentials from the environment and a flat environments.json", () => {
  let server: Server;

  beforeAll(async () => {
    server = startServer(freshHome(flatFile()));
    await server.ready();
  }, TEST_TIMEOUT_MS);

  it(
    "advertises manage_environments",
    async () => {
      const response = await server.request("tools/list");
      expect(response.result.tools.map((t: any) => t.name)).toContain(
        "manage_environments",
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "starts on the plugin credentials and names the matching entry",
    async () => {
      expect(
        await server.call("manage_environments", { operation: "current" }),
      ).toEqual({
        environment: "trial",
        apiBaseUrl: TRIAL.apiBaseUrl,
        source: "plugin-config",
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "use switches this session, and the next current says so",
    async () => {
      const switched = await server.call("manage_environments", {
        operation: "use",
        name: "APP",
      });
      expect(switched.previous).toBe("trial");
      expect(switched.current.name).toBe("app");
      expect(switched.scope).toMatch(/engine process.*shared by every chat/i);

      expect(
        await server.call("manage_environments", { operation: "current" }),
      ).toMatchObject({ environment: "app", source: "session" });
    },
    TEST_TIMEOUT_MS,
  );

  it("neither stdout nor stderr ever contains a key", () => {
    for (const key of FAKE_KEYS) {
      expect(server.stdout()).not.toContain(key);
      expect(server.stderr()).not.toContain(key);
    }
  });
});

describe("a platform call after use goes to the NEW environment", () => {
  it(
    "reaches the switched environment's base URL, not the starting one",
    async () => {
      // `dead` points at a closed local port: if the call really goes there it
      // fails with a connection error naming that address; if the switch were
      // ignored it would go to the starting environment's real host instead.
      const server = startServer(
        freshHome(
          JSON.stringify({
            trial: TRIAL,
            dead: { apiBaseUrl: "http://127.0.0.1:9", apiKey: "FAKE-KEY-DEAD" },
          }),
        ),
      );
      await server.ready();
      await server.call("manage_environments", {
        operation: "use",
        name: "dead",
      });
      const result = await server.call("list_resources", {
        resourceType: "project",
      });
      expect(JSON.stringify(result)).toMatch(/127\.0\.0\.1:9|ECONNREFUSED/);
      expect(server.stderr()).not.toContain("FAKE-KEY-DEAD");
    },
    TEST_TIMEOUT_MS,
  );
});

describe("server with an unusable or missing environments file", () => {
  it(
    "still boots on a malformed file; list reports the problem without any key",
    async () => {
      const server = startServer(
        freshHome(`{ "trial": { "apiKey": "${TRIAL.apiKey}" `),
      );
      await server.ready();

      expect(
        await server.call("manage_environments", { operation: "current" }),
      ).toMatchObject({ environment: null, source: "plugin-config" });

      const listed = await server.call("manage_environments", {
        operation: "list",
      });
      expect(listed.error).toMatch(/not valid JSON/);
      for (const key of FAKE_KEYS) {
        expect(JSON.stringify(listed)).not.toContain(key);
        expect(server.stderr()).not.toContain(key);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "boots with no file at all; list says how to add one",
    async () => {
      const server = startServer(freshHome());
      await server.ready();
      const listed = await server.call("manage_environments", {
        operation: "list",
      });
      expect(listed.environments).toEqual([]);
      expect(listed.note).toMatch(/cognigy-env add/);
    },
    TEST_TIMEOUT_MS,
  );
});
