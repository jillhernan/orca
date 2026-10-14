import type { WorkflowDefinitionBody } from './workflow-definition'
import { knownDependencies } from './workflow-graph'
import {
  WORKFLOW_ACTIVE_ATTEMPT_STATES,
  type WorkflowAttempt,
  type WorkflowAttemptState,
  type WorkflowRunControl,
  type WorkflowRunStatus,
  type WorkflowStepStatus,
  type WorkflowStepView
} from './workflow-run-types'

const STEP_STATUS_BY_ATTEMPT: Record<WorkflowAttemptState, WorkflowStepStatus> = {
  claimed: 'starting',
  starting: 'starting',
  running: 'running',
  stopping: 'stopping',
  // Why: an unconfirmed stop is not a failure; the scheduler keeps reconciling it.
  stop_unknown: 'stopping',
  awaiting_decision: 'awaiting_decision',
  succeeded: 'succeeded',
  approved: 'succeeded',
  rejected: 'rejected',
  failed: 'failed',
  start_failed: 'failed',
  stopped: 'failed',
  superseded: 'waiting'
}

const BLOCKING_STATUSES: readonly WorkflowStepStatus[] = [
  'failed',
  'rejected',
  'blocked',
  'cancelled'
]

const RETRYABLE_STATES: readonly WorkflowAttemptState[] = ['failed', 'start_failed', 'stopped']

export function isActiveAttempt(attempt: Pick<WorkflowAttempt, 'state'>): boolean {
  return WORKFLOW_ACTIVE_ATTEMPT_STATES.includes(attempt.state)
}

/** Failed, never-started or stopped attempts; decisions included, since a gate can fail to open. */
export function isRetryableAttempt(attempt: Pick<WorkflowAttempt, 'state'>): boolean {
  return RETRYABLE_STATES.includes(attempt.state)
}

/** A failed attempt the user asked to retry no longer decides its step's status. */
function decidesStepStatus(attempt: WorkflowAttempt | undefined): attempt is WorkflowAttempt {
  if (!attempt || attempt.state === 'superseded') {
    return false
  }
  return !(attempt.retryRequestedAt && isRetryableAttempt(attempt))
}

export function latestAttemptsByStep(
  attempts: readonly WorkflowAttempt[]
): Map<string, WorkflowAttempt> {
  const latest = new Map<string, WorkflowAttempt>()
  for (const attempt of attempts) {
    const current = latest.get(attempt.stepId)
    if (!current || attempt.attemptNo > current.attemptNo) {
      latest.set(attempt.stepId, attempt)
    }
  }
  return latest
}

export type WorkflowRunProjection = {
  steps: WorkflowStepView[]
  status: WorkflowRunStatus
  /** Steps whose dependencies all succeeded and that have no attempt yet. */
  readyStepIds: string[]
}

export function projectWorkflowRun(
  snapshot: Pick<WorkflowDefinitionBody, 'steps'>,
  control: WorkflowRunControl,
  attempts: readonly WorkflowAttempt[]
): WorkflowRunProjection {
  const edges = knownDependencies(snapshot.steps)
  const latest = latestAttemptsByStep(attempts)
  const statuses = new Map<string, WorkflowStepStatus>()
  const blockedBy = new Map<string, string[]>()

  const resolve = (stepId: string, trail: Set<string>): WorkflowStepStatus => {
    const known = statuses.get(stepId)
    if (known) {
      return known
    }
    const attempt = latest.get(stepId)
    let status: WorkflowStepStatus
    if (decidesStepStatus(attempt)) {
      status =
        control === 'cancel' && attempt.state === 'stopped'
          ? 'cancelled'
          : STEP_STATUS_BY_ATTEMPT[attempt.state]
    } else if (trail.has(stepId)) {
      // A cycle cannot be scheduled; validation refuses it before a run exists.
      status = 'blocked'
    } else {
      trail.add(stepId)
      const deps = edges.get(stepId) ?? []
      const depStatuses = deps.map((dep) => [dep, resolve(dep, trail)] as const)
      trail.delete(stepId)
      const blockers = depStatuses
        .filter(([, depStatus]) => BLOCKING_STATUSES.includes(depStatus))
        .map(([dep]) => dep)
      if (control === 'cancel') {
        status = 'cancelled'
      } else if (blockers.length > 0) {
        status = 'blocked'
        blockedBy.set(stepId, blockers)
      } else if (depStatuses.every(([, depStatus]) => depStatus === 'succeeded')) {
        status = 'ready'
      } else {
        status = 'waiting'
      }
    }
    statuses.set(stepId, status)
    return status
  }

  const steps: WorkflowStepView[] = snapshot.steps.map((step) => ({
    stepId: step.id,
    status: resolve(step.id, new Set()),
    attempts: attempts
      .filter((attempt) => attempt.stepId === step.id)
      .sort((a, b) => a.attemptNo - b.attemptNo),
    blockedBy: blockedBy.get(step.id) ?? []
  }))
  const readyStepIds = steps.filter((step) => step.status === 'ready').map((step) => step.stepId)
  return { steps, readyStepIds, status: projectRunStatus(steps, control, attempts) }
}

function projectRunStatus(
  steps: readonly WorkflowStepView[],
  control: WorkflowRunControl,
  attempts: readonly WorkflowAttempt[]
): WorkflowRunStatus {
  const anyActive = attempts.some(isActiveAttempt)
  if (control === 'cancel') {
    return anyActive ? 'cancelling' : 'cancelled'
  }
  if (steps.every((step) => step.status === 'succeeded')) {
    return 'succeeded'
  }
  if (control === 'pause') {
    return 'paused'
  }
  if (anyActive || steps.some((step) => step.status === 'ready')) {
    return 'running'
  }
  if (steps.some((step) => step.status === 'awaiting_decision')) {
    return 'awaiting_decision'
  }
  return steps.some((step) => step.status === 'failed') ? 'failed' : 'blocked'
}

/** Agent attempts that occupy a concurrency slot, and whether one holds the shared workspace. */
export function activeAgentUsage(attempts: readonly WorkflowAttempt[]): {
  active: number
  sharedWorkspaceBusy: boolean
} {
  const active = attempts.filter((attempt) => attempt.kind === 'agent' && isActiveAttempt(attempt))
  return {
    active: active.length,
    sharedWorkspaceBusy: active.some((attempt) => attempt.input?.workspaceMode !== 'isolated')
  }
}
