import type {
  WorkflowDefinitionBody,
  WorkflowParameterValue,
  WorkflowStepKind,
  WorkflowWorkspaceMode
} from './workflow-definition'
import type { WorkflowPromptTruncation } from './workflow-prompt-composition'
import type {
  WorkflowArtifactRef,
  WorkflowDecisionRecord,
  WorkflowExecutionTarget
} from './workflow-step-output'

/** What the user asked the run to do; the scheduler acts on it, status reports the outcome. */
export type WorkflowRunControl = 'run' | 'pause' | 'cancel'

export type WorkflowRunStatus =
  | 'running'
  | 'paused'
  | 'awaiting_decision'
  | 'succeeded'
  | 'failed'
  | 'blocked'
  | 'cancelling'
  | 'cancelled'

export const WORKFLOW_TERMINAL_RUN_STATUSES: readonly WorkflowRunStatus[] = [
  'succeeded',
  'failed',
  'blocked',
  'cancelled'
]

export type WorkflowAttemptState =
  | 'claimed'
  | 'starting'
  | 'running'
  | 'awaiting_decision'
  | 'succeeded'
  | 'approved'
  | 'rejected'
  | 'failed'
  | 'start_failed'
  | 'stopping'
  | 'stopped'
  | 'stop_unknown'
  | 'superseded'

/** States in which an attempt may still own a live agent or an open start. */
export const WORKFLOW_ACTIVE_ATTEMPT_STATES: readonly WorkflowAttemptState[] = [
  'claimed',
  'starting',
  'running',
  'stopping',
  'stop_unknown'
]

/** Process verdict vocabulary shared with the rest of Orca. */
export type WorkflowLiveness = 'live' | 'unverifiable' | 'exited'

export type WorkflowAttemptInput = {
  prompt: string
  byteLength: number
  truncations: WorkflowPromptTruncation[]
  inputs: { stepId: string; attemptNo: number | null; summary: boolean; artifacts: boolean }[]
  agent: string | null
  model: string | null
  effort: string | null
  workspaceMode: WorkflowWorkspaceMode
}

export type WorkflowAttemptResult = {
  summary: string
  artifacts: WorkflowArtifactRef[]
  reportedAt: string | null
  decision?: WorkflowDecisionRecord
}

export type WorkflowAttempt = {
  id: string
  runId: string
  stepId: string
  attemptNo: number
  kind: WorkflowStepKind
  state: WorkflowAttemptState
  taskId: string | null
  dispatchId: string | null
  gateId: string | null
  retryOfDispatchId: string | null
  terminalHandle: string | null
  input: WorkflowAttemptInput | null
  target: WorkflowExecutionTarget | null
  result: WorkflowAttemptResult | null
  failure: string | null
  liveness: WorkflowLiveness | null
  /** Set on a failed attempt the user asked to retry; the scheduler then starts the next one. */
  retryRequestedAt: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  updatedAt: string
}

/** The workspace a run is bound to on its execution host. */
export type WorkflowRunTarget = {
  hostId: string
  workspaceId: string
  workspaceLabel: string
  workspacePath: string | null
  repoId: string | null
  isGit: boolean
}

export type WorkflowRun = {
  id: string
  definitionId: string
  definitionRevision: number
  definitionName: string
  snapshot: WorkflowDefinitionBody
  params: Record<string, WorkflowParameterValue>
  target: WorkflowRunTarget
  orchestrationRunId: string | null
  maxConcurrency: number
  control: WorkflowRunControl
  status: WorkflowRunStatus
  rerunOf: string | null
  createdAt: string
  updatedAt: string
  finishedAt: string | null
}

export type WorkflowStepStatus =
  | 'waiting'
  | 'ready'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'awaiting_decision'
  | 'succeeded'
  | 'failed'
  | 'rejected'
  | 'blocked'
  | 'cancelled'

export type WorkflowStepView = {
  stepId: string
  status: WorkflowStepStatus
  attempts: WorkflowAttempt[]
  /** Upstream steps whose failure or rejection keeps this one from running. */
  blockedBy: string[]
}

export type WorkflowEventActor = 'user' | 'system'

export type WorkflowRunEvent = {
  runId: string
  seq: number
  kind: string
  stepId: string | null
  attemptId: string | null
  actor: WorkflowEventActor
  payload: Record<string, unknown> | null
  createdAt: string
}

export type WorkflowRunDetail = {
  run: WorkflowRun
  steps: WorkflowStepView[]
  events: WorkflowRunEvent[]
}

export type WorkflowRunSummary = {
  id: string
  definitionId: string
  definitionName: string
  definitionRevision: number
  status: WorkflowRunStatus
  control: WorkflowRunControl
  target: WorkflowRunTarget
  stepCount: number
  succeededSteps: number
  failedSteps: number
  rerunOf: string | null
  createdAt: string
  updatedAt: string
  finishedAt: string | null
}
