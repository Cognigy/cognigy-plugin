/**
 * Validation for Cognigy Code Node content against NA Professional Services
 * standards (see the `na-professionalservices` skill, `cognigyCodeDev.md`,
 * sections: "Code Node Rules", "Standardized Catch Block", "Allowed API
 * Functions", "api.setState() ... Removed", "api.deleteContext() ...",
 * "Writing to Context", "No HTTP in Code Nodes", "Environment Constraints",
 * "Coding Standards").
 *
 * Current scope, per team decisions:
 *   - Comment-header enforcement is out of scope (tracked separately).
 *   - The "no function declarations inside a Code Node" rule is out of
 *     scope for now (tracked separately).
 *   - `errorEnv` is intentionally NOT part of the required catch fields —
 *     the team standard was trimmed to only fields sourced from the error
 *     itself or from `input`, since an environment lookup can't be assumed
 *     to exist on every agent.
 *
 * This is a structural/text check, not a full JS/TS parse — Code Nodes are
 * TypeScript, transpiled server-side, and we don't have that transpiler
 * available locally. Checks are intentionally pattern-based rather than a
 * strict AST match, so minor formatting differences (spacing, variable name
 * for the caught error) don't produce false failures.
 */

export interface CodeNodeValidationResult {
  /** Blocking problems — code with any of these should not be written. */
  errors: string[];
  /** Non-blocking problems — code proceeds, but the caller should be told. */
  warnings: string[];
}

/** Fields the standardized catch block must set on the `codeNode` error object. */
const REQUIRED_CATCH_FIELDS = [
  "error",
  "errorMessage",
  "errorFlow",
  "errorNode",
  "errorTime",
  "errorSessionId",
  "errorUserId",
] as const;

/**
 * The standardized catch block template, current team version (errorEnv
 * removed — see the module doc comment above for why). Surfaced in
 * validation error messages so callers can copy it directly instead of
 * reconstructing it from the rule description.
 */
export const STANDARD_CATCH_BLOCK = `try {
  // your script here
} catch (error) {
  let codeNode = {
    error: true,
    errorMessage: \`\${error}\`,
    errorFlow: \`\${input.flowName}\`,
    errorNode: \`NODE NAME\`, // SET TO THE NAME OF THE FLOW THIS IS FOR
    errorTime: input.currentTime.plain,
    errorSessionId: input.sessionId,
    errorUserId: input.userId
  };
  api.addToContext("codeNode", codeNode, "simple");
}`;

/** The only api.* methods the platform actually supports (cognigyCodeDev "Allowed API Functions"). */
const ALLOWED_API_METHODS = new Set([
  "addToContext",
  "getContext",
  "setContext",
  "deleteContext",
  "removeFromContext",
  "resetContext",
  "say",
  "output",
  "addToInput",
  "updateProfile",
  "setNextNode",
  "resetNextNodes",
  "stopExecution",
  "log",
  "logDebugMessage",
  "logDebugError",
  "setAppState",
  "handover",
  "thinkV2",
  "base64Encode",
  "base64Decode",
  "completeGoal",
  "parseCognigyScript",
  "trackAnalyticsStep",
]);

/** Methods removed in Cognigy.AI 2026.12.0 — called out with a specific message. */
const REMOVED_STATE_METHODS = new Set(["setState", "getState", "resetState"]);

