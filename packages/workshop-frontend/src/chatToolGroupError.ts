/**
 * Whether a collapsed tool-call group should show the red ERROR badge.
 *
 * `executeCode` is exploratory: the agent is expected to try Worker-style calls, miss, and recover
 * through `callTool` or a later executeCode. A failed executeCode that sits beside a successful
 * MCP observation (or a later successful executeCode) is not a failed turn. Other tool failures
 * still mark the group.
 */
export function toolCallGroupHasError(
  toolCalls: Array<{ toolName: string; error?: string }>,
  observationCount = 0,
): boolean {
  const failures = toolCalls.filter((tc) => Boolean(tc.error));
  if (failures.length === 0) return false;
  if (
    failures.every((tc) => tc.toolName === "executeCode")
    && (observationCount > 0 || toolCalls.some((tc) => tc.toolName === "executeCode" && !tc.error))
  ) {
    return false;
  }
  return true;
}
