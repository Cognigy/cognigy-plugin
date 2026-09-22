/**
 * Per-rule, per-project, per-session override state for the policy soft gate
 * (§3.5). One instance per ToolHandlers: the plugin speaks MCP over stdio,
 * one server process per client session, so instance lifetime is session
 * lifetime - the same premise the backup gate's own session state rests on.
 *
 * A call whose args carry no projectId (most manage_flow_nodes / create_tool
 * / update_tool calls) falls back to a session-wide bucket, mirroring the
 * backup gate's "project unknown" fallback in handlers.ts.
 */
export class PolicySession {
  private readonly overriddenByProject = new Map<string, Set<string>>();
  private readonly overriddenWithoutProject = new Set<string>();

  /**
   * Record that `ruleId` is acknowledged for `projectId` (or session-wide
   * when absent) for the rest of the session.
   */
  acknowledge(ruleId: string, projectId?: string): void {
    if (!projectId) {
      this.overriddenWithoutProject.add(ruleId);
      return;
    }
    const existing = this.overriddenByProject.get(projectId);
    if (existing) existing.add(ruleId);
    else this.overriddenByProject.set(projectId, new Set([ruleId]));
  }

  isOverridden(ruleId: string, projectId?: string): boolean {
    if (projectId && this.overriddenByProject.get(projectId)?.has(ruleId)) {
      return true;
    }
    return this.overriddenWithoutProject.has(ruleId);
  }
}
