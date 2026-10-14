import type {
  DispatchStatus,
  TaskStatus,
  WorkerDispatchState
} from '../runtime/orchestration/types'
import type { WorkflowLiveness } from '../../shared/workflows/workflow-run-types'

export type WorkflowWorkspaceInfo = {
  workspaceId: string
  label: string
  path: string | null
  branch: string | null
  repoId: string | null
  hostId: string
  isGit: boolean
}

export type WorkflowWorkerStart = {
  orchestrationRunId: string
  taskId: string
  /** The run's workspace: shared steps run in it, isolated steps branch a child worktree from it. */
  anchorWorkspaceId: string
  agent: string
  model?: string
  effort?: string
  isolated: boolean
  worktreeName?: string
  retryOfDispatchId?: string
}

export type WorkflowWorkerStartOutcome = {
  dispatchId: string | null
  /** Set when the start failed before the agent took the task. */
  failure: string | null
}

/** One Dispatch as orchestration currently records it. */
export type WorkflowDispatchObservation = {
  dispatchStatus: DispatchStatus
  workerState: WorkerDispatchState | null
  taskStatus: TaskStatus | null
  taskResult: string | null
  lastFailure: string | null
  terminationReason: string | null
  terminalHandle: string | null
  worktreeId: string | null
}

export type WorkflowStopOutcome =
  | { kind: 'stopped' }
  | { kind: 'already_settled' }
  | { kind: 'unknown'; reason: string }

/**
 * Everything the workflow scheduler needs from orchestration. The real implementation reuses
 * Run/Task/Dispatch/gate primitives and the worker-start/stop/release paths; tests substitute a
 * controllable fake.
 */
export type WorkflowOrchestrationPort = {
  createRun(objective: string): string
  runExists(runId: string): boolean
  createTask(input: { runId: string; spec: string; title: string; deps: string[] }): string
  startWorker(input: WorkflowWorkerStart): Promise<WorkflowWorkerStartOutcome>
  observeDispatch(dispatchId: string): WorkflowDispatchObservation | null
  /** Newest Dispatch for a Task, used to adopt a start the previous process did not record. */
  latestDispatchForTask(taskId: string): string | null
  openGate(input: { taskId: string; question: string }): string
  readGate(gateId: string): { status: string; resolution: string | null } | null
  settleGate(input: {
    gateId: string
    taskId: string
    decision: 'approved' | 'rejected' | 'cancelled'
    result: string
  }): void
  reopenGate(input: { taskId: string; question: string }): string
  stopWorker(dispatchId: string): Promise<WorkflowStopOutcome>
  releaseWorker(dispatchId: string): Promise<void>
  probeLiveness(dispatchId: string): Promise<WorkflowLiveness | null>
  describeWorkspace(workspaceId: string): Promise<WorkflowWorkspaceInfo>
  /** The agent a step without an explicit choice runs on this host, or null when none is set up. */
  resolveDefaultAgent(workspaceId: string): Promise<string | null>
  isAgentEnabled(agent: string): boolean
}
