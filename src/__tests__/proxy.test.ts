/**
 * Tests for corporate-proxy support.
 *
 * The behaviour under test is the axios wiring, not the tunnelling itself:
 * every instance must carry `proxy: false` (axios' own proxy handling sends a
 * plaintext absolute-form request that corporate proxies reject) and, when a
 * proxy applies, real tunnelling agents.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import {
  clearProxyAgentCache,
  getProxyAxiosOptions,
  redactProxyUrl,
} from "../utils/proxy.js";

const PROXY_ENV_VARS = [
  "HTTP_PROXY",
  "http_proxy",
  "HTTPS_PROXY",
  "https_proxy",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
  "npm_config_proxy",
  "npm_config_https_proxy",
];

const API_URL = "https://api-trial.cognigy.ai";

describe("proxy support", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const key of PROXY_ENV_VARS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    clearProxyAgentCache();
  });

  afterEach(() => {
    for (const key of PROXY_ENV_VARS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    clearProxyAgentCache();
  });

  describe("getProxyAxiosOptions", () => {
    it("always disables axios' own proxy handling", () => {
      expect(getProxyAxiosOptions(API_URL).proxy).toBe(false);

      process.env.HTTPS_PROXY = "http://proxy.corp.example:8080";
      expect(getProxyAxiosOptions(API_URL).proxy).toBe(false);
    });

    it("attaches no agents when no proxy is configured", () => {
      const options = getProxyAxiosOptions(API_URL);
      expect(options.httpAgent).toBeUndefined();
      expect(options.httpsAgent).toBeUndefined();
    });

    it("attaches tunnelling agents when HTTPS_PROXY is set", () => {
      process.env.HTTPS_PROXY = "http://proxy.corp.example:8080";
      const options = getProxyAxiosOptions(API_URL);
      expect(options.httpsAgent).toBeInstanceOf(HttpsProxyAgent);
      expect(options.httpAgent).toBeInstanceOf(HttpProxyAgent);
    });

    it("reads the lower-case variable spelling too", () => {
      process.env.https_proxy = "http://proxy.corp.example:8080";
      expect(getProxyAxiosOptions(API_URL).httpsAgent).toBeInstanceOf(
        HttpsProxyAgent,
      );
    });

    it("uses HTTP_PROXY for an http:// target", () => {
      process.env.HTTP_PROXY = "http://proxy.corp.example:8080";
      const options = getProxyAxiosOptions("http://cognigy.internal");
      expect(options.httpAgent).toBeInstanceOf(HttpProxyAgent);
    });

    it("honours NO_PROXY exclusions", () => {
      process.env.HTTPS_PROXY = "http://proxy.corp.example:8080";
      process.env.NO_PROXY = "api-trial.cognigy.ai";
      const options = getProxyAxiosOptions(API_URL);
      expect(options.httpsAgent).toBeUndefined();
      expect(options.httpAgent).toBeUndefined();
    });

    it("keeps proxying hosts NO_PROXY does not cover", () => {
      process.env.HTTPS_PROXY = "http://proxy.corp.example:8080";
      process.env.NO_PROXY = "internal.example";
      expect(getProxyAxiosOptions(API_URL).httpsAgent).toBeInstanceOf(
        HttpsProxyAgent,
      );
    });

    it("passes proxy credentials through to the agent", () => {
      process.env.HTTPS_PROXY = "http://alice:s3cret@proxy.corp.example:8080";
      const agent = getProxyAxiosOptions(API_URL).httpsAgent as HttpsProxyAgent<
        typeof API_URL
      >;
      expect(agent).toBeInstanceOf(HttpsProxyAgent);
      expect(agent.proxy.username).toBe("alice");
      expect(agent.proxy.password).toBe("s3cret");
    });

    it("reuses one agent per proxy so sockets are pooled", () => {
      process.env.HTTPS_PROXY = "http://proxy.corp.example:8080";
      const first = getProxyAxiosOptions(API_URL);
      const second = getProxyAxiosOptions(`${API_URL}/v2.0/projects`);
      expect(second.httpsAgent).toBe(first.httpsAgent);
    });

    it("falls back to a direct connection when the proxy URL is unusable", () => {
      // A bare scheme survives proxy-from-env's normalisation but has no host.
      process.env.HTTPS_PROXY = "http://";
      const options = getProxyAxiosOptions(API_URL);
      expect(options.proxy).toBe(false);
      expect(options.httpsAgent).toBeUndefined();
    });

    it("refuses a SOCKS proxy rather than tunnelling to a nonsense host", () => {
      process.env.HTTPS_PROXY = "socks5://proxy.corp.example:1080";
      const options = getProxyAxiosOptions(API_URL);
      expect(options.proxy).toBe(false);
      expect(options.httpsAgent).toBeUndefined();
    });

    it("accepts an https:// proxy URL", () => {
      process.env.HTTPS_PROXY = "https://proxy.corp.example:8443";
      expect(getProxyAxiosOptions(API_URL).httpsAgent).toBeInstanceOf(
        HttpsProxyAgent,
      );
    });
  });

  describe("redactProxyUrl", () => {
    it("removes credentials", () => {
      const redacted = redactProxyUrl(
        "http://alice:s3cret@proxy.corp.example:8080",
      );
      expect(redacted).not.toContain("s3cret");
      expect(redacted).not.toContain("alice");
      expect(redacted).toContain("proxy.corp.example:8080");
    });

    it("leaves a credential-free URL usable", () => {
      expect(redactProxyUrl("http://proxy.corp.example:8080")).toContain(
        "proxy.corp.example:8080",
      );
    });

    it("does not throw on an unparseable value", () => {
      expect(redactProxyUrl("not-a-url")).toBe("(unparseable proxy url)");
    });
  });
});
