import { REGISTRY } from "./registry.js";
import type { PolicySession } from "./session.js";
import { buildPolicyRefusal } from "./response.js";
import type { RuleFinding } from "./types.js";

/**
 * The single entry point for the policy layer (§3.1). Called pre-dispatch, in
 * handleToolCall, above the backup gate (§3.4) - so a refused call cannot
 * consume the gate's one-shot hold (§3.4, §7 R4).
 *
 * The only side effects are fork-owned: stripping `_policyOverride` off
 * `args` and recording acknowledgements on `session`. Nothing here mutates
 * upstream state or calls the platform.
 */
export function evaluatePolicy(
  toolName: string,
  args: any,
  session: PolicySession,
): unknown | null {
  const projectId =
    typeof args?.projectId === "string" ? args.projectId : undefined;

  // The override channel is a reserved arg, not a new tool (§3.5). Strip it
  // unconditionally - matched rules or not, refused or not - so nothing
  // downstream (the backup gate, Zod) ever sees the key.
  const overrideIds: string[] = Array.isArray(args?._policyOverride)
    ? args._policyOverride
    : [];
  if (args && typeof args === "object") {
    delete args._policyOverride;
  }
  for (const ruleId of overrideIds) {
    session.acknowledge(ruleId, projectId);
  }

  const findings: RuleFinding[] = [];
  for (const rule of REGISTRY) {
    for (const target of rule.targets) {
      if (target.tool !== toolName) continue;
      if (target.operation) {
        const operations = Array.isArray(target.operation)
          ? target.operation
          : [target.operation];
        if (!operations.includes(args?.operation)) continue;
      }
      for (const selected of target.select(args)) {
        const results = rule.check(selected.value, {
          tool: toolName,
          operation: args?.operation,
          args,
          projectId,
        });
        for (const result of results) {
          findings.push({
            ruleId: rule.id,
            severity: rule.severity,
            path: result.path.length ? result.path : selected.path,
            message: result.message,
            fix: result.fix,
            docs: result.docs ?? rule.docs,
          });
        }
      }
    }
  }

  const blocking = findings.filter(
    (f) => f.severity === "block" && !session.isOverridden(f.ruleId, projectId),
  );
  if (blocking.length === 0) return null;

  return buildPolicyRefusal(toolName, projectId, blocking);
}
