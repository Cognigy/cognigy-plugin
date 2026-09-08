/**
 * End-to-end tests for proxy routing against real loopback servers: the
 * `CONNECT` deadline, and per-request proxy selection.
 *
 * These need real sockets — the behaviours under test live in the connection
 * phase, which a mocked adapter never reaches.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import axios from "axios";
import { createServer, type Server } from "http";
import { createServer as createTcpServer, type Server as TcpServer } from "net";
import { AddressInfo } from "net";
import { CognigyApiClient } from "../api/client.js";
import { clearProxyAgentCache, getProxyAxiosOptions } from "../utils/proxy.js";

const PROXY_ENV_VARS = [
  "COGNIGY_PROXY_CONNECT_TIMEOUT_MS",
  "HTTP_PROXY",
  "http_proxy",
  "HTTPS_PROXY",
  "https_proxy",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
];

function portOf(server: Server | TcpServer): number {
  return (server.address() as AddressInfo).port;
}

describe("proxy routing (real sockets)", () => {
  let savedEnv: Record<string, string | undefined>;
  const closers: Array<() => Promise<void>> = [];

  beforeEach(() => {
    savedEnv = {};
    for (const key of PROXY_ENV_VARS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    clearProxyAgentCache();
  });

  afterEach(async () => {
    for (const close of closers.splice(0)) await close();
    for (const key of PROXY_ENV_VARS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    clearProxyAgentCache();
  });

  function track(server: Server | TcpServer) {
    closers.push(
      () =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    );
  }

  async function listen<T extends Server | TcpServer>(server: T): Promise<T> {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    track(server);
    return server;
  }

  it("fails a request when the proxy accepts the connection but never completes the tunnel", async () => {
    // A proxy that accepts TCP and then goes silent. Axios' own `timeout`
    // cannot catch this: it is armed once the request has a socket, and a
    // proxy agent hands the socket over only after the tunnel is negotiated.
    const stalled = await listen(
      createTcpServer((socket) => {
        socket.on("data", () => {
          /* read the CONNECT request and never answer it */
        });
      }),
    );

    process.env.HTTPS_PROXY = `http://127.0.0.1:${portOf(stalled)}`;
    process.env.COGNIGY_PROXY_CONNECT_TIMEOUT_MS = "200";

    const target = "https://cognigy.invalid";
    const client = axios.create({
      // A timeout far longer than the deadline: if the request only fails when
      // this fires, the deadline did not do its job.
      timeout: 30000,
      ...getProxyAxiosOptions(target),
    });

    const started = Date.now();
    await expect(client.get(target)).rejects.toMatchObject({
      code: "ETIMEDOUT",
    });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("selects the proxy per request, not per client", async () => {
    // 127.0.0.1 and localhost are the same address but different hostnames, so
    // NO_PROXY can cover one and not the other — which is exactly the shape of
    // an API host that bypasses the proxy while a package download link does
    // not (downloadPackageArchive sends an absolute URL with baseURL: undefined).
    const origin = await listen(
      createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ via: "origin" }));
      }),
    );

    const proxied: string[] = [];
    const proxy = await listen(
      createServer((req, res) => {
        proxied.push(req.url ?? "");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ via: "proxy" }));
      }),
    );

    process.env.HTTP_PROXY = `http://127.0.0.1:${portOf(proxy)}`;
    process.env.NO_PROXY = "127.0.0.1";

    const client = new CognigyApiClient({
      baseUrl: `http://127.0.0.1:${portOf(origin)}`,
      apiKey: "test-key",
    });

    // Excluded by NO_PROXY: must reach the origin directly.
    await expect(client.get("/v2.0/projects")).resolves.toEqual({
      via: "origin",
    });
    expect(proxied).toHaveLength(0);

    // Same client, absolute URL on a host NO_PROXY does not cover: must be
    // proxied even though the client's own base URL is excluded.
    const downloadUrl = `http://localhost:${portOf(origin)}/download/archive.zip`;
    await expect(
      client.get(downloadUrl, { baseURL: undefined }),
    ).resolves.toEqual({ via: "proxy" });
    expect(proxied).toEqual([downloadUrl]);
  });

  it("fails the request when the configured proxy is unusable", async () => {
    process.env.HTTPS_PROXY = "socks5://127.0.0.1:1080";
    const client = new CognigyApiClient({
      baseUrl: "https://api-trial.cognigy.ai",
      apiKey: "test-key",
    });

    await expect(client.get("/v2.0/projects")).rejects.toThrow(
      /only http and https proxies are supported/,
    );
  });
});
