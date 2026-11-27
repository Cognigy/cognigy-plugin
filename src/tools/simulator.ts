/**
 * The Cognigy Simulator (service-testing), behind manage_simulations.
 *
 * service-testing sits on the same API gateway as service-agents, under
 * `<origin>/testing` (its generic OpenAPI server is `https://api-<host>/testing`).
 * Traefik's auth gateway turns the plugin's `X-API-Key` into the internal JWT,
 * as for AI Agents (see the top of agentsV2.ts). Every route resolves its
 * project from `projectId` in the query or `projectReference` in the body, never
 * both. Logic ported from service-testing's `packages/simulator-skill`.
 */
import { CognigyApiClient } from "../api/client.js";
import { resolveLocalInputFile } from "../utils/localInputFile.js";
import type { ManageSimulationsInput } from "../schemas/tools.js";
import { filterResponse, withHints, type ResponseHints } from "./filters.js";
import {
  localizeTimes,
  resolveProjectTimezone,
  withLocalTimes,
  withTimeContext,
} from "./simulatorScheduleTimes.js";

/**
 * Every service-testing route this module calls, as "METHOD path" with the
 * path templated like the OpenAPI spec. simulatorContract.test.ts checks each
 * against the spec's endpoint list.
 */
export const SIMULATOR_ENDPOINTS = {
  listSimulations: "GET /simulations",
  createSimulation: "POST /simulations",
  getSimulation: "GET /simulations/{simulationReference}",
  updateSimulation: "PATCH /simulations/{simulationReference}",
  deleteSimulation: "DELETE /simulations/{simulationReference}",
  cloneSimulation: "POST /simulations/{simulationReference}/clone",
  // Despite the name this starts a run batch now; recurring runs are schedules.
  startBatch: "POST /simulations/{simulationReference}/schedule",
  listProjectBatches: "GET /simulations/batches",
  listBatches: "GET /simulations/{simulationReference}/batches",
  getBatch:
    "GET /simulations/{simulationReference}/batches/{simulationRunBatchReference}",
  stopBatch:
    "POST /simulations/{simulationReference}/batches/{simulationRunBatchReference}/stop",
  listRuns:
    "GET /simulations/{simulationReference}/batches/{simulationRunBatchReference}/runs",
  getRun:
    "GET /simulations/{simulationReference}/batches/{simulationRunBatchReference}/runs/{simulationRunReference}",
  listSchedules: "GET /simulations/{simulationReference}/schedules",
  createSchedule: "POST /simulations/{simulationReference}/schedules",
  updateSchedule:
    "PATCH /simulations/{simulationReference}/schedules/{schedulerReference}",
  dashboardOverview: "GET /dashboard/overview",
  dashboardSuccessRateTrend: "GET /dashboard/success-rate-trend",
  dashboardUpcomingRuns: "GET /dashboard/upcoming-scheduled-runs",
  personaOptions: "POST /personas/options",
  generatePersona: "POST /personas/generate",
  regeneratePersonaField: "POST /personas/regenerate-field",
  transcriptRequest: "POST /v1/transcript-request",
  transcriptUpload: "POST /v1/transcript-upload",
  generateFromTranscript: "POST /v1/generate-from-transcript",
} as const;

type Endpoint = keyof typeof SIMULATOR_ENDPOINTS;

/**
 * Persona and transcript generation are LLM calls the service gives 55-60 s
 * per attempt; the client's 30 s default would abandon them mid-generation.
 */
export const SIMULATOR_LLM_TIMEOUT_MS = 120_000;

/** service-testing's transcript upload limit (SIMULATOR_TRANSCRIPT_FILE_MAX_SIZE default). */
export const TRANSCRIPT_MAX_BYTES = 10 * 1024 * 1024;

const HEX_ID = /^[a-f0-9]{24}$/;

const DEFAULT_LIST_LIMIT = 20;
const DEFAULT_TRANSCRIPT_CRITERIA = 3;

const DASHBOARD_ENDPOINTS: Record<string, Endpoint> = {
  overview: "dashboardOverview",
  success_rate_trend: "dashboardSuccessRateTrend",
  upcoming_scheduled_runs: "dashboardUpcomingRuns",
};
/** Sections whose days and time windows follow the timezone they are asked in. */
const DASHBOARD_SECTIONS_WITH_TIMEZONE = new Set([
  "overview",
  "success_rate_trend",
]);

