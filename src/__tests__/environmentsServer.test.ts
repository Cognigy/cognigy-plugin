/**
 * End-to-end: the real server process over stdio JSON-RPC, with two local fake
 * Cognigy APIs standing in for the default environment and a "trial" one, so
 * the tests see which API (and which key) each call actually reached.
 *
 * Like serverLifecycle.test.ts this runs the TypeScript entry through tsx,
 * because CI runs `npm test` before `npm run build`. HOME is always a temp dir,
 * so these tests never read or write the developer's real ~/.cognigy-plugin.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { createServer, type Server as HttpServer } from "http";
import type { AddressInfo } from "net";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENTRY = join(REPO_ROOT, "src", "index.ts");
const TIMEOUT_MS = 30000;

interface FakeApi {
  url: string;
  keys: string[];
  server: HttpServer;
}

/** A fake Cognigy API that records the key of every request it gets. */
function fakeApi(): Promise<FakeApi> {
  const api = { keys: [] as string[] } as FakeApi;
  api.server = createServer((req, res) => {
    api.keys.push(String(req.headers["x-api-key"]));
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ items: [], total: 0 }));
  });
  return new Promise((resolve) =>
    api.server.listen(0, "127.0.0.1", () => {
      api.url = `http://127.0.0.1:${(api.server.address() as AddressInfo).port}`;
      resolve(api);
    }),
  );
}

let defaultApi: FakeApi;
let trialApi: FakeApi;
const homes: string[] = [];
const children: ChildProcessWithoutNullStreams[] = [];

beforeAll(async () => {
  defaultApi = await fakeApi();
  trialApi = await fakeApi();
});

afterAll(() => {
  for (const child of children) child.kill("SIGKILL");
  for (const home of homes) rmSync(home, { recursive: true, force: true });
  defaultApi.server.close();
  trialApi.server.close();
});

/** A temp HOME, optionally holding an environments.json with this raw content. */
function freshHome(environmentsJson?: string): string {
  const home = mkdtempSync(join(tmpdir(), "cognigy-envs-e2e-"));
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

async function startServer(home: string) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // The fake APIs are on localhost: never route them through a dev proxy.
  for (const key of [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "http_proxy",
    "https_proxy",
  ]) {
    delete env[key];
  }
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    NO_PROXY: "*",
    no_proxy: "*",
    COGNIGY_API_BASE_URL: defaultApi.url,
    COGNIGY_API_KEY: "FAKE-DEFAULT",
  });
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
    const lines = out.split("\n");
    out = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim().startsWith("{")) continue;
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
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
        () => reject(new Error(`no response to ${method}: ${err}`)),
        TIMEOUT_MS,
      );
      pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      send({ jsonrpc: "2.0", id, method, params });
    });

  await request("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "environments-e2e", version: "0.0.0" },
  });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });

  return {
    listTools: async () => (await request("tools/list")).result.tools,
    /** tools/call: the parsed JSON text plus the isError flag. */
    call: async (args: Record<string, unknown>) => {
      const response = await request("tools/call", {
        name: "list_resources",
        arguments: { resourceType: "project", ...args },
      });
      return {
        isError: Boolean(response.result.isError),
        text: response.result.content[0].text as string,
        body: JSON.parse(response.result.content[0].text),
      };
    },
  };
}

function resetCounts() {
  defaultApi.keys.length = 0;
  trialApi.keys.length = 0;
}

describe("one environment (no environments.json)", () => {
  it(
    "lists the tools unchanged and runs every call on the plugin's own login",
    async () => {
      const server = await startServer(freshHome());
      const tools = await server.listTools();
      expect(tools.some((t: any) => t.inputSchema.properties.environment)).toBe(
        false,
      );

      resetCounts();
      const result = await server.call({});
      expect(result.isError).toBe(false);
      expect(result.body._environment).toBeUndefined();
      expect(defaultApi.keys).toContain("FAKE-DEFAULT");
      expect(trialApi.keys).toEqual([]);
    },
    TIMEOUT_MS * 2,
  );
});

describe("extra environments", () => {
  let server: Awaited<ReturnType<typeof startServer>>;

  beforeAll(async () => {
    server = await startServer(
      freshHome(
        JSON.stringify({
          trial: { apiBaseUrl: trialApi.url, apiKey: "FAKE-TRIAL" },
        }),
      ),
    );
  }, TIMEOUT_MS * 2);

  it("offers a required environment field on every tool", async () => {
    const tools = await server.listTools();
    for (const tool of tools) {
      expect(tool.inputSchema.properties.environment.enum).toEqual([
        "default",
        "trial",
      ]);
      expect(tool.inputSchema.required).toContain("environment");
    }
  });

  it("refuses a call without an environment and reaches no API", async () => {
    resetCounts();
    const result = await server.call({});
    expect(result.isError).toBe(true);
    expect(result.body.error).toContain("Ask the user which one to use");
    expect(result.text).not.toMatch(/FAKE-/);
    expect([...defaultApi.keys, ...trialApi.keys]).toEqual([]);
  });

  it("sends each call to the environment it names, and says which", async () => {
    resetCounts();
    const trial = await server.call({ environment: "trial" });
    expect(trial.body._environment).toBe("trial");
    expect(trialApi.keys.length).toBeGreaterThan(0);
    expect(trialApi.keys.every((k) => k === "FAKE-TRIAL")).toBe(true);
    expect(defaultApi.keys).toEqual([]);

    resetCounts();
    const fallback = await server.call({ environment: "default" });
    expect(fallback.body._environment).toBe("default");
    expect(defaultApi.keys.every((k) => k === "FAKE-DEFAULT")).toBe(true);
    expect(trialApi.keys).toEqual([]);
  });
});

describe("an unusable environments.json", () => {
  it(
    "fails calls loudly instead of using the default, without quoting the file",
    async () => {
      const server = await startServer(freshHome('{"trial": FAKE-BROKEN'));
      resetCounts();
      const result = await server.call({});
      expect(result.isError).toBe(true);
      expect(result.body.error).toMatch(/not valid JSON.*cognigy-envs/);
      expect(result.text).not.toContain("FAKE-BROKEN");
      expect([...defaultApi.keys, ...trialApi.keys]).toEqual([]);
    },
    TIMEOUT_MS * 2,
  );
});
