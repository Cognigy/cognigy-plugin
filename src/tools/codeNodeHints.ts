/**
 * Non-blocking hints for Code Node source that uses something the Cognigy Code
 * Node runtime does not provide. Each rule cites the documentation behind it.
 *
 * Hints, never gates: the write always goes through and the caller gets the
 * sentences as `_hints.warning`. The scan is a plain pattern match with
 * comments and string contents blanked out, nothing more — a local helper that
 * happens to be called `fetch` may trigger a hint, which costs one sentence,
 * not the write. Whether the code compiles is the platform's verdict, read
 * back as `config.hasError` by the update handler.
 */

// https://docs.cognigy.com/ai/for-developers/code/modules
const MODULE_GLOBALS = "moment, _ (Lodash), xmljs, getTextCleaner";

const RULES: { pattern: RegExp; hint: string }[] = [
  {
    // api.httpRequest exists in Cognigy Functions only.
    pattern: /\bapi\.httpRequest\s*\(/,
    hint: "api.httpRequest() exists only in Cognigy Functions, not in Code Nodes — use an HTTP Request node and read input.httprequest.",
  },
  {
    pattern:
      /(?:(?<![.\w$])|\b(?:globalThis|window|global|self)\.)fetch\s*\(|\bXMLHttpRequest\b/,
    hint: "fetch()/XMLHttpRequest are not available in the Code Node runtime — use an HTTP Request node and read input.httprequest.",
  },
  {
    // String contents are blanked before matching, so a static import's
    // module name is gone: match `import … from` or a bare `import ;`.
    pattern:
      /(?:(?<![.\w$])|\b(?:globalThis|window|global|self)\.)(?:require|import)\s*\(|^\s*import\s+(?!type\b)(?:[\w*{}\s,$]+\s+from\b|;|$)/m,
    hint: `require()/import are not available in the Code Node runtime — the preinstalled modules are globals (${MODULE_GLOBALS}) and nothing else can be loaded.`,
  },
  {
    // https://docs.cognigy.com/ai/for-developers/code/api-functions#states-deprecated
    pattern: /\bapi\.(?:setState|getState|resetState)\s*\(/,
    hint: "api.setState()/getState()/resetState() were removed with States in Cognigy.AI 2026.12.0 — use Intent Conditions instead.",
  },
];

const CAVEAT =
  "If the flagged name is a local helper rather than the runtime API, ignore this.";

/** Blanks comments and string/template literal contents so text is not read as code. */
const executableOnly = (code: string): string =>
  code.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g,
    " ",
  );

/**
 * Sentences for `_hints.warning` about runtime APIs the code uses but the
 * Code Node runtime does not have; empty when nothing was found.
 */
export function codeNodeWarnings(code: string): string[] {
  const executable = executableOnly(code);
  const hints = RULES.filter((r) => r.pattern.test(executable)).map(
    (r) => r.hint,
  );
  return hints.length > 0 ? [...hints, CAVEAT] : [];
}
