import type Database from '../sqlite/sync-database'
import type { SqliteRow } from '../sqlite/sqlite-statement'
import { generateId } from '../runtime/orchestration/db/generated-id'
import {
  claimWorkflowAttempt,
  patchWorkflowAttempt,
  STEP_HOLDING_STATES_SQL,
  type WorkflowAttemptClaim,
  type WorkflowAttemptPatch
} from './workflow-attempt-writes'
import type {
  WorkflowDefinitionBody,
  WorkflowParameterValue
} from '../../shared/workflows/workflow-definition'
import type {
  WorkflowAttempt,
  WorkflowAttemptState,
  WorkflowEventActor,
  WorkflowRun,
  WorkflowRunControl,
  WorkflowRunEvent,
  WorkflowRunStatus,
  WorkflowRunTarget
} from '../../shared/workflows/workflow-run-types'
import { readAttempt, readEvent, readRun } from './workflow-run-rows'

export type WorkflowRunInsert = {
  startRequestId: string
  definitionId: string
  definitionRevision: number
  snapshot: WorkflowDefinitionBody
  params: Record<string, WorkflowParameterValue>
  target: WorkflowRunTarget
  maxConcurrency: number
  rerunOf: string | null
}

export type { WorkflowAttemptPatch } from './workflow-attempt-writes'

export class WorkflowRunStore {
  constructor(private readonly db: Database) {}

  /** Returns `created: false` with the original run when the start request was already applied. */
  createRun(input: WorkflowRunInsert): { run: WorkflowRun; created: boolean } {
    const existing = this.db
      .prepare('SELECT * FROM workflow_runs WHERE start_request_id = ?')
      .get(input.startRequestId)
    if (existing) {
      return { run: readRun(existing), created: false }
    }
    const id = generateId('wfrun')
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO workflow_runs (
           id, start_request_id, definition_id, definition_revision, definition_name, snapshot, params,
           host_id, workspace_id, workspace_label, workspace_path, repo_id, workspace_is_git,
           max_concurrency, control, status, rerun_of, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'run', 'running', ?, ?, ?)`
      )
      .run(
        id,
        input.startRequestId,
        input.definitionId,
        input.definitionRevision,
        input.snapshot.name,
        JSON.stringify(input.snapshot),
        JSON.stringify(input.params),
        input.target.hostId,
        input.target.workspaceId,
        input.target.workspaceLabel,
        input.target.workspacePath,
        input.target.repoId,
        input.target.isGit ? 1 : 0,
        input.maxConcurrency,
        input.rerunOf,
        now,
        now
      )
    return { run: this.requireRun(id), created: true }
  }

  getRun(id: string): WorkflowRun | null {
    const row = this.db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(id)
    return row ? readRun(row) : null
  }

  requireRun(id: string): WorkflowRun {
    const run = this.getRun(id)
    if (!run) {
      throw new Error(`Workflow run ${id} was not found.`)
    }
    return run
  }

  listRuns(filter: {
    definitionId?: string
    statuses?: readonly WorkflowRunStatus[]
    limit: number
    before?: string
  }): WorkflowRun[] {
    const clauses: string[] = []
    const values: (string | number)[] = []
    if (filter.definitionId) {
      clauses.push('definition_id = ?')
      values.push(filter.definitionId)
    }
    if (filter.statuses && filter.statuses.length > 0) {
      clauses.push(`status IN (${filter.statuses.map(() => '?').join(', ')})`)
      values.push(...filter.statuses)
    }
    if (filter.before) {
      clauses.push('created_at < ?')
      values.push(filter.before)
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    return this.db
      .prepare(`SELECT * FROM workflow_runs ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...values, filter.limit)
      .map(readRun)
  }

  /** Runs the scheduler still has to drive; settled runs come back through a user action. */
  listOpenRuns(): WorkflowRun[] {
    return this.db
      .prepare(
        `SELECT * FROM workflow_runs
         WHERE status NOT IN ('succeeded', 'failed', 'blocked', 'cancelled') OR id IN (
           SELECT run_id FROM workflow_attempts WHERE state IN (${STEP_HOLDING_STATES_SQL})
         )`
      )
      .all()
      .map(readRun)
  }

  countActiveRunsForDefinition(definitionId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM workflow_runs
         WHERE definition_id = ? AND status NOT IN ('succeeded', 'failed', 'blocked', 'cancelled')`
      )
      .get(definitionId)
    return row ? Number(row.count ?? 0) : 0
  }

  setControl(id: string, control: WorkflowRunControl): void {
    this.db
      .prepare('UPDATE workflow_runs SET control = ?, updated_at = ? WHERE id = ?')
      .run(control, new Date().toISOString(), id)
  }

  setOrchestrationRunId(id: string, orchestrationRunId: string): void {
    this.db
      .prepare(
        'UPDATE workflow_runs SET orchestration_run_id = ?, updated_at = ? WHERE id = ? AND orchestration_run_id IS NULL'
      )
      .run(orchestrationRunId, new Date().toISOString(), id)
  }

  setStatus(id: string, status: WorkflowRunStatus, finished: boolean): void {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `UPDATE workflow_runs SET status = ?, updated_at = ?,
           finished_at = CASE WHEN ? THEN COALESCE(finished_at, ?) ELSE NULL END
         WHERE id = ? AND (status != ? OR (finished_at IS NULL) = ?)`
      )
      .run(status, now, finished ? 1 : 0, now, id, status, finished ? 1 : 0)
  }

  listAttempts(runId: string): WorkflowAttempt[] {
    return this.db
      .prepare('SELECT * FROM workflow_attempts WHERE run_id = ? ORDER BY step_id, attempt_no')
      .all(runId)
      .map(readAttempt)
  }

  getAttempt(id: string): WorkflowAttempt | null {
    const row = this.db.prepare('SELECT * FROM workflow_attempts WHERE id = ?').get(id)
    return row ? readAttempt(row) : null
  }

  claimAttempt(input: WorkflowAttemptClaim): WorkflowAttempt | null {
    const id = claimWorkflowAttempt(this.db, input)
    return id ? this.getAttempt(id) : null
  }

  updateAttempt(
    id: string,
    patch: WorkflowAttemptPatch,
    fromStates?: readonly WorkflowAttemptState[]
  ): boolean {
    return patchWorkflowAttempt(this.db, id, patch, fromStates)
  }
  appendEvent(input: {
    runId: string
    kind: string
    actor: WorkflowEventActor
    stepId?: string | null
    attemptId?: string | null
    payload?: Record<string, unknown> | null
  }): void {
    this.db
      .prepare(
        `INSERT INTO workflow_events (run_id, seq, kind, step_id, attempt_id, actor, payload, created_at)
         VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM workflow_events WHERE run_id = ?), ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.runId,
        input.runId,
        input.kind,
        input.stepId ?? null,
        input.attemptId ?? null,
        input.actor,
        input.payload ? JSON.stringify(input.payload) : null,
        new Date().toISOString()
      )
  }

  listEvents(runId: string, limit = 500): WorkflowRunEvent[] {
    return this.db
      .prepare('SELECT * FROM workflow_events WHERE run_id = ? ORDER BY seq DESC LIMIT ?')
      .all(runId, limit)
      .map((row: SqliteRow) => readEvent(row))
      .toReversed()
  }
}
