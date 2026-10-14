/** Stable workflow RPC error codes; the runtime forwards every `workflow_*` code with its data. */
export type WorkflowErrorCode =
  | 'workflow_definition_not_found'
  | 'workflow_revision_conflict'
  | 'workflow_definition_has_active_runs'
  | 'workflow_run_not_found'
  | 'workflow_invalid_definition'
  | 'workflow_invalid_launch'
  | 'workflow_invalid_state'
  | 'workflow_step_not_found'
  | 'workflow_unavailable'

export const WORKFLOW_ERROR_CODE_PREFIX = 'workflow_'

export function isWorkflowErrorCode(code: unknown): code is WorkflowErrorCode {
  return typeof code === 'string' && code.startsWith(WORKFLOW_ERROR_CODE_PREFIX)
}
