import type {
  WorkflowDefinition,
  WorkflowDefinitionBody,
  WorkflowDefinitionKind
} from '../../shared/workflows/workflow-definition'
import { validateWorkflowDefinition } from '../../shared/workflows/workflow-definition-validation'
import type {
  WorkflowLaunchInput,
  WorkflowLaunchPlan
} from '../../shared/workflows/workflow-launch-types'
import {
  isActiveAttempt,
  isRetryableAttempt,
  latestAttemptsByStep,
  projectWorkflowRun
} from '../../shared/workflows/workflow-run-projection'
import type {
  WorkflowRunDetail,
  WorkflowRunStatus,
  WorkflowRunSummary
} from '../../shared/workflows/workflow-run-types'
import { summarizeWorkflowIssues } from '../../shared/workflows/workflow-validation-issues'
import type { WorkflowDispatchContext } from './workflow-agent-dispatch'
import { recordDecision, reopenDecision, type WorkflowDecision } from './workflow-decision-steps'
import { planWorkflowLaunch, startWorkflowRun } from './workflow-run-launch'
import type { WorkflowScheduler } from './workflow-scheduler'
import { WorkflowServiceError } from './workflow-service-error'

const DEFAULT_RUN_PAGE = 50
const MAX_RUN_PAGE = 200

/** The workflow surface one host exposes: its definitions, the runs it executes, their controls. */
export class WorkflowService {
  constructor(
    private readonly ctx: WorkflowDispatchContext,
    private readonly scheduler: WorkflowScheduler
  ) {}

  listDefinitions(kind?: WorkflowDefinitionKind): {
    definitions: WorkflowDefinition[]
    unreadable: string[]
    latestRuns: Record<string, WorkflowRunSummary>
  } {
    const listed = this.ctx.store.definitions.list(kind)
    const latestRuns: Record<string, WorkflowRunSummary> = {}
    for (const definition of listed.definitions) {
      const [latest] = this.ctx.store.runs.listRuns({ definitionId: definition.id, limit: 1 })
      if (latest) {
        latestRuns[definition.id] = this.summarize(latest.id)
      }
    }
    return { ...listed, latestRuns }
  }

  getDefinition(id: string): WorkflowDefinition {
    const definition = this.ctx.store.definitions.get(id)
    if (!definition) {
      throw new WorkflowServiceError(
        'workflow_definition_not_found',
        `Workflow ${id} was not found.`
      )
    }
    return definition
  }

  getRevision(id: string, revision: number): WorkflowDefinitionBody {
    const body = this.ctx.store.definitions.getRevision(id, revision)
    if (!body) {
      throw new WorkflowServiceError(
        'workflow_definition_not_found',
        `Revision ${revision} of workflow ${id} was not found.`
      )
    }
    return body
  }

  createDefinition(input: {
    kind: WorkflowDefinitionKind
    body: WorkflowDefinitionBody
    requestId?: string
  }): WorkflowDefinition {
    this.assertStorable(input.body)
    return this.ctx.store.definitions.create(input)
  }

  updateDefinition(
    id: string,
    body: WorkflowDefinitionBody,
    expectedRevision: number
  ): WorkflowDefinition {
    this.assertStorable(body)
    return this.ctx.store.definitions.update(id, body, expectedRevision)
  }

  /** Never touches runs: history keeps its snapshots, and active runs must be handled first. */
  deleteDefinition(id: string): void {
    this.getDefinition(id)
    const active = this.ctx.store.runs.countActiveRunsForDefinition(id)
    if (active > 0) {
      throw new WorkflowServiceError(
        'workflow_definition_has_active_runs',
        `This workflow has ${active} run(s) in progress. Wait for them to finish or cancel them before deleting it; deleting never stops them.`,
        { activeRuns: active }
      )
    }
    this.ctx.store.definitions.delete(id)
  }

  planLaunch(input: WorkflowLaunchInput): Promise<WorkflowLaunchPlan> {
    return planWorkflowLaunch(this.ctx, input)
  }

  async startRun(input: WorkflowLaunchInput): Promise<WorkflowRunDetail> {
    const { run } = await startWorkflowRun(this.ctx, input)
    await this.scheduler.reconcileRun(run.id)
    return this.showRun(run.id)
  }

  listRuns(filter: {
    definitionId?: string
    statuses?: WorkflowRunStatus[]
    limit?: number
    before?: string
  }): { runs: WorkflowRunSummary[] } {
    const limit = Math.min(Math.max(filter.limit ?? DEFAULT_RUN_PAGE, 1), MAX_RUN_PAGE)
    const runs = this.ctx.store.runs.listRuns({ ...filter, limit })
    return { runs: runs.map((run) => this.summarize(run.id)) }
  }

  showRun(id: string): WorkflowRunDetail {
    const run = this.requireRun(id)
    const attempts = this.ctx.store.runs.listAttempts(id)
    const projection = projectWorkflowRun(run.snapshot, run.control, attempts)
    return { run, steps: projection.steps, events: this.ctx.store.runs.listEvents(id) }
  }

  pauseRun(id: string): Promise<WorkflowRunDetail> {
    return this.setControl(id, 'pause', 'run_paused', ['running', 'awaiting_decision'])
  }

  resumeRun(id: string): Promise<WorkflowRunDetail> {
    return this.setControl(id, 'run', 'run_resumed', ['paused'])
  }

  cancelRun(id: string): Promise<WorkflowRunDetail> {
    return this.setControl(id, 'cancel', 'run_cancel_requested', [
      'running',
      'paused',
      'awaiting_decision',
      'failed',
      'blocked'
    ])
  }

