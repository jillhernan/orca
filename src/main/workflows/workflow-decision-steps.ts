import type { WorkflowStep } from '../../shared/workflows/workflow-definition'
import type { WorkflowAttempt, WorkflowRun } from '../../shared/workflows/workflow-run-types'
import { latestAttemptsByStep } from '../../shared/workflows/workflow-run-projection'
import { runTarget, type WorkflowDispatchContext } from './workflow-agent-dispatch'
import { WorkflowServiceError } from './workflow-service-error'
import { predecessorTaskIds } from './workflow-step-outputs'

export type WorkflowDecision = 'approved' | 'rejected'

function decisionTitle(run: WorkflowRun, step: WorkflowStep): string {
  return `${run.snapshot.name} · ${step.name}`
}

/**
 * Opens a decision gate for a ready approval or integration step. The gate lives on the step's own
 * orchestration Task, so `orca orchestration` sees the same block the workflow shows.
 */
export function openDecisionAttempt(
  ctx: WorkflowDispatchContext,
  run: WorkflowRun,
  step: WorkflowStep,
  attempts: readonly WorkflowAttempt[]
): void {
  const previous = latestAttemptsByStep(attempts).get(step.id) ?? null
  const attempt = ctx.store.runs.claimAttempt({
    runId: run.id,
    stepId: step.id,
    kind: step.kind,
    state: 'awaiting_decision',
    input: null,
    taskId: previous?.taskId ?? null,
    retryOfDispatchId: null
  })
  if (!attempt || !run.orchestrationRunId) {
    return
  }
  try {
    const taskId =
      previous?.taskId ??
      ctx.port.createTask({
        runId: run.orchestrationRunId,
        spec: step.prompt,
        title: decisionTitle(run, step),
        deps: predecessorTaskIds(step, attempts)
      })
    const gateId = previous?.taskId
      ? ctx.port.reopenGate({ taskId, question: step.prompt })
      : ctx.port.openGate({ taskId, question: step.prompt })
    ctx.store.runs.updateAttempt(
      attempt.id,
      { taskId, gateId, target: runTarget(run), startedAt: new Date().toISOString() },
      ['awaiting_decision']
    )
    ctx.store.runs.appendEvent({
      runId: run.id,
      kind: 'decision_requested',
      actor: 'system',
      stepId: step.id,
      attemptId: attempt.id,
      payload: { taskId, gateId }
    })
  } catch (error) {
    const failure = `Could not open the decision gate: ${error instanceof Error ? error.message : String(error)}`
    ctx.store.runs.updateAttempt(
      attempt.id,
      { state: 'failed', failure, finishedAt: new Date().toISOString() },
      ['awaiting_decision']
    )
  }
}

/** Records a user's decision. Only this path, driven by a user action over RPC, settles a gate. */
export function recordDecision(
  ctx: WorkflowDispatchContext,
  run: WorkflowRun,
  stepId: string,
  decision: WorkflowDecision,
  comment: string
): WorkflowAttempt {
  const attempt = latestAttemptsByStep(ctx.store.runs.listAttempts(run.id)).get(stepId)
  if (!attempt || attempt.state !== 'awaiting_decision' || !attempt.gateId || !attempt.taskId) {
    throw new WorkflowServiceError(
      'workflow_invalid_state',
      'This step is not waiting for a decision. Refresh the run to see its current state.'
    )
  }
  const decidedAt = new Date().toISOString()
  // Orchestration first: dependents' Tasks name this Task as a dependency and need it settled.
  ctx.port.settleGate({
    gateId: attempt.gateId,
    taskId: attempt.taskId,
    decision,
    result: JSON.stringify({ provenance: 'workflow_user_decision', decision, comment, decidedAt })
  })
  const changed = ctx.store.runs.updateAttempt(
    attempt.id,
    {
      state: decision,
      result: {
        summary: comment,
        artifacts: [],
        reportedAt: decidedAt,
        decision: { decision, comment, decidedAt }
      },
      finishedAt: decidedAt
    },
    ['awaiting_decision']
  )
  if (!changed) {
    throw new WorkflowServiceError(
      'workflow_invalid_state',
      'The decision changed while it was being saved.'
    )
  }
  ctx.store.runs.appendEvent({
    runId: run.id,
    kind: 'decision_recorded',
    actor: 'user',
    stepId,
    attemptId: attempt.id,
    payload: { decision, comment, gateId: attempt.gateId }
  })
  return attempt
}

/** Lets the user decide again after a rejection; the earlier decision stays in history. */
export function reopenDecision(
  ctx: WorkflowDispatchContext,
  run: WorkflowRun,
  stepId: string
): void {
  const step = run.snapshot.steps.find((candidate) => candidate.id === stepId)
  const attempts = ctx.store.runs.listAttempts(run.id)
  const latest = latestAttemptsByStep(attempts).get(stepId)
  if (!step || step.kind === 'agent' || latest?.state !== 'rejected') {
    throw new WorkflowServiceError(
      'workflow_invalid_state',
      'Only a rejected decision can be reopened.'
    )
  }
  openDecisionAttempt(ctx, run, step, attempts)
  ctx.store.runs.appendEvent({ runId: run.id, kind: 'decision_reopened', actor: 'user', stepId })
}

/** A cancelled run closes its open gates so no Task is left blocked on a question nobody owns. */
export function closeOpenDecisions(
  ctx: WorkflowDispatchContext,
  run: WorkflowRun,
  attempts: readonly WorkflowAttempt[]
): void {
  for (const attempt of attempts) {
    if (attempt.state !== 'awaiting_decision') {
      continue
    }
    if (attempt.gateId && attempt.taskId) {
      try {
        ctx.port.settleGate({
          gateId: attempt.gateId,
          taskId: attempt.taskId,
          decision: 'cancelled',
          result: JSON.stringify({ provenance: 'workflow_cancelled' })
        })
      } catch {
        // The workflow record below is what keeps dependents from running.
      }
    }
    if (
      ctx.store.runs.updateAttempt(
        attempt.id,
        {
          state: 'stopped',
          failure: 'The run was cancelled before a decision.',
          finishedAt: new Date().toISOString()
        },
        ['awaiting_decision']
      )
    ) {
      ctx.store.runs.appendEvent({
        runId: run.id,
        kind: 'decision_cancelled',
        actor: 'system',
        stepId: attempt.stepId,
        attemptId: attempt.id
      })
    }
  }
}
