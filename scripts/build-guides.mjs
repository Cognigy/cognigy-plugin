#!/usr/bin/env node
/**
 * Build the server's guide markdown from the canonical plugin skills.
 *
 * Source of truth: each Claude Code skill at `plugin/skills/<id>/SKILL.md`
 * (hand-authored — frontmatter + body). This script strips the YAML frontmatter
 * and writes the body to `dist/resources/<id>.md`, which the MCP server reads at
 * runtime for the `read_guide` tool and the `cognigy://guide/<id>` resource
 * (see `src/guides.ts` `readGuideContent` → `dist/resources/<file>`).
 *
 * One source, two consumers: the skill auto-loads in Claude Code; the extracted
 * body serves every other MCP client through read_guide. `dist/resources` is a
 * build artifact (gitignored) — it is NOT committed, so there is no generated
 * file to keep in sync and no drift guard.
 *
 * The npm package ships `dist/` only (not `plugin/`), so this step is what makes
 * guides available to the standalone server. Run via `npm run build` (after tsc).
 *
 * MAINTENANCE: to edit a guide, edit its `plugin/skills/<id>/SKILL.md` directly.
 * To add/remove a guide, add/remove the skill dir AND its `src/guides.ts` entry
 * (GUIDE_IDS + GUIDE_DEFINITIONS) — this script checks the two stay in lockstep.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const skillsDir = join(repoRoot, "plugin", "skills");
const outDir = join(repoRoot, "dist", "resources");
const compiledGuides = join(repoRoot, "dist", "guides.js");

/** Strip a leading YAML frontmatter block (--- … ---); return the body. */
function stripFrontmatter(text, file) {
  const lines = text.split("\n");
  if (lines[0] !== "---") return text.trim();
  const end = lines.indexOf("---", 1);
  if (end === -1)
    throw new Error(`[build-guides] unterminated frontmatter in ${file}`);
  return lines
    .slice(end + 1)
    .join("\n")
    .trim();
}

const skillIds = readdirSync(skillsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

// Keep the skills and the guide registry in lockstep — a missing pair on either
// side means read_guide and the auto-loading skill would disagree.
const { GUIDE_IDS } = await import(pathToFileURL(compiledGuides).href);
const expected = [...GUIDE_IDS].sort();
const missingSkill = expected.filter((id) => !skillIds.includes(id));
const orphanSkill = skillIds.filter((id) => !expected.includes(id));
if (missingSkill.length || orphanSkill.length) {
  throw new Error(
    `[build-guides] skills/guides out of lockstep.` +
      (missingSkill.length
        ? ` Missing skill dir for: ${missingSkill.join(", ")}.`
        : "") +
      (orphanSkill.length
        ? ` Skill dir with no GUIDE_IDS entry: ${orphanSkill.join(", ")}.`
        : ""),
  );
}

mkdirSync(outDir, { recursive: true });
let count = 0;
for (const id of skillIds) {
  const skill = join(skillsDir, id, "SKILL.md");
  const body = stripFrontmatter(readFileSync(skill, "utf-8"), skill);
  writeFileSync(join(outDir, `${id}.md`), `${body}\n`, "utf-8");
  count++;
}

console.log(`[build-guides] wrote ${count} guide(s) to dist/resources/`);
