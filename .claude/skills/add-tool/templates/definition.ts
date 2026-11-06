// Template: Tool definition entry for src/tools/definitions.ts
// Replace all <PLACEHOLDERS> with actual values.
// Add this object to the `tools` array.

{
  name: "<tool_name>",
  // 3-6 sentences, <= 1000 chars (src/__tests__/toolSurfaceBudget.test.ts):
  // what it does, what it does NOT do / which sibling tool to use instead,
  // one clause per operation, what it returns, any irreversibility.
  // No numbered procedures, prerequisites checklists or "after this call X"
  // — that belongs in the skill (plugin/skills) or in a result _hint.
  description:
    "<What it does, in one sentence>. <Negative scope or sibling tool>. " +
    "Operations: <op_a> (<what/when>), <op_b> (<what/when>). " +
    "Returns <fields>. <Irreversibility or precondition, if any>.",
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
