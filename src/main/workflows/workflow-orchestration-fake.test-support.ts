import type { TaskStatus } from '../runtime/orchestration/types'
import type { WorkflowLiveness } from '../../shared/workflows/workflow-run-types'
import type {
  WorkflowDispatchObservation,
  WorkflowOrchestrationPort,
  WorkflowStopOutcome,
  WorkflowWorkerStart,
  WorkflowWorkspaceInfo
} from './workflow-orchestration-port'

type FakeTask = {
  id: string
  runId: string
  spec: string
  title: string
  deps: string[]
  status: TaskStatus
  result: string | null
}

type FakeDispatch = WorkflowDispatchObservation & {
  id: string
  taskId: string
  start: WorkflowWorkerStart
}

/**
 * Orchestration as the scheduler sees it, with workers the test settles by hand. Settlement mirrors
 * the real worker_done projection: the Dispatch closes and the Task carries the report JSON.
 */
export class FakeWorkflowOrchestration implements WorkflowOrchestrationPort {
  readonly runs = new Set<string>()
  readonly tasks = new Map<string, FakeTask>()
  readonly dispatches = new Map<string, FakeDispatch>()
  readonly gates = new Map<string, { taskId: string; status: string; resolution: string | null }>()
  readonly starts: WorkflowWorkerStart[] = []
  readonly stops: string[] = []
  readonly releases: string[] = []
  workspaces = new Map<string, WorkflowWorkspaceInfo>([
    [
      'ws-git',
      {
        workspaceId: 'ws-git',
        label: 'main',
        path: '/repo',
        branch: 'main',
        repoId: 'repo',
        hostId: 'local',
        isGit: true
      }
    ],
    [
      'ws-folder',
      {
        workspaceId: 'ws-folder',
        label: 'notes',
        path: '/notes',
        branch: null,
        repoId: null,
        hostId: 'local',
        isGit: false
      }
    ]
  ])
  defaultAgent: string | null = 'claude'
  enabledAgents = new Set(['claude', 'codex'])
  stopOutcome: WorkflowStopOutcome = { kind: 'stopped' }
  nextStartFailure: string | null = null
  private pendingStart: (() => void) | null = null
  holdStarts = false
  /** Holds starts after the Dispatch exists, as orchestration does while the agent launches. */
  holdStartsAfterDispatch = false
  private readonly launching = new Set<string>()
  private counter = 0

  private id(prefix: string): string {
    this.counter += 1
    return `${prefix}_${this.counter}`
  }

  createRun(): string {
    const id = this.id('run')
    this.runs.add(id)
    return id
  }

  runExists(runId: string): boolean {
    return this.runs.has(runId)
  }

  createTask(input: { runId: string; spec: string; title: string; deps: string[] }): string {
    const id = this.id('task')
    this.tasks.set(id, { id, ...input, status: 'ready', result: null })
    return id
  }

  async startWorker(input: WorkflowWorkerStart) {
    this.starts.push(input)
    if (this.holdStarts) {
      await new Promise<void>((resolve) => {
        this.pendingStart = resolve
      })
    }
    if (this.nextStartFailure) {
      const failure = this.nextStartFailure
      this.nextStartFailure = null
      return { dispatchId: null, failure }
    }
    const id = this.id('dispatch')
    const worktreeId = input.isolated ? `wt-${id}` : null
    if (worktreeId) {
      this.workspaces.set(worktreeId, {
        workspaceId: worktreeId,
        label: input.worktreeName ?? worktreeId,
        path: `/repo-${id}`,
        branch: input.worktreeName ?? id,
        repoId: 'repo',
        hostId: 'local',
        isGit: true
      })
    }
    this.dispatches.set(id, {
      id,
      taskId: input.taskId,
      start: input,
      dispatchStatus: 'dispatched',
      workerState: 'ready',
      taskStatus: 'dispatched',
      taskResult: null,
      lastFailure: null,
      terminationReason: null,
      terminalHandle: `term-${id}`,
      worktreeId
    })
    const task = this.tasks.get(input.taskId)
    if (task) {
      task.status = 'dispatched'
    }
    if (this.holdStartsAfterDispatch) {
      this.launching.add(id)
      await new Promise<void>((resolve) => {
        this.pendingStart = resolve
      })
      this.launching.delete(id)
    }
    return { dispatchId: id, failure: null }
  }

