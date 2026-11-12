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

/**
 * Blanks comments, string/template literal contents and regex literals so text
 * is not read as code. Blanking keeps every newline and the line lengths, so
 * the per-line readability checks see the original line structure. A regex
 * literal is a `/…/` that follows an operator, an opening bracket or a keyword
 * such as `return` (so `a / b / c`, `{ … } / 2` and `n++ / 2` stay division).
 */
const executableOnly = (code: string): string =>
  code.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`|(?<=(?:[=(,:[!&|?{;*%<>~^]|(?<![+-])[+-]|(?<![\w$.])(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await))\s*)\/(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[a-z]*/g,
    (m) => m.replace(/[^\n]/g, " "),
  );

// Readability ceilings (github issue #62). Humans review and maintain the
// generated flow; a Code node past these is hard to read in the Designer.
const MAX_LINES = 60;
const MAX_LINE_CHARS = 160;

/**
 * Statements on one line of executable text: the non-empty `;`-separated
 * segments once brace-free `(…)` groups (`for (…; …; …)` headers, call
 * arguments) and type literals (`{ name: string; price: number }` after `:`
 * that is not a `case`/`default` label, `<`, `type X =` or `interface X`) are
 * dropped. Executable blocks such as
 * `if (x) { a(); b(); c(); }` keep their statements.
 */
function statementCount(line: string): number {
  let out = line;
  for (let prev = ""; prev !== out;) {
    prev = out;
    out = out
      .replace(/\([^(){}]*\)/g, " ")
      .replace(
        /(?:(?<!\b(?:case\b[^:]*|default\s*)):|<|\btype\s+[\w$]+(?:<[^<>]*>)?\s*=|\binterface\s+[\w$]+[^{]*)\s*\{[^{}]*\}/g,
        " ",
      );
  }
  return out.split(";").filter((s) => /[^\s{}]/.test(s)).length;
}

/** Sentences about code that is too long or crammed onto too few lines. */
function readabilityWarnings(code: string): string[] {
  const hints: string[] = [];
  const nonBlank = code.split("\n").filter((l) => l.trim().length > 0).length;
  if (nonBlank > MAX_LINES) {
    hints.push(
      `This Code node is ${nonBlank} lines — split it into smaller, separately labelled nodes (aim for under ${MAX_LINES}) so reviewers can follow it.`,
    );
  }
  const crammed = executableOnly(code)
    .split("\n")
    .some((l) => l.length > MAX_LINE_CHARS || statementCount(l) >= 3);
  if (crammed) {
    hints.push(
      `The code has lines that chain several statements or run past ${MAX_LINE_CHARS} characters — format it like a source file: one statement per line, 2-space indentation, blank lines between steps.`,
    );
  }
  return hints;
}

/**
 * One pass over the code. `warnings` are the sentences for `_hints.warning`:
 * readability ceilings the code exceeds, then runtime APIs it uses but the
 * Code Node runtime does not have, followed by the caveat that applies only to
 * those. `fix` names the matching next step as a clause the caller finishes
 * with the tool to use ("… with another update."). Both empty when nothing
 * was found.
 */
export function codeNodeHints(code: string): {
  warnings: string[];
  fix: string;
} {
  const executable = executableOnly(code);
  const runtime = RULES.filter((r) => r.pattern.test(executable)).map(
    (r) => r.hint,
  );
  const readability = readabilityWarnings(code);
  const replace = "If the flagged call is real, replace it";
  const fix =
    runtime.length > 0 && readability.length > 0
      ? `${replace}, and reformat or split the code`
      : runtime.length > 0
        ? replace
        : readability.length > 0
          ? "Reformat the code one statement per line, or split it into smaller nodes"
          : "";
  return {
    warnings: [
      ...readability,
      ...(runtime.length > 0 ? [...runtime, CAVEAT] : []),
    ],
    fix,
  };
}

/** The `warnings` of {@link codeNodeHints}. */
export const codeNodeWarnings = (code: string): string[] =>
  codeNodeHints(code).warnings;
