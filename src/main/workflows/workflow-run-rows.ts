import type { SqliteRow } from '../sqlite/sqlite-statement'
import type { WorkflowStepKind } from '../../shared/workflows/workflow-definition'
import type {
  WorkflowAttempt,
  WorkflowAttemptInput,
  WorkflowAttemptResult,
  WorkflowAttemptState,
  WorkflowLiveness,
  WorkflowRun,
  WorkflowRunControl,
  WorkflowRunEvent,
  WorkflowRunStatus
} from '../../shared/workflows/workflow-run-types'
import type {
  WorkflowArtifactRef,
  WorkflowExecutionTarget
} from '../../shared/workflows/workflow-step-output'
import {
  integer,
  isRecord,
  json,
  optionalText,
  readDefinitionBody,
  readParams,
  text
} from './workflow-store-rows'

const RUN_STATUSES: readonly WorkflowRunStatus[] = [
  'running',
  'paused',
  'awaiting_decision',
  'succeeded',
  'failed',
  'blocked',
  'cancelling',
  'cancelled'
]
const CONTROLS: readonly WorkflowRunControl[] = ['run', 'pause', 'cancel']
const ATTEMPT_STATES: readonly WorkflowAttemptState[] = [
  'claimed',
  'starting',
  'running',
  'awaiting_decision',
  'succeeded',
  'approved',
  'rejected',
  'failed',
  'start_failed',
  'stopping',
  'stopped',
  'stop_unknown',
  'superseded'
]
const LIVENESS: readonly WorkflowLiveness[] = ['live', 'unverifiable', 'exited']
const STEP_KINDS: readonly WorkflowStepKind[] = ['agent', 'approval', 'integration']

function oneOf<T extends string>(values: readonly T[], value: string | null, fallback: T): T {
  return values.find((candidate) => candidate === value) ?? fallback
}

export function readRun(row: SqliteRow): WorkflowRun {
  return {
    id: text(row, 'id'),
    definitionId: text(row, 'definition_id'),
    definitionRevision: integer(row, 'definition_revision'),
    definitionName: text(row, 'definition_name'),
    snapshot: readDefinitionBody(json(row, 'snapshot')),
    params: readParams(json(row, 'params')),
    target: {
      hostId: text(row, 'host_id'),
      workspaceId: text(row, 'workspace_id'),
      workspaceLabel: text(row, 'workspace_label'),
      workspacePath: optionalText(row, 'workspace_path'),
      repoId: optionalText(row, 'repo_id'),
      isGit: integer(row, 'workspace_is_git') === 1
    },
    orchestrationRunId: optionalText(row, 'orchestration_run_id'),
    maxConcurrency: integer(row, 'max_concurrency'),
    control: oneOf(CONTROLS, optionalText(row, 'control'), 'run'),
    status: oneOf(RUN_STATUSES, optionalText(row, 'status'), 'running'),
    rerunOf: optionalText(row, 'rerun_of'),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
    finishedAt: optionalText(row, 'finished_at')
  }
}

function readArtifacts(value: unknown): WorkflowArtifactRef[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((entry: unknown) =>
    isRecord(entry) && typeof entry.path === 'string'
      ? [{ kind: entry.kind === 'report' ? 'report' : 'file', path: entry.path }]
      : []
  )
}

function readResult(value: unknown): WorkflowAttemptResult | null {
  if (!isRecord(value)) {
    return null
  }
  const decision = isRecord(value.decision) ? value.decision : null
  return {
    summary: typeof value.summary === 'string' ? value.summary : '',
    artifacts: readArtifacts(value.artifacts),
    reportedAt: typeof value.reportedAt === 'string' ? value.reportedAt : null,
    ...(decision &&
    (decision.decision === 'approved' || decision.decision === 'rejected') &&
    typeof decision.decidedAt === 'string'
      ? {
          decision: {
            decision: decision.decision,
            comment: typeof decision.comment === 'string' ? decision.comment : '',
            decidedAt: decision.decidedAt
          }
        }
      : {})
  }
}

