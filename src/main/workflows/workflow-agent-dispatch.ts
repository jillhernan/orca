import type { WorkflowStep } from '../../shared/workflows/workflow-definition'
import {
  composeWorkflowStepPrompt,
  WorkflowPromptTooLargeError
} from '../../shared/workflows/workflow-prompt-composition'
import type {
  WorkflowAttempt,
  WorkflowAttemptInput,
  WorkflowRun
} from '../../shared/workflows/workflow-run-types'
import type { WorkflowExecutionTarget } from '../../shared/workflows/workflow-step-output'
import type { WorkflowDatabase } from './workflow-database'
import type { WorkflowOrchestrationPort } from './workflow-orchestration-port'
import { collectPredecessorOutputs, predecessorTaskIds } from './workflow-step-outputs'

export type WorkflowDispatchContext = {
  store: WorkflowDatabase
  port: WorkflowOrchestrationPort
  maxPromptBytes: number
}

function worktreeName(run: WorkflowRun, step: WorkflowStep): string {
  const slug = run.snapshot.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20)
  return [slug || 'workflow', step.id.slice(0, 16), run.id.slice(-6)].filter(Boolean).join('-')
}

export function runTarget(run: WorkflowRun): WorkflowExecutionTarget {
  return {
    hostId: run.target.hostId,
    workspaceId: run.target.workspaceId,
    workspaceLabel: run.target.workspaceLabel,
    isolated: false,
    path: run.target.workspacePath
  }
}

/** The prompt and launch choices an attempt runs with; a retry reuses its predecessor's. */
export function buildAttemptInput(args: {
  run: WorkflowRun
  step: WorkflowStep
  attempts: readonly WorkflowAttempt[]
  agent: string
  maxPromptBytes: number
}): WorkflowAttemptInput {
  const { run, step } = args
  const composed = composeWorkflowStepPrompt({
    workflowName: run.snapshot.name,
    step,
    steps: run.snapshot.steps,
    params: run.params,
    outputs: collectPredecessorOutputs(step, args.attempts),
    maxBytes: args.maxPromptBytes
  })
  return {
    prompt: composed.text,
    byteLength: composed.byteLength,
    truncations: composed.truncations,
    inputs: composed.inputs,
    agent: args.agent,
    model: step.model ?? null,
    effort: step.model ? (step.effort ?? null) : null,
    // A folder target cannot host an isolated worktree; launch validation refuses that earlier.
    workspaceMode: run.target.isGit ? step.workspaceMode : 'shared'
  }
}

/**
 * Runs one claimed agent attempt to the point where orchestration owns it. Every write is fenced
 * on the attempt's expected state, so a cancel that lands mid-start is never overwritten.
 */
