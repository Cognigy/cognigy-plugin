// Template: Zod schema for src/schemas/tools.ts
// Replace all <PLACEHOLDERS> with actual values.

// --- Single-operation tool ---
export const <toolName>Schema = z.object({
  projectId: idSchema,
  name: z.string().min(1).max(200),
  // add fields here
});

// --- Multi-operation tool (use this pattern instead) ---
export const <toolName>Schema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("<op_a>"),
    projectId: idSchema,
    name: z.string().min(1),
    // op_a-specific fields
  }),
  z.object({
    operation: z.literal("<op_b>"),
    projectId: idSchema,
    resourceId: idSchema,
    // op_b-specific fields
  }),
]);

// Notes:
// - idSchema is already defined: z.string().regex(/^[a-f0-9]{24}$/)
// - Use .optional() for optional fields
// - Use z.enum([...]) for fixed string sets
// - Use z.number().int().min(0) for counts/limits
