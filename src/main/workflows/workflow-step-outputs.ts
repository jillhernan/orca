import type { WorkflowStep } from '../../shared/workflows/workflow-definition'
import type { WorkflowAttempt } from '../../shared/workflows/workflow-run-types'
import type { WorkflowStepOutput } from '../../shared/workflows/workflow-step-output'

const SUCCESS_STATES = new Set(['succeeded', 'approved'])

/** The attempt whose result a step hands to its dependents: its latest successful one. */
export function successfulAttempt(
  attempts: readonly WorkflowAttempt[],
  stepId: string
): WorkflowAttempt | null {
  let found: WorkflowAttempt | null = null
  for (const attempt of attempts) {
    if (
      attempt.stepId === stepId &&
      SUCCESS_STATES.has(attempt.state) &&
      (!found || attempt.attemptNo > found.attemptNo)
    ) {
      found = attempt
    }
  }
  return found
}

export function attemptOutput(attempt: WorkflowAttempt): WorkflowStepOutput {
  return {
    stepId: attempt.stepId,
    attemptNo: attempt.attemptNo,
    taskId: attempt.taskId,
    dispatchId: attempt.dispatchId,
    summary: attempt.result?.summary ?? '',
    artifacts: attempt.result?.artifacts ?? [],
    target: attempt.target,
    ...(attempt.result?.decision ? { decision: attempt.result.decision } : {})
  }
}

export function collectPredecessorOutputs(
  step: Pick<WorkflowStep, 'dependsOn'>,
  attempts: readonly WorkflowAttempt[]
): Map<string, WorkflowStepOutput> {
  const outputs = new Map<string, WorkflowStepOutput>()
  for (const dep of step.dependsOn) {
    const attempt = successfulAttempt(attempts, dep)
    if (attempt) {
      outputs.set(dep, attemptOutput(attempt))
    }
  }
  return outputs
}

/** Orchestration Task ids of the predecessors, so the step's Task records the same DAG. */
export function predecessorTaskIds(
  step: Pick<WorkflowStep, 'dependsOn'>,
  attempts: readonly WorkflowAttempt[]
): string[] {
  return step.dependsOn.flatMap((dep) => {
    const taskId = successfulAttempt(attempts, dep)?.taskId
    return taskId ? [taskId] : []
  })
}
