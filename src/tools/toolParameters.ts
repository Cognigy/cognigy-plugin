/**
 * Validation + normalization for AI Agent Tool `parameters` (a JSON Schema
 * authored by the calling LLM and stored as a string on the tool node).
 *
 * The Cognigy runtime passes this schema VERBATIM to the LLM provider
 * (shared/charts/.../createToolDefinitions.ts) and the backend only checks
 * "string, ≤100k chars" — an unparseable schema is silently dropped at
 * runtime (the tool is sent with no parameters at all), and a schema that
 * violates a strict provider's subset fails every conversation turn with a
 * 400. OpenAI Responses-API models (gpt-5.x) are strict by default: they
 * require `additionalProperties: false` on every object level and every
 * property key listed in `required`.
 *
 * We therefore validate the contract that actually breaks at runtime — NOT
 * the stricter subset of the Cognigy UI's graphical parameter builder
 * (services/service-ui/.../toolParameterSchema.ts). Constructs the builder
 * can't render (nested object properties, "integer") are valid here; the UI
 * simply falls back to its raw JSON editor for them.
 *
 * Hard errors are aggregated and thrown so the calling LLM can correct the
 * whole schema in one retry. Mechanically safe fixes are applied silently:
 * a missing top-level `type` is inferred as "object", and
 * `additionalProperties: false` is injected wherever an object level defines
 * `properties` without it.
 */

const ALLOWED_TYPES = new Set([
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
  "null",
]);

/** Keywords we understand; anything else earns a strict-provider warning. */
const KNOWN_KEYWORDS = new Set([
  "type",
  "description",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "anyOf",
  "oneOf",
  "allOf",
  "title",
]);

/** Backend limit: services/service-resources validation/schemas.ts caps the field at 100k chars. */
const MAX_LENGTH = 100_000;

export interface NormalizedToolParameters {
  /** Normalized JSON string to store on the node. */
  parameters: string;
  /** Non-fatal notes to surface to the calling LLM via _hints. */
  warnings: string[];
}

interface Ctx {
  errors: string[];
  warnings: string[];
  /** paths whose `required` array does not list every property key */
  incompleteRequired: string[];
  /** unknown keywords seen, as "keyword at path" */
  unknownKeywords: string[];
}

