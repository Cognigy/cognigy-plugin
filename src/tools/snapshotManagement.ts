// Snapshot backup/restore helpers.
//
// A Cognigy Snapshot is an immutable copy of a whole PROJECT. It is the only
// rollback primitive the platform offers, so the plugin uses it as a "backup"
// before it starts editing an existing agent. Everything in here is pure so it
// can be unit-tested without an API client; the HTTP calls live in handlers.ts.

/**
 * Snapshots have no metadata field and no PATCH endpoint — `name` and
 * `description` are the only writable fields, and they are immutable once
 * written. So the marker that distinguishes a plugin-created backup from a
 * human-created snapshot has to live in both of them.
 *
 * Requiring BOTH halves to match means a human snapshot that happens to share
 * the name prefix is still protected from plugin deletion.
 */
export const AUTO_BACKUP_NAME_PREFIX = "[AI Backup] ";
/**
 * No format version in the marker on purpose. Descriptions are immutable, so
 * bumping the literal to :v2 would instantly un-mark every backup ever written:
 * they would stop being deletable through the tool AND drop out of the
 * deletable set the limit check uses, leaving a full project with no way
 * forward. It is matched as a SUBSTRING, so backups written by an earlier build
 * with a `:v1` suffix still read as plugin backups.
 */
export const AUTO_BACKUP_MARKER = "cognigy-plugin:auto-backup";

/**
 * Default only. The real cap is MAX_AMOUNT_SNAPSHOTS_IN_AGENT, which the
 * platform exposes solely on service-ui's /api/config — not on the REST API we
 * speak. So we pre-check against this assumption and let the task's failReason
 * be the authority (see SNAPSHOT_LIMIT_FAIL_REASON).
 */
export const ASSUMED_MAX_SNAPSHOTS = 10;

/** Substring of the ConflictError the platform raises when the cap is hit. */
export const SNAPSHOT_LIMIT_FAIL_REASON = "Limit of allowed Snapshots";

/** Substring of the InputOutputError raised for an in-use snapshot. */
export const SNAPSHOT_IN_USE_FAIL_REASON = "attached to an endpoint";

