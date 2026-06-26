// Keeps plugin/.claude-plugin/plugin.json `version` in lockstep with the
// @cognigy/plugin-engine release version, so the plugin and its engine always
// carry the same number — the single version users and the launcher reason
// about. Invoked by semantic-release (.releaserc exec prepareCmd) with the
// computed next version; the bumped plugin.json is committed via the git asset.
//
// The version field is replaced in place (not a JSON round-trip) so the file's
// existing formatting is preserved and stays Prettier-clean.

import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!version) {
  console.error("usage: sync-plugin-version.mjs <version>");
  process.exit(1);
}

const file = "plugin/.claude-plugin/plugin.json";
const src = readFileSync(file, "utf8");
const next = src.replace(/("version":\s*")[^"]*(")/, `$1${version}$2`);
writeFileSync(file, next);

const applied = JSON.parse(next).version;
if (applied !== version) {
  console.error(
    `[release] FAILED to set ${file} version to ${version} (still ${applied}); the version field may have moved.`,
  );
  process.exit(1);
}
console.error(`[release] synced ${file} version -> ${version}`);