  releaseHeldStart(): void {
    this.holdStarts = false
    this.holdStartsAfterDispatch = false
    this.pendingStart?.()
    this.pendingStart = null
  }

  /** What a worker's `worker_done` does to the records. Late reports for closed Dispatches are refused. */
  report(
    dispatchId: string,
    outcome: 'succeeded' | 'failed',
    body: string,
    files: string[] = []
  ): boolean {
    const dispatch = this.dispatches.get(dispatchId)
    const task = dispatch ? this.tasks.get(dispatch.taskId) : undefined
    if (!dispatch || !task || dispatch.dispatchStatus !== 'dispatched') {
      return false
    }
    const result = JSON.stringify({
      provenance: 'worker_report',
      outcome,
      subject: '',
      body,
      filesModified: files,
      reportPath: null,
      completedAt: new Date().toISOString()
    })
    dispatch.dispatchStatus = outcome === 'succeeded' ? 'completed' : 'failed'
    dispatch.workerState = outcome === 'succeeded' ? 'succeeded' : 'failed'
    task.status = outcome === 'succeeded' ? 'completed' : 'failed'
    task.result = result
    dispatch.taskStatus = task.status
    dispatch.taskResult = result
    return true
  }

  observeDispatch(dispatchId: string): WorkflowDispatchObservation | null {
    const dispatch = this.dispatches.get(dispatchId)
    if (!dispatch) {
      return null
    }
    const task = this.tasks.get(dispatch.taskId)
    return { ...dispatch, taskStatus: task?.status ?? null, taskResult: task?.result ?? null }
  }

  latestDispatchForTask(taskId: string): string | null {
    return [...this.dispatches.values()].findLast((d) => d.taskId === taskId)?.id ?? null
  }

  openGate(input: { taskId: string }): string {
    const id = this.id('gate')
    this.gates.set(id, { taskId: input.taskId, status: 'pending', resolution: null })
    const task = this.tasks.get(input.taskId)
    if (task) {
      task.status = 'blocked'
    }
    return id
  }

  readGate(gateId: string) {
    return this.gates.get(gateId) ?? null
  }

  settleGate(input: { gateId: string; taskId: string; decision: string; result: string }): void {
    const gate = this.gates.get(input.gateId)
    if (gate) {
      gate.status = 'resolved'
      gate.resolution = input.decision
    }
    const task = this.tasks.get(input.taskId)
    if (task) {
      task.status = input.decision === 'approved' ? 'completed' : 'blocked'
      task.result = input.result
    }
  }

  reopenGate(input: { taskId: string; question: string }): string {
    return this.openGate(input)
  }

  async stopWorker(dispatchId: string): Promise<WorkflowStopOutcome> {
    this.stops.push(dispatchId)
    if (this.launching.has(dispatchId)) {
      return { kind: 'unknown', reason: 'The Dispatch has no recorded agent terminal.' }
    }
    const dispatch = this.dispatches.get(dispatchId)
    if (dispatch && this.stopOutcome.kind === 'stopped') {
      dispatch.workerState = 'stopped'
      dispatch.dispatchStatus = 'failed'
    }
    return this.stopOutcome
  }

  async releaseWorker(dispatchId: string): Promise<void> {
    this.releases.push(dispatchId)
  }

  async probeLiveness(): Promise<WorkflowLiveness | null> {
    return 'live'
  }

  async describeWorkspace(workspaceId: string): Promise<WorkflowWorkspaceInfo> {
    const info = this.workspaces.get(workspaceId)
    if (!info) {
      throw new Error('selector_not_found')
    }
    return info
  }

  async resolveDefaultAgent(): Promise<string | null> {
    return this.defaultAgent
  }

  isAgentEnabled(agent: string): boolean {
    return this.enabledAgents.has(agent)
  }

  dispatchesForStep(stepName: string): FakeDispatch[] {
    return [...this.dispatches.values()].filter((d) =>
      this.tasks.get(d.taskId)?.title.endsWith(`· ${stepName}`)
    )
  }
}
