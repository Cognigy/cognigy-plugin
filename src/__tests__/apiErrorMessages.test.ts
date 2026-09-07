/**
 * Tests for the error message produced when a response body is not a Cognigy
 * error. Behind a corporate proxy this is the common case — the proxy answers
 * with an HTML page — and the message used to collapse to a bare
 * "API request failed", hiding what actually responded.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import type { AxiosError } from "axios";
import { describeUnexpectedBody } from "../api/client.js";

const PROXY_ENV_VARS = [
  "HTTP_PROXY",
  "http_proxy",
  "HTTPS_PROXY",
  "https_proxy",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
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
