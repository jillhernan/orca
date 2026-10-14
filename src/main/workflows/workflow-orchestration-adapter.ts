import { basename } from 'node:path'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { startLocalWorker } from '../runtime/rpc/methods/orchestration/worker/local-worker-start'
import { stopOrchestrationWorker } from '../runtime/rpc/methods/orchestration/worker/worker-stop'
import { releaseOrchestrationWorker } from '../runtime/rpc/methods/orchestration/worker/worker-release'
import { inspectWorkerTerminal } from '../runtime/rpc/methods/orchestration/worker/worker-observation'
import {
  decideWorkerStartMode,
  readWorkerStartModeSettings
} from '../runtime/rpc/methods/orchestration-worker-start-mode'
import { detectAgentsOnHost } from '../preflight/workspace-agent-detection'
import { resolveWorkerStartReadinessTimeoutMs } from '../../shared/orchestration-timing-budgets'
import { isFolderRepo } from '../../shared/repo-kind'
import { getConnectionExecutionHostId } from '../../shared/execution-host'
import { isTuiAgent } from '../../shared/tui-agent-config'
import { isTuiAgentEnabled } from '../../shared/tui-agent-selection'
import type { WorkflowLiveness } from '../../shared/workflows/workflow-run-types'
import type {
  WorkflowDispatchObservation,
  WorkflowOrchestrationPort,
  WorkflowStopOutcome,
  WorkflowWorkerStart,
  WorkflowWorkerStartOutcome,
  WorkflowWorkspaceInfo
} from './workflow-orchestration-port'

const GATE_OPTIONS = ['approved', 'rejected']

function readField(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null || !(key in value)) {
    return null
  }
  const field: unknown = Reflect.get(value, key)
  return typeof field === 'string' && field.length > 0 ? field : null
}

