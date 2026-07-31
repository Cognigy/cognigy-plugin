#!/usr/bin/env node
/**
 * Guards the published form of the tracked plugin manifests:
 *   - plugin/.claude-plugin/plugin.json  (Claude Code)
 *   - plugin/.codex-plugin/plugin.json   (Codex)
 *   - plugin/.codex-plugin/mcp.json      (Codex MCP servers)
 *
 * Local dev testing runs the engine from source via a GENERATED manifest
 * (scripts/dev-plugin.mjs → .dev-plugin/, gitignored). The tracked manifests
 * must always keep the published npx form — a committed `node …/dist/index.js`
 * or unpinned engine would ship a broken plugin to every user. Runs in
 * pre-commit and CI.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8"));

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

function checkPlatformServer(platform, errors) {
  if (!platform) {
    errors.push("mcpServers.platform is missing");
    return;
  }
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

function checkVersion(manifest, errors) {
  if (manifest.version !== pkg.version) {
    errors.push(
      `plugin version ${manifest.version} != package version ${pkg.version} — ` +
        "never hand-bump; semantic-release syncs both",
    );
  }
}

function checkClaudeManifest(manifest, errors) {
  checkPlatformServer(manifest.mcpServers?.platform, errors);
  checkVersion(manifest, errors);
}

function checkCodexPluginJson(manifest, errors) {
  checkVersion(manifest, errors);
  if (manifest.skills !== "./skills/") {
    errors.push(
      `skills pointer must be "./skills/" (got ${JSON.stringify(manifest.skills)})`,
    );
  }
  if (typeof manifest.mcpServers !== "string") {
    errors.push(
      `mcpServers must be a path pointer string (got ${JSON.stringify(manifest.mcpServers)})`,
    );
  } else if (!existsSync(join(repoRoot, "plugin", manifest.mcpServers))) {
    errors.push(`mcpServers pointer ${manifest.mcpServers} does not resolve`);
  }
}

function checkCodexMcpJson(manifest, errors) {
  checkPlatformServer(manifest.mcpServers?.platform, errors);
}

const CHECKS = [
  ["plugin/.claude-plugin/plugin.json", checkClaudeManifest],
  ["plugin/.codex-plugin/plugin.json", checkCodexPluginJson],
  ["plugin/.codex-plugin/mcp.json", checkCodexMcpJson],
];

let failed = false;
for (const [relPath, check] of CHECKS) {
  const manifestPath = join(repoRoot, relPath);
  const errors = [];
  check(JSON.parse(readFileSync(manifestPath, "utf-8")), errors);
  if (errors.length > 0) {
    failed = true;
    console.error(`✗ ${manifestPath} failed validation:`);
    for (const error of errors) console.error(`  - ${error}`);
  }
}

if (failed) process.exit(1);
console.log("✓ plugin manifests OK (published npx form, version in sync)");
