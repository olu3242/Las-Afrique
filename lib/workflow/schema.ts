/**
 * Agentic workflow tables have the same single-owner RLS invariant as tenant
 * tables, but live in a separate inventory so the workflow boundary remains
 * explicit and cannot silently weaken the long-standing tenant contract.
 */
export const WORKFLOW_TABLES = [
  "trip_workflows",
  "workflow_events",
  "workflow_evidence",
  "workflow_exceptions",
  "workflow_approvals",
  "workflow_tool_executions",
] as const;
