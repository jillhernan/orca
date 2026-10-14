import type { WorkflowAttempt, WorkflowRun } from '../../shared/workflows/workflow-run-types'
import {
  parseWorkerReportResult,
  workerReportArtifacts,
  workerReportSummary
} from '../../shared/workflows/workflow-step-output'
import type { WorkflowDispatchContext } from './workflow-agent-dispatch'
import type { WorkflowDispatchObservation } from './workflow-orchestration-port'

export type WorkflowReconcileContext = WorkflowDispatchContext & {
  /** Starts this process is still awaiting; anything else in a start state is an orphan. */
  inflightStarts: ReadonlySet<string>
  stopsInFlight: Set<string>
  /** Throttles per-attempt probes that may cross SSH. */
  isDue: (key: string, intervalMs: number) => boolean
}

const LIVENESS_PROBE_MS = 10_000
const STOP_RETRY_MS = 30_000
const SETTLED_WORKER_STATES = new Set(['stopped', 'abandoned'])

function emit(
  ctx: WorkflowReconcileContext,
  run: WorkflowRun,
  attempt: WorkflowAttempt,
  kind: string,
  payload: Record<string, unknown>
): void {
  ctx.store.runs.appendEvent({
    runId: run.id,
    kind,
    actor: 'system',
    stepId: attempt.stepId,
    attemptId: attempt.id,
    payload
  })
}

/** A Dispatch on the attempt's Task that no earlier attempt of the step already owns. */
function unclaimedDispatch(
  ctx: WorkflowReconcileContext,
  attempt: WorkflowAttempt,
  attempts: readonly WorkflowAttempt[]
): string | null {
  if (attempt.dispatchId) {
    return attempt.dispatchId
  }
  const candidate = attempt.taskId ? ctx.port.latestDispatchForTask(attempt.taskId) : null
  if (!candidate) {
    return null
  }
  const owned = attempts.some((other) => other.id !== attempt.id && other.dispatchId === candidate)
  return owned ? null : candidate
}

/** Settles an attempt from a Dispatch orchestration already closed. Returns false while open. */
function settleFromObservation(
  ctx: WorkflowReconcileContext,
  run: WorkflowRun,
  attempt: WorkflowAttempt,
  dispatchId: string,
  observation: WorkflowDispatchObservation,
  stopped: boolean
): boolean {
  const now = new Date().toISOString()
  const fromStates = [attempt.state]
  if (observation.dispatchStatus === 'completed') {
    const report = parseWorkerReportResult(observation.taskResult)
    const changed = ctx.store.runs.updateAttempt(
      attempt.id,
      {
        state: 'succeeded',
        dispatchId,
        result: {
          summary: report ? workerReportSummary(report) : '',
          artifacts: report ? workerReportArtifacts(report) : [],
          reportedAt: report?.completedAt ?? now
        },
        failure: null,
        finishedAt: now
      },
      fromStates
    )
    if (changed) {
      emit(ctx, run, attempt, 'step_succeeded', { dispatchId })
      // Settled workers are released through their own Dispatch; output stays readable.
      void ctx.port.releaseWorker(dispatchId)
    }
    return true
  }
  const workerClosed = SETTLED_WORKER_STATES.has(observation.workerState ?? '')
  if (
    observation.dispatchStatus === 'failed' ||
    observation.dispatchStatus === 'circuit_broken' ||
    workerClosed
  ) {
    const report = parseWorkerReportResult(observation.taskResult)
    const reason =
      report?.outcome === 'failed'
        ? workerReportSummary(report) || 'The agent reported that the step failed.'
        : (observation.lastFailure ??
          (observation.terminationReason
            ? `The agent terminal ended (${observation.terminationReason}) before reporting.`
            : 'The attempt ended without a successful report.'))
    const state = stopped || observation.workerState === 'stopped' ? 'stopped' : 'failed'
    const changed = ctx.store.runs.updateAttempt(
      attempt.id,
      {
        state,
        dispatchId,
        failure: state === 'stopped' ? 'Stopped before it finished.' : reason,
        ...(report
          ? {
              result: {
                summary: workerReportSummary(report),
                artifacts: workerReportArtifacts(report),
                reportedAt: report.completedAt
              }
            }
          : {}),
        finishedAt: now
      },
      fromStates
    )
    if (changed) {
      emit(ctx, run, attempt, state === 'stopped' ? 'step_stopped' : 'step_failed', {
        dispatchId,
        reason
      })
    }
    return true
  }
  return false
}

