import {
  activeAgentUsage,
  isActiveAttempt,
  isRetryableAttempt,
  latestAttemptsByStep,
  projectWorkflowRun
} from '../../shared/workflows/workflow-run-projection'
import {
  WORKFLOW_TERMINAL_RUN_STATUSES,
  type WorkflowAttempt,
  type WorkflowRun
} from '../../shared/workflows/workflow-run-types'
import type { WorkflowStep } from '../../shared/workflows/workflow-definition'
import { dispatchAgentAttempt, type WorkflowDispatchContext } from './workflow-agent-dispatch'
import { reconcileAgentAttempt, type WorkflowReconcileContext } from './workflow-attempt-reconcile'
import { closeOpenDecisions, openDecisionAttempt } from './workflow-decision-steps'

const ACTIVE_INTERVAL_MS = 2_000
const IDLE_INTERVAL_MS = 60_000

/**
 * Drives workflow runs on the host that executes them. Each tick reads orchestration's current
 * Task/Dispatch state and the run's control intent, then starts whatever is ready. It is
 * level-triggered, so replayed events, double clicks and restarts converge on one dispatch per
 * attempt instead of reacting to each signal.
 */
export class WorkflowScheduler {
  private readonly inflightStarts = new Set<string>()
  private readonly stopsInFlight = new Set<string>()
  private readonly lastProbe = new Map<string, number>()
  private readonly pendingStarts = new Set<Promise<void>>()
  private readonly runLocks = new Map<string, Promise<void>>()
  private readonly releasedDispatches = new Set<string>()
  private readonly ctx: WorkflowReconcileContext
  private timer: ReturnType<typeof setTimeout> | null = null
  private ticking: Promise<void> | null = null
  private tickAgain = false
  private disposed = false

  constructor(
    dispatch: WorkflowDispatchContext,
    private readonly options: { now?: () => number; onRunChanged?: (runId: string) => void } = {}
  ) {
    this.ctx = {
      ...dispatch,
      inflightStarts: this.inflightStarts,
      stopsInFlight: this.stopsInFlight,
      isDue: (key, intervalMs) => this.isDue(key, intervalMs)
    }
  }

