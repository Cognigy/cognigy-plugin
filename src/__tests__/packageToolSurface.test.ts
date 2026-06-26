import { describe, it, expect } from "@jest/globals";
import { existsSync } from "fs";
import { join } from "path";
import { tools } from "../tools/definitions.js";

const repoRoot = join(process.cwd());

describe("manage_packages tool surface", () => {
  it("is registered in tool definitions", () => {
    const tool = tools.find(
      (candidate) => candidate.name === "manage_packages",
    );
    expect(tool).toBeDefined();
    expect(tool?.inputSchema.properties.operation).toBeDefined();
  });

  it("has a backing skill file", () => {
    expect(
      existsSync(join(repoRoot, "plugin/skills/package-management/SKILL.md")),
    ).toBe(true);
  });
});