/** Browser-only APIs that don't exist in the Code Node's Node.js runtime. */
const BANNED_BROWSER_APIS = [
  /\.toLocaleString\s*\(/,
  /\.toLocaleDateString\s*\(/,
  /\.toLocaleTimeString\s*\(/,
  /\bIntl\./,
];

/** Approximate soft ceiling used only to warn on unusually large Code Nodes. */
const LINE_COUNT_LIMIT = 200_000;
/** Approximate soft ceiling on api.* calls per Code Node (platform limit is 100). */
const API_CALL_WARNING_THRESHOLD = 100;

function checkTryCatch(code: string, errors: string[]): void {
  const hasTry = /\btry\s*{/.test(code);
  const hasCatch = /}\s*catch\s*\(\s*\w+\s*\)\s*{/.test(code);

  if (!hasTry || !hasCatch) {
    errors.push(
      "Code must wrap all logic in a try/catch block — every Code Node body needs a top-level try { ... } catch (error) { ... }.",
    );
    return;
  }

  // Isolate the catch block body so the field checks below don't false-positive
  // on unrelated code elsewhere in the node that happens to mention these words.
  const catchBodyMatch = code.match(/catch\s*\(\s*\w+\s*\)\s*{([\s\S]*)}\s*$/);
  const catchBody = catchBodyMatch ? catchBodyMatch[1] : code;

  const missingFields = REQUIRED_CATCH_FIELDS.filter(
    (field) => !new RegExp(`\\b${field}\\b`).test(catchBody),
  );
  if (missingFields.length > 0) {
    errors.push(
      `catch block is missing required field(s): ${missingFields.join(", ")}. Use the standardized catch block from the cognigyCodeDev skill.`,
    );
  }

  if (!/api\.addToContext\(\s*["']codeNode["']/.test(catchBody)) {
    errors.push(
      'catch block must report the error via api.addToContext("codeNode", ..., "simple") — the standardized catch block is missing or was not detected.',
    );
  }
}

function checkApiAllowlist(code: string, errors: string[]): void {
  const calls = code.matchAll(/\bapi\.(\w+)\s*\(/g);
  const seen = new Set<string>();
  for (const match of calls) {
    const method = match[1];
    if (seen.has(method)) continue;
    seen.add(method);

    if (REMOVED_STATE_METHODS.has(method)) {
      errors.push(
        `api.${method}() was removed in Cognigy.AI 2026.12.0 and cannot be used. Use Intent Conditions to control intent recognition instead.`,
      );
      continue;
    }

    if (!ALLOWED_API_METHODS.has(method)) {
      errors.push(
        `api.${method}() is not a supported Cognigy Code Node API method. Allowed methods: ${Array.from(ALLOWED_API_METHODS).join(", ")}.`,
      );
    }
  }
}

function checkNoHttpOrModules(code: string, errors: string[]): void {
  if (/\bapi\.httpRequest\s*\(/.test(code)) {
    errors.push(
      "api.httpRequest() does not exist. HTTP calls must use a dedicated HTTP Request Node in the Flow, not a Code Node.",
    );
  }
  if (/\bfetch\s*\(/.test(code) || /\bXMLHttpRequest\b/.test(code)) {
    errors.push(
      "fetch()/XMLHttpRequest are not available in the Code Node runtime. Use a dedicated HTTP Request Node in the Flow instead.",
    );
  }
  if (/\baxios\b/.test(code)) {
    errors.push(
      "axios is not available in the Code Node runtime. Use a dedicated HTTP Request Node in the Flow instead.",
    );
  }
  if (/require\s*\(\s*["']node-fetch["']\s*\)/.test(code)) {
    errors.push(
      "node-fetch is not available in the Code Node runtime. Use a dedicated HTTP Request Node in the Flow instead.",
    );
  }
  if (/\brequire\s*\(/.test(code) || /^\s*import\s+.+\bfrom\b/m.test(code)) {
    errors.push(
      "require()/import of a module was detected. Only modules explicitly documented as available in Cognigy's Code Node environment may be used — check the Available Modules reference before including this.",
    );
  }
}

function checkBannedBrowserApis(code: string, errors: string[]): void {
  if (BANNED_BROWSER_APIS.some((pattern) => pattern.test(code))) {
    errors.push(
      "Code uses a browser-only API (toLocaleString/toLocaleDateString/toLocaleTimeString/Intl.*) that isn't available in the Code Node's Node.js runtime. Use deterministic string/date handling instead (e.g. substring, regex, plain arithmetic).",
    );
  }
}

function checkDeleteContextNestedPath(code: string, warnings: string[]): void {
  const nestedDeleteCalls = code.match(
    /api\.deleteContext\(\s*["'][^"']*\.[^"']*["']/g,
  );
  if (nestedDeleteCalls) {
    warnings.push(
      'api.deleteContext() only deletes top-level keys — a dot-path argument (e.g. "temp.latencyStart") fails silently and leaves the key in place. For a nested key, use `delete context.temp.latencyStart;` or api.removeFromContext("temp.latencyStart", null, "simple") instead.',
    );
  }
}

function checkDirectContextAssignment(code: string, warnings: string[]): void {
  // `delete context.x;` is the documented, correct way to remove a nested key
  // (see checkDeleteContextNestedPath above) — strip those statements first so
  // they aren't mistaken for a direct assignment.
  const withoutDeletes = code.replace(/delete\s+context\.[\w$.]+\s*;?/g, "");
  if (/\bcontext\.[\w$.]+\s*=(?!=)/.test(withoutDeletes)) {
    warnings.push(
      'Code appears to assign directly to context (e.g. "context.x = value") instead of using api.addToContext("path.to.key", value, "simple"). Direct assignment does not persist the way Cognigy expects — use api.addToContext() to write to context.',
    );
  }
}

function checkVarUsage(code: string, warnings: string[]): void {
  if (/\bvar\s+\w+/.test(code)) {
    warnings.push(
      "Code uses `var`, which is function-scoped and hoisted and can cause unexpected bugs. Use `const` for values that aren't reassigned and `let`, scoped as tightly as possible, for values that are.",
    );
  }
}

function checkSizeAndCallLimits(code: string, warnings: string[]): void {
  const lineCount = code.split("\n").length;
  if (lineCount > LINE_COUNT_LIMIT) {
    warnings.push(
      `Code is ${lineCount} lines, at or beyond the platform's 200,000-line Code Node limit.`,
    );
  }

  const apiCallCount = (code.match(/\bapi\.\w+\s*\(/g) ?? []).length;
  if (apiCallCount > API_CALL_WARNING_THRESHOLD) {
    warnings.push(
      `Code makes approximately ${apiCallCount} api.* calls, above the platform's 100-API-call-per-node limit (this count is a textual approximation, not an exact runtime count).`,
    );
  }
}

/**
 * Validates a Code Node's `code` string against the team's Cognigy Code Node
 * standards. Returns blocking `errors` (code that is guaranteed-broken or
 * guaranteed-nonfunctional on the platform) separately from non-blocking
 * `warnings` (code that may work but is risky, silently wrong, or against
 * style guidance).
 */
export function validateCodeNode(code: string): CodeNodeValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  checkTryCatch(code, errors);
  checkApiAllowlist(code, errors);
  checkNoHttpOrModules(code, errors);
  checkBannedBrowserApis(code, errors);

  checkDeleteContextNestedPath(code, warnings);
  checkDirectContextAssignment(code, warnings);
  checkVarUsage(code, warnings);
  checkSizeAndCallLimits(code, warnings);

  return { errors, warnings };
}
