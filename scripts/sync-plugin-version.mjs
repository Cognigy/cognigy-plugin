// Keeps every tracked plugin manifest in lockstep with the
// @cognigy/plugin-engine release version, so the plugin and its engine always
// carry the same number — the single version users reason about. For each
// file it rewrites the top-level `version` field (when present) AND every
// engine pin (`@cognigy/plugin-engine@<version>`), so the plugin always
// launches the exact engine build it was released with. Invoked by
// semantic-release (.releaserc exec prepareCmd) with the computed next
// version; the bumped manifests are committed via the git assets.
//
// Fields are replaced in place (not a JSON round-trip) so each file's
// existing formatting is preserved and stays Prettier-clean.

import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!version) {
  console.error("usage: sync-plugin-version.mjs <version>");
  process.exit(1);
}

// Every committed manifest that carries the plugin version and/or an engine
// pin. The Gemini extension manifest is NOT here — it is generated at release
// time (scripts/build-gemini-extension.mjs), never committed.
const FILES = [
  "plugin/.claude-plugin/plugin.json", // version + engine pin
  "plugin/.codex-plugin/plugin.json", // version
  "plugin/.codex-plugin/mcp.json", // engine pin
  "plugin/plugin.json", // version (Agent Plugins spec manifest)
  "plugin/mcp.json", // engine pin (Agent Plugins spec MCP config)
];

for (const file of FILES) {
  const src = readFileSync(file, "utf8");
  const next = src
    .replace(/("version":\s*")[^"]*(")/, `$1${version}$2`)
    .replace(/(@cognigy\/plugin-engine@)[^"]*(")/g, `$1${version}$2`);
  writeFileSync(file, next);

  const parsed = JSON.parse(next);
  if (parsed.version !== undefined && parsed.version !== version) {
    console.error(
      `[release] FAILED to set ${file} version to ${version} (still ${parsed.version}); the version field may have moved.`,
    );
    process.exit(1);
  }

  // The pin uses an npm alias (cognigy-engine@npm:@cognigy/plugin-engine@<v>)
  // so `npm exec` never resolves the spec to this repo's own package when the
  // client session is rooted here (name match would skip the install and the
  // bin would be missing — MCP error -32000).
  const pins = next.match(/@cognigy\/plugin-engine@[^"]*/g) ?? [];
  const badPin = pins.find((p) => p !== `@cognigy/plugin-engine@${version}`);
  if (badPin) {
    console.error(
      `[release] FAILED to pin the engine in ${file} to ${version} (got ${badPin}); the mcpServers npx args may have moved.`,
    );
    process.exit(1);
  }
  console.error(`[release] synced ${file} -> ${version}`);
}
