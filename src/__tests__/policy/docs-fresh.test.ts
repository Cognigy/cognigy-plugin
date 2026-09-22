import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { REGISTRY } from "../../policy/registry.js";
import { renderStandardsSkill } from "../../policy/generate-docs.js";

/**
 * §3.8 / §5, test 6: regenerates the ai-coe-standards skill in memory from
 * the current registry and compares it against the file on disk, failing
 * with a diff when they differ. The skill is generated in full and never
 * hand-edited (§3.8), so any drift means someone changed a rule without
 * running `npm run policy:docs`.
 */
const SKILL_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "plugin",
  "skills",
  "ai-coe-standards",
  "SKILL.md",
);

describe("ai-coe-standards skill freshness", () => {
  it("matches what generate-docs.ts produces from the current registry", () => {
    const onDisk = readFileSync(SKILL_PATH, "utf8");
    const regenerated = renderStandardsSkill(REGISTRY);

    expect(onDisk).toBe(regenerated);
  });
});
