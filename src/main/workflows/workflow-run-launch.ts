import {
  WORKFLOW_MAX_CONCURRENCY_LIMIT,
  type WorkflowStep
} from '../../shared/workflows/workflow-definition'
import { validateWorkflowDefinition } from '../../shared/workflows/workflow-definition-validation'
import type {
  WorkflowAgentSource,
  WorkflowLaunchInput,
  WorkflowLaunchNote,
  WorkflowLaunchPlan,
  WorkflowLaunchStepPlan
} from '../../shared/workflows/workflow-launch-types'
import { resolveWorkflowParameterValues } from '../../shared/workflows/workflow-parameter-validation'
import {
  composeWorkflowStepPrompt,
  WorkflowPromptTooLargeError
} from '../../shared/workflows/workflow-prompt-composition'
import type { WorkflowRun, WorkflowRunTarget } from '../../shared/workflows/workflow-run-types'
import {
  launchIssue,
  stepIssue,
  summarizeWorkflowIssues,
  type WorkflowValidationIssue
} from '../../shared/workflows/workflow-validation-issues'
import type { WorkflowDispatchContext } from './workflow-agent-dispatch'
import { WorkflowServiceError } from './workflow-service-error'

async function resolveTarget(
  ctx: WorkflowDispatchContext,
  workspaceId: string
): Promise<WorkflowRunTarget | null> {
  try {
    const info = await ctx.port.describeWorkspace(workspaceId)
    return {
      hostId: info.hostId,
      workspaceId: info.workspaceId,
      workspaceLabel: info.label,
      workspacePath: info.path,
      repoId: info.repoId,
      isGit: info.isGit
    }
  } catch {
    return null
  }
}

/**
 * Everything a launch would do, without doing it: validation located by field, the target as this
 * host resolves it, and each step's agent and final prompt. Starting a run re-plans, so a preview
 * that went stale can never launch something different from what it showed.
 */
export async function planWorkflowLaunch(
  ctx: WorkflowDispatchContext,
  input: WorkflowLaunchInput
): Promise<WorkflowLaunchPlan> {
  const { snapshot } = input
  const named = new Set(
    [snapshot.defaultAgent, ...snapshot.steps.map((step) => step.agent)].filter(
      (agent): agent is string => Boolean(agent)
    )
  )
  const availableAgents = [...named].filter((agent) => ctx.port.isAgentEnabled(agent))
  const issues: WorkflowValidationIssue[] = validateWorkflowDefinition(snapshot, {
    availableAgents
  })
  const resolved = resolveWorkflowParameterValues(snapshot.parameters, input.params)
  issues.push(...resolved.issues)
  const maxConcurrency = input.maxConcurrency ?? snapshot.maxConcurrency
  if (
    !Number.isInteger(maxConcurrency) ||
    maxConcurrency < 1 ||
    maxConcurrency > WORKFLOW_MAX_CONCURRENCY_LIMIT
  ) {
    issues.push(
      launchIssue(
        'maxConcurrency',
        'max_concurrency_invalid',
        `Max parallel steps must be a whole number from 1 to ${WORKFLOW_MAX_CONCURRENCY_LIMIT}.`
      )
    )
  }
  const target = await resolveTarget(ctx, input.workspaceId)
  if (!target) {
    issues.push(
      launchIssue('workspace', 'target_required', 'Choose a workspace that exists on this host.')
    )
  }
  const needsHostDefault = snapshot.steps.some(
    (step) => step.kind === 'agent' && !step.agent && !snapshot.defaultAgent
  )
  const hostDefault =
    needsHostDefault && target ? await ctx.port.resolveDefaultAgent(target.workspaceId) : null
  const notes = new Set<WorkflowLaunchNote>()
  const steps = snapshot.steps.map((step, index) =>
    planStep({
      ctx,
      input,
      step,
      index,
      target,
      hostDefault,
      params: resolved.values,
      issues,
      notes
    })
  )
  if (target && !target.isGit) {
    notes.add('folder_runs_serially')
  }
  return { issues, target, params: resolved.values, maxConcurrency, steps, notes: [...notes] }
}