  start(): void {
    this.schedule(0)
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /** Re-evaluates soon; coalesces with a tick already in progress. */
  kick(): void {
    if (this.ticking) {
      this.tickAgain = true
      return
    }
    this.schedule(0)
  }

  async tick(): Promise<void> {
    if (this.ticking) {
      this.tickAgain = true
      return this.ticking
    }
    let openRuns = 0
    this.ticking = (async () => {
      const runs = this.ctx.store.runs.listOpenRuns()
      openRuns = runs.length
      for (const run of runs) {
        try {
          await this.reconcileRun(run.id)
        } catch (error) {
          console.warn('[workflows] reconcile failed', run.id, error)
        }
      }
      this.pruneProbes(runs)
    })().finally(() => {
      this.ticking = null
      const again = this.tickAgain
      this.tickAgain = false
      this.schedule(again ? 0 : openRuns > 0 ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS)
    })
    return this.ticking
  }

  /** Test seam: resolves once every agent start launched so far has finished. */
  async settled(): Promise<void> {
    while (this.pendingStarts.size > 0) {
      await Promise.all(this.pendingStarts)
    }
  }

  /** Serialized per run, so two reconciles never both count free slots and overfill them. */
  reconcileRun(runId: string): Promise<void> {
    const previous = this.runLocks.get(runId) ?? Promise.resolve()
    const next = previous.then(() => this.reconcileRunLocked(runId))
    const tail = next.catch(() => undefined)
    this.runLocks.set(runId, tail)
    void tail.finally(() => {
      if (this.runLocks.get(runId) === tail) {
        this.runLocks.delete(runId)
      }
    })
    return next
  }

  private async reconcileRunLocked(runId: string): Promise<void> {
    const { store } = this.ctx
    const initial = store.runs.getRun(runId)
    if (!initial) {
      return
    }
    const before = initial.updatedAt
    const observed = store.runs.listAttempts(runId)
    for (const attempt of observed) {
      if (isActiveAttempt(attempt)) {
        await reconcileAgentAttempt(this.ctx, initial, attempt, observed)
      }
    }
    // Control may have changed while probes were awaited.
    const run = store.runs.getRun(runId) ?? initial
    let attempts = store.runs.listAttempts(runId)
    if (run.control === 'cancel') {
      closeOpenDecisions(this.ctx, run, attempts)
      this.stopActiveAttempts(run, attempts)
      this.releaseFailedWorkers(attempts)
      attempts = store.runs.listAttempts(runId)
    } else if (run.control === 'run') {
      this.startReadySteps(run, attempts)
      attempts = store.runs.listAttempts(runId)
    }
    const projection = projectWorkflowRun(run.snapshot, run.control, attempts)
    store.runs.setStatus(
      runId,
      projection.status,
      WORKFLOW_TERMINAL_RUN_STATUSES.includes(projection.status)
    )
    if (store.runs.getRun(runId)?.updatedAt !== before) {
      this.options.onRunChanged?.(runId)
    }
  }

  private startReadySteps(run: WorkflowRun, attempts: readonly WorkflowAttempt[]): void {
    const projection = projectWorkflowRun(run.snapshot, run.control, attempts)
    const usage = activeAgentUsage(attempts)
    let active = usage.active
    let sharedBusy = usage.sharedWorkspaceBusy
    const latest = latestAttemptsByStep(attempts)
    for (const stepId of projection.readyStepIds) {
      const step = run.snapshot.steps.find((candidate) => candidate.id === stepId)
      if (!step) {
        continue
      }
      if (step.kind !== 'agent') {
        openDecisionAttempt(this.ctx, run, step, attempts)
        continue
      }
      // Two steps never write one directory at once: shared-workspace steps take turns.
      const shared = !run.target.isGit || step.workspaceMode !== 'isolated'
      if (active >= run.maxConcurrency || (shared && sharedBusy)) {
        continue
      }
      const previous = latest.get(stepId)
      const retryOf =
        previous && isRetryableAttempt(previous) && previous.retryRequestedAt ? previous : null
      const attempt = this.ctx.store.runs.claimAttempt({
        runId: run.id,
        stepId,
        kind: 'agent',
        state: 'claimed',
        input: null,
        taskId: retryOf?.taskId ?? null,
        retryOfDispatchId: retryOf?.dispatchId ?? null
      })
      if (!attempt) {
        continue
      }
      if (retryOf?.dispatchId) {
        // The retry supersedes the failed agent; closing it keeps two agents out of one folder.
        void this.ctx.port.releaseWorker(retryOf.dispatchId)
      }
      active += 1
      sharedBusy ||= shared
      this.launch(run, step, attempt, retryOf)
    }
  }

  private launch(
    run: WorkflowRun,
    step: WorkflowStep,
    attempt: WorkflowAttempt,
    previous: WorkflowAttempt | null
  ): void {
    this.inflightStarts.add(attempt.id)
    const started: Promise<void> = dispatchAgentAttempt(this.ctx, run, step, attempt, previous)
      .catch((error: unknown) => {
        console.warn('[workflows] start failed', attempt.id, error)
      })
      .finally(() => {
        this.inflightStarts.delete(attempt.id)
        this.pendingStarts.delete(started)
        this.kick()
      })
    this.pendingStarts.add(started)
  }

  private stopActiveAttempts(run: WorkflowRun, attempts: readonly WorkflowAttempt[]): void {
    for (const attempt of attempts) {
      if (
        attempt.kind === 'agent' &&
        ['claimed', 'starting', 'running'].includes(attempt.state) &&
        this.ctx.store.runs.updateAttempt(attempt.id, { state: 'stopping' }, [attempt.state])
      ) {
        this.ctx.store.runs.appendEvent({
          runId: run.id,
          kind: 'step_stop_requested',
          actor: 'system',
          stepId: attempt.stepId,
          attemptId: attempt.id
        })
      }
    }
  }

  /** A failed agent stays open for inspection until a retry supersedes it or the run is cancelled. */
  private releaseFailedWorkers(attempts: readonly WorkflowAttempt[]): void {
    for (const attempt of attempts) {
      const dispatchId = attempt.dispatchId
      if (attempt.state === 'failed' && dispatchId && !this.releasedDispatches.has(dispatchId)) {
        this.releasedDispatches.add(dispatchId)
        void this.ctx.port.releaseWorker(dispatchId)
      }
    }
  }

  private isDue(key: string, intervalMs: number): boolean {
    const now = this.options.now?.() ?? Date.now()
    const last = this.lastProbe.get(key)
    if (last !== undefined && now - last < intervalMs) {
      return false
    }
    this.lastProbe.set(key, now)
    return true
  }

  private pruneProbes(runs: readonly WorkflowRun[]): void {
    if (this.lastProbe.size < 200) {
      return
    }
    const live = new Set(
      runs.flatMap((run) =>
        this.ctx.store.runs
          .listAttempts(run.id)
          .filter(isActiveAttempt)
          .map((a) => a.id)
      )
    )
    for (const key of this.lastProbe.keys()) {
      if (!live.has(key.slice(key.indexOf(':') + 1))) {
        this.lastProbe.delete(key)
      }
    }
  }

  private schedule(delayMs: number): void {
    if (this.disposed) {
      return
    }
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.timer = setTimeout(() => {
      this.timer = null
      void this.tick()
    }, delayMs)
    this.timer.unref?.()
  }
}
