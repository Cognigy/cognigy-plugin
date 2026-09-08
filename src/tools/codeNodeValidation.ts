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
 * Comments, string/regex literal contents and the literal parts of template
 * literals are blanked out first (`${…}` interpolations stay, since they run)
 * so a mention of `fetch()` in a message or a comment is never mistaken for a
 * call. Bare names are then classified per use site: a locally declared
 * `fetch`, a `fetch() {}` method definition or a `{ fetch: … }` key is code
 * the runtime resolves itself and is never reported as a missing global.
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
 * Objects through which a runtime global can be reached by qualified name.
 */
const GLOBAL_OBJECTS = "globalThis|window|global|self";

/**
 * After one of these a `/` starts a regex literal rather than a division.
 */
const REGEX_PRECEDING_KEYWORDS = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "await",
  "yield",
]);

/**
 * `(` after one of these opens a condition/head, not a parameter list.
 */
const NON_PARAM_KEYWORDS = new Set([
  "if",
  "while",
  "for",
  "switch",
  "with",
  "return",
  "typeof",
  "await",
  "yield",
  "throw",
  "case",
  "in",
  "of",
  "instanceof",
  "new",
  "delete",
  "void",
]);

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Replaces the contents of comments, string literals, regex literals and the
 * literal (non-`${…}`) parts of template literals with spaces — preserving
 * length and line breaks — so the pattern checks only see code that can
 * execute. Interpolated expressions are kept and scanned recursively, so
 * `` `${api.getState()}` `` is still a call and `` `${`fetch()`}` `` is still
 * text. Delimiters (quotes, backticks, slashes, `${`/`}`) are kept in place.
 *
 * Regex-vs-division is decided the way a tokenizer does: a `/` starts a regex
 * when the previous significant token cannot end an operand (`(`, `,`, `=`,
 * `return`, …); after `)`, `]`, an identifier or a number it is a division.
 * The ambiguous `}` is read as a block end (regex allowed). A misread only
 * blanks the rest of that line — a false negative, never a false rejection.
 */
export function stripCommentsAndStrings(code: string): string {
  const n = code.length;
  let out = "";
  let i = 0;
  const blank = (s: string) => s.replace(/[^\n]/g, " ");

  /** Whether a `/` at the current position starts a regex literal. */
  const regexAllowed = (): boolean => {
    let k = out.length - 1;
    while (k >= 0 && /\s/.test(out[k])) k--;
    if (k < 0) return true;
    const prev = out[k];
    if (/[\w$]/.test(prev)) {
      let w = k;
      while (w >= 0 && /[\w$]/.test(out[w])) w--;
      return REGEX_PRECEDING_KEYWORDS.has(out.slice(w + 1, k + 1));
    }
    return "(,=:[!&|?{};+-*%<>~^".includes(prev);
  };

  const scanLineComment = (): void => {
    const end = code.indexOf("\n", i);
    const stop = end === -1 ? n : end;
    out += blank(code.slice(i, stop));
    i = stop;
  };

  const scanBlockComment = (): void => {
    const end = code.indexOf("*/", i + 2);
    const stop = end === -1 ? n : end + 2;
    out += blank(code.slice(i, stop));
    i = stop;
  };

  const scanString = (quote: string): void => {
    let j = i + 1;
    while (j < n && code[j] !== quote && code[j] !== "\n") {
      if (code[j] === "\\") j++;
      j++;
    }
    const closed = j < n && code[j] === quote;
    const stop = Math.min(closed ? j + 1 : j, n);
    out += quote + blank(code.slice(i + 1, stop - (closed ? 1 : 0)));
    if (closed) out += quote;
    i = stop;
  };

  const scanRegex = (): void => {
    out += "/";
    i++;
    let inClass = false;
    while (i < n) {
      const c = code[i];
      if (c === "\n") return; // unterminated — treat as a misread, resume
      if (c === "\\") {
        out += blank(code.slice(i, i + 2));
        i += 2;
        continue;
      }
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) {
        out += "/";
        i++;
        while (i < n && /[a-z]/i.test(code[i])) out += code[i++];
        return;
      }
      out += " ";
      i++;
    }
  };

  const scanTemplate = (): void => {
    out += "`";
    i++;
    while (i < n) {
      const c = code[i];
      if (c === "\\") {
        out += blank(code.slice(i, i + 2));
        i += 2;
      } else if (c === "`") {
        out += "`";
        i++;
        return;
      } else if (c === "$" && code[i + 1] === "{") {
        out += "${";
        i += 2;
        scanCode(true);
        if (i < n) {
          out += "}";
          i++;
        }
      } else {
        out += c === "\n" ? "\n" : " ";
        i++;
      }
    }
  };

  /**
   * Scans code; with `untilBrace` it stops (without consuming) at the `}`
   * that closes the enclosing `${`.
   */
  const scanCode = (untilBrace: boolean): void => {
    let depth = 0;
    while (i < n) {
      const c = code[i];
      const next = code[i + 1];
      if (c === "/" && next === "/") scanLineComment();
      else if (c === "/" && next === "*") scanBlockComment();
      else if (c === '"' || c === "'") scanString(c);
      else if (c === "`") scanTemplate();
      else if (c === "/" && regexAllowed()) scanRegex();
      else {
        if (untilBrace) {
          if (c === "{") depth++;
          else if (c === "}") {
            if (depth === 0) return;
            depth--;
          }
        }
        out += c;
        i++;
      }
    }
  };

  scanCode(false);
  return out;
}

