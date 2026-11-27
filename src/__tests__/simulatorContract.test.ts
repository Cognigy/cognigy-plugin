import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";
import { SIMULATOR_ENDPOINTS } from "../tools/simulator.js";

// Every route manage_simulations calls must exist in service-testing's
// published (generic) OpenAPI spec. Refresh the fixture with
// `node scripts/sync-simulator-endpoints.mjs <service-testing>/openapi/generic-openapi.json`.
const fixture = JSON.parse(
  readFileSync(
    join(
      process.cwd(),
      "src/__tests__/fixtures/service-testing-endpoints.json",
    ),
    "utf8",
  ),
) as { source: string; endpoints: string[] };

/**
 * Real routes the spec documents wrongly. The stop route is served at
 * `.../batches/{id}/stop` (service-testing simulationRoutes.ts), while the
 * generic spec lists it without `/stop`.
 */
const SPEC_DRIFT = new Set([
  "POST /simulations/{simulationReference}/batches/{simulationRunBatchReference}/stop",
]);

describe("manage_simulations endpoint contract", () => {
  const used = Object.values(SIMULATOR_ENDPOINTS);

  it("only calls routes the service-testing OpenAPI spec documents", () => {
    const undocumented = used.filter(
      (endpoint) =>
        !SPEC_DRIFT.has(endpoint) && !fixture.endpoints.includes(endpoint),
    );
    expect(undocumented).toEqual([]);
  });

  it("keeps the drift exceptions honest", () => {
    for (const endpoint of SPEC_DRIFT) {
      // Still used, and still missing from the spec; drop it once fixed there.
      expect(used).toContain(endpoint);
      expect(fixture.endpoints).not.toContain(endpoint);
    }
  });

  it("reads a fixture generated from the spec", () => {
    expect(fixture.source).toBe("service-testing openapi/generic-openapi.json");
    expect(fixture.endpoints.length).toBeGreaterThan(0);
  });
});
