#!/usr/bin/env node
/* Adopt a clean eval run's agent-mock recordings as committed replays. Run:
 *   npm run evals 2>&1 | tee run.log
 *   npm run evals:adopt -- run.log
 * Reads the recording list the run printed to the terminal (path, sha256, and
 * the .replay/ dir beside the mock that produced it), checks each file against
 * that hash and copies it there. The terminal log is the source of truth, not
 * ADOPT.txt: that file sits where the agent under test could write.
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const log = process.argv[2];
if (!log) {
  console.error("Usage: npm run evals:adopt -- <terminal log of a clean run>");
  process.exit(1);
}
const evalsDir = resolve("plugin/evals");
const lines = readFileSync(log, "utf8").split("\n");
let adopted = 0;
let bad = 0;
for (let i = 0; i < lines.length - 1; i++) {
  const rec = /^\s*(\S+\.json)\s+sha256=([0-9a-f]{64})\s*$/.exec(lines[i]);
  const to = /^\s*->\s*(\S+\/\.replay\/[^/\s]+\/?)\s*$/.exec(lines[i + 1]);
  if (!rec || !to) continue;
  const [, src, hash] = rec;
  const dir = resolve(to[1]);
  // Only into this checkout's eval suite, never wherever a log points.
  if (!dir.startsWith(evalsDir + "/")) {
    console.error(`skip ${basename(src)}: ${dir} is outside ${evalsDir}`);
    bad++;
    continue;
  }
  const got = createHash("sha256").update(readFileSync(src)).digest("hex");
  if (got !== hash) {
    console.error(`skip ${basename(src)}: sha256 differs from the run's`);
    bad++;
    continue;
  }
  mkdirSync(dir, { recursive: true });
  copyFileSync(src, join(dir, basename(src)));
  adopted++;
}
console.log(`Adopted ${adopted} recording(s)${bad ? `, skipped ${bad}` : ""}.`);
if (!adopted && !bad) {
  console.error(
    "No recordings found. Was the run clean (no error or abort), and is this its full terminal output?",
  );
  process.exit(1);
}
process.exit(bad ? 1 : 0);