/** regenerate_persona_field names the draft fields as create does. */
const DRAFT_FIELD_API_NAMES: Record<string, string> = {
  name: "simulationName",
  personaName: "personaName",
  persona: "personaDescription",
  mission: "mission",
  successCriteria: "successCriteria",
};

interface Simulator {
  api: CognigyApiClient;
  /** `<origin>/testing` */
  base: string;
  projectId: string;
}

interface Call {
  path?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  timeout?: number;
}

/**
 * Drops undefined and null values, so request bodies and queries carry only
 * what was set (Zod admits no null input; a null here comes from a stored
 * document, e.g. a batch without a stop condition).
 */
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).filter(
      ([, value]) => value !== undefined && value !== null,
    ),
  );
}

export function simulatorUrl(
  base: string,
  endpoint: Endpoint,
  path: Record<string, string> = {},
): string {
  const template = SIMULATOR_ENDPOINTS[endpoint].split(" ")[1];
  return (
    base +
    template.replace(/\{(\w+)\}/g, (_, key: string) =>
      encodeURIComponent(path[key]),
    )
  );
}

async function call(
  sim: Simulator,
  endpoint: Endpoint,
  req: Call = {},
): Promise<any> {
  const method = SIMULATOR_ENDPOINTS[endpoint].split(" ")[0];
  const url = simulatorUrl(sim.base, endpoint, req.path);
  // Only reads are retried: a retried write can repeat what the server already
  // did (a second billed batch, a second LLM generation).
  const config = compact({
    params: req.query,
    timeout: req.timeout,
    noRetry: method === "GET" ? undefined : true,
  });
  switch (method) {
    case "GET":
      return sim.api.get(url, config);
    case "DELETE":
      return sim.api.delete(url, config);
    case "PATCH":
      return sim.api.patch(url, req.body, config);
    default:
      return sim.api.post(url, req.body, config);
  }
}

/** Lists come as `{ data, pagination }` or, on some routes, a bare array. */
function listItems(body: any): any[] {
  if (Array.isArray(body)) return body;
  return Array.isArray(body?.data) ? body.data : [];
}

function batchListItem(raw: any): any {
  // The frozen copy of the scenario is the bulk of each batch; get_batch has it.
  const { simulationFrozen: _frozen, ...rest } = filterResponse(
    "simulation_batch",
    raw,
  );
  return rest;
}

/** The scenario's own target: it was written for that kind and no other. */
function runTarget(simulation: any): Record<string, unknown> | undefined {
  if (simulation?.aiAgentV2ReferenceId) {
    return {
      targetType: "agent",
      agentReferenceId: simulation.aiAgentV2ReferenceId,
    };
  }
  if (simulation?.flowReferenceId) {
    return { targetType: "flow", flowReferenceId: simulation.flowReferenceId };
  }
  return undefined;
}

/** A server-supplied name, safe to put into hint text: quoted and capped. */
function quoteName(name: unknown): string {
  return JSON.stringify(String(name).slice(0, 78));
}

/** A server-supplied id, only when it has the shape the next call takes. */
function hintId(value: unknown): string | undefined {
  return typeof value === "string" && HEX_ID.test(value) ? value : undefined;
}

function noTargetResult(operation: string, simulation: any, ref: string) {
  return withHints(
    {
      operation,
      error: "simulation_has_no_target",
      message: `Simulation ${quoteName(simulation?.name ?? ref)} has no Flow or AI Agent target, so it cannot run.`,
    },
    {
      action:
        "Ask the user which Flow or AI Agent it tests, then set it with update { flowReferenceId } or { agentReferenceId } and retry.",
    },
  );
}

/** The poll hint, only when both ids are real; never an "undefined" in it. */
function withBatchStartedHint<T extends object>(
  result: T,
  simulationReference: string,
  batchReference: unknown,
): T {
  const batch = hintId(batchReference);
  const simulation = hintId(simulationReference);
  if (!batch || !simulation) return result;
  return withHints(result, {
    action: `Poll manage_simulations { operation: "get_batch", simulationReference: "${simulation}", batchReference: "${batch}" } until status is COMPLETED, FAILED or STOPPED, then use get_runs for runs that did not pass.`,
  });
}

