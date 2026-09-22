import { withHints } from "../tools/filters.js";
import type { RuleFinding } from "./types.js";

/**
 * Builds the policy_violation payload, following the backup gate's withHints
 * convention (§3.5) so the two refusal shapes read the same to a caller.
 */
export function buildPolicyRefusal(
  toolName: string,
  projectId: string | undefined,
  blocking: RuleFinding[],
): unknown {
  const fixes = blocking
    .map((f) => f.fix)
    .filter((fix): fix is string => Boolean(fix))
    .join(" ");

  return withHints(
    {
      error: "policy_violation",
      tool: toolName,
      changed: false,
      ...(projectId ? { projectId } : {}),
      findings: blocking.map((f) => ({
        ruleId: f.ruleId,
        path: f.path,
        message: f.message,
        ...(f.docs ? { docs: f.docs } : {}),
      })),
    },
    {
      warning: `NOTHING WAS CHANGED. ${blocking.length} AI COE standard(s) were not met, so ${toolName} was not run.`,
      action:
        `Fix the flagged content and retry.${fixes ? ` ${fixes}` : ""}\n` +
        `If a finding is a false positive, retry the same call with ` +
        `_policyOverride: ["<ruleId>"] and say in one short line which rule you are overriding and why.`,
    },
  );
}
