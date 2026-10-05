/**
 * Actor attribution for Cognigy audit events.
 *
 * Cognigy.AI (>= 2026.17.0) records who performed an audited action in
 * `IAuditEvent.performedBy` and surfaces it as the "Performed by" column in
 * Admin Center -> Audit Events. Callers declare themselves with the
 * `X-Ask-AI-Context` request header, which service-api's authentication
 * middleware parses into `request.actor` before any auth strategy runs.
 *
 * Wire contract (service-api `middleware/authentication.ts`) — get any of this
 * wrong and the platform silently records the action as a plain human one:
 * - The header is a JSON object whose actor field is named `type`, NOT `actor`
 *   (the middleware maps `context.type` onto `performedBy.actor`).
 * - `taskId` is MANDATORY and must be a string.
 * - `type` must be one of "human" | "ask-ai" | "system" | "mcp-plugin"; this
 *   plugin is "mcp-plugin", already a first-class value in the platform's enum,
 *   indexes, REST `actor[]` filter and UI labels.
 * - `sessionId` is optional and must be a string when present.
 *
 * Older platform versions simply ignore the unknown header, so sending it is
 * safe against any tenant.
 *
 * Attribution is self-declared provenance for auditability, not a security
 * control: the platform trusts this header from any authenticated caller (a
 * gap tracked on the Cognigy side).
 */
import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";

/** The actor value this plugin reports. Must match the platform's enum. */
export const ACTOR_TYPE = "mcp-plugin";

export const ACTOR_CONTEXT_HEADER = "X-Ask-AI-Context";

/**
 * One MCP server process serves exactly one client session (a single stdio
 * transport, torn down when stdin closes), so a boot-time id is the session
 * identity. Grouping every task of one server run under it lets an operator
 * pick a whole plugin session out of the audit log.
 */
const SESSION_ID = randomUUID();

interface TaskContext {
  taskId: string;
}

const taskStore = new AsyncLocalStorage<TaskContext>();

/**
 * Run `fn` under a fresh task id. Scoped per MCP tool call so that every API
 * request a single tool call fans out to shares one `taskId` — the correlation
 * granularity that matches the platform's "task/turn" semantics.
 *
 * AsyncLocalStorage rather than a field on the client: the MCP server can have
 * several tool calls in flight, and a mutable field would let their ids
 * interleave.
 */
export function runWithTask<T>(fn: () => Promise<T>): Promise<T> {
  return taskStore.run({ taskId: randomUUID() }, fn);
}

/** The current task id, or undefined outside a `runWithTask` scope. */
export function getTaskId(): string | undefined {
  return taskStore.getStore()?.taskId;
}

/** The id shared by every task of this server process. */
export function getSessionId(): string {
  return SESSION_ID;
}

/**
 * The `X-Ask-AI-Context` header value for the current task, or undefined when
 * called outside a tool call — in which case no attribution is claimed and the
 * request keeps the exact shape it had before this feature.
 */
export function getActorContextHeader(): string | undefined {
  const taskId = getTaskId();
  if (!taskId) return undefined;
  return JSON.stringify({
    type: ACTOR_TYPE,
    taskId,
    sessionId: SESSION_ID,
  });
}