export async function reconcileAgentAttempt(
  ctx: WorkflowReconcileContext,
  run: WorkflowRun,
  attempt: WorkflowAttempt,
  attempts: readonly WorkflowAttempt[]
): Promise<void> {
  if (attempt.state === 'claimed' || attempt.state === 'starting') {
    if (ctx.inflightStarts.has(attempt.id)) {
      return
    }
    // The process that claimed this start is gone; adopt what it launched or report that it did not.
    const adopted = unclaimedDispatch(ctx, attempt, attempts)
    if (
      adopted &&
      ctx.store.runs.updateAttempt(attempt.id, { state: 'running', dispatchId: adopted }, [
        attempt.state
      ])
    ) {
      emit(ctx, run, attempt, 'step_adopted', { dispatchId: adopted })
      return
    }
    if (
      ctx.store.runs.updateAttempt(
        attempt.id,
        {
          state: 'start_failed',
          failure:
            'Orca stopped before this attempt launched an agent. Retry the step to start it.',
          finishedAt: new Date().toISOString()
        },
        [attempt.state]
      )
    ) {
      emit(ctx, run, attempt, 'step_start_failed', { reason: 'orphaned_start' })
    }
    return
  }
  if (attempt.state === 'running') {
    await observeRunning(ctx, run, attempt)
    return
  }
  if (attempt.state === 'stopping' || attempt.state === 'stop_unknown') {
    await continueStop(ctx, run, attempt, attempts)
  }
}

async function observeRunning(
  ctx: WorkflowReconcileContext,
  run: WorkflowRun,
  attempt: WorkflowAttempt
): Promise<void> {
  const dispatchId = attempt.dispatchId
  const observation = dispatchId ? ctx.port.observeDispatch(dispatchId) : null
  if (!dispatchId || !observation) {
    if (
      ctx.store.runs.updateAttempt(
        attempt.id,
        {
          state: 'failed',
          failure: 'The orchestration record for this attempt no longer exists.',
          finishedAt: new Date().toISOString()
        },
        ['running']
      )
    ) {
      emit(ctx, run, attempt, 'step_failed', { reason: 'dispatch_missing' })
    }
    return
  }
  if (settleFromObservation(ctx, run, attempt, dispatchId, observation, false)) {
    return
  }
  if (observation.terminalHandle && observation.terminalHandle !== attempt.terminalHandle) {
    ctx.store.runs.updateAttempt(attempt.id, { terminalHandle: observation.terminalHandle }, [
      'running'
    ])
  }
  if (ctx.isDue(`liveness:${attempt.id}`, LIVENESS_PROBE_MS)) {
    const liveness = await ctx.port.probeLiveness(dispatchId)
    if (liveness && liveness !== attempt.liveness) {
      ctx.store.runs.updateAttempt(attempt.id, { liveness }, ['running'])
    }
  }
}

async function continueStop(
  ctx: WorkflowReconcileContext,
  run: WorkflowRun,
  attempt: WorkflowAttempt,
  attempts: readonly WorkflowAttempt[]
): Promise<void> {
  const dispatchId = unclaimedDispatch(ctx, attempt, attempts)
  if (!dispatchId) {
    if (
      !ctx.inflightStarts.has(attempt.id) &&
      ctx.store.runs.updateAttempt(
        attempt.id,
        {
          state: 'stopped',
          failure: 'Stopped before an agent was launched.',
          finishedAt: new Date().toISOString()
        },
        [attempt.state]
      )
    ) {
      emit(ctx, run, attempt, 'step_stopped', { dispatchId: null })
    }
    return
  }
  const observation = ctx.port.observeDispatch(dispatchId)
  if (observation && settleFromObservation(ctx, run, attempt, dispatchId, observation, true)) {
    return
  }
  if (ctx.stopsInFlight.has(attempt.id) || !ctx.isDue(`stop:${attempt.id}`, STOP_RETRY_MS)) {
    return
  }
  ctx.stopsInFlight.add(attempt.id)
  try {
    const outcome = await ctx.port.stopWorker(dispatchId)
    if (outcome.kind === 'stopped') {
      if (
        ctx.store.runs.updateAttempt(
          attempt.id,
          {
            state: 'stopped',
            dispatchId,
            failure: 'Stopped before it finished.',
            liveness: 'exited',
            finishedAt: new Date().toISOString()
          },
          ['stopping', 'stop_unknown']
        )
      ) {
        emit(ctx, run, attempt, 'step_stopped', { dispatchId })
      }
    } else if (outcome.kind === 'unknown') {
      // Never claim a stop the host could not confirm; keep reconciling it.
      ctx.store.runs.updateAttempt(
        attempt.id,
        { state: 'stop_unknown', dispatchId, failure: outcome.reason, liveness: 'unverifiable' },
        ['stopping', 'stop_unknown']
      )
    }
  } finally {
    ctx.stopsInFlight.delete(attempt.id)
  }
}
