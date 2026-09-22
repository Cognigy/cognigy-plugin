import type { Rule } from "./types.js";
import { upstreamCodeNodeRuntimeApis } from "./rules/upstream-code-node-hints.js";

/**
 * The rule list. The ONE file a new rule is added to (§2.2).
 */
export const REGISTRY: Rule[] = [upstreamCodeNodeRuntimeApis];
