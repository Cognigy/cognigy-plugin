/**
 * Types for the AI COE policy layer. See
 * docs/ai-coe/architecture/06-Policy-Layer-Design.md §3.3 for the rationale
 * behind each departure from the original brief's sketch.
 */

export type Severity = "block" | "warn";

/**
 * Why the rule exists, which decides whether it is a PR candidate.
 * Upstream's observed filter: it accepts rules stating what the platform
 * cannot do, and rejects rules encoding how we think code should be written.
 */
export type RuleKind = "platform-fact" | "house-opinion";

export interface RuleFinding {
  ruleId: string;
  severity: Severity;
  /** Path into the call args, so the message can point at the offending field. */
  path: (string | number)[];
  message: string;
  /** Copy-pasteable remedy, surfaced in _hints.action. */
  fix?: string;
  docs?: string;
}

export interface SelectedValue {
  path: (string | number)[];
  value: unknown;
}

/**
 * Which calls a rule inspects, and how it pulls the values out of them.
 * The selector lives with the rule, NOT in the dispatch - that is what makes
 * "add a rule, touch one file" true.
 */
export interface RuleTarget {
  tool: string;
  /** For multi-operation tools; omit to match every operation. */
  operation?: string | string[];
  select(args: any): SelectedValue[];
}

export interface RuleContext {
  tool: string;
  operation?: string;
  args: any;
  projectId?: string;
}

export interface Rule {
  /** Stable. Cited in errors, in tests, and in the override call. Never renamed. */
  id: string;
  kind: RuleKind;
  /** OUR severity, independent of upstream's. */
  severity: Severity;
  targets: RuleTarget[];
  /**
   * Pure and synchronous. No I/O, no network, no platform calls.
   * Receives one selected value at a time.
   */
  check(
    value: unknown,
    ctx: RuleContext,
  ): Omit<RuleFinding, "ruleId" | "severity">[];
  /** Condition under which this rule is deleted rather than maintained. Required. */
  retireWhen: string;
  docs?: string;
}
