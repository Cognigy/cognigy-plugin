import { codeNodeWarnings } from "../../tools/codeNodeHints.js";
import { codeFieldsOf } from "../selectors.js";
import type { Rule } from "../types.js";

/**
 * Adapts upstream's codeNodeWarnings() into a rule (§3.6). Upstream's file
 * is imported unmodified and never touched, so it rebases free forever - the
 * fork keeps only the severity decision (upstream ships these as hints that
 * never gate a write; the fork blocks) and the wiring.
 */
export const upstreamCodeNodeRuntimeApis: Rule = {
  id: "codenode.runtime-apis",
  kind: "platform-fact",
  // OUR severity. Upstream ships these as non-blocking hints; the fork blocks.
  severity: "block",
  targets: [
    codeFieldsOf("create_tool"),
    codeFieldsOf("update_tool"),
    codeFieldsOf("manage_flow_nodes"),
  ],
  check: (value) =>
    codeNodeWarnings(String(value ?? "")).map((hint) => ({
      path: [],
      message: hint,
    })),
  docs: "https://docs.cognigy.com/ai/for-developers/code/api-functions",
  retireWhen:
    "upstream makes these blocking, or the team accepts advisory severity for them",
};