function readTarget(value: unknown): WorkflowExecutionTarget | null {
  if (
    !isRecord(value) ||
    typeof value.hostId !== 'string' ||
    typeof value.workspaceId !== 'string'
  ) {
    return null
  }
  return {
    hostId: value.hostId,
    workspaceId: value.workspaceId,
    workspaceLabel:
      typeof value.workspaceLabel === 'string' ? value.workspaceLabel : value.workspaceId,
    isolated: value.isolated === true,
    branch: typeof value.branch === 'string' ? value.branch : null,
    path: typeof value.path === 'string' ? value.path : null
  }
}

function readInput(value: unknown): WorkflowAttemptInput | null {
  if (!isRecord(value) || typeof value.prompt !== 'string') {
    return null
  }
  const optional = (key: string): string | null =>
    typeof value[key] === 'string' ? String(value[key]) : null
  return {
    prompt: value.prompt,
    byteLength: typeof value.byteLength === 'number' ? value.byteLength : value.prompt.length,
    truncations: Array.isArray(value.truncations)
      ? value.truncations.flatMap((entry: unknown) =>
          isRecord(entry) &&
          typeof entry.stepId === 'string' &&
          typeof entry.shownBytes === 'number' &&
          typeof entry.totalBytes === 'number'
            ? [{ stepId: entry.stepId, shownBytes: entry.shownBytes, totalBytes: entry.totalBytes }]
            : []
        )
      : [],
    inputs: Array.isArray(value.inputs)
      ? value.inputs.flatMap((entry: unknown) =>
          isRecord(entry) && typeof entry.stepId === 'string'
            ? [
                {
                  stepId: entry.stepId,
                  attemptNo: typeof entry.attemptNo === 'number' ? entry.attemptNo : null,
                  summary: entry.summary === true,
                  artifacts: entry.artifacts === true
                }
              ]
            : []
        )
      : [],
    agent: optional('agent'),
    model: optional('model'),
    effort: optional('effort'),
    workspaceMode: value.workspaceMode === 'isolated' ? 'isolated' : 'shared'
  }
}

export function readAttempt(row: SqliteRow): WorkflowAttempt {
  const liveness = optionalText(row, 'liveness')
  return {
    id: text(row, 'id'),
    runId: text(row, 'run_id'),
    stepId: text(row, 'step_id'),
    attemptNo: integer(row, 'attempt_no'),
    kind: oneOf(STEP_KINDS, optionalText(row, 'kind'), 'agent'),
    state: oneOf(ATTEMPT_STATES, optionalText(row, 'state'), 'failed'),
    taskId: optionalText(row, 'task_id'),
    dispatchId: optionalText(row, 'dispatch_id'),
    gateId: optionalText(row, 'gate_id'),
    retryOfDispatchId: optionalText(row, 'retry_of_dispatch_id'),
    terminalHandle: optionalText(row, 'terminal_handle'),
    input: readInput(json(row, 'input_snapshot')),
    target: readTarget(json(row, 'target')),
    result: readResult(json(row, 'result')),
    failure: optionalText(row, 'failure'),
    liveness: liveness ? oneOf(LIVENESS, liveness, 'unverifiable') : null,
    retryRequestedAt: optionalText(row, 'retry_requested_at'),
    createdAt: text(row, 'created_at'),
    startedAt: optionalText(row, 'started_at'),
    finishedAt: optionalText(row, 'finished_at'),
    updatedAt: text(row, 'updated_at')
  }
}

export function readEvent(row: SqliteRow): WorkflowRunEvent {
  const payload = json(row, 'payload')
  return {
    runId: text(row, 'run_id'),
    seq: integer(row, 'seq'),
    kind: text(row, 'kind'),
    stepId: optionalText(row, 'step_id'),
    attemptId: optionalText(row, 'attempt_id'),
    actor: optionalText(row, 'actor') === 'user' ? 'user' : 'system',
    payload: isRecord(payload) ? payload : null,
    createdAt: text(row, 'created_at')
  }
}
