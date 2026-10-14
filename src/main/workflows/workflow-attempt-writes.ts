import type Database from '../sqlite/sync-database'
import { generateId } from '../runtime/orchestration/db/generated-id'
import type { WorkflowStepKind } from '../../shared/workflows/workflow-definition'
import {
  WORKFLOW_ACTIVE_ATTEMPT_STATES,
  type WorkflowAttempt,
  type WorkflowAttemptInput,
  type WorkflowAttemptState
} from '../../shared/workflows/workflow-run-types'

export type WorkflowAttemptPatch = Partial<
  Pick<
    WorkflowAttempt,
    | 'state'
    | 'input'
    | 'taskId'
    | 'dispatchId'
    | 'gateId'
    | 'terminalHandle'
    | 'target'
    | 'result'
    | 'failure'
    | 'liveness'
    | 'retryRequestedAt'
    | 'startedAt'
    | 'finishedAt'
  >
>

export type WorkflowAttemptClaim = {
  runId: string
  stepId: string
  kind: WorkflowStepKind
  state: WorkflowAttemptState
  input: WorkflowAttemptInput | null
  taskId: string | null
  retryOfDispatchId: string | null
}

const ATTEMPT_PATCH_KEYS = [
  'state',
  'input',
  'taskId',
  'dispatchId',
  'gateId',
  'terminalHandle',
  'target',
  'result',
  'failure',
  'liveness',
  'retryRequestedAt',
  'startedAt',
  'finishedAt'
] as const satisfies readonly (keyof WorkflowAttemptPatch)[]

const ATTEMPT_COLUMNS: Record<keyof WorkflowAttemptPatch, { column: string; json?: boolean }> = {
  state: { column: 'state' },
  input: { column: 'input_snapshot', json: true },
  taskId: { column: 'task_id' },
  dispatchId: { column: 'dispatch_id' },
  gateId: { column: 'gate_id' },
  terminalHandle: { column: 'terminal_handle' },
  target: { column: 'target', json: true },
  result: { column: 'result', json: true },
  failure: { column: 'failure' },
  liveness: { column: 'liveness' },
  retryRequestedAt: { column: 'retry_requested_at' },
  startedAt: { column: 'started_at' },
  finishedAt: { column: 'finished_at' }
}

/** Attempt states that still hold their step: an active start or agent, or an open decision. */
export const STEP_HOLDING_STATES_SQL = [...WORKFLOW_ACTIVE_ATTEMPT_STATES, 'awaiting_decision']
  .map((state) => `'${state}'`)
  .join(', ')

/**
 * Inserts the next attempt for a step and returns its id, or null when one still holds the step.
 * The check and the insert share one write transaction, so a replayed tick or a double click
 * cannot claim twice.
 */
export function claimWorkflowAttempt(db: Database, input: WorkflowAttemptClaim): string | null {
  db.exec('BEGIN IMMEDIATE')
  try {
    const holding = db
      .prepare(
        `SELECT id FROM workflow_attempts
         WHERE run_id = ? AND step_id = ? AND state IN (${STEP_HOLDING_STATES_SQL})`
      )
      .get(input.runId, input.stepId)
    if (holding) {
      db.exec('COMMIT')
      return null
    }
    const last = db
      .prepare(
        'SELECT MAX(attempt_no) AS attempt_no FROM workflow_attempts WHERE run_id = ? AND step_id = ?'
      )
      .get(input.runId, input.stepId)
    const id = generateId('wfatt')
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO workflow_attempts (
         id, run_id, step_id, attempt_no, kind, state, task_id, retry_of_dispatch_id,
         input_snapshot, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.runId,
      input.stepId,
      Number(last?.attempt_no ?? 0) + 1,
      input.kind,
      input.state,
      input.taskId,
      input.retryOfDispatchId,
      input.input ? JSON.stringify(input.input) : null,
      now,
      now
    )
    db.exec('COMMIT')
    return id
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** Applies a patch only while the attempt is still in one of `fromStates`, when given. */
export function patchWorkflowAttempt(
  db: Database,
  id: string,
  patch: WorkflowAttemptPatch,
  fromStates?: readonly WorkflowAttemptState[]
): boolean {
  const assignments: string[] = []
  const values: (string | null)[] = []
  for (const key of ATTEMPT_PATCH_KEYS) {
    if (!Object.hasOwn(patch, key)) {
      continue
    }
    const value: unknown = patch[key]
    const spec = ATTEMPT_COLUMNS[key]
    assignments.push(`${spec.column} = ?`)
    values.push(
      value === null || value === undefined
        ? null
        : spec.json
          ? JSON.stringify(value)
          : String(value)
    )
  }
  if (assignments.length === 0) {
    return false
  }
  const guard = fromStates?.length ? ` AND state IN (${fromStates.map(() => '?').join(', ')})` : ''
  const result = db
    .prepare(
      `UPDATE workflow_attempts SET ${assignments.join(', ')}, updated_at = ? WHERE id = ?${guard}`
    )
    .run(...values, new Date().toISOString(), id, ...(fromStates ?? []))
  return Number(result.changes) > 0
}