async function listSimulations(
  sim: Simulator,
  data: Extract<ManageSimulationsInput, { operation: "list" }>,
) {
  const limit = data.limit ?? DEFAULT_LIST_LIMIT;
  const skip = data.skip ?? 0;
  const body = await call(sim, "listSimulations", {
    query: compact({
      projectId: sim.projectId,
      limit,
      skip,
      filter: data.nameFilter,
    }),
  });
  return localizeTimes(sim.api, sim.projectId, {
    simulations: listItems(body).map((s) =>
      filterResponse("simulation_summary", s),
    ),
    total: body?.pagination?.total,
    limit,
    skip,
  });
}

function scenarioBody(
  data: Extract<ManageSimulationsInput, { operation: "create" | "update" }>,
) {
  return compact({
    name: data.name,
    persona: data.persona,
    personaName: data.personaName,
    mission: data.mission,
    successCriteria: data.successCriteria,
    evaluationProfileReferenceIds: data.evaluationProfileReferenceIds,
    maxTurns: data.maxTurns,
    flowId: data.flowId,
    flowReferenceId: data.flowReferenceId,
    aiAgentV2ReferenceId: data.agentReferenceId,
  });
}

async function runSimulation(
  sim: Simulator,
  data: Extract<ManageSimulationsInput, { operation: "run" }>,
) {
  const path = { simulationReference: data.simulationReference };
  const simulation = await call(sim, "getSimulation", {
    path,
    query: { projectId: sim.projectId },
  });
  const target = runTarget(simulation);
  if (!target)
    return noTargetResult("run", simulation, path.simulationReference);

  const batch = await call(sim, "startBatch", {
    path,
    body: compact({
      projectReference: sim.projectId,
      name: data.name || simulation?.name || data.simulationReference,
      numberOfExecutions: data.numberOfExecutions ?? 1,
      // entrypoint = the project: run against the live project, not a snapshot.
      runConfig: { ...target, entrypoint: sim.projectId },
      evaluationProfileReferenceIds: data.evaluationProfileReferenceIds,
    }),
  });
  const batchReference = batch?._id ?? batch?.id;
  return withBatchStartedHint(
    {
      operation: "run",
      simulationReference: data.simulationReference,
      batchReference,
      name: batch?.name,
      status: batch?.status,
    },
    data.simulationReference,
    batchReference,
  );
}

async function rerunBatch(
  sim: Simulator,
  data: Extract<ManageSimulationsInput, { operation: "rerun_batch" }>,
) {
  const path = {
    simulationReference: data.simulationReference,
    simulationRunBatchReference: data.batchReference,
  };
  const original = await call(sim, "getBatch", {
    path,
    query: { projectId: sim.projectId },
  });
  if (original?.mode === "multivariate" || !original?.runConfig) {
    return withHints(
      {
        operation: "rerun_batch",
        error: "batch_not_rerunnable",
        message:
          original?.mode === "multivariate"
            ? "Multivariate batches cannot be rerun here."
            : "This batch has no run configuration to replay.",
      },
      { action: "Start a new batch with run instead." },
    );
  }
  const runConfig = original.runConfig;
  const frozenProfiles = (
    original.simulationFrozen?.evaluationProfiles as
      Array<{ id: string }> | undefined
  )?.map((profile) => profile.id);

  const batch = await call(sim, "startBatch", {
    path: { simulationReference: data.simulationReference },
    body: compact({
      projectReference: sim.projectId,
      name: data.name || `${original.name || data.simulationReference} (rerun)`,
      numberOfExecutions: original.numberOfExecutions,
      runConfig: compact({
        targetType: runConfig.targetType,
        flowReferenceId: runConfig.flowReferenceId,
        agentReferenceId: runConfig.agentReferenceId,
        entrypoint: runConfig.entrypoint,
        localeReferenceId: runConfig.localeReferenceId,
        largeLanguageModelReferenceId: runConfig.largeLanguageModelReferenceId,
      }),
      evaluationProfileReferenceIds: frozenProfiles?.length
        ? frozenProfiles
        : undefined,
      stopCondition: original.stopCondition,
      endPointType: original.endPointType,
    }),
  });
  const batchReference = batch?._id ?? batch?.id;
  return withBatchStartedHint(
    {
      operation: "rerun_batch",
      simulationReference: data.simulationReference,
      batchReference,
      rerunOf: data.batchReference,
      name: batch?.name,
      status: batch?.status,
    },
    data.simulationReference,
    batchReference,
  );
}

