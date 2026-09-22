import type { RuleTarget } from "./types.js";

/**
 * Shared RuleTarget builder for code-bearing config fields (§3.3).
 *
 * Selects on the PRESENCE of a code field, never on a declared node type.
 * On manage_flow_nodes create the node type is in the args, so it would be
 * decidable there - but on update it is not: the existing node's type is
 * only known after the handler fetches it, which a synchronous, pure,
 * pre-dispatch gate structurally cannot do. `code` is the only registry
 * entry whose configKeys is exactly `["code"]` (verified against
 * src/tools/nodeRegistry.ts), so presence of `config.code` is itself a sound
 * discriminator that fires correctly on create and update alike, with no
 * fetch.
 */
export const codeFieldsOf = (tool: string): RuleTarget => ({
  tool,
  select: (args) =>
    (["code", "preProcessCode", "postProcessCode"] as const)
      .filter((k) => typeof args?.config?.[k] === "string")
      .map((k) => ({ path: ["config", k], value: args.config[k] })),
});
