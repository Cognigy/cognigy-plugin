#!/usr/bin/env node
/**
 * Generate Claude Code plugin skills from the canonical Cognigy guides.
 *
 * Single source of truth: each guide in `src/guides.ts` (GUIDE_DEFINITIONS) with
 * its markdown body in `src/resources/<file>` becomes one plugin skill at
 * `plugin/skills/<guideId>/SKILL.md`. The skill `description` frontmatter is the
 * guide's `skillTrigger` — what Claude Code matches against to auto-load it.
 *
 * The generated files are COMMITTED (marketplace installs ship repo files as-is,
 * with no user-side build). CI re-runs this and fails on drift, so never edit a
 * generated SKILL.md by hand — edit the guide and regenerate.
 *
 * Run via `npm run build` (after tsc) or standalone `npm run generate:skills`.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const resourceDir = join(repoRoot, "src", "resources");
const skillsDir = join(repoRoot, "plugin", "skills");
const compiledGuides = join(repoRoot, "dist", "guides.js");

let GUIDE_DEFINITIONS;
try {
  ({ GUIDE_DEFINITIONS } = await import(pathToFileURL(compiledGuides).href));
} catch (err) {
  console.error(
    `[generate-skills] Could not load ${compiledGuides}. Run \`tsc\` first (npm run build does this).`,
  );
  throw err;
}

/** Quote a value for safe single-line YAML (handles colons, dashes, quotes). */
function yamlQuote(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// Wipe and rebuild so removed/renamed guides never leave stale skills behind.
rmSync(skillsDir, { recursive: true, force: true });
mkdirSync(skillsDir, { recursive: true });

let count = 0;
for (const guide of GUIDE_DEFINITIONS) {
  const body = readFileSync(join(resourceDir, guide.file), "utf-8").trimEnd();
  const description = guide.skillTrigger || guide.description;
  const frontmatter = [
    "---",
    `name: ${guide.guideId}`,
    `description: ${yamlQuote(description)}`,
    "---",
  ].join("\n");
  const banner = `<!-- GENERATED from src/resources/${guide.file} by scripts/generate-skills.mjs. Do not edit by hand — edit the guide and run \`npm run generate:skills\`. -->`;
  // The server instructions still point bare MCP clients at read_guide for this
  // guide. In Claude Code the skill already carries that content, so tell the
  // model not to re-fetch it (avoids a redundant read_guide call + tool prompt).
  const noFetchNote = `> The full **${guide.name}** is included below — you already have it. Do NOT call \`read_guide\` for \`${guide.guideId}\`; just follow the content here.`;
  const contents = `${frontmatter}\n\n${banner}\n\n${noFetchNote}\n\n${body}\n`;

  const dir = join(skillsDir, guide.guideId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), contents, "utf-8");
  count++;
}

console.log(`[generate-skills] wrote ${count} skill(s) to plugin/skills/`);
