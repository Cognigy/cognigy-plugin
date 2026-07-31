// Keeps plugin/.claude-plugin/plugin.json in lockstep with the
// @cognigy/plugin-engine release version, so the plugin and its engine always
// carry the same number — the single version users reason about. Rewrites BOTH
// the top-level `version` field AND the engine pin inside the mcpServers npx
// command (`@cognigy/plugin-engine@<version>`), so the plugin always launches
// the exact engine build it was released with. Invoked by semantic-release
// (.releaserc exec prepareCmd) with the computed next version; the bumped
// plugin.json is committed via the git asset.
//
// Fields are replaced in place (not a JSON round-trip) so the file's existing
// formatting is preserved and stays Prettier-clean.

import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!version) {
  console.error("usage: sync-plugin-version.mjs <version>");
  process.exit(1);
}

const file = "plugin/.claude-plugin/plugin.json";
const src = readFileSync(file, "utf8");
const next = src
  .replace(/("version":\s*")[^"]*(")/, `$1${version}$2`)
  .replace(/(@cognigy\/plugin-engine@)[^"]*(")/, `$1${version}$2`);
writeFileSync(file, next);

const parsed = JSON.parse(next);
const applied = parsed.version;
if (applied !== version) {
  console.error(
    `[release] FAILED to set ${file} version to ${version} (still ${applied}); the version field may have moved.`,
  );
  process.exit(1);
}

// The pin uses an npm alias (cognigy-engine@npm:@cognigy/plugin-engine@<v>)
// so `npm exec` never resolves the spec to this repo's own package when the
// client session is rooted here (name match would skip the install and the
// bin would be missing — MCP error -32000).
const enginePin = (parsed.mcpServers?.platform?.args ?? []).find((a) =>
  a.includes("@cognigy/plugin-engine@"),
);
if (!enginePin?.endsWith(`@cognigy/plugin-engine@${version}`)) {
  console.error(
    `[release] FAILED to pin the engine in ${file} to ${version} (got ${enginePin ?? "none"}); the mcpServers npx args may have moved.`,
  );
  process.exit(1);
}
console.error(`[release] synced ${file} version + engine pin -> ${version}`);