function planStep(args: {
  ctx: WorkflowDispatchContext
  input: WorkflowLaunchInput
  step: WorkflowStep
  index: number
  target: WorkflowRunTarget | null
  hostDefault: string | null
  params: WorkflowLaunchPlan['params']
  issues: WorkflowValidationIssue[]
  notes: Set<WorkflowLaunchNote>
}): WorkflowLaunchStepPlan {
  const { step, index, target, input, issues, notes } = args
  const base = {
    stepId: step.id,
    kind: step.kind,
    agent: null,
    agentSource: null,
    model: null,
    effort: null,
    workspaceMode: step.workspaceMode,
    prompt: null,
    byteLength: 0
  }
  if (step.kind !== 'agent') {
    return base
  }
  const [agent, agentSource]: [string | null, WorkflowAgentSource | null] = step.agent
    ? [step.agent, 'step']
    : input.snapshot.defaultAgent
      ? [input.snapshot.defaultAgent, 'workflow']
      : args.hostDefault
        ? [args.hostDefault, 'host']
        : [null, null]
  if (!agent && target) {
    issues.push(
      stepIssue(
        index,
        step.id,
        'agent',
        'agent_unavailable',
        'This host has no default agent. Choose an agent for this step or the workflow.'
      )
    )
  }
  if (step.workspaceMode === 'isolated') {
    if (target && !target.isGit) {
      issues.push(
        stepIssue(
          index,
          step.id,
          'workspaceMode',
          'target_not_git',
          'Isolated steps need a Git repository; this workspace is a plain folder.'
        )
      )
    }
    notes.add('isolated_from_commit')
  } else if (input.snapshot.maxConcurrency > 1 || (input.maxConcurrency ?? 1) > 1) {
    notes.add('shared_steps_take_turns')
  }
  try {
    const composed = composeWorkflowStepPrompt({
      workflowName: input.snapshot.name,
      step,
      steps: input.snapshot.steps,
      params: args.params,
      outputs: new Map(),
      maxBytes: args.ctx.maxPromptBytes
    })
    return {
      ...base,
      agent,
      agentSource,
      model: step.model ?? null,
      effort: step.model ? (step.effort ?? null) : null,
      prompt: composed.text,
      byteLength: composed.byteLength
    }
  } catch (error) {
    if (error instanceof WorkflowPromptTooLargeError) {
      issues.push(stepIssue(index, step.id, 'prompt', 'prompt_too_large', error.message))
      return { ...base, agent, agentSource }
    }
    throw error
  }
}

/** Creates the run and its orchestration Run. Idempotent per `requestId`. */
export async function startWorkflowRun(
  ctx: WorkflowDispatchContext,
  input: WorkflowLaunchInput
): Promise<{ run: WorkflowRun; created: boolean }> {
  const plan = await planWorkflowLaunch(ctx, input)
  if (plan.issues.length > 0 || !plan.target) {
    throw new WorkflowServiceError(
      'workflow_invalid_launch',
      summarizeWorkflowIssues(plan.issues),
      {
        issues: plan.issues
      }
    )
  }
  const { run, created } = ctx.store.runs.createRun({
    startRequestId: input.requestId,
    definitionId: input.definitionId,
    definitionRevision: input.definitionRevision,
    snapshot: input.snapshot,
    params: plan.params,
    target: plan.target,
    maxConcurrency: plan.target.isGit ? plan.maxConcurrency : 1,
    rerunOf: input.rerunOf ?? null
  })
  if (!created) {
    return { run, created }
  }
  const orchestrationRunId = ctx.port.createRun(`Workflow: ${input.snapshot.name}`)
  ctx.store.runs.setOrchestrationRunId(run.id, orchestrationRunId)
  ctx.store.runs.appendEvent({
    runId: run.id,
    kind: 'run_started',
    actor: 'user',
    payload: {
      definitionRevision: input.definitionRevision,
      orchestrationRunId,
      rerunOf: input.rerunOf ?? null
    }
  })
  return { run: ctx.store.runs.requireRun(run.id), created }
}
