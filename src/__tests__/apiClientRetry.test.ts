/**
 * The client retries 429/5xx, which is only safe for idempotent requests.
 * `noRetry` opts a single request out; other requests keep retrying.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { createServer, type Server } from "http";
import { AddressInfo } from "net";
import { CognigyApiClient } from "../api/client.js";
import { ToolHandlers } from "../tools/handlers.js";

const SIM = "60d5ec49f1a2c8b1a4e0a001";
const PROJECT = "507f1f77bcf86cd799439011";

const PROXY_ENV_VARS = [
  "HTTP_PROXY",
  "http_proxy",
  "HTTPS_PROXY",
  "https_proxy",
  "ALL_PROXY",
  "all_proxy",
  "npm_config_proxy",
  "npm_config_http_proxy",
  "npm_config_https_proxy",
];

let server: Server;
let base = "";
const hits: string[] = [];
let rateLimited = false;
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const key of PROXY_ENV_VARS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  server = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    req.resume();
    req.on("end", () => {
      if (req.url === "/rate-once" && !rateLimited) {
        rateLimited = true;
        res.writeHead(429, { "Content-Type": "text/plain" });
        res.end("Too Many Requests");
        return;
      }
      if (req.url === "/rate-once") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
        return;
      }
      if (
        req.method === "GET" &&
        req.url?.startsWith(`/testing/simulations/${SIM}?`)
      ) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ _id: SIM, flowReferenceId: "f-uuid" }));
        return;
      }
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Bad Gateway");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const key of PROXY_ENV_VARS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("CognigyApiClient retries", () => {
  it("sends a noRetry POST exactly once on a 502", async () => {
    hits.length = 0;
    const client = new CognigyApiClient({ baseUrl: base, apiKey: "k" });
    await expect(
      client.post(`${base}/once`, { a: 1 }, { noRetry: true }),
    ).rejects.toMatchObject({ status: 502 });
    expect(hits).toEqual(["POST /once"]);
  });

  it("sends a noRetry upload exactly once on a 502", async () => {
    hits.length = 0;
    const client = new CognigyApiClient({ baseUrl: base, apiKey: "k" });
    await expect(
      client.uploadFile(
        `${base}/upload`,
        Buffer.from("a,b"),
        "a.csv",
        {},
        {
          noRetry: true,
        },
      ),
    ).rejects.toMatchObject({ status: 502 });
    expect(hits).toEqual(["POST /upload"]);
  });

  it("retries a noRetry request on 429, which the server did not act on", async () => {
    hits.length = 0;
    const client = new CognigyApiClient({ baseUrl: base, apiKey: "k" });
    await expect(
      client.post(`${base}/rate-once`, {}, { noRetry: true }),
    ).resolves.toEqual({});
    expect(hits).toEqual(["POST /rate-once", "POST /rate-once"]);
  });

  it("still retries a request without the flag", async () => {
    hits.length = 0;
    const client = new CognigyApiClient({ baseUrl: base, apiKey: "k" });
    await expect(client.get(`${base}/again`)).rejects.toMatchObject({
      status: 502,
    });
    expect(hits).toHaveLength(4);
  }, 15_000);

  it("starts a Simulator batch once, even when the gateway answers 502", async () => {
    hits.length = 0;
    const client = new CognigyApiClient({ baseUrl: base, apiKey: "k" });
    const handlers = new ToolHandlers(client, "", "", "", base);
    await expect(
      handlers.handleToolCall("manage_simulations", {
        operation: "run",
        projectId: PROJECT,
        simulationReference: SIM,
      }),
    ).rejects.toMatchObject({ status: 502 });
    expect(hits.filter((hit) => hit.startsWith("POST"))).toEqual([
      `POST /testing/simulations/${SIM}/schedule`,
    ]);
  });
});
