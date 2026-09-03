/**
 * Static checks for Cognigy Code Node source against constraints the platform
 * itself imposes. Every rule here cites the Cognigy documentation that backs it
 * and was verified on a live tenant (2026.17) before being added.
 *
 * Severity follows the evidence, not preference:
 *   - `errors` — the code is guaranteed to fail on the platform (a method or
 *     global that does not exist in the Code Node runtime). Writes are rejected.
 *   - `warnings` — a documented limit or documented footgun; the code still
 *     runs, so the write proceeds and the caller is told.
 *
 * Style and house conventions (try/catch shape, method allowlists, `var`,
 * locale APIs, direct `context.x = …` writes, which do persist) are deliberately
 * NOT checked — anything the platform supports must not be gated.
 *
 * Checks are pattern-based, not a JS/TS parse: Code Nodes are TypeScript that
 * the backend transpiles at save time, and the real compile verdict is read
 * back as `config.hasError` by the update handler. These checks only cover
 * what a successful transpile cannot catch (missing runtime globals/methods).
 * Comments and string/template literal contents are blanked out first so a
 * mention of `fetch()` in a message or a comment is never mistaken for a call.
 */

export interface CodeNodeValidationResult {
  /** Blocking problems — the code is certain to fail on the platform. */
  errors: string[];
  /** Non-blocking problems — the code runs, but the caller should be told. */
  warnings: string[];
}

/**
 * States are deprecated since 2026.7.0 and slated for removal in 2026.12.0;
 * Intent Conditions are the documented replacement.
 * https://docs.cognigy.com/ai/for-developers/code/api-functions#states-deprecated
 * https://docs.cognigy.com/release-notes/2026.12
 */
const REMOVED_STATE_METHODS = new Set(["setState", "getState", "resetState"]);

/**
 * Modules available in a Code Node are injected as globals — `moment`, `_`
 * (Lodash), `xmljs`, `getTextCleaner` — there is no `require`/`import`.
 * https://docs.cognigy.com/ai/for-developers/code/modules
 */
const MODULE_GLOBALS = "moment, _ (Lodash), xmljs, getTextCleaner";

/**
 * Documented platform limit: at most 100 `api.*` calls per Code Node
 * execution; exceeding it aborts the node with `input.codeNodeError`.
 * https://docs.cognigy.com/ai/administer/limitations
 */
const API_CALL_LIMIT = 100;

/**
 * Call of a global — bare (`fetch(`) or qualified through a global object
 * (`globalThis.fetch(`), but not a method on some other object (`repo.fetch(`).
 */
const globalCall = (name: string) =>
  new RegExp(
    `(?:(?<![.\\w$])|\\b(?:globalThis|window|global|self)\\.)${name}\\s*\\(`,
  );

/**
 * Replaces the contents of comments and string/template literals with spaces
 * (preserving length and line breaks) so the pattern checks only see code that
 * can execute. Regex literals are not tracked; a quote inside one is rare in
 * Code Node scripts and at worst blanks a stretch of code (a false negative,
 * never a false rejection).
 */
export function stripCommentsAndStrings(code: string): string {
  let out = "";
  let i = 0;
  const n = code.length;
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  while (i < n) {
    const c = code[i];
    const next = code[i + 1];
    if (c === "/" && next === "/") {
      const end = code.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      out += blank(code.slice(i, stop));
      i = stop;
    } else if (c === "/" && next === "*") {
      const end = code.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      out += blank(code.slice(i, stop));
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n && code[j] !== c) {
        if (code[j] === "\\") j++;
        else if (c !== "`" && code[j] === "\n") break;
        j++;
      }
      const stop = Math.min(j + 1, n);
      out += c + blank(code.slice(i + 1, stop - 1)) + (j < n ? c : "");
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function checkRemovedStateMethods(code: string, errors: string[]): void {
  const used = new Set<string>();
  for (const match of code.matchAll(/\bapi\.(\w+)\s*\(/g)) {
    if (REMOVED_STATE_METHODS.has(match[1])) used.add(match[1]);
  }
  if (used.size > 0) {
    errors.push(
      `api.${Array.from(used).join("()/api.")}() — States are deprecated since Cognigy.AI 2026.7.0 and removed in 2026.12.0. Use Intent Conditions to control intent recognition instead.`,
    );
  }
}

function checkHttp(code: string, errors: string[]): void {
  if (/\bapi\.httpRequest\s*\(/.test(code)) {
    errors.push(
      "api.httpRequest() exists only in Cognigy Functions, not in Code Nodes. Use an HTTP Request node in the flow and read the response from input.httprequest.",
    );
  }
  if (globalCall("fetch").test(code) || /\bXMLHttpRequest\b/.test(code)) {
    errors.push(
      "fetch()/XMLHttpRequest are not available in the Code Node runtime. Use an HTTP Request node in the flow and read the response from input.httprequest.",
    );
  }
}

function checkModuleLoading(code: string, errors: string[]): void {
  const hasRequire = globalCall("require").test(code);
  const hasImport =
    /^\s*import\s+(?:[\w*{}\s,$]+\s+from\s+)?["']/m.test(code) ||
    globalCall("import").test(code);
  if (hasRequire || hasImport) {
    errors.push(
      `require()/import are not available in the Code Node runtime. The preinstalled modules are injected as globals — ${MODULE_GLOBALS} — and no other modules can be loaded.`,
    );
  }
}

function checkDeleteContextNestedPath(code: string, warnings: string[]): void {
  if (/\bapi\.deleteContext\s*\(\s*["'`][^"'`]*\.[^"'`]*["'`]/.test(code)) {
    warnings.push(
      'api.deleteContext() only removes top-level keys — a dot-path argument like "a.b" silently does nothing. To remove a nested key use `delete context.a.b;` instead.',
    );
  }
}

function checkApiCallLimit(code: string, warnings: string[]): void {
  const apiCallCount = (code.match(/\bapi\.\w+\s*\(/g) ?? []).length;
  if (apiCallCount > API_CALL_LIMIT) {
    warnings.push(
      `Code contains ${apiCallCount} api.* call sites; the platform aborts a Code Node after ${API_CALL_LIMIT} api.* calls per execution (input.codeNodeError). Calls inside loops count per iteration, so the real total may be higher still.`,
    );
  }
}

/**
 * Validates a Code Node's `code` string against documented platform
 * constraints. See the module doc comment for what is and is not checked.
 */
export function validateCodeNode(source: string): CodeNodeValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const code = stripCommentsAndStrings(source);

  checkRemovedStateMethods(code, errors);
  checkHttp(code, errors);
  checkModuleLoading(code, errors);

  // Needs the literal argument, so it runs on the unstripped source.
  checkDeleteContextNestedPath(source, warnings);
  checkApiCallLimit(code, warnings);

  return { errors, warnings };
}