function isPlainObject(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate one schema node in place (normalizations mutate the parsed tree).
 * `requireDescription` is true for entries of a `properties` map — those are
 * what the model reads to decide how to call the tool.
 */
function validateSchema(
  schema: any,
  path: string,
  requireDescription: boolean,
  ctx: Ctx,
): void {
  if (!isPlainObject(schema)) {
    ctx.errors.push(`${path}: must be an object (a JSON Schema definition)`);
    return;
  }

  for (const key of Object.keys(schema)) {
    if (!KNOWN_KEYWORDS.has(key)) {
      ctx.unknownKeywords.push(`"${key}" at ${path}`);
    }
  }

  if (requireDescription) {
    if (typeof schema.description !== "string" || !schema.description.trim()) {
      ctx.errors.push(
        `${path}: missing "description" — every parameter needs a description string so the model knows what to pass`,
      );
    }
  } else if (
    schema.description !== undefined &&
    typeof schema.description !== "string"
  ) {
    ctx.errors.push(`${path}: "description" must be a string`);
  }

  // type may be a string or an array of strings (e.g. ["string","null"])
  const types: string[] = [];
  if (schema.type !== undefined) {
    const list = Array.isArray(schema.type) ? schema.type : [schema.type];
    for (const t of list) {
      if (typeof t !== "string" || !ALLOWED_TYPES.has(t)) {
        ctx.errors.push(
          `${path}: invalid type ${JSON.stringify(t)} — allowed types are ${[...ALLOWED_TYPES].join(", ")}`,
        );
      } else {
        types.push(t);
      }
    }
  }

  const hasComposition = ["anyOf", "oneOf", "allOf"].some(
    (k) => schema[k] !== undefined,
  );
  if (
    schema.type === undefined &&
    schema.properties === undefined &&
    schema.enum === undefined &&
    schema.const === undefined &&
    !hasComposition
  ) {
    ctx.errors.push(
      `${path}: missing "type" — declare one of ${[...ALLOWED_TYPES].join(", ")}`,
    );
  }

  if (schema.enum !== undefined && !Array.isArray(schema.enum)) {
    ctx.errors.push(`${path}: "enum" must be an array of allowed values`);
  }

  for (const comboKey of ["anyOf", "oneOf", "allOf"]) {
    const combo = schema[comboKey];
    if (combo === undefined) continue;
    if (!Array.isArray(combo)) {
      ctx.errors.push(`${path}: "${comboKey}" must be an array of schemas`);
      continue;
    }
    combo.forEach((sub: any, i: number) =>
      validateSchema(sub, `${path}.${comboKey}[${i}]`, false, ctx),
    );
  }

  // Object semantics — nested properties are fine at runtime (the Cognigy
  // graphical builder just falls back to its JSON editor for them).
  if (schema.properties !== undefined || types.includes("object")) {
    if (schema.properties !== undefined) {
      if (!isPlainObject(schema.properties)) {
        ctx.errors.push(`${path}: "properties" must be an object map`);
      } else {
        for (const [name, sub] of Object.entries(schema.properties)) {
          validateSchema(sub, `${path}.properties.${name}`, true, ctx);
        }

        if (!Array.isArray(schema.required)) {
          ctx.errors.push(
            `${path}: missing "required" — list the mandatory property names as an array (use [] if none)`,
          );
        } else {
          const keys = new Set(Object.keys(schema.properties));
          for (const r of schema.required) {
            if (typeof r !== "string" || !keys.has(r)) {
              ctx.errors.push(
                `${path}: "required" lists ${JSON.stringify(r)}, which is not a key of "properties"`,
              );
            }
          }
          if ([...keys].some((k) => !schema.required.includes(k))) {
            ctx.incompleteRequired.push(path);
          }
        }

        // Strict-proofing: providers all accept this, and OpenAI's
        // Responses-API models (strict by default) demand it.
        if (schema.additionalProperties === undefined) {
          schema.additionalProperties = false;
        }
      }
    } else {
      ctx.warnings.push(
        `${path}: "object" without "properties" — strict-mode models (OpenAI Responses API, e.g. gpt-5.x) reject free-form objects; define its properties if the target model is strict`,
      );
    }
  }

  // Array semantics
  if (types.includes("array")) {
    if (schema.items === undefined) {
      ctx.errors.push(
        `${path}: type "array" requires "items" describing the element schema`,
      );
    } else if (Array.isArray(schema.items)) {
      schema.items.forEach((sub: any, i: number) =>
        validateSchema(sub, `${path}.items[${i}]`, false, ctx),
      );
    } else {
      validateSchema(schema.items, `${path}.items`, false, ctx);
    }
  } else if (schema.items !== undefined && !types.includes("array")) {
    ctx.warnings.push(
      `${path}: has "items" but type is not "array" — "items" will be ignored`,
    );
  }
}

/**
 * Parse, validate, and normalize a tool `parameters` JSON string.
 * Throws an Error aggregating every problem so the caller (an LLM) can fix
 * the schema in a single retry. Returns the normalized JSON string plus
 * non-fatal warnings.
 */
export function normalizeToolParameters(raw: string): NormalizedToolParameters {
  let root: any;
  try {
    root = JSON.parse(raw);
  } catch (e: any) {
    throw new Error(
      `config.parameters is not valid JSON (${e.message}). ` +
        `Cognigy stores it as-is and silently drops unparseable schemas at runtime — the tool would be sent to the LLM with NO parameters. ` +
        `Provide a JSON Schema string like: {"type":"object","properties":{"city":{"type":"string","description":"City name"}},"required":["city"]}`,
    );
  }

  const ctx: Ctx = {
    errors: [],
    warnings: [],
    incompleteRequired: [],
    unknownKeywords: [],
  };

  if (!isPlainObject(root)) {
    ctx.errors.push(
      `parameters: must be a JSON object of the form {"type":"object","properties":{...},"required":[...]}`,
    );
  } else {
    if (root.type === undefined && isPlainObject(root.properties)) {
      root.type = "object"; // safe inference
    }
    if (root.type !== "object") {
      ctx.errors.push(
        `parameters: top-level "type" must be "object" (got ${JSON.stringify(root.type)})`,
      );
    }
    if (!isPlainObject(root.properties)) {
      ctx.errors.push(
        `parameters: top-level "properties" object is required — a map of parameter name to schema`,
      );
    }
    if (ctx.errors.length === 0) {
      validateSchema(root, "parameters", false, ctx);
    }
  }

  if (ctx.errors.length > 0) {
    throw new Error(
      `Invalid tool parameters schema:\n- ${ctx.errors.join("\n- ")}\n` +
        `Fix the schema and retry. Contract: top level is {"type":"object","properties":{...},"required":[...]}; ` +
        `every entry in a "properties" map needs "type" and "description"; allowed types: ${[...ALLOWED_TYPES].join(", ")}; ` +
        `"array" needs "items"; any level defining "properties" also needs a "required" array. ` +
        `Strict-mode models (OpenAI Responses API, e.g. gpt-5.x) additionally require every property key listed in "required" — make a parameter optional with a nullable type such as {"type":["string","null"]}.`,
    );
  }

  const warnings = [...ctx.warnings];
  if (ctx.incompleteRequired.length > 0) {
    warnings.push(
      `Not every property key is listed in "required" (at ${ctx.incompleteRequired.join(", ")}). ` +
        `Strict-mode models (OpenAI Responses API, e.g. gpt-5.x) reject such schemas with a 400 — list every key in "required" and mark optional parameters with a nullable type like {"type":["string","null"]} if this agent may use a strict model.`,
    );
  }
  if (ctx.unknownKeywords.length > 0) {
    warnings.push(
      `Schema uses keyword(s) ${ctx.unknownKeywords.join(", ")} that strict-mode OpenAI models may reject; they are passed through unchanged.`,
    );
  }

  const normalized = JSON.stringify(root);
  if (normalized.length > MAX_LENGTH) {
    throw new Error(
      `config.parameters exceeds Cognigy's ${MAX_LENGTH}-character limit for tool parameter schemas (got ${normalized.length}). Simplify the schema.`,
    );
  }

  return { parameters: normalized, warnings };
}
