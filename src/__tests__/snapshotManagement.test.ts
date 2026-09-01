import { describe, it, expect } from "@jest/globals";
import {
  AUTO_BACKUP_MARKER,
  buildAutoBackupFields,
  formatBackupTimestamp,
  isAutoBackup,
  nextBackupVersion,
  parseBackupVersion,
} from "../tools/snapshotManagement.js";

describe("backup naming", () => {
  // 2026-08-20T23:30:05Z — an instant that falls on a different calendar day
  // in any timezone west of UTC, so a local-time stamp shows a different date.
  const instant = new Date(Date.UTC(2026, 7, 20, 23, 30, 5));

  it("stamps UTC, not local time", () => {
    // Package names are built with toISOString; a local stamp here makes the
    // two schemes sort inconsistently and lets two timezones mint the same
    // name for different snapshots.
    expect(formatBackupTimestamp(instant)).toBe("2026-08-20 23-30-05");
  });

  it("never puts a colon in the name", () => {
    // isValidResourceName rejects `:`, so a colon fails every create.
    expect(formatBackupTimestamp(instant)).not.toContain(":");
  });

  it("builds a versioned, marked name", () => {
    const fields = buildAutoBackupFields("pre-persona", instant, 4);

    expect(fields.name).toBe(
      "[AI Backup] v4 pre-persona — 2026-08-20 23-30-05",
    );
    expect(isAutoBackup(fields)).toBe(true);
    expect(fields.description).toContain(AUTO_BACKUP_MARKER);
  });

  it("keeps the name inside the 200-char limit", () => {
    const fields = buildAutoBackupFields("x".repeat(400), instant, 12);

    expect(fields.name.length).toBeLessThanOrEqual(200);
    expect(fields.name.endsWith(" — 2026-08-20 23-30-05")).toBe(true);
  });
});

describe("backup versions", () => {
  const backup = (name: string) => ({
    name,
    description: `Automatic backup.\n${AUTO_BACKUP_MARKER}`,
  });

  it("parses a version out of a name", () => {
    expect(
      parseBackupVersion("[AI Backup] v3 label — 2026-08-20 10-00-00"),
    ).toBe(3);
    expect(parseBackupVersion("[AI Backup] label — 2026-08-20 10-00-00")).toBe(
      null,
    );
    expect(parseBackupVersion("Release 2026-01")).toBe(null);
    expect(parseBackupVersion(undefined)).toBe(null);
  });

  it("counts up from the project's highest, ignoring human snapshots", () => {
    const snapshots = [
      backup("[AI Backup] v2 a — 2026-08-20 10-00-00"),
      backup("[AI Backup] v9 b — 2026-08-20 10-00-01"),
      { name: "[AI Backup] v40 lookalike", description: "written by hand" },
    ];

    expect(nextBackupVersion(snapshots)).toBe(10);
  });

  it("starts at 1 on an empty project", () => {
    expect(nextBackupVersion([])).toBe(1);
  });

  it("never falls back to a number the session already issued", () => {
    // The project looks empty because the only backup was just deleted.
    // Reusing v1 would make "restore v1" ambiguous forever.
    expect(nextBackupVersion([], 1)).toBe(2);
  });
});
