/**
 * Fingerprint of the plugin/ files the dev install copies (scripts/dev-plugin.mjs).
 * The dev plugin's version carries it, and the dev engine compares it with the
 * working tree at startup, so a stale copy (branch switch, skill edit) is noticed.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Not copied into the dev plugin, so not part of its fingerprint: the Codex
 * manifest (prod-pinned engine) and the eval suite, whose results/ change on
 * every run.
 */
export const SKIPPED_ENTRIES = new Set([".codex-plugin", "evals"]);

export function pluginFingerprint(pluginDir) {
  const hash = createHash("sha256");
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (name === ".DS_Store") continue;
      if (dir === pluginDir && SKIPPED_ENTRIES.has(name)) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else
        hash
          .update(`${relative(pluginDir, path)}\0`)
          .update(readFileSync(path));
    }
  };
  walk(pluginDir);
  return hash.digest("hex").slice(0, 12);
}
