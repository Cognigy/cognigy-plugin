// Template: Tool definition entry for src/tools/definitions.ts
// Replace all <PLACEHOLDERS> with actual values.
// Add this object to the `tools` array.

{
  name: "<tool_name>",
  description:
    "<One-line summary>.\n\n" +
    "<Detailed usage, prerequisites, parameter docs per operation.\n" +
    "Document each operation and its required/optional params.\n" +
    "Include examples of typical calls.>",
  annotations: {
    title: "<Human Readable Title>",
    readOnlyHint: false,        // true if tool only reads data
    destructiveHint: false,     // true if tool deletes/removes data
    idempotentHint: false,      // true if repeated calls are safe
    openWorldHint: true,        // true if tool creates new resources
  },
  inputSchema: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: ["<op_a>", "<op_b>"],
        description: "Which operation to perform",
      },
      projectId: {
        type: "string",
        description: "24-char hex project ID",
      },
      // Add operation-specific properties here.
      // All properties are flat — the operation discriminator
      // determines which ones are required at runtime via the Zod schema.
    },
    required: ["operation"],
  },
}