/** Characters isValidResourceName rejects, plus the 200-char name cap. */
const FORBIDDEN_NAME_CHARS = /[\\/:*?"<>|¥]/g;
const MAX_NAME_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 500;

export interface SnapshotSummary {
  id: string | null;
  name: string;
  /** Version parsed out of the backup name; null for anything unversioned. */
  version: number | null;
  description: string;
  createdAt: number | null;
  createdBy: string | null;
  isPackaged: boolean;
  isPluginBackup: boolean;
}

export interface SnapshotLimitEvaluation {
  count: number;
  assumedMax: number;
  atLimit: boolean;
  /** Plugin-created backups only, oldest first. */
  deletable: SnapshotSummary[];
  oldestDeletable: SnapshotSummary | null;
}

const snapshotId = (raw: any): string | null => raw?._id ?? raw?.id ?? null;

/** Pad to two digits without pulling in a date library. */
const p2 = (n: number): string => String(n).padStart(2, "0");

/**
 * Snapshot names must be unique within the project, so the timestamp carries
 * SECONDS — a minute-resolution stamp lets two backups in the same minute
 * collide with a 409 that only surfaces on the task, well after the fact.
 *
 * The time uses `HH-mm-ss`, NOT `HH:mm:ss`: isValidResourceName rejects `:`
 * outright, so a colon here would make every single create fail server-side.
 *
 * UTC, like the package names built via toISOString: local time makes the two
 * naming schemes sort inconsistently against each other, and lets two sessions
 * in different timezones mint byte-identical names — a collision that only ever
 * surfaces as a generic 409 on the task, long after the fact.
 */
export function formatBackupTimestamp(now: Date): string {
  return (
    `${now.getUTCFullYear()}-${p2(now.getUTCMonth() + 1)}-${p2(now.getUTCDate())} ` +
    `${p2(now.getUTCHours())}-${p2(now.getUTCMinutes())}-${p2(now.getUTCSeconds())}`
  );
}

/**
 * Build the name+description for a plugin backup. The caller supplies only a
 * short label — the plugin owns the rest so the marker can never be omitted.
 * `now` is injected so tests are deterministic.
 */
export function buildAutoBackupFields(
  label: string | undefined,
  now: Date,
  version: number,
): { name: string; description: string } {
  const stamp = formatBackupTimestamp(now);
  // Strip characters isValidResourceName rejects rather than letting the API
  // fail on a label the model chose innocently.
  const safeLabel = (label ?? "backup")
    .replace(FORBIDDEN_NAME_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim();

  const prefix = `${AUTO_BACKUP_NAME_PREFIX}v${version} `;
  const suffix = ` — ${stamp}`;
  const room = MAX_NAME_LENGTH - prefix.length - suffix.length;
  const name =
    prefix + (safeLabel || "backup").slice(0, Math.max(1, room)) + suffix;

  const description = [
    "Automatic backup created by the NiCE Cognigy Plugin before agent changes.",
    "Safe for the plugin to delete when the snapshot limit is reached.",
    AUTO_BACKUP_MARKER,
  ]
    .join("\n")
    .slice(0, MAX_DESCRIPTION_LENGTH);

  return { name, description };
}

/** Both halves of the marker must match for the plugin to treat it as its own. */
export function isAutoBackup(raw: any): boolean {
  const name = typeof raw?.name === "string" ? raw.name : "";
  const description =
    typeof raw?.description === "string" ? raw.description : "";
  return (
    name.startsWith(AUTO_BACKUP_NAME_PREFIX) &&
    description.includes(AUTO_BACKUP_MARKER)
  );
}

/** `[AI Backup] v3 pre-persona — …` -> 3. Null when the name carries no version. */
export function parseBackupVersion(name: any): number | null {
  if (typeof name !== "string") return null;
  const match = new RegExp(
    `^${AUTO_BACKUP_NAME_PREFIX.replace(/[[\]]/g, "\\$&")}v(\\d+) `,
  ).exec(name);
  return match ? Number(match[1]) : null;
}

/**
 * The next version number for a project: one above the highest ANY plugin
 * backup in it has ever shown, never a number already used. `floor` carries the
 * highest version this session issued, so deleting the newest backup and
 * creating another cannot hand the same number to two different snapshots.
 */
export function nextBackupVersion(snapshots: any[], floor = 0): number {
  const highest = snapshots
    .filter(isAutoBackup)
    .reduce((max, s) => Math.max(max, parseBackupVersion(s?.name) ?? 0), 0);
  return Math.max(highest, floor) + 1;
}

export function summarizeSnapshot(raw: any): SnapshotSummary {
  return {
    id: snapshotId(raw),
    name: raw?.name ?? "",
    // Guarded: a human snapshot named "[AI Backup] v9 test" is not part of the
    // plugin's numbering, and reporting version 9 next to isPluginBackup false
    // invites "restore v9" for a snapshot the plugin does not own.
    version: isAutoBackup(raw) ? parseBackupVersion(raw?.name) : null,
    description: raw?.description ?? "",
    createdAt: raw?.createdAt ?? null,
    createdBy: raw?.createdBy ?? null,
    isPackaged: Boolean(raw?.isPackaged),
    isPluginBackup: isAutoBackup(raw),
  };
}

/**
 * Requirement: deletion preference is always the OLDEST, and only ever a
 * plugin-created backup. Sorting the deletable subset ascending by createdAt
 * makes `oldestDeletable` correct by construction.
 */
export function evaluateSnapshotLimit(
  snapshots: any[],
  assumedMax: number = ASSUMED_MAX_SNAPSHOTS,
): SnapshotLimitEvaluation {
  const summaries = snapshots.map(summarizeSnapshot);
  const deletable = summaries
    .filter((s) => s.isPluginBackup && s.id)
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

  return {
    count: summaries.length,
    assumedMax,
    atLimit: summaries.length >= assumedMax,
    deletable,
    oldestDeletable: deletable[0] ?? null,
  };
}

/**
 * The standing warnings for a restore. Every one of these was verified against
 * the platform's restoreSnapshot controller — restore deletes all snapshottable
 * resources first, re-clones them with fresh ids, rewrites endpoint locale
 * references, moves the project's primary locale, and flushes the project's
 * cache. None of it is reversible.
 */
export const RESTORE_WARNINGS = [
  "DESTRUCTIVE: every Flow, AI Agent, Connection, LLM, Lexicon, Extension, Function, Playbook, Goal, Snippet and Locale in the project is DELETED first, then recreated from the snapshot.",
  "This reverts the WHOLE PROJECT, not just one agent. Every AI Agent in the project is rolled back.",
  "Endpoints are NOT stored in a snapshot. They survive the restore, but their locale references are rewritten; endpoints on non-primary locales need manual repair in the UI afterwards.",
  "Knowledge AI (stores, sources, chunks, connectors) is NOT stored in a snapshot and is NOT restored. A RAG agent will come back without its knowledge.",
  "The project's primary locale is reset to the snapshot's primary locale.",
  "Resource ids change. Re-list resources after restoring; any id from earlier in this conversation is stale.",
  "Active conversations on endpoints pointing at these flows will break.",
];

/** Resource types a snapshot does not carry, for the create response. */
export const SNAPSHOT_EXCLUSIONS = [
  "Endpoints (and their API keys)",
  "Knowledge AI: stores, sources, chunks, connectors",
  "Intent Trainer learning sentences",
  "Analytics data, contact profiles, logs",
  "Other snapshots and packages",
  "Agent Assist configs",
];

export interface RestorePreflight {
  operation: "restore";
  applied: false;
  projectId: string;
  snapshot: SnapshotSummary;
  warnings: string[];
  notRestored: string[];
}

export function buildRestorePreflight(
  raw: any,
  projectId: string,
): RestorePreflight {
  return {
    operation: "restore",
    applied: false,
    projectId,
    snapshot: summarizeSnapshot(raw),
    warnings: RESTORE_WARNINGS,
    notRestored: SNAPSHOT_EXCLUSIONS,
  };
}
