import { describe, it, expect } from "@jest/globals";
import { existsSync } from "fs";
import { join } from "path";
import { tools } from "../tools/definitions.js";

const repoRoot = join(process.cwd());

describe("manage_snapshots tool surface", () => {
  it("is registered in tool definitions", () => {
    const tool = tools.find(
      (candidate) => candidate.name === "manage_snapshots",
    );
    expect(tool).toBeDefined();
    expect(tool?.inputSchema.properties.operation).toBeDefined();
    expect(tool?.inputSchema.properties.operation.enum).toEqual([
      "list",
      "create",
      "restore",
      "delete",
      "read_task",
    ]);
  });

  it("has a backing skill file", () => {
    expect(
      existsSync(join(repoRoot, "plugin/skills/snapshot-backups/SKILL.md")),
    ).toBe(true);
  });

  it("does not expose download, package, or upload operations", () => {
    const tool = tools.find(
      (candidate) => candidate.name === "manage_snapshots",
    );
    const ops: string[] = tool?.inputSchema.properties.operation.enum ?? [];
    for (const forbidden of ["download", "package", "upload"]) {
      expect(ops).not.toContain(forbidden);
    }
  });

  it("keeps snapshots out of delete_resource so the backup-only gate holds", () => {
    const del = tools.find((candidate) => candidate.name === "delete_resource");
    expect(del?.inputSchema.properties.resourceType.enum).not.toContain(
      "snapshot",
    );
  });
});
