import type { WorkflowErrorCode } from '../../shared/workflows/workflow-error-codes'

/** Errors the workflow RPCs return with a stable code so clients can react without parsing text. */
export class WorkflowServiceError extends Error {
  constructor(
    readonly code: WorkflowErrorCode,
    message: string,
    readonly data?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'WorkflowServiceError'
  }
}