async function listBatches(
  sim: Simulator,
  data: Extract<ManageSimulationsInput, { operation: "list_batches" }>,
) {
  const query = compact({
    projectId: sim.projectId,
    limit: data.limit,
    skip: data.skip,
  });
  const body = data.simulationReference
    ? await call(sim, "listBatches", {
        path: { simulationReference: data.simulationReference },
        query,
      })
    : await call(sim, "listProjectBatches", { query });
  return localizeTimes(sim.api, sim.projectId, {
    batches: listItems(body).map(batchListItem),
    pagination: body?.pagination,
  });
}

async function getRuns(
  sim: Simulator,
  data: Extract<ManageSimulationsInput, { operation: "get_runs" }>,
) {
  const path = {
    simulationReference: data.simulationReference,
    simulationRunBatchReference: data.batchReference,
  };
  if (data.runReference) {
    const run = await call(sim, "getRun", {
      path: { ...path, simulationRunReference: data.runReference },
      query: { projectId: sim.projectId },
    });
    return localizeTimes(
      sim.api,
      sim.projectId,
      filterResponse("simulation_run", run),
    );
  }
  const body = await call(sim, "listRuns", {
    path,
    query: compact({
      projectId: sim.projectId,
      limit: data.limit,
      skip: data.skip,
    }),
  });
  return localizeTimes(sim.api, sim.projectId, {
    runs: listItems(body).map((r) => filterResponse("simulation_run", r)),
    pagination: body?.pagination,
  });
}

async function upsertSchedule(
  sim: Simulator,
  data: Extract<ManageSimulationsInput, { operation: "upsert_schedule" }>,
) {
  const path = { simulationReference: data.simulationReference };
  const query = { projectId: sim.projectId };
  const fields = compact({
    runName: data.name,
    frequency: data.frequency,
    time: data.time,
    numberOfRuns: data.numberOfRuns,
    enableSchedule: data.enableSchedule,
  });

  // One schedule per simulation: the service reads it with findOne, so a
  // second create would be a duplicate trigger nobody can see.
  let scheduleReference: string | undefined = data.scheduleReference;
  if (!scheduleReference) {
    const current = await call(sim, "listSchedules", { path, query });
    const existing = Array.isArray(current?.scheduler)
      ? current.scheduler[0]
      : current?.scheduler;
    scheduleReference = existing?._id ?? existing?.id;
  }

  if (scheduleReference) {
    if (Object.keys(fields).length === 0) {
      throw new Error(
        "upsert_schedule needs at least one of name, frequency, time, numberOfRuns or enableSchedule to change the existing schedule.",
      );
    }
    const updated = await call(sim, "updateSchedule", {
      path: { ...path, schedulerReference: scheduleReference },
      query,
      body: fields,
    });
    return localizeTimes(sim.api, sim.projectId, updated);
  }

  const missing = ["name", "frequency", "time"].filter(
    (key) => (data as Record<string, unknown>)[key] === undefined,
  );
  if (missing.length) {
    throw new Error(`Creating a schedule requires ${missing.join(", ")}.`);
  }
  const simulation = await call(sim, "getSimulation", { path, query });
  const target = runTarget(simulation);
  if (!target) {
    return noTargetResult(
      "upsert_schedule",
      simulation,
      path.simulationReference,
    );
  }
  const created = await call(sim, "createSchedule", {
    path,
    query,
    body: { ...fields, runConfig: { ...target, entrypoint: sim.projectId } },
  });
  return localizeTimes(sim.api, sim.projectId, created);
}

