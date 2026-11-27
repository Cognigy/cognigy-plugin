/**
 * Renders the Simulator's UTC timestamps in the project's current timezone, so
 * the model shows a ready-made local time instead of converting one itself
 * (which it does unreliably). Ported from service-testing's simulator skill
 * (`packages/simulator-skill/src/scheduleTimes.ts`).
 */
import { CognigyApiClient } from "../api/client.js";

/** Used when a schedule predates the stored-timezone field, as the backend does. */
const FALLBACK_TIMEZONE = "UTC";

/** Guards against walking an unexpectedly deep response. */
const MAX_DEPTH = 6;

/** The project timezone changes rarely; one settings read serves a while. */
const PROJECT_TIMEZONE_TTL_MS = 60_000;
/** A failed read (no rights, a blip) is retried soon, not held for a minute. */
const PROJECT_TIMEZONE_FAILURE_TTL_MS = 5_000;

const PROJECT_TIMEZONE_UNAVAILABLE_NOTE =
  "The project timezone could not be read, so times are not converted to it. Show a time only with the timezone it is labelled with, and say that unlabelled times are UTC.";

/** Timestamps the user may be shown, as epoch milliseconds or ISO strings. */
const INSTANT_KEYS = [
  "createdAt",
  "updatedAt",
  "completedAt",
  "stoppedAt",
  "lastChanged",
  "expiresAt",
  "evaluatedAt",
  "processedAt",
  "endDate",
];

/** A schedule's stored wall clock and cron line: internal to its trigger. */
const SCHEDULE_INTERNAL_KEYS = ["cronScheduler", "time"];

/**
 * Formats a UTC instant in an IANA timezone as `YYYY-MM-DD HH:mm`. `h23`
 * keeps midnight as 00:00, not 24:00. Undefined for an unparsable instant or
 * an unusable zone, so the caller leaves the entry alone rather than guessing.
 */
export function formatInTimezone(
  isoTimestamp: string,
  timeZone: string,
): string | undefined {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return undefined;

  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const part = (type: string): string =>
      parts.find((entry) => entry.type === type)?.value ?? "";
    const [year, month, day, hour, minute] = [
      "year",
      "month",
      "day",
      "hour",
      "minute",
    ].map(part);
    if (!year || !month || !day || !hour || !minute) return undefined;
    return `${year}-${month}-${day} ${hour}:${minute}`;
  } catch {
    return undefined;
  }
}

function annotateSchedule(
  schedule: Record<string, unknown>,
  projectTimezone?: string,
): Record<string, unknown> {
  const timeZone =
    projectTimezone ??
    (typeof schedule.timezone === "string" && schedule.timezone
      ? schedule.timezone
      : FALLBACK_TIMEZONE);
  const formatted = formatInTimezone(
    schedule.nextScheduledRun as string,
    timeZone,
  );
  if (!formatted) return schedule;

  const annotated: Record<string, unknown> = {
    ...schedule,
    nextScheduledRunLocal: `${formatted} (${timeZone})`,
  };
  if (projectTimezone) {
    for (const key of SCHEDULE_INTERNAL_KEYS) delete annotated[key];
    // The trigger fires in its stored zone. When that is not the project's
    // (the project's changed since), keep it visible rather than hide it.
    const stored = annotated.timezone;
    delete annotated.timezone;
    if (typeof stored === "string" && stored && stored !== projectTimezone) {
      annotated.scheduleTimezone = stored;
    }
  }
  return annotated;
}

function annotateInstants(
  entry: Record<string, unknown>,
  projectTimezone: string,
): Record<string, unknown> {
  let annotated = entry;
  for (const key of INSTANT_KEYS) {
    const value = entry[key];
    if (typeof value !== "number" && typeof value !== "string") continue;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) continue;
    const formatted = formatInTimezone(date.toISOString(), projectTimezone);
    if (formatted) {
      annotated = {
        ...annotated,
        [`${key}Local`]: `${formatted} (${projectTimezone})`,
      };
    }
  }
  return annotated;
}

/**
 * Adds a `<field>Local` rendering next to every timestamp in a response. The
 * UTC values stay untouched. Without a project timezone only schedules are
 * converted, each into its own stored timezone. Walks the response because the
 * endpoints differ in shape (`{ data: [] }`, `{ scheduler }`, bare objects).
 */
export function withLocalTimes(
  payload: unknown,
  projectTimezone?: string,
  depth = 0,
): unknown {
  if (depth > MAX_DEPTH) return payload;
  if (Array.isArray(payload)) {
    return payload.map((entry) =>
      withLocalTimes(entry, projectTimezone, depth + 1),
    );
  }
  if (!payload || typeof payload !== "object") return payload;

  let entry = payload as Record<string, unknown>;
  if (typeof entry.nextScheduledRun === "string") {
    entry = annotateSchedule(entry, projectTimezone);
  }
  if (projectTimezone) entry = annotateInstants(entry, projectTimezone);

  let changed = entry !== payload;
  const walked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    walked[key] = withLocalTimes(value, projectTimezone, depth + 1);
    if (walked[key] !== value) changed = true;
  }
  return changed ? walked : payload;
}

/** Names the timezone and the time there now, or says it could not be read. */
export function withTimeContext(
  data: unknown,
  projectTimezone: string | undefined,
): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  if (!projectTimezone) {
    return { ...data, timezoneNote: PROJECT_TIMEZONE_UNAVAILABLE_NOTE };
  }
  return {
    ...data,
    projectTimezone,
    currentTimeLocal: `${formatInTimezone(new Date().toISOString(), projectTimezone)} (${projectTimezone})`,
  };
}

/**
 * Per API client, so two environments never share a cached timezone. The
 * promise is stored, so concurrent calls share one settings read.
 */
const timezoneCache = new WeakMap<
  CognigyApiClient,
  Map<string, { promise: Promise<string | undefined>; expiresAt: number }>
>();

async function readProjectTimezone(
  api: CognigyApiClient,
  projectId: string,
): Promise<string | undefined> {
  try {
    const settings = await api.get(`/new/v2.0/projects/${projectId}/settings`);
    const value = settings?.timezone;
    return typeof value === "string" &&
      formatInTimezone(new Date().toISOString(), value)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The project's current timezone from its settings, or undefined when it
 * cannot be read (no rights, unknown zone). A success is cached for a minute,
 * a failure for a few seconds.
 */
export function resolveProjectTimezone(
  api: CognigyApiClient,
  projectId: string,
): Promise<string | undefined> {
  let cache = timezoneCache.get(api);
  if (!cache) {
    cache = new Map();
    timezoneCache.set(api, cache);
  }
  const cached = cache.get(projectId);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const entry = {
    promise: readProjectTimezone(api, projectId),
    expiresAt: Number.POSITIVE_INFINITY,
  };
  cache.set(projectId, entry);
  entry.promise.then((timezone) => {
    entry.expiresAt =
      Date.now() +
      (timezone ? PROJECT_TIMEZONE_TTL_MS : PROJECT_TIMEZONE_FAILURE_TTL_MS);
  });
  return entry.promise;
}

/** Converts every timestamp in a result into the project's timezone. */
export async function localizeTimes(
  api: CognigyApiClient,
  projectId: string,
  data: unknown,
): Promise<unknown> {
  const projectTimezone = await resolveProjectTimezone(api, projectId);
  return withTimeContext(
    withLocalTimes(data, projectTimezone),
    projectTimezone,
  );
}