export async function dispatchAgentAttempt(
  ctx: WorkflowDispatchContext,
  run: WorkflowRun,
  step: WorkflowStep,
  attempt: WorkflowAttempt,
  previous: WorkflowAttempt | null
): Promise<void> {
  const { store, port } = ctx
  const fail = (failure: string): void => {
    const now = new Date().toISOString()
    if (
      store.runs.updateAttempt(attempt.id, { state: 'start_failed', failure, finishedAt: now }, [
        'claimed',
        'starting'
      ])
    ) {
      store.runs.appendEvent({
        runId: run.id,
        kind: 'step_start_failed',
        actor: 'system',
        stepId: step.id,
        attemptId: attempt.id,
        payload: { failure }
      })
    }
  }
  try {
    if (!run.orchestrationRunId) {
      fail('This run has no orchestration Run yet.')
      return
    }
    const agent =
      previous?.input?.agent ??
      step.agent ??
      run.snapshot.defaultAgent ??
      (await port.resolveDefaultAgent(run.target.workspaceId))
    if (!agent) {
      fail(
        'No agent is set for this step and this host has no default agent. Choose an agent in the workflow or set a default agent in Settings.'
      )
      return
    }
    if (!port.isAgentEnabled(agent)) {
      fail(`Agent "${agent}" is disabled or not installed on this host.`)
      return
    }
    const attempts = store.runs.listAttempts(run.id)
    const input =
      previous?.input ??
      buildAttemptInput({ run, step, attempts, agent, maxPromptBytes: ctx.maxPromptBytes })
    const taskId =
      previous?.taskId ??
      port.createTask({
        runId: run.orchestrationRunId,
        spec: input.prompt,
        title: `${run.snapshot.name} · ${step.name}`,
        deps: predecessorTaskIds(step, attempts)
      })
    const isolated = input.workspaceMode === 'isolated'
    const moved = store.runs.updateAttempt(
      attempt.id,
      {
        state: 'starting',
        input,
        taskId,
        target: isolated ? null : runTarget(run),
        startedAt: new Date().toISOString()
      },
      ['claimed']
    )
    if (!moved) {
      return
    }
    store.runs.appendEvent({
      runId: run.id,
      kind: 'step_dispatching',
      actor: 'system',
      stepId: step.id,
      attemptId: attempt.id,
      payload: {
        taskId,
        agent,
        attemptNo: attempt.attemptNo,
        retryOf: previous?.dispatchId ?? null
      }
    })
    const outcome = await port.startWorker({
      orchestrationRunId: run.orchestrationRunId,
      taskId,
      anchorWorkspaceId: run.target.workspaceId,
      agent,
      ...(input.model ? { model: input.model } : {}),
      ...(input.effort ? { effort: input.effort } : {}),
      isolated,
      ...(isolated ? { worktreeName: worktreeName(run, step) } : {}),
      ...(previous?.dispatchId ? { retryOfDispatchId: previous.dispatchId } : {})
    })
    await recordStartOutcome(ctx, run, step, attempt, outcome, isolated)
  } catch (error) {
    fail(
      error instanceof WorkflowPromptTooLargeError
        ? error.message
        : `Could not start the step: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

async function recordStartOutcome(
  ctx: WorkflowDispatchContext,
  run: WorkflowRun,
  step: WorkflowStep,
  attempt: WorkflowAttempt,
  outcome: { dispatchId: string | null; failure: string | null },
  isolated: boolean
): Promise<void> {
  const { store, port } = ctx
  const observation = outcome.dispatchId ? port.observeDispatch(outcome.dispatchId) : null
  const startFailed =
    !outcome.dispatchId ||
    !observation ||
    observation.workerState === 'failed' ||
    (observation.dispatchStatus === 'failed' && observation.taskResult === null)
  let target: WorkflowExecutionTarget | null = isolated ? null : runTarget(run)
  if (isolated && observation?.worktreeId) {
    const info = await port.describeWorkspace(observation.worktreeId).catch(() => null)
    target = info
      ? {
          hostId: info.hostId,
          workspaceId: info.workspaceId,
          workspaceLabel: info.label,
          isolated: true,
          branch: info.branch,
          path: info.path
        }
      : null
  }
  const failure = outcome.failure ?? observation?.lastFailure ?? null
  if (
    store.runs.updateAttempt(
      attempt.id,
      {
        dispatchId: outcome.dispatchId,
        terminalHandle: observation?.terminalHandle ?? null,
        target
      },
      ['stopping', 'stop_unknown']
    )
  ) {
    // A stop arrived mid-start; recording the Dispatch lets the stop reach the agent it launched.
    return
  }
  const recorded = store.runs.updateAttempt(
    attempt.id,
    startFailed
      ? {
          state: 'start_failed',
          dispatchId: outcome.dispatchId,
          failure: failure ?? 'The agent did not take the task.',
          target,
          finishedAt: new Date().toISOString()
        }
      : {
          state: 'running',
          dispatchId: outcome.dispatchId,
          terminalHandle: observation?.terminalHandle ?? null,
          target,
          // A start whose outcome orchestration could not prove keeps running with the warning.
          failure
        },
    ['starting']
  )
  if (!recorded) {
    return
  }
  store.runs.appendEvent({
    runId: run.id,
    kind: startFailed ? 'step_start_failed' : 'step_started',
    actor: 'system',
    stepId: step.id,
    attemptId: attempt.id,
    payload: { dispatchId: outcome.dispatchId, failure }
  })
}
