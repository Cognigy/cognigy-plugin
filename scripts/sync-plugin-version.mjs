// Keeps the plugin in lockstep with the @cognigy/plugin-engine release
// version, so the plugin and its engine always carry the same number — the
// single version users reason about. Rewrites the top-level `version` field
// in plugin/.claude-plugin/plugin.json AND the engine pin inside the
// mcpServers npx command (`@cognigy/plugin-engine@<version>`) in
// plugin/.mcp.json, so the plugin always launches the exact engine build it
// was released with. Invoked by semantic-release (.releaserc exec prepareCmd)
// with the computed next version; both bumped files are committed via the
// git assets.
//
// Fields are replaced in place (not a JSON round-trip) so each file's
// existing formatting is preserved and stays Prettier-clean.

import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!version) {
  console.error("usage: sync-plugin-version.mjs <version>");
  process.exit(1);
}

const manifestFile = "plugin/.claude-plugin/plugin.json";
const manifestSrc = readFileSync(manifestFile, "utf8");
const manifestNext = manifestSrc.replace(
  /("version":\s*")[^"]*(")/,
  `$1${version}$2`,
);
writeFileSync(manifestFile, manifestNext);

const applied = JSON.parse(manifestNext).version;
if (applied !== version) {
  console.error(
    `[release] FAILED to set ${manifestFile} version to ${version} (still ${applied}); the version field may have moved.`,
  );
  process.exit(1);
}

const mcpFile = "plugin/.mcp.json";
const mcpSrc = readFileSync(mcpFile, "utf8");
const mcpNext = mcpSrc.replace(
  /(@cognigy\/plugin-engine@)[^"]*(")/,
  `$1${version}$2`,
);
writeFileSync(mcpFile, mcpNext);

// The pin uses an npm alias (cognigy-engine@npm:@cognigy/plugin-engine@<v>)
// so `npm exec` never resolves the spec to this repo's own package when the
// client session is rooted here (name match would skip the install and the
// bin would be missing — MCP error -32000).
const enginePin = (JSON.parse(mcpNext).mcpServers?.platform?.args ?? []).find(
  (a) => a.includes("@cognigy/plugin-engine@"),
);
if (!enginePin?.endsWith(`@cognigy/plugin-engine@${version}`)) {
  console.error(
    `[release] FAILED to pin the engine in ${mcpFile} to ${version} (got ${enginePin ?? "none"}); the mcpServers npx args may have moved.`,
  );
  process.exit(1);
}
console.error(
  `[release] synced ${manifestFile} version + ${mcpFile} engine pin -> ${version}`,
);
