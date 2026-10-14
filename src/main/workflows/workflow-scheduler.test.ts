import { describe, expect, it } from 'vitest'
import {
  applySequentialDependencies,
  createEmptyWorkflowBody,
  type WorkflowDefinitionBody,
  type WorkflowStep
} from '../../shared/workflows/workflow-definition'
import { WorkflowDatabase } from './workflow-database'
import { FakeWorkflowOrchestration } from './workflow-orchestration-fake.test-support'
import { WorkflowScheduler } from './workflow-scheduler'
import { WorkflowService } from './workflow-service'

function step(id: string, overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    id,
    name: id,
    kind: 'agent',
    prompt: `Do ${id}`,
    dependsOn: [],
    inputs: [],
    workspaceMode: 'shared',
    ...overrides
  }
}

function sequential(ids: string[]): WorkflowDefinitionBody {
  return applySequentialDependencies({
    ...createEmptyWorkflowBody('Feature'),
    steps: ids.map((id) => step(id))
  })
}

function graph(steps: WorkflowStep[], maxConcurrency = 1): WorkflowDefinitionBody {
  return { ...createEmptyWorkflowBody('Graph'), dependencyMode: 'graph', maxConcurrency, steps }
}

function harness(options: { now?: () => number } = {}) {
  const store = new WorkflowDatabase(':memory:')
  const port = new FakeWorkflowOrchestration()
  const ctx = { store, port, maxPromptBytes: 60_000 }
  const scheduler = new WorkflowScheduler(ctx, options)
  // Ticks run only when a test asks, so assertions never race a timer.
  scheduler.dispose()
  const service = new WorkflowService(ctx, scheduler)
  const settle = async (): Promise<void> => {
    for (let index = 0; index < 3; index += 1) {
      await scheduler.settled()
      await scheduler.tick()
    }
  }
  let requests = 0
  const launch = async (
    body: WorkflowDefinitionBody,
    extra: { workspaceId?: string; requestId?: string; params?: Record<string, string> } = {}
  ) => {
    const definition = service.createDefinition({ kind: 'workflow', body })
    requests += 1
    const detail = await service.startRun({
      requestId: extra.requestId ?? `req-${requests}`,
      definitionId: definition.id,
      definitionRevision: definition.revision,
      snapshot: definition.body,
      params: extra.params ?? {},
      workspaceId: extra.workspaceId ?? 'ws-git'
    })
    await settle()
    return detail.run.id
  }
  const stepStatus = (runId: string) =>
    Object.fromEntries(service.showRun(runId).steps.map((view) => [view.stepId, view.status]))
  return { store, port, scheduler, service, settle, launch, stepStatus, ctx }
}

