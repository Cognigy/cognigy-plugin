#!/usr/bin/env node
/**
 * Guards the published form of plugin/.claude-plugin/plugin.json.
 *
 * Local dev testing runs the engine from source via a GENERATED manifest
 * (scripts/dev-plugin.mjs → .dev-plugin/, gitignored). The tracked manifest
 * must always keep the published npx form — a committed `node …/dist/index.js`
 * or unpinned engine would ship a broken plugin to every user. Runs in
 * pre-commit and CI.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(repoRoot, "plugin", ".claude-plugin", "plugin.json");

const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8"));

const errors = [];
const platform = manifest.mcpServers?.platform;

if (!platform) {
  errors.push("mcpServers.platform is missing");
} else {
  // Alias form (cognigy-engine@npm:...) is REQUIRED, not cosmetic: a plain
  // `@cognigy/plugin-engine@<v>` spec makes `npm exec` treat this repo's own
  // package.json as satisfying the pin when a session is rooted here, skip
  // the install, and fail with `cognigy-mcp: command not found` (-32000).
  const expectedArgs = [
    "-y",
    "-p",
    `cognigy-engine@npm:@cognigy/plugin-engine@${pkg.version}`,
    "cognigy-mcp",
  ];
  if (platform.command !== "npx") {
    errors.push(
      `platform.command must be "npx" (got ${JSON.stringify(platform.command)}) — ` +
        "local-dev manifests are generated, never committed (npm run plugin:dev)",
    );
  }
  if (JSON.stringify(platform.args) !== JSON.stringify(expectedArgs)) {
    errors.push(
      `platform.args must be ${JSON.stringify(expectedArgs)} (got ${JSON.stringify(platform.args)})`,
    );
  }
}

if (manifest.version !== pkg.version) {
  errors.push(
    `plugin version ${manifest.version} != package version ${pkg.version} — ` +
      "never hand-bump; semantic-release syncs both",
  );
}

if (errors.length > 0) {
  console.error(`✗ ${manifestPath} failed validation:`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log("✓ plugin manifest OK (published npx form, version in sync)");
