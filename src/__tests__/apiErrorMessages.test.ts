/**
 * Tests for the error message produced when a response body is not a Cognigy
 * error. Behind a corporate proxy this is the common case — the proxy answers
 * with an HTML page — and the message used to collapse to a bare
 * "API request failed", hiding what actually responded.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import type { AxiosError } from "axios";
import { describeUnexpectedBody, formatApiError } from "../api/client.js";

const PROXY_ENV_VARS = [
  "HTTP_PROXY",
  "http_proxy",
  "HTTPS_PROXY",
  "https_proxy",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
  // `npm test` itself exports an `.npmrc` proxy as `npm_config_*`, which the
  // engine honours too.
  "npm_config_proxy",
  "npm_config_http_proxy",
  "npm_config_https_proxy",
  "npm_config_no_proxy",
  "npm_config_noproxy",
];

function errorWith(status: number, url = "/v2.0/projects"): AxiosError {
  return {
    config: { url, baseURL: "https://api-trial.cognigy.ai" },
    response: { status },
  } as unknown as AxiosError;
}

describe("describeUnexpectedBody", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const key of PROXY_ENV_VARS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of PROXY_ENV_VARS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it("includes the status and a snippet of an HTML body", () => {
    const message = describeUnexpectedBody(
      "<html>\n  <body>\n    ERROR: The requested URL could not be retrieved\n  </body>\n</html>",
      errorWith(500),
    );
    expect(message).toContain("HTTP 500");
    expect(message).toContain("The requested URL could not be retrieved");
    // Whitespace collapsed so the snippet budget holds real text.
    expect(message).not.toContain("\n");
  });

  it("serialises a non-Cognigy JSON body", () => {
    const message = describeUnexpectedBody(
      { message: "Forbidden by policy" },
      errorWith(403),
    );
    expect(message).toContain("Forbidden by policy");
  });

  it("truncates a long body", () => {
    const message = describeUnexpectedBody("x".repeat(5000), errorWith(502));
    expect(message.length).toBeLessThan(600);
    expect(message).toContain("…");
  });

  it("caps a multi-megabyte body without building the whole string", () => {
    const message = describeUnexpectedBody(
      Buffer.alloc(5 * 1024 * 1024, "y"),
      errorWith(502),
    );
    expect(message.length).toBeLessThan(600);
  });

  it("names the proxy when one is configured for the request", () => {
    process.env.HTTPS_PROXY = "http://alice:s3cret@proxy.corp.example:8080";
    const message = describeUnexpectedBody(
      "<html>denied</html>",
      errorWith(500),
    );
    expect(message).toContain("proxy.corp.example:8080");
    expect(message).not.toContain("s3cret");
    expect(message).toContain("NODE_EXTRA_CA_CERTS");
  });

  it("does not mention a proxy when NO_PROXY excludes the host", () => {
    process.env.HTTPS_PROXY = "http://proxy.corp.example:8080";
    process.env.NO_PROXY = "api-trial.cognigy.ai";
    const message = describeUnexpectedBody(
      "<html>denied</html>",
      errorWith(500),
    );
    expect(message).not.toContain("proxy.corp.example");
  });

  it("does not mention a proxy when none is configured", () => {
    const message = describeUnexpectedBody(
      "<html>denied</html>",
      errorWith(500),
    );
    expect(message).not.toContain("proxy");
  });

  it("survives a request config with no usable URL", () => {
    const error = { response: { status: 500 } } as unknown as AxiosError;
    expect(() => describeUnexpectedBody("boom", error)).not.toThrow();
  });

  it("handles a Buffer body", () => {
    const message = describeUnexpectedBody(
      Buffer.from("proxy authentication required"),
      errorWith(407),
    );
    expect(message).toContain("proxy authentication required");
  });
});

describe("formatApiError", () => {
  it("keeps the request URL on the error", () => {
    const err = formatApiError({
      config: {
        url: "/v2.0/aiagents/abc",
        baseURL: "https://api-trial.cognigy.ai",
      },
      response: { status: 404, data: { status: 404, detail: "Not found" } },
    } as any);
    expect(err.message).toBe("Not found");
    expect((err as any).status).toBe(404);
    expect((err as any).url).toBe("/v2.0/aiagents/abc");
  });

  it("names service-agents field errors", () => {
    const err = formatApiError({
      config: { url: "https://api-dev.cognigy.ai/v1/agentpersonas" },
      response: {
        status: 400,
        data: {
          status: 400,
          detail: "request body validation failed",
          errors: [{ field: "voiceConfig", message: "is required" }],
        },
      },
    } as any);
    expect(err.message).toBe(
      "request body validation failed (voiceConfig: is required)",
    );
  });
});

describe("formatApiError fallback message", () => {
  const withBody = (status: number, data: unknown) =>
    formatApiError({
      config: {
        url: "https://api-trial.cognigy.ai/testing/simulations",
      },
      response: { status, data },
    } as any);

  it("uses a JSON body's message or error when it has no detail or title", () => {
    expect(withBody(400, { message: "maxTurns is invalid" }).message).toBe(
      "maxTurns is invalid",
    );
    expect(withBody(404, { error: "Simulation not found" }).message).toBe(
      "Simulation not found",
    );
    // detail still wins.
    expect(withBody(400, { detail: "d", error: "e" }).message).toBe("d");
  });

  it("uses a short plain-text body as is", () => {
    const err = withBody(
      401,
      "You are not authorized to access this resource.",
    );
    expect(err.message).toBe("You are not authorized to access this resource.");
    expect((err as any).status).toBe(401);
  });

  it("keeps the diagnostic for HTML, long text and bodies without a message", () => {
    expect(withBody(404, "<html>Cannot POST</html>").message).toContain(
      "did not match the expected Cognigy error format",
    );
    expect(withBody(502, "x".repeat(400)).message).toContain(
      "did not match the expected Cognigy error format",
    );
    expect(withBody(500, { foo: 1 }).message).toContain(
      "did not match the expected Cognigy error format",
    );
  });

  it("keeps a JSON error body on the error for callers that classify it", () => {
    expect((withBody(404, { error: "x", code: "C" }) as any).errorBody).toEqual(
      { error: "x", code: "C" },
    );
    expect((withBody(404, "<html></html>") as any).errorBody).toBeUndefined();
  });
});

describe("formatApiError JSON passthrough limits", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const key of PROXY_ENV_VARS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });
  afterEach(() => {
    for (const key of PROXY_ENV_VARS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
  const withBody = (data: unknown) =>
    formatApiError({
      config: { url: "https://api-trial.cognigy.ai/testing/simulations" },
      response: { status: 400, data },
    } as any);

  it("replaces control characters and caps a long message", () => {
    expect(withBody({ error: "  bad\n\tinput\u0000here " }).message).toBe(
      "bad  input here",
    );
    const long = withBody({ message: "y".repeat(1000) }).message;
    expect(long).toBe(`${"y".repeat(300)}…`);
  });

  it("keeps the proxy diagnostic when a proxy applies", () => {
    process.env.HTTPS_PROXY = "http://proxy.corp.example:8080";
    const message = withBody({ error: "denied" }).message;
    expect(message).toContain(
      "did not match the expected Cognigy error format",
    );
    expect(message).toContain("proxy.corp.example:8080");
  });
});
