import { normalizeToolParameters } from "../tools/toolParameters.js";

const valid = JSON.stringify({
  type: "object",
  properties: {
    city: { type: "string", description: "City name" },
  },
  required: ["city"],
});

describe("normalizeToolParameters", () => {
  it("accepts a valid schema and injects additionalProperties: false", () => {
    const { parameters, warnings } = normalizeToolParameters(valid);
    const parsed = JSON.parse(parameters);
    expect(parsed.additionalProperties).toBe(false);
    expect(parsed.properties.city.type).toBe("string");
    expect(warnings).toEqual([]);
  });

  it("infers a missing top-level type when properties are present", () => {
    const raw = JSON.stringify({
      properties: { a: { type: "boolean", description: "A flag" } },
      required: ["a"],
    });
    const parsed = JSON.parse(normalizeToolParameters(raw).parameters);
    expect(parsed.type).toBe("object");
  });

  it("preserves an explicit additionalProperties value", () => {
    const raw = JSON.stringify({
      type: "object",
      properties: { a: { type: "string", description: "x" } },
      required: ["a"],
      additionalProperties: true,
    });
    const parsed = JSON.parse(normalizeToolParameters(raw).parameters);
    expect(parsed.additionalProperties).toBe(true);
  });

  it("hard-fails on unparseable JSON with a corrective message", () => {
    expect(() => normalizeToolParameters('{"type":"object",')).toThrow(
      /not valid JSON/,
    );
  });

  it("hard-fails when top-level type is not object", () => {
    expect(() =>
      normalizeToolParameters(JSON.stringify({ type: "string" })),
    ).toThrow(/top-level "type" must be "object"/);
  });

  it("hard-fails when a property is missing its description", () => {
    const raw = JSON.stringify({
      type: "object",
      properties: { confirmationCode: { type: "string" } },
      required: ["confirmationCode"],
    });
    expect(() => normalizeToolParameters(raw)).toThrow(
      /confirmationCode: missing "description"/,
    );
  });

  it("hard-fails on an unknown type value", () => {
    const raw = JSON.stringify({
      type: "object",
      properties: { n: { type: "int", description: "count" } },
      required: ["n"],
    });
    expect(() => normalizeToolParameters(raw)).toThrow(/invalid type "int"/);
  });

  it("allows integer (valid JSON Schema, only unsupported by the UI builder)", () => {
    const raw = JSON.stringify({
      type: "object",
      properties: { n: { type: "integer", description: "A count" } },
      required: ["n"],
    });
    expect(() => normalizeToolParameters(raw)).not.toThrow();
  });

  it("hard-fails when required is missing", () => {
    const raw = JSON.stringify({
      type: "object",
      properties: { a: { type: "string", description: "x" } },
    });
    expect(() => normalizeToolParameters(raw)).toThrow(/missing "required"/);
  });

  it("hard-fails when required names an unknown property", () => {
    const raw = JSON.stringify({
      type: "object",
      properties: { a: { type: "string", description: "x" } },
      required: ["b"],
    });
    expect(() => normalizeToolParameters(raw)).toThrow(/not a key/);
  });

  it("hard-fails on array without items", () => {
    const raw = JSON.stringify({
      type: "object",
      properties: { list: { type: "array", description: "Some list" } },
      required: ["list"],
    });
    expect(() => normalizeToolParameters(raw)).toThrow(/requires "items"/);
  });

  it("allows nested object properties and validates them recursively", () => {
    const raw = JSON.stringify({
      type: "object",
      properties: {
        address: {
          type: "object",
          description: "Postal address",
          properties: {
            street: { type: "string", description: "Street" },
          },
          required: ["street"],
        },
      },
      required: ["address"],
    });
    const parsed = JSON.parse(normalizeToolParameters(raw).parameters);
    expect(parsed.properties.address.additionalProperties).toBe(false);
  });

  it("hard-fails a nested property missing a description", () => {
    const raw = JSON.stringify({
      type: "object",
      properties: {
        address: {
          type: "object",
          description: "Postal address",
          properties: { street: { type: "string" } },
          required: ["street"],
        },
      },
      required: ["address"],
    });
    expect(() => normalizeToolParameters(raw)).toThrow(
      /properties\.address\.properties\.street/,
    );
  });

  it("aggregates multiple errors into one throw", () => {
    const raw = JSON.stringify({
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "array", description: "list" },
      },
      required: ["a", "b"],
    });
    let message = "";
    try {
      normalizeToolParameters(raw);
    } catch (e: any) {
      message = e.message;
    }
    expect(message).toMatch(/a: missing "description"/);
    expect(message).toMatch(/b: type "array" requires "items"/);
  });

  it("warns (not fails) when required does not list every key", () => {
    const raw = JSON.stringify({
      type: "object",
      properties: {
        a: { type: "string", description: "x" },
        b: { type: "string", description: "y" },
      },
      required: ["a"],
    });
    const { warnings } = normalizeToolParameters(raw);
    expect(warnings.join(" ")).toMatch(/strict/i);
  });

  it("warns on unknown keywords that strict providers may reject", () => {
    const raw = JSON.stringify({
      type: "object",
      properties: {
        a: { type: "string", description: "x", format: "date-time" },
      },
      required: ["a"],
    });
    const { warnings } = normalizeToolParameters(raw);
    expect(warnings.join(" ")).toMatch(/"format"/);
  });

  it("accepts nullable union types for optional parameters", () => {
    const raw = JSON.stringify({
      type: "object",
      properties: {
        note: { type: ["string", "null"], description: "Optional note" },
      },
      required: ["note"],
    });
    expect(normalizeToolParameters(raw).warnings).toEqual([]);
  });
});