  /** Retries inside the same run; dependents start only after the new attempt succeeds. */
  async retryStep(runId: string, stepId: string): Promise<WorkflowRunDetail> {
    const run = this.requireRun(runId)
    if (run.control === 'cancel') {
      throw new WorkflowServiceError(
        'workflow_invalid_state',
        'A cancelled run cannot retry steps.'
      )
    }
    const latest = latestAttemptsByStep(this.ctx.store.runs.listAttempts(runId)).get(stepId)
    if (!latest || !isRetryableAttempt(latest) || latest.retryRequestedAt) {
      throw new WorkflowServiceError(
        'workflow_invalid_state',
        'Only a failed or stopped step can be retried.'
      )
    }
    this.ctx.store.runs.updateAttempt(latest.id, { retryRequestedAt: new Date().toISOString() }, [
      latest.state
    ])
    this.ctx.store.runs.appendEvent({
      runId,
      kind: 'retry_requested',
      actor: 'user',
      stepId,
      attemptId: latest.id
    })
    await this.scheduler.reconcileRun(runId)
    return this.showRun(runId)
  }

  async stopStep(runId: string, stepId: string): Promise<WorkflowRunDetail> {
    this.requireRun(runId)
    const latest = latestAttemptsByStep(this.ctx.store.runs.listAttempts(runId)).get(stepId)
    if (
      !latest ||
      latest.kind !== 'agent' ||
      !isActiveAttempt(latest) ||
      latest.state === 'stopping'
    ) {
      throw new WorkflowServiceError(
        'workflow_invalid_state',
        'This step has no running agent to stop.'
      )
    }
    this.ctx.store.runs.updateAttempt(latest.id, { state: 'stopping' }, [latest.state])
    this.ctx.store.runs.appendEvent({
      runId,
      kind: 'step_stop_requested',
      actor: 'user',
      stepId,
      attemptId: latest.id
    })
    await this.scheduler.reconcileRun(runId)
    return this.showRun(runId)
  }

  async decide(
    runId: string,
    stepId: string,
    decision: WorkflowDecision,
    comment: string
  ): Promise<WorkflowRunDetail> {
    const run = this.requireRun(runId)
    if (run.control === 'cancel') {
      throw new WorkflowServiceError('workflow_invalid_state', 'This run was cancelled.')
    }
    recordDecision(this.ctx, run, stepId, decision, comment)
    await this.scheduler.reconcileRun(runId)
    return this.showRun(runId)
  }

  async reopenDecision(runId: string, stepId: string): Promise<WorkflowRunDetail> {
    const run = this.requireRun(runId)
    if (run.control === 'cancel') {
      throw new WorkflowServiceError('workflow_invalid_state', 'This run was cancelled.')
    }
    reopenDecision(this.ctx, run, stepId)
    await this.scheduler.reconcileRun(runId)
    return this.showRun(runId)
  }

  private async setControl(
    id: string,
    control: 'run' | 'pause' | 'cancel',
    eventKind: string,
    allowedStatuses: readonly WorkflowRunStatus[]
  ): Promise<WorkflowRunDetail> {
    const run = this.requireRun(id)
    if (run.control === control) {
      return this.showRun(id)
    }
    if (run.control === 'cancel' || !allowedStatuses.includes(run.status)) {
      throw new WorkflowServiceError(
        'workflow_invalid_state',
        `A run that is ${run.status} cannot be ${control === 'run' ? 'resumed' : control === 'pause' ? 'paused' : 'cancelled'}.`
      )
    }
    this.ctx.store.runs.setControl(id, control)
    this.ctx.store.runs.appendEvent({ runId: id, kind: eventKind, actor: 'user' })
    await this.scheduler.reconcileRun(id)
    return this.showRun(id)
  }

  private summarize(id: string): WorkflowRunSummary {
    const run = this.requireRun(id)
    const projection = projectWorkflowRun(
      run.snapshot,
      run.control,
      this.ctx.store.runs.listAttempts(id)
    )
    return {
      id: run.id,
      definitionId: run.definitionId,
      definitionName: run.definitionName,
      definitionRevision: run.definitionRevision,
      status: run.status,
      control: run.control,
      target: run.target,
      stepCount: run.snapshot.steps.length,
      succeededSteps: projection.steps.filter((step) => step.status === 'succeeded').length,
      failedSteps: projection.steps.filter((step) => step.status === 'failed').length,
      rerunOf: run.rerunOf,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      finishedAt: run.finishedAt
    }
  }

  private requireRun(id: string) {
    const run = this.ctx.store.runs.getRun(id)
    if (!run) {
      throw new WorkflowServiceError('workflow_run_not_found', `Workflow run ${id} was not found.`)
    }
    return run
  }

  /** Drafts may be incomplete, but a stored body must at least be structurally sound. */
  private assertStorable(body: WorkflowDefinitionBody): void {
    const structural = validateWorkflowDefinition(body).filter((issue) =>
      [
        'step_id_invalid',
        'step_id_duplicate',
        'param_id_invalid',
        'param_id_duplicate',
        'steps_too_many',
        'parameters_too_many',
        'name_required',
        'name_too_long'
      ].includes(issue.code)
    )
    if (structural.length > 0) {
      throw new WorkflowServiceError(
        'workflow_invalid_definition',
        summarizeWorkflowIssues(structural),
        {
          issues: structural
        }
      )
    }
  }
}