async function dashboard(
  sim: Simulator,
  data: Extract<ManageSimulationsInput, { operation: "dashboard" }>,
) {
  const section = data.section ?? "overview";
  const timezone = await resolveProjectTimezone(sim.api, sim.projectId);
  const body = await call(sim, DASHBOARD_ENDPOINTS[section], {
    query: compact({
      projectId: sim.projectId,
      timezone: DASHBOARD_SECTIONS_WITH_TIMEZONE.has(section)
        ? timezone
        : undefined,
    }),
  });
  return withTimeContext(
    withLocalTimes({ section, [section]: body }, timezone),
    timezone,
  );
}

async function importTranscript(
  sim: Simulator,
  data: Extract<ManageSimulationsInput, { operation: "import_transcript" }>,
) {
  // Read before any call, so a bad path opens no upload session.
  const file = resolveLocalInputFile(data.filePath, {
    extensions: [".csv"],
    maxBytes: TRANSCRIPT_MAX_BYTES,
    rejectSymlinks: true,
  });
  const session = await call(sim, "transcriptRequest", {
    body: { projectReference: sim.projectId },
  });
  const requestId = session?.requestId;
  if (!requestId)
    throw new Error("The Simulator returned no transcript requestId.");

  await sim.api.uploadFile(
    simulatorUrl(sim.base, "transcriptUpload"),
    file.data,
    file.name,
    { requestId, projectId: sim.projectId },
    { timeoutMs: SIMULATOR_LLM_TIMEOUT_MS, noRetry: true },
  );
  const generated = await call(sim, "generateFromTranscript", {
    body: compact({
      projectReference: sim.projectId,
      requestId,
      // The endpoint reads `flowReference`, and rejects a missing count.
      flowReference: data.flowReferenceId,
      numberOfSuccessCriteria:
        data.numberOfSuccessCriteria ?? DEFAULT_TRANSCRIPT_CRITERIA,
      language: data.language,
    }),
    timeout: SIMULATOR_LLM_TIMEOUT_MS,
  });
  return withHints(
    { operation: "import_transcript", fileName: file.name, ...generated },
    {
      action:
        "Show the user the suggestions and create the one they pick with create, adding its flowReferenceId or agentReferenceId.",
    },
  );
}

/**
 * A scenario's persona and mission are written for one target kind, so an
 * update may set a target only of the kind it already has (or any, when it has
 * none or both; the service treats a dual-target scenario as unrestricted).
 */
async function targetMismatch(
  sim: Simulator,
  data: Extract<ManageSimulationsInput, { operation: "update" }>,
) {
  if (!data.flowReferenceId && !data.agentReferenceId) return undefined;
  const current = await call(sim, "getSimulation", {
    path: { simulationReference: data.simulationReference },
    query: { projectId: sim.projectId },
  });
  // Read from the raw document, as service-testing's createdFromFlow does: the
  // legacy AI Agent node fields mean the scenario was written from a Flow.
  const hasFlow = Boolean(
    current?.flowReferenceId ||
    current?.aiAgentReferenceId ||
    current?.jobNodeId,
  );
  const hasAgent = Boolean(current?.aiAgentV2ReferenceId);
  const wantsAgent = Boolean(data.agentReferenceId);
  const mismatch = wantsAgent ? hasFlow && !hasAgent : hasAgent && !hasFlow;
  if (!mismatch) return undefined;
  return withHints(
    {
      operation: "update",
      error: "scenario_target_mismatch",
      message: `Simulation ${quoteName(current?.name ?? data.simulationReference)} is written for ${hasAgent ? "an AI Agent" : "a Flow"} and cannot be pointed at ${wantsAgent ? "an AI Agent" : "a Flow"}.`,
    },
    {
      action:
        "Keep its target, or create a new simulation for the other target.",
    },
  );
}

async function deletePreflight(sim: Simulator, simulationReference: string) {
  const simulation = await call(sim, "getSimulation", {
    path: { simulationReference },
    query: { projectId: sim.projectId },
  });
  return withHints(
    {
      operation: "delete",
      simulationReference,
      name: simulation?.name,
      deleted: false,
    },
    {
      action: `Deleting ${quoteName(simulation?.name ?? simulationReference)} also removes all its batches, runs and schedules permanently; ask the user and retry with confirm: true.`,
    },
  );
}

