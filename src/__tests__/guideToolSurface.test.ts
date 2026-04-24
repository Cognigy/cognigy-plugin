import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";
import { getGuideById } from "../guides.js";
import { tools } from "../tools/definitions.js";

const repoRoot = join(process.cwd());

describe("read_guide tool surface", () => {
  it("is registered in tool definitions", () => {
    const tool = tools.find((candidate) => candidate.name === "read_guide");
    expect(tool).toBeDefined();
    expect(tool?.inputSchema.properties.guideId).toBeDefined();
  });

  it("is listed in the manifest", () => {
    const manifestPath = join(repoRoot, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest.tools.some((tool: any) => tool.name === "read_guide")).toBe(
      true,
    );
  });

  it("has a settings guide entry in the central registry", () => {
    const guide = getGuideById("settings");
    expect(guide).toEqual(
      expect.objectContaining({
        guideId: "settings",
        uri: "cognigy://guide/settings",
      }),
    );
  });
});
