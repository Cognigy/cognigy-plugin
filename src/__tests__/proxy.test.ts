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
  ProxyConfigurationError,
  redactProxyUrl,
  resolveProxyForUrl,
} from "../utils/proxy.js";

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
  "npm_config_proxy",
  "npm_config_https_proxy",
  "npm_config_no_proxy",
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

    it("refuses an unusable proxy URL instead of connecting directly", () => {
      // A bare scheme survives proxy-from-env's normalisation but has no host.
      process.env.HTTPS_PROXY = "http://";
      expect(() => getProxyAxiosOptions(API_URL)).toThrow(
        ProxyConfigurationError,
      );
    });

    it("refuses a SOCKS proxy rather than silently bypassing it", () => {
      process.env.HTTPS_PROXY = "socks5://proxy.corp.example:1080";
      expect(() => getProxyAxiosOptions(API_URL)).toThrow(
        /only http and https proxies are supported/,
      );
    });

    it("names NO_PROXY as the way out in the rejection message", () => {
      process.env.HTTPS_PROXY = "socks5://proxy.corp.example:1080";
      expect(() => getProxyAxiosOptions(API_URL)).toThrow(/NO_PROXY/);
    });

    it("keeps proxy credentials out of the rejection message", () => {
      process.env.HTTPS_PROXY = "socks5://alice:s3cret@proxy.corp.example:1080";
      expect(() => getProxyAxiosOptions(API_URL)).toThrow(
        expect.objectContaining({
          message: expect.not.stringContaining("s3cret"),
        }) as Error,
      );
    });

    it("accepts an https:// proxy URL", () => {
      process.env.HTTPS_PROXY = "https://proxy.corp.example:8443";
      expect(getProxyAxiosOptions(API_URL).httpsAgent).toBeInstanceOf(
        HttpsProxyAgent,
      );
    });
  });

  describe("resolveProxyForUrl", () => {
    const NPM_PROXY = "http://npm-proxy.corp.example:3128";
    const ENV_PROXY = "http://proxy.corp.example:8080";

    it("honours npm_config_https_proxy (set by npx from .npmrc)", () => {
      process.env.npm_config_https_proxy = NPM_PROXY;
      expect(resolveProxyForUrl(API_URL)).toBe(NPM_PROXY);
    });

    it("prefers npm_config_https_proxy over HTTPS_PROXY, as v1 did", () => {
      process.env.npm_config_https_proxy = NPM_PROXY;
      process.env.HTTPS_PROXY = ENV_PROXY;
      expect(resolveProxyForUrl(API_URL)).toBe(NPM_PROXY);
    });

    it("prefers HTTPS_PROXY over npm_config_proxy", () => {
      process.env.npm_config_proxy = NPM_PROXY;
      process.env.HTTPS_PROXY = ENV_PROXY;
      expect(resolveProxyForUrl(API_URL)).toBe(ENV_PROXY);
    });

    it("falls back to npm_config_proxy before ALL_PROXY", () => {
      process.env.npm_config_proxy = NPM_PROXY;
      process.env.ALL_PROXY = ENV_PROXY;
      expect(resolveProxyForUrl(API_URL)).toBe(NPM_PROXY);
    });

    it("applies npm_config_no_proxy exclusions", () => {
      process.env.HTTPS_PROXY = ENV_PROXY;
      process.env.npm_config_no_proxy = ".cognigy.ai";
      expect(resolveProxyForUrl(API_URL)).toBe("");
    });

    it("leaves process.env as it found it", () => {
      process.env.npm_config_https_proxy = NPM_PROXY;
      resolveProxyForUrl(API_URL);
      expect(process.env.https_proxy).toBeUndefined();
      expect(process.env.no_proxy).toBeUndefined();
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
