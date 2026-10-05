import { describe, it, expect } from "@jest/globals";
import {
  endpointUrlFor,
  hasEndpointToken,
  isTestModeEndpointUrl,
  toProductionEndpointUrl,
  toTestModeEndpointUrl,
} from "../utils/endpointUrl.js";

describe("endpoint URL test-mode helpers", () => {
  const prod = "https://endpoint-trial.cognigy.ai/abc123token";
  const test = "https://endpoint-trial.cognigy.ai/test/abc123token";

  it("inserts the test segment directly before the URL token", () => {
    expect(toTestModeEndpointUrl(prod)).toBe(test);
  });

  it("is idempotent for a URL already in test mode", () => {
    expect(toTestModeEndpointUrl(test)).toBe(test);
  });

  it("strips the test segment to get the regular endpoint", () => {
    expect(toProductionEndpointUrl(test)).toBe(prod);
    expect(toProductionEndpointUrl(prod)).toBe(prod);
  });

  it("detects test-mode URLs", () => {
    expect(isTestModeEndpointUrl(test)).toBe(true);
    expect(isTestModeEndpointUrl(prod)).toBe(false);
    // A token that merely equals "test" is not a test-mode URL.
    expect(isTestModeEndpointUrl("https://host/test")).toBe(false);
  });

  it("keeps a base path prefix in front of the test segment (on-prem)", () => {
    expect(toTestModeEndpointUrl("https://host/endpoint/tok")).toBe(
      "https://host/endpoint/test/tok",
    );
    expect(toProductionEndpointUrl("https://host/endpoint/test/tok")).toBe(
      "https://host/endpoint/tok",
    );
  });

  it("does not fold the test segment into a trailing slash", () => {
    expect(toTestModeEndpointUrl("https://host/tok/")).toBe(
      "https://host/test/tok",
    );
  });
});

describe("endpointUrlFor / hasEndpointToken", () => {
  it("appends the token behind the base, with a test segment in test mode", () => {
    expect(
      endpointUrlFor("https://endpoint-trial.cognigy.ai", "tok", true),
    ).toBe("https://endpoint-trial.cognigy.ai/test/tok");
    expect(
      endpointUrlFor("https://endpoint-trial.cognigy.ai", "tok", false),
    ).toBe("https://endpoint-trial.cognigy.ai/tok");
  });

  it("keeps any base path prefix, even one that ends in /test", () => {
    expect(endpointUrlFor("https://host/endpoint/", "tok", true)).toBe(
      "https://host/endpoint/test/tok",
    );
    expect(endpointUrlFor("https://host/test", "tok", true)).toBe(
      "https://host/test/test/tok",
    );
    expect(endpointUrlFor("https://host/test", "tok", false)).toBe(
      "https://host/test/tok",
    );
  });

  it("detects whether a URL carries a token segment at all", () => {
    expect(hasEndpointToken("https://host/tok")).toBe(true);
    expect(hasEndpointToken("https://host/test/tok")).toBe(true);
    expect(hasEndpointToken("https://host")).toBe(false);
    expect(hasEndpointToken("https://host/")).toBe(false);
  });
});
