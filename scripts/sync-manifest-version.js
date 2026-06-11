#!/usr/bin/env node
// Sync manifest.json "version" with the version semantic-release computed.
// Usage: node scripts/sync-manifest-version.js <version>
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!version) {
  console.error("Usage: node scripts/sync-manifest-version.js <version>");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.version = version;
writeFileSync("manifest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(`manifest.json version set to ${version}`);
