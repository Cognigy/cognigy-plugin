import { describe, it, expect } from "@jest/globals";
import { readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { REGISTRY } from "../../policy/registry.js";

/**
 * §5, test 2: walks the registry and fails, naming any rule with no
 * corresponding negative-path test. This is what makes the system
 * self-defending - a rule cannot be added untested, and cannot be silently
 * lost (§2.2, §5).
 */
const RULES_TEST_DIR = join(dirname(fileURLToPath(import.meta.url)), "rules");

describe("policy rule coverage guard", () => {
  it("every rule in the registry has a rules/<rule-id>.test.ts negative-path test", () => {
    const testFiles = new Set(readdirSync(RULES_TEST_DIR));
    const missing = REGISTRY.filter(
      (rule) => !testFiles.has(`${rule.id}.test.ts`),
    ).map((rule) => rule.id);

    expect(missing).toEqual([]);
  });

  it("every rule declares a non-empty retireWhen", () => {
    const missing = REGISTRY.filter((rule) => !rule.retireWhen?.trim()).map(
      (rule) => rule.id,
    );

    expect(missing).toEqual([]);
  });

  it("has no duplicate rule ids", () => {
    const seen = new Set<string>();
    const duplicates = REGISTRY.filter((rule) => {
      if (seen.has(rule.id)) return true;
      seen.add(rule.id);
      return false;
    }).map((rule) => rule.id);

    expect(duplicates).toEqual([]);
  });
});