/**
 * Whether `name` is declared in the code itself — as a function/class/
 * variable, in a destructuring declaration, or as a parameter — in which case
 * a bare reference resolves to that binding, not to a runtime global.
 * Scoping is deliberately ignored: any declaration anywhere shadows.
 */
function isDeclaredLocally(code: string, name: string): boolean {
  const id = escapeRegExp(name);
  const word = `(?<![\\w$.])${id}(?![\\w$])`;
  if (
    new RegExp(
      `\\b(?:function\\s*\\*?|const|let|var|class)\\s+${id}(?![\\w$])`,
    ).test(code)
  ) {
    return true;
  }
  // const { a, fetch } = …;  const [fetch] = …;
  if (
    new RegExp(
      `\\b(?:const|let|var)\\s*[{\\[][^=;]*${word}[^=;]*[}\\]]\\s*=`,
    ).test(code)
  ) {
    return true;
  }
  // fetch => …
  if (new RegExp(`${word}\\s*=>`).test(code)) return true;
  // function f(fetch) {…}   { m(fetch) {…} }   (a, fetch) => …
  const paramLists = code.matchAll(
    /(?:\bfunction\b\s*\*?\s*[\w$]*\s*|(?<![\w$.])([\w$]+)\s*)?\(([^()]*)\)\s*(=>|\{)/g,
  );
  const inList = new RegExp(word);
  for (const m of paramLists) {
    const [, callee, params, opener] = m;
    if (
      opener === "{" &&
      (callee === undefined || NON_PARAM_KEYWORDS.has(callee))
    ) {
      // `if (…) {`, `while (…) {`, or a bare `(…) {` — not a parameter list.
      if (!/\bfunction\b/.test(m[0])) continue;
    }
    if (inList.test(params)) return true;
  }
  return false;
}

/** Index of the `)` matching the `(` at `open`, or -1. */
function matchingParen(code: string, open: number): number {
  let depth = 0;
  for (let k = open; k < code.length; k++) {
    if (code[k] === "(") depth++;
    else if (code[k] === ")" && --depth === 0) return k;
  }
  return -1;
}

/**
 * Whether `name` is used as a runtime global: referenced bare or qualified
 * through globalThis/window/global/self, and not as a property of some other
 * object, a local binding, a function/method definition or an object key.
 * With `call`, only call sites (`name(`) count.
 */
function usesGlobal(
  code: string,
  name: string,
  { call }: { call: boolean },
): boolean {
  const declared = isDeclaredLocally(code, name);
  const uses = code.matchAll(
    new RegExp(
      `(?<![.\\w$])(?:(${GLOBAL_OBJECTS})\\s*\\.\\s*)?${escapeRegExp(name)}(?![\\w$])`,
      "g",
    ),
  );
  for (const m of uses) {
    const qualified = m[1] !== undefined;
    const end = m.index + m[0].length;
    const before = code.slice(0, m.index);
    const after = code.slice(end);
    if (call) {
      const paren = after.match(/^\s*\(/);
      if (!paren) continue;
      const close = matchingParen(code, end + paren[0].length - 1);
      const tail = close === -1 ? "" : code.slice(close + 1);
      // `fetch(…) {` — a function or method definition, not a call.
      if (/^\s*\{/.test(tail)) continue;
    }
    if (qualified) return true;
    if (declared) continue;
    // `{ XMLHttpRequest: … }` — an object key.
    if (/[{,]\s*$/.test(before) && /^\s*:/.test(after)) continue;
    // `typeof XMLHttpRequest` — feature detection never throws.
    if (!call && /\btypeof\s+$/.test(before)) continue;
    return true;
  }
  return false;
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
  if (
    usesGlobal(code, "fetch", { call: true }) ||
    usesGlobal(code, "XMLHttpRequest", { call: false })
  ) {
    errors.push(
      "fetch()/XMLHttpRequest are not available in the Code Node runtime. Use an HTTP Request node in the flow and read the response from input.httprequest.",
    );
  }
}

function checkModuleLoading(code: string, errors: string[]): void {
  const hasRequire = usesGlobal(code, "require", { call: true });
  const hasImport =
    /^\s*import\s+(?:[\w*{}\s,$]+\s+from\s+)?["']/m.test(code) ||
    usesGlobal(code, "import", { call: true });
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