describe('WorkflowScheduler', () => {
  it('runs a sequential workflow and hands each result to the next step', async () => {
    const { port, launch, settle, service, stepStatus } = harness()
    const runId = await launch(sequential(['plan', 'build', 'docs']))
    expect(port.starts).toHaveLength(1)
    expect(stepStatus(runId)).toEqual({ plan: 'running', build: 'waiting', docs: 'waiting' })

    const plan = port.dispatchesForStep('plan')[0]!
    port.report(plan.id, 'succeeded', 'Plan: use a trie', ['docs/plan.md'])
    await settle()
    expect(port.starts).toHaveLength(2)
    const buildTask = port.tasks.get(port.starts[1]!.taskId)!
    expect(buildTask.spec).toContain('Plan: use a trie')
    expect(buildTask.spec).toContain('- docs/plan.md')
    expect(buildTask.deps).toEqual([plan.taskId])

    port.report(port.dispatchesForStep('build')[0]!.id, 'succeeded', 'Built')
    await settle()
    port.report(port.dispatchesForStep('docs')[0]!.id, 'succeeded', 'Documented')
    await settle()
    expect(service.showRun(runId).run.status).toBe('succeeded')
    expect(port.releases).toHaveLength(3)
  })

  it('creates one run and one dispatch for a repeated start and replayed reports', async () => {
    const { port, service, settle } = harness()
    const definition = service.createDefinition({ kind: 'workflow', body: sequential(['a', 'b']) })
    const input = {
      requestId: 'same-click',
      definitionId: definition.id,
      definitionRevision: definition.revision,
      snapshot: definition.body,
      params: {},
      workspaceId: 'ws-git'
    }
    const [first, second] = await Promise.all([service.startRun(input), service.startRun(input)])
    expect(second.run.id).toBe(first.run.id)
    await settle()
    await settle()
    expect(port.starts).toHaveLength(1)
    const a = port.dispatchesForStep('a')[0]!
    expect(port.report(a.id, 'succeeded', 'done')).toBe(true)
    expect(port.report(a.id, 'succeeded', 'replayed')).toBe(false)
    await settle()
    await settle()
    expect(port.starts).toHaveLength(2)
    expect(service.listRuns({}).runs).toHaveLength(1)
  })

  it('stops a failed chain and retries as a new attempt on the same task', async () => {
    const { port, launch, settle, service, stepStatus } = harness()
    const runId = await launch(sequential(['a', 'b', 'c']))
    port.report(port.dispatchesForStep('a')[0]!.id, 'succeeded', 'A done')
    await settle()
    const firstB = port.dispatchesForStep('b')[0]!
    port.report(firstB.id, 'failed', 'Tests failed')
    await settle()
    expect(stepStatus(runId)).toEqual({ a: 'succeeded', b: 'failed', c: 'blocked' })
    expect(service.showRun(runId).run.status).toBe('failed')
    expect(port.dispatchesForStep('c')).toHaveLength(0)

    await service.retryStep(runId, 'b')
    await settle()
    const retry = port.starts.at(-1)!
    expect(retry.retryOfDispatchId).toBe(firstB.id)
    expect(retry.taskId).toBe(firstB.taskId)
    expect(port.releases).toContain(firstB.id)
    // The old attempt's late report cannot finish the new one.
    expect(port.report(firstB.id, 'succeeded', 'late')).toBe(false)
    expect(stepStatus(runId).b).toBe('running')

    port.report(port.dispatchesForStep('b')[1]!.id, 'succeeded', 'Fixed')
    await settle()
    const b = service.showRun(runId).steps.find((view) => view.stepId === 'b')!
    expect(b.attempts.map((attempt) => [attempt.attemptNo, attempt.state])).toEqual([
      [1, 'failed'],
      [2, 'succeeded']
    ])
    expect(service.showRun(runId).steps[0]!.attempts).toHaveLength(1)
    expect(port.dispatchesForStep('c')).toHaveLength(1)
  })

  it('runs isolated branches in parallel and waits for code integration before the join', async () => {
    const { port, launch, settle, service, stepStatus } = harness()
    const runId = await launch(
      graph(
        [
          step('a'),
          step('b', { dependsOn: ['a'], workspaceMode: 'isolated' }),
          step('c', { dependsOn: ['a'], workspaceMode: 'isolated' }),
          step('merge', { kind: 'integration', dependsOn: ['b', 'c'], prompt: 'Merge b and c' }),
          step('d', {
            dependsOn: ['merge'],
            inputs: [{ stepId: 'merge', summary: true, artifacts: false }]
          })
        ],
        2
      )
    )
    port.report(port.dispatchesForStep('a')[0]!.id, 'succeeded', 'A')
    await settle()
    const branches = port.starts.slice(1)
    expect(branches.map((start) => start.isolated)).toEqual([true, true])
    expect(branches.every((start) => start.worktreeName?.includes('graph'))).toBe(true)

    port.report(port.dispatchesForStep('b')[0]!.id, 'succeeded', 'B', ['b.ts'])
    await settle()
    expect(stepStatus(runId).merge).toBe('waiting')
    port.report(port.dispatchesForStep('c')[0]!.id, 'succeeded', 'C', ['c.ts'])
    await settle()
    expect(stepStatus(runId)).toMatchObject({ merge: 'awaiting_decision', d: 'waiting' })
    const branchTarget = service.showRun(runId).steps.find((v) => v.stepId === 'b')!
      .attempts[0]!.target
    expect(branchTarget).toMatchObject({ isolated: true, path: expect.stringContaining('/repo-') })

    await service.decide(runId, 'merge', 'approved', 'Merged both branches')
    await settle()
    expect(stepStatus(runId).d).toBe('running')
    expect(port.tasks.get(port.starts.at(-1)!.taskId)!.spec).toContain('Merged both branches')
  })

  it('never runs two shared-workspace steps at once', async () => {
    const { port, launch, settle } = harness()
    await launch(
      graph([step('a'), step('b', { dependsOn: ['a'] }), step('c', { dependsOn: ['a'] })], 2)
    )
    port.report(port.dispatchesForStep('a')[0]!.id, 'succeeded', 'A')
    await settle()
    expect(port.starts).toHaveLength(2)
    expect(port.dispatchesForStep('c')).toHaveLength(0)
    port.report(port.dispatchesForStep('b')[0]!.id, 'succeeded', 'B')
    await settle()
    expect(port.starts).toHaveLength(3)
  })

  it('holds dependents on a rejected decision until the user reopens and approves', async () => {
    const { port, launch, settle, service, stepStatus } = harness()
    const runId = await launch(
      graph([
        step('a'),
        step('review', { kind: 'approval', dependsOn: ['a'], prompt: 'Ship the plan?' }),
        step('b', { dependsOn: ['review'] })
      ])
    )
    port.report(port.dispatchesForStep('a')[0]!.id, 'succeeded', 'Plan ready')
    await settle()
    expect(service.showRun(runId).run.status).toBe('awaiting_decision')

    await service.decide(runId, 'review', 'rejected', 'Needs tests')
    await settle()
    expect(stepStatus(runId)).toMatchObject({ review: 'rejected', b: 'blocked' })
    expect(service.showRun(runId).run.status).toBe('blocked')

    await service.reopenDecision(runId, 'review')
    await service.decide(runId, 'review', 'approved', 'Tests added')
    await settle()
    expect(stepStatus(runId).b).toBe('running')
    const decisions = service
      .showRun(runId)
      .events.filter((event) => event.kind === 'decision_recorded')
      .map((event) => [event.actor, event.payload?.decision, event.payload?.comment])
    expect(decisions).toEqual([
      ['user', 'rejected', 'Needs tests'],
      ['user', 'approved', 'Tests added']
    ])
  })

  it('records results while paused and starts nothing new until resumed', async () => {
    const { port, launch, settle, service, stepStatus } = harness()
    const runId = await launch(sequential(['a', 'b']))
    await service.pauseRun(runId)
    port.report(port.dispatchesForStep('a')[0]!.id, 'succeeded', 'A')
    await settle()
    expect(stepStatus(runId)).toEqual({ a: 'succeeded', b: 'ready' })
    expect(service.showRun(runId).run.status).toBe('paused')
    expect(port.starts).toHaveLength(1)

    await service.resumeRun(runId)
    await settle()
    await settle()
    expect(port.starts).toHaveLength(2)
  })

  it('stops only its own active dispatch on cancel and keeps reconciling an unconfirmed stop', async () => {
    let now = 0
    const { port, launch, settle, service, stepStatus } = harness({ now: () => now })
    port.stopOutcome = { kind: 'unknown', reason: 'Host unreachable' }
    const runId = await launch(sequential(['a', 'b']))
    const a = port.dispatchesForStep('a')[0]!
    await service.cancelRun(runId)
    await settle()
    expect(port.stops).toEqual([a.id])
    expect(service.showRun(runId).run.status).toBe('cancelling')
    expect(service.showRun(runId).steps[0]!.attempts[0]!.liveness).toBe('unverifiable')

    port.stopOutcome = { kind: 'stopped' }
    now += 31_000
    await settle()
    expect(port.stops).toEqual([a.id, a.id])
    expect(service.showRun(runId).run.status).toBe('cancelled')
    expect(stepStatus(runId)).toEqual({ a: 'cancelled', b: 'cancelled' })
  })

  it('stops an agent that was still launching as soon as its start returns', async () => {
    const { store, port, service, settle } = harness()
    port.holdStartsAfterDispatch = true
    const definition = service.createDefinition({ kind: 'workflow', body: sequential(['a', 'b']) })
    const { run } = await service.startRun({
      requestId: 'r',
      definitionId: definition.id,
      definitionRevision: 1,
      snapshot: definition.body,
      params: {},
      workspaceId: 'ws-git'
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await service.stopStep(run.id, 'a')
    // The Dispatch exists, but its agent has no terminal yet; a stop now would be refused.
    expect(port.stops).toEqual([])

    port.releaseHeldStart()
    await settle()
    const a = port.dispatchesForStep('a')[0]!
    expect(port.stops).toEqual([a.id])
    expect(store.runs.listAttempts(run.id)).toMatchObject([
      { stepId: 'a', state: 'stopped', dispatchId: a.id }
    ])
    expect(port.dispatchesForStep('b')).toHaveLength(0)
  })

  it('keeps a failed agent open until the run is cancelled, then releases it once', async () => {
    const { port, launch, settle, service } = harness()
    const runId = await launch(sequential(['a', 'b']))
    const a = port.dispatchesForStep('a')[0]!
    port.report(a.id, 'failed', 'Broke')
    await settle()
    expect(port.releases).toEqual([])

    await service.cancelRun(runId)
    await settle()
    await settle()
    expect(port.releases).toEqual([a.id])
    expect(port.stops).toEqual([])
    expect(port.dispatchesForStep('b')).toHaveLength(0)
  })

  it('reconciles after a restart without restarting live work', async () => {
    const { store, port, launch, ctx } = harness()
    const runId = await launch(sequential(['a', 'b']))
    const [attempt] = store.runs.listAttempts(runId)
    const a = port.dispatchesForStep('a')[0]!
    // The previous process died after starting the agent but before recording the Dispatch.
    store.runs.updateAttempt(attempt!.id, { state: 'starting', dispatchId: null })
    port.report(a.id, 'succeeded', 'Finished while Orca was closed')

    const restarted = new WorkflowScheduler(ctx)
    restarted.dispose()
    await restarted.tick()
    await restarted.settled()
    await restarted.tick()
    const after = store.runs.listAttempts(runId)
    expect(after.find((row) => row.stepId === 'a')).toMatchObject({
      state: 'succeeded',
      dispatchId: a.id
    })
    expect(port.dispatchesForStep('a')).toHaveLength(1)
    expect(port.dispatchesForStep('b')).toHaveLength(1)
  })

  it('reports an orphaned start instead of launching it again', async () => {
    const { store, port, scheduler, service, ctx } = harness()
    port.holdStarts = true
    const definition = service.createDefinition({ kind: 'workflow', body: sequential(['a']) })
    const { run } = await service.startRun({
      requestId: 'r',
      definitionId: definition.id,
      definitionRevision: 1,
      snapshot: definition.body,
      params: {},
      workspaceId: 'ws-git'
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(store.runs.listAttempts(run.id)[0]!.state).toBe('starting')
    void scheduler
    const restarted = new WorkflowScheduler(ctx)
    restarted.dispose()
    await restarted.tick()
    expect(store.runs.listAttempts(run.id)[0]).toMatchObject({ state: 'start_failed' })
    expect(port.starts).toHaveLength(1)
    port.releaseHeldStart()
  })

  it('refuses invalid launches before creating anything', async () => {
    const { port, service, store } = harness()
    const cyclic = graph([step('a', { dependsOn: ['b'] }), step('b', { dependsOn: ['a'] })])
    const definition = service.createDefinition({ kind: 'workflow', body: cyclic })
    await expect(
      service.startRun({
        requestId: 'x',
        definitionId: definition.id,
        definitionRevision: 1,
        snapshot: definition.body,
        params: {},
        workspaceId: 'ws-git'
      })
    ).rejects.toMatchObject({
      code: 'workflow_invalid_launch',
      data: {
        issues: [expect.objectContaining({ code: 'dependency_cycle', field: 'steps.0.dependsOn' })]
      }
    })
    const isolatedOnFolder = graph([step('a', { workspaceMode: 'isolated' })])
    const plan = await service.planLaunch({
      requestId: 'y',
      definitionId: 'wf',
      definitionRevision: 1,
      snapshot: isolatedOnFolder,
      params: {},
      workspaceId: 'ws-folder'
    })
    expect(plan.issues.map((issue) => [issue.code, issue.field])).toEqual([
      ['target_not_git', 'steps.0.workspaceMode']
    ])
    expect(store.runs.listRuns({ limit: 5 })).toEqual([])
    expect(port.starts).toEqual([])
    expect(port.runs.size).toBe(0)
  })

  it('pins each run to the definition revision it started from', async () => {
    const { service, settle } = harness()
    const definition = service.createDefinition({ kind: 'workflow', body: sequential(['a']) })
    const start = (requestId: string, revision: number, snapshot: WorkflowDefinitionBody) =>
      service.startRun({
        requestId,
        definitionId: definition.id,
        definitionRevision: revision,
        snapshot,
        params: {},
        workspaceId: 'ws-git'
      })
    const first = await start('r1', 1, definition.body)
    const edited = service.updateDefinition(
      definition.id,
      { ...definition.body, steps: [{ ...definition.body.steps[0]!, prompt: 'Changed' }] },
      1
    )
    const second = await start('r2', edited.revision, edited.body)
    await settle()
    expect(service.showRun(first.run.id).run.snapshot.steps[0]!.prompt).toBe('Do a')
    expect(service.showRun(second.run.id).run).toMatchObject({ definitionRevision: 2 })
    expect(service.showRun(second.run.id).run.snapshot.steps[0]!.prompt).toBe('Changed')
  })
})