/** Orchestration as the workflow scheduler drives it; every effect goes through existing paths. */
export function createWorkflowOrchestrationAdapter(
  runtime: OrcaRuntimeService
): WorkflowOrchestrationPort {
  const db = () => runtime.getOrchestrationDb()

  const startWorker = async (input: WorkflowWorkerStart): Promise<WorkflowWorkerStartOutcome> => {
    const orchestration = db()
    const run = orchestration.getRun(input.orchestrationRunId)
    const task = orchestration.getTask(input.taskId)
    if (!run || !task) {
      return {
        dispatchId: null,
        failure: 'The orchestration Run or Task for this step is missing.'
      }
    }
    const mailboxAddress = `run:${run.id}`
    const params = {
      task: task.id,
      run: run.id,
      from: mailboxAddress,
      worktree: input.isolated ? 'new-child' : 'current',
      ...(input.isolated ? { name: input.worktreeName } : {}),
      agent: input.agent,
      ...(input.model ? { model: input.model } : {}),
      ...(input.model && input.effort ? { effort: input.effort } : {}),
      ...(input.retryOfDispatchId ? { retryOf: input.retryOfDispatchId } : {})
    }
    try {
      const receipt = await startLocalWorker({
        params: { ...params, timeoutMs: resolveWorkerStartReadinessTimeoutMs(undefined) },
        runtime,
        db: orchestration,
        run,
        coordinator: null,
        existingTask: task,
        mode: decideWorkerStartMode({ params, settings: readWorkerStartModeSettings(runtime) }),
        systemCoordinator: { workspaceId: input.anchorWorkspaceId, mailboxAddress }
      })
      const dispatchId = readField(receipt, 'dispatchId')
      const lastError = readField(receipt, 'lastError')
      return { dispatchId, failure: lastError }
    } catch (error) {
      // Refusals before a Dispatch exists (bad agent, prompt budget, placement) land here.
      return {
        dispatchId: orchestration.getDispatchContext(task.id)?.id ?? null,
        failure: error instanceof Error ? error.message : String(error)
      }
    }
  }

  const observeDispatch = (dispatchId: string): WorkflowDispatchObservation | null => {
    const orchestration = db()
    const dispatch = orchestration.getDispatchContextById(dispatchId)
    if (!dispatch) {
      return null
    }
    const worker = orchestration.getWorkerDispatch(dispatchId)
    const task = orchestration.getTask(dispatch.task_id)
    return {
      dispatchStatus: dispatch.status,
      workerState: worker?.state ?? null,
      taskStatus: task?.status ?? null,
      taskResult: task?.result ?? null,
      lastFailure: dispatch.last_failure ?? worker?.last_error ?? null,
      terminationReason: dispatch.termination_reason ?? null,
      terminalHandle: worker?.agent_terminal_handle ?? dispatch.assignee_handle ?? null,
      worktreeId: worker?.worktree_id ?? null
    }
  }

  const stopWorker = async (dispatchId: string): Promise<WorkflowStopOutcome> => {
    try {
      const receipt = await stopOrchestrationWorker(runtime, dispatchId)
      const state = readField(receipt, 'state')
      if (state === 'stopped') {
        return { kind: 'stopped' }
      }
      if (
        typeof receipt === 'object' &&
        receipt !== null &&
        Reflect.get(receipt, 'alreadySettled') === true
      ) {
        return { kind: 'already_settled' }
      }
      return {
        kind: 'unknown',
        reason: readField(receipt, 'lastError') ?? `Stop ended in state ${state ?? 'unknown'}.`
      }
    } catch (error) {
      return { kind: 'unknown', reason: error instanceof Error ? error.message : String(error) }
    }
  }

  const probeLiveness = async (dispatchId: string): Promise<WorkflowLiveness | null> => {
    const observation = await inspectWorkerTerminal(runtime, db(), dispatchId).catch(() => null)
    switch (observation?.status) {
      case 'live':
        return 'live'
      case 'exited':
      case 'identity_changed':
        return 'exited'
      case 'unverifiable':
      case 'missing':
        // Missing is not proof of death: a restarted renderer can lose a handle the PTY outlived.
        return 'unverifiable'
      default:
        return null
    }
  }

  const describeWorkspace = async (workspaceId: string): Promise<WorkflowWorkspaceInfo> => {
    const scope = await runtime.showTerminalWorkspaceLaunchScope(`id:${workspaceId}`)
    const managed = await runtime
      .showManagedTerminalWorkspace(`id:${workspaceId}`)
      .catch(() => null)
    const connectionId = scope.folderWorkspace?.connectionId ?? scope.connectionId
    return {
      workspaceId: scope.id,
      label: scope.folderWorkspace?.name || managed?.displayName || basename(scope.path),
      path: scope.path,
      branch: scope.folderWorkspace ? null : managed?.git?.branch || null,
      repoId: scope.repo?.id ?? null,
      hostId:
        scope.folderWorkspace?.executionHostId ??
        managed?.hostId ??
        getConnectionExecutionHostId(connectionId),
      isGit: !scope.folderWorkspace && scope.repo !== null && !isFolderRepo(scope.repo)
    }
  }

  const isAgentEnabled = (agent: string): boolean => {
    if (!isTuiAgent(agent)) {
      return runtime.resolveOrchestrationAgentLauncher(agent) !== undefined
    }
    return isTuiAgentEnabled(agent, runtime.getClientSettings()?.disabledTuiAgents)
  }

  const resolveDefaultAgent = async (workspaceId: string): Promise<string | null> => {
    const configured = runtime.getClientSettings()?.defaultTuiAgent
    if (configured && configured !== 'blank' && isAgentEnabled(configured)) {
      return configured
    }
    const detected = await detectAgentsOnHost(
      await runtime.resolveAgentDetectionHost(workspaceId)
    ).catch(() => [])
    return detected.find((agent) => isTuiAgent(agent) && isAgentEnabled(agent)) ?? null
  }

  return {
    createRun: (objective) =>
      db().createRun({ objective, coordinatorHandle: null, coordinatorPaneKey: null }).id,
    runExists: (runId) => Boolean(db().getRun(runId)),
    createTask: ({ runId, spec, title, deps }) =>
      db().createTask({ runId, spec, taskTitle: title, deps }).id,
    startWorker,
    observeDispatch,
    latestDispatchForTask: (taskId) => db().getDispatchContext(taskId)?.id ?? null,
    openGate: ({ taskId, question }) =>
      db().createGate({ taskId, question, options: GATE_OPTIONS }).id,
    readGate: (gateId) => {
      const gate = db().getGate(gateId)
      return gate ? { status: gate.status, resolution: gate.resolution } : null
    },
    settleGate: ({ gateId, taskId, decision, result }) => {
      const orchestration = db()
      orchestration.resolveGate(gateId, decision)
      orchestration.updateTaskStatus(
        taskId,
        decision === 'approved' ? 'completed' : 'blocked',
        result
      )
    },
    reopenGate: ({ taskId, question }) =>
      db().createGate({ taskId, question, options: GATE_OPTIONS }).id,
    stopWorker,
    releaseWorker: async (dispatchId) => {
      await releaseOrchestrationWorker(runtime, dispatchId).catch(() => undefined)
    },
    probeLiveness,
    describeWorkspace,
    resolveDefaultAgent,
    isAgentEnabled
  }
}
