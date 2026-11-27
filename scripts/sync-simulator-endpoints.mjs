#!/usr/bin/env node
/**
 * Regenerates src/__tests__/fixtures/service-testing-endpoints.json, the list of
 * Simulator routes that simulatorContract.test.ts checks manage_simulations
 * against, from service-testing's generic OpenAPI spec. Run:
 *   node scripts/sync-simulator-endpoints.mjs <path>/service-testing/openapi/generic-openapi.json
 *   npm run sync:simulator-endpoints -- <same path>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const METHODS = ["get", "post", "put", "patch", "delete"];
const specPath = process.argv[2];
if (!specPath) {
  console.error(
    "Usage: node scripts/sync-simulator-endpoints.mjs <path to service-testing openapi/generic-openapi.json>",
  );
  process.exit(1);
}

const spec = JSON.parse(readFileSync(specPath, "utf8"));
const endpoints = Object.entries(spec.paths ?? {}).flatMap(([path, ops]) =>
  Object.keys(ops)
    .filter((method) => METHODS.includes(method))
    .map((method) => `${method.toUpperCase()} ${path}`),
);

const out = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src/__tests__/fixtures/service-testing-endpoints.json",
);
writeFileSync(
  out,
  JSON.stringify(
    { source: "service-testing openapi/generic-openapi.json", endpoints },
    null,
    2,
  ) + "\n",
);
console.log(`Wrote ${endpoints.length} endpoints to ${out}`);