async function runOperation(
  sim: Simulator,
  data: ManageSimulationsInput,
): Promise<any> {
  const query = { projectId: sim.projectId };
  switch (data.operation) {
    case "list":
      return listSimulations(sim, data);
    case "get": {
      const simulation = await call(sim, "getSimulation", {
        path: { simulationReference: data.simulationReference },
        query,
      });
      return localizeTimes(
        sim.api,
        sim.projectId,
        filterResponse("simulation", simulation),
      );
    }
    case "create": {
      const created = await call(sim, "createSimulation", {
        body: { projectReference: sim.projectId, ...scenarioBody(data) },
      });
      return localizeTimes(
        sim.api,
        sim.projectId,
        filterResponse("simulation", created),
      );
    }
    case "update": {
      const mismatch = await targetMismatch(sim, data);
      if (mismatch) return mismatch;
      const updated = await call(sim, "updateSimulation", {
        path: { simulationReference: data.simulationReference },
        query,
        body: scenarioBody(data),
      });
      return localizeTimes(
        sim.api,
        sim.projectId,
        filterResponse("simulation", updated),
      );
    }
    case "delete":
      if (!data.confirm) return deletePreflight(sim, data.simulationReference);
      await call(sim, "deleteSimulation", {
        path: { simulationReference: data.simulationReference },
        query,
      });
      return {
        operation: "delete",
        simulationReference: data.simulationReference,
        deleted: true,
      };
    case "clone": {
      const cloned = await call(sim, "cloneSimulation", {
        path: { simulationReference: data.simulationReference },
        body: compact({ projectReference: sim.projectId, name: data.name }),
      });
      return localizeTimes(
        sim.api,
        sim.projectId,
        filterResponse("simulation", cloned),
      );
    }
    case "run":
      return runSimulation(sim, data);
    case "list_batches":
      return listBatches(sim, data);
    case "get_batch": {
      const batch = await call(sim, "getBatch", {
        path: {
          simulationReference: data.simulationReference,
          simulationRunBatchReference: data.batchReference,
        },
        query,
      });
      return localizeTimes(
        sim.api,
        sim.projectId,
        filterResponse("simulation_batch", batch),
      );
    }
    case "get_runs":
      return getRuns(sim, data);
    case "stop_batch":
      await call(sim, "stopBatch", {
        path: {
          simulationReference: data.simulationReference,
          simulationRunBatchReference: data.batchReference,
        },
        query,
      });
      return {
        operation: "stop_batch",
        batchReference: data.batchReference,
        stopped: true,
      };
    case "rerun_batch":
      return rerunBatch(sim, data);
    case "list_schedules": {
      const schedules = await call(sim, "listSchedules", {
        path: { simulationReference: data.simulationReference },
        query,
      });
      return localizeTimes(sim.api, sim.projectId, schedules);
    }
    case "upsert_schedule":
      return upsertSchedule(sim, data);
    case "dashboard":
      return dashboard(sim, data);
    case "persona_options":
      // Also an LLM call: it reads the Flow and proposes persona types.
      return call(sim, "personaOptions", {
        body: compact({
          projectReference: sim.projectId,
          flowId: data.flowId,
          numberOfSuccessCriteria: data.numberOfSuccessCriteria,
          language: data.language,
        }),
        timeout: SIMULATOR_LLM_TIMEOUT_MS,
      });
    case "generate_persona":
      return call(sim, "generatePersona", {
        body: compact({
          projectReference: sim.projectId,
          // The wire field is misnamed: it takes the Flow's 24-hex _id.
          flowReferenceId: data.flowId,
          selectedMissionType: data.selectedMissionType,
          selectedPersonaType: data.selectedPersonaType,
          numberOfSuccessCriteria: data.numberOfSuccessCriteria,
          language: data.language,
        }),
        timeout: SIMULATOR_LLM_TIMEOUT_MS,
      });
    case "regenerate_persona_field":
      return call(sim, "regeneratePersonaField", {
        body: compact({
          projectReference: sim.projectId,
          fieldToRegenerate: DRAFT_FIELD_API_NAMES[data.fieldToRegenerate],
          simulationName: data.name,
          personaName: data.personaName,
          personaDescription: data.persona,
          mission: data.mission,
          successCriteria: data.successCriteria,
          successCriteriaIndex: data.successCriteriaIndex,
          language: data.language,
        }),
        timeout: SIMULATOR_LLM_TIMEOUT_MS,
      });
    case "import_transcript":
      return importTranscript(sim, data);
  }
}

