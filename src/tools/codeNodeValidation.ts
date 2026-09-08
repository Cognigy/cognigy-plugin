import ts from "typescript";

export interface CodeNodeValidationResult {
  /** Blocking problems: direct calls to unavailable runtime APIs. */
  errors: string[];
  /** Non-blocking platform limits and likely mistakes. */
  warnings: string[];
}

// https://docs.cognigy.com/ai/for-developers/code/api-functions#states-deprecated
// https://docs.cognigy.com/release-notes/2026.12
const REMOVED_STATE_METHODS = new Set(["setState", "getState", "resetState"]);
// https://docs.cognigy.com/ai/for-developers/code/modules
const MODULE_GLOBALS = "moment, _ (Lodash), xmljs, getTextCleaner";
// https://docs.cognigy.com/ai/administer/limitations
const API_CALL_LIMIT = 100;
const GLOBAL_OBJECTS = new Set(["globalThis", "window", "global", "self"]);

/** Unwrap syntax that does not change the value being called. */
function unwrap(expression: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    expression = expression.expression;
  }
  return expression;
}

function member(
  expression: ts.Expression,
): { object: ts.Expression; name: string } | undefined {
  expression = unwrap(expression);
  if (ts.isPropertyAccessExpression(expression)) {
    return {
      object: unwrap(expression.expression),
      name: expression.name.text,
    };
  }
  if (
    ts.isElementAccessExpression(expression) &&
    ts.isStringLiteralLike(expression.argumentExpression)
  ) {
    return {
      object: unwrap(expression.expression),
      name: expression.argumentExpression.text,
    };
  }
  return undefined;
}

/**
 * Parse one virtual TypeScript file and bind its local symbols. No source is
 * executed, no libraries/files are read, and imports are never resolved.
 * Syntax/type diagnostics remain the platform's responsibility. The checker
 * is used only to distinguish lexical bindings from injected runtime globals.
 */
export function validateCodeNode(source: string): CodeNodeValidationResult {
  const fileName = "code-node.ts";
  // Give the snippet its own lexical scope, as the runtime does. In script
  // scope TypeScript otherwise reserves globalThis even when locally declared.
  const moduleSource = `export {};\n${source}`;
  const file = ts.createSourceFile(
    fileName,
    moduleSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const options: ts.CompilerOptions = {
    noLib: true,
    noResolve: true,
    types: [],
    target: ts.ScriptTarget.Latest,
  };
  const host: ts.CompilerHost = {
    getSourceFile: (name) => (name === fileName ? file : undefined),
    getDefaultLibFileName: () => "",
    writeFile: () => {},
    getCurrentDirectory: () => "",
    getDirectories: () => [],
    fileExists: (name) => name === fileName,
    readFile: (name) => (name === fileName ? moduleSource : undefined),
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };
  const checker = ts.createProgram([fileName], options, host).getTypeChecker();
  const unbound = (expression: ts.Expression, name: string): boolean => {
    expression = unwrap(expression);
    return (
      ts.isIdentifier(expression) &&
      expression.text === name &&
      // globalThis has an intrinsic symbol even with noLib. Only source
      // declarations represent a local binding in this virtual program.
      !checker.getSymbolAtLocation(expression)?.declarations?.length
    );
  };
  const global = (expression: ts.Expression, name: string): boolean => {
    if (unbound(expression, name)) return true;
    const access = member(expression);
    return (
      !!access &&
      access.name === name &&
      ts.isIdentifier(access.object) &&
      GLOBAL_OBJECTS.has(access.object.text) &&
      unbound(access.object, access.object.text)
    );
  };

  const states = new Set<string>();
  let httpRequest = false;
  let httpGlobal = false;
  let moduleLoading = false;
  let nestedDelete = false;
  let apiCallCount = 0;

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      // Type-only imports are erased and do not load a module at runtime.
      const onlyTypes =
        clause?.isTypeOnly ||
        (clause &&
          !clause.name &&
          clause.namedBindings &&
          ts.isNamedImports(clause.namedBindings) &&
          clause.namedBindings.elements.length > 0 &&
          clause.namedBindings.elements.every((item) => item.isTypeOnly));
      if (!onlyTypes) moduleLoading = true;
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      moduleLoading = true;
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const expression = unwrap(node.expression);
      if (global(expression, "fetch") || global(expression, "XMLHttpRequest"))
        httpGlobal = true;
      if (
        global(expression, "require") ||
        expression.kind === ts.SyntaxKind.ImportKeyword
      )
        moduleLoading = true;
      const access = member(expression);
      if (access && global(access.object, "api")) {
        apiCallCount++;
        if (REMOVED_STATE_METHODS.has(access.name)) states.add(access.name);
        if (access.name === "httpRequest") httpRequest = true;
        const argument = node.arguments?.[0];
        const hasLiteralDot =
          argument &&
          ((ts.isStringLiteralLike(argument) && argument.text.includes(".")) ||
            (ts.isTemplateExpression(argument) &&
              (argument.head.text.includes(".") ||
                argument.templateSpans.some((span) =>
                  span.literal.text.includes("."),
                ))));
        if (access.name === "deleteContext" && hasLiteralDot)
          nestedDelete = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);

  const errors: string[] = [];
  const warnings: string[] = [];
  if (states.size)
    errors.push(
      `api.${Array.from(states).join("()/api.")}() — States are deprecated since Cognigy.AI 2026.7.0 and removed in 2026.12.0. Use Intent Conditions to control intent recognition instead.`,
    );
  if (httpRequest)
    errors.push(
      "api.httpRequest() exists only in Cognigy Functions, not in Code Nodes. Use an HTTP Request node in the flow and read the response from input.httprequest.",
    );
  if (httpGlobal)
    errors.push(
      "fetch()/XMLHttpRequest are not available in the Code Node runtime. Use an HTTP Request node in the flow and read the response from input.httprequest.",
    );
  if (moduleLoading)
    errors.push(
      `require()/import are not available in the Code Node runtime. The preinstalled modules are injected as globals — ${MODULE_GLOBALS} — and no other modules can be loaded.`,
    );
  if (nestedDelete)
    warnings.push(
      'api.deleteContext() only removes top-level keys — a dot-path argument like "a.b" silently does nothing. To remove a nested key use `delete context.a.b;` instead.',
    );
  if (apiCallCount > API_CALL_LIMIT)
    warnings.push(
      `Code contains ${apiCallCount} api.* call sites; the platform aborts a Code Node after ${API_CALL_LIMIT} api.* calls per execution (input.codeNodeError). Calls inside loops count per iteration, so the real total may be higher still.`,
    );
  return { errors, warnings };
}
