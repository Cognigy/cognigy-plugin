import { describe, it, expect } from "@jest/globals";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getGuideById } from "../guides.js";
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

  it("is listed in the manifest", () => {
    const manifestPath = join(repoRoot, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(
      manifest.tools.some((tool: any) => tool.name === "manage_packages"),
    ).toBe(true);
  });

  it("has a registered guide resource and backing file", () => {
    const guide = getGuideById("package-management");
    expect(guide?.uri).toBe("cognigy://guide/package-management");
    expect(
      existsSync(join(repoRoot, "plugin/skills/package-management/SKILL.md")),
    ).toBe(true);
  });
});
