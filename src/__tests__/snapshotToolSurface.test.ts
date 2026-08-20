import { describe, it, expect } from "@jest/globals";
import { existsSync } from "fs";
import { join } from "path";
import { tools } from "../tools/definitions.js";
import { BACKUP_WORTHY_TOOLS } from "../tools/handlers.js";
import { manageSnapshotsSchema } from "../schemas/tools.js";

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
      "decline",
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

// ---------------------------------------------------------------------------
// Backup-gate classification
//
// The gate only holds calls it knows about, so a tool that nobody classified
// silently changes an existing agent with no backup offer. This forces the
// decision: every tool is read-only, backup-worthy, or exempt WITH a reason.
// ---------------------------------------------------------------------------

describe("backup gate classification", () => {
  /** Mutating tools that deliberately do NOT warrant a backup offer. */
  const EXEMPT: Record<string, string> = {
    create_ai_agent: "creates new material; nothing to roll back to",
    setup_llm: "additive: adds an LLM + connection, changes no agent",
    manage_knowledge:
      "Knowledge AI is NOT captured in a snapshot, so a backup would not protect it",
    manage_packages: "import is additive; export only reads",
    manage_webchat: "endpoints are NOT captured in a snapshot",
    manage_voice_gateway: "endpoints are NOT captured in a snapshot",
    manage_snapshots: "the backup tool itself",
    talk_to_agent: "sends a message; changes no configuration",
  };

  it("classifies every tool", () => {
    const unclassified = tools
      .filter((tool) => tool.annotations?.readOnlyHint !== true)
      .map((tool) => tool.name)
      .filter((name) => !BACKUP_WORTHY_TOOLS.has(name) && !(name in EXEMPT));

    // A new tool 18 lands here until someone decides which bucket it is in.
    expect(unclassified).toEqual([]);
    // Sanity: the check is only meaningful because it does discriminate.
    expect(BACKUP_WORTHY_TOOLS.has("tool_18")).toBe(false);
    expect("tool_18" in EXEMPT).toBe(false);
  });

  it("treats project settings as backup-worthy", () => {
    // manage_settings writes voice-preview and Knowledge AI settings, and
    // project settings ARE captured in a snapshot.
    expect(BACKUP_WORTHY_TOOLS.has("manage_settings")).toBe(true);
  });

  it("treats an applied voice audit as backup-worthy", () => {
    expect(BACKUP_WORTHY_TOOLS.has("audit_voice_agent")).toBe(true);
  });

  it("keeps the JSON input schema in step with the zod schema", () => {
    const props = tools.find((t) => t.name === "manage_snapshots")!.inputSchema
      .properties as Record<string, any>;

    // A model can only use what the JSON schema declares, and strict clients
    // reject anything it omits — while zod is what actually validates.
    expect(props.limit).toMatchObject({ minimum: 1, maximum: 100 });
    expect(props.skip).toMatchObject({ minimum: 0 });
    expect(props.timeoutMs).toMatchObject({
      minimum: 1000,
      maximum: 3600000,
    });
    expect(props.label).toMatchObject({ minLength: 1, maxLength: 120 });

    // Values legal here must be legal there: parsing must not throw.
    expect(() =>
      manageSnapshotsSchema.parse({
        operation: "list",
        projectId: "60d5ec49f1a2c8b1a4e0fa01",
        limit: 100,
        skip: 0,
      }),
    ).not.toThrow();
    expect(() =>
      manageSnapshotsSchema.parse({
        operation: "create",
        projectId: "60d5ec49f1a2c8b1a4e0fa01",
        timeoutMs: 1000,
        label: "x".repeat(120),
      }),
    ).not.toThrow();
  });
});
