import { describe, it, expect } from "@jest/globals";
import { buildPackageImportPreview } from "../tools/packageManagement.js";

const flow = (id: string, referenceId: string) => ({
  _id: id,
  type: "flow",
  referenceId,
  properties: { name: "My Flow" },
});

describe("buildPackageImportPreview conflict warning", () => {
  it("warns that re-identify duplicates a resource that already exists", () => {
    const preview = buildPackageImportPreview("proj", "pkg", {
      proj: { resources: [flow("existing", "ref-1")] } as any,
      pkg: { resources: [flow("incoming", "ref-1")] } as any,
    });
    const r = preview.resources[0];
    expect(r.defaultStrategy).toBe("re-identify");
    expect(r.conflict?.targetResourceId).toBe("existing");
    expect(preview.summary.reidentifyConflictCount).toBe(1);
    expect(preview.summary.conflictWarning).toMatch(/NEW copy/);
    expect(preview.summary.conflictWarning).toMatch(/replace/);
  });

  it("adds no warning when nothing conflicts", () => {
    const preview = buildPackageImportPreview("proj", "pkg", {
      proj: { resources: [] } as any,
      pkg: { resources: [flow("incoming", "ref-1")] } as any,
    });
    expect(preview.summary.reidentifyConflictCount).toBe(0);
    expect(preview.summary.conflictWarning).toBeUndefined();
  });
});