/** Whether service-testing answers at all on this environment. */
async function simulatorReachable(sim: Simulator): Promise<boolean> {
  try {
    await call(sim, "listSimulations", {
      query: { projectId: sim.projectId, limit: 1 },
    });
    return true;
  } catch (error: any) {
    // A 4xx other than 404 is the service answering; a 5xx or no answer is not.
    const status = error?.status;
    return (
      typeof status === "number" &&
      status >= 400 &&
      status < 500 &&
      status !== 404
    );
  }
}

/** A JSON error the service wrote itself (`{ error }` or `{ code }`). */
function isServiceError(body: any): boolean {
  return (
    !!body &&
    typeof body === "object" &&
    (typeof body.error === "string" || typeof body.code === "string")
  );
}

/** stop_batch answers every failure, a missing batch included, with a 400. */
function isNotFound(operation: string, error: any): boolean {
  if (error.status === 404) return true;
  return (
    operation === "stop_batch" &&
    error.status === 400 &&
    /not found/i.test(String(error.message))
  );
}

/**
 * A 4xx becomes a result that says what it means. Never rethrown: a
 * `/testing/v1/...` failure must not read as an AI Agents problem.
 */
async function errorResult(
  sim: Simulator,
  operation: string,
  error: any,
): Promise<any> {
  const failure = compact({
    operation,
    status: error.status,
    message: error.message,
    traceId: error.traceId,
  });
  const result = (code: string, hints: ResponseHints) =>
    withHints({ error: code, ...failure }, hints);
  const transcript = operation === "import_transcript";

  if (error.status === 401) {
    return result("simulator_forbidden", {
      likely_cause:
        "The key's user lacks the Simulator right for this operation.",
      action:
        "Tell the user the key's user needs a project role with this Simulator right; do not retry.",
    });
  }
  if (error.status === 403) {
    return result("simulator_forbidden", {
      likely_cause:
        "The key's user cannot use this project: not a member, not allowed to authenticate with an API key, a wrong projectId, or an id from another project.",
      action:
        "Check the projectId and the ids against list results; otherwise tell the user what the key's user lacks. Do not retry unchanged.",
    });
  }
  if (error.status === 429) {
    return result("simulator_rate_limited", {
      action: "Rate limited; wait a moment and retry.",
    });
  }
  if (error.status === 404 && error.code === "FEATURE_DISABLED") {
    return result("transcript_import_disabled", {
      likely_cause: "Transcript import is turned off on this environment.",
      action:
        "Tell the user, and offer to draft the scenario with persona_options and generate_persona instead.",
    });
  }
  if (error.status === 404 && transcript && !isServiceError(error.errorBody)) {
    return result("transcript_import_unavailable", {
      likely_cause: "This environment's Simulator has no transcript import.",
      action:
        "Tell the user, and offer to draft the scenario with persona_options and generate_persona instead.",
    });
  }
  if (isNotFound(operation, error)) {
    const answeredByService =
      error.status !== 404 || transcript || (await simulatorReachable(sim));
    if (!answeredByService) {
      return result("simulator_unavailable", {
        likely_cause: "This environment does not run the Cognigy Simulator.",
        action: "Tell the user the Simulator is not available here.",
      });
    }
    return result("simulator_not_found", {
      likely_cause: transcript
        ? "The transcript session does not exist any more."
        : "The simulation, batch, run or schedule does not exist in this project: deleted or a wrong id.",
      action: transcript
        ? "A transcript session expires, so run import_transcript again."
        : "List again to get current references; never guess one.",
    });
  }
  return result("simulator_request_rejected", {
    action: "Fix the request as the message says; do not retry it unchanged.",
  });
}

export async function manageSimulations(
  api: CognigyApiClient,
  origin: string,
  data: ManageSimulationsInput,
): Promise<any> {
  const sim: Simulator = {
    api,
    base: `${origin}/testing`,
    projectId: data.projectId,
  };
  try {
    return await runOperation(sim, data);
  } catch (error: any) {
    const status = error?.status;
    if (typeof status !== "number" || status < 400 || status >= 500) {
      throw error;
    }
    return errorResult(sim, data.operation, error);
  }
}
