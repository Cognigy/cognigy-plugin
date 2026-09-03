import { describe, it, expect } from "@jest/globals";
import {
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
