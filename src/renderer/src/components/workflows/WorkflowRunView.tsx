import { useMemo, useState } from 'react'
import { AlertTriangle, Ban, Pause, Play, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { translate } from '@/i18n/i18n'
import { formatUiRelativeTimeFromDate } from '@/i18n/relative-time-format'
import { focusRendererTerminalHandle } from '@/components/terminal-pane/terminal-handle-links'
import { focusRuntimeOrchestrationTask } from '@/components/terminal-pane/terminal-orchestration-task-links'
import { WORKFLOW_SCHEMA_VERSION } from '../../../../shared/workflows/workflow-definition'
import {
  WORKFLOW_TERMINAL_RUN_STATUSES,
  type WorkflowRunDetail
} from '../../../../shared/workflows/workflow-run-types'
import {
  actOnWorkflowStep,
  controlWorkflowRun,
  decideWorkflowStep,
  workflowErrorMessage,
  type WorkflowRunControlAction
} from './workflow-client'
import { useWorkflowHostOptions, workflowHostFromKey } from './workflow-hosts'
import { useWorkflowRun } from './use-workflow-run'
import { WorkflowRunStatusBadge, WorkflowStepStatusBadge } from './WorkflowStatusBadge'
import { WorkflowGraphView } from './WorkflowGraphView'
import { WorkflowRunStepPanel, type WorkflowStepPanelAction } from './WorkflowRunStepPanel'
import { WorkflowRunEventLog } from './WorkflowRunEventLog'
import { WorkflowLaunchDialog } from './WorkflowLaunchDialog'

export function WorkflowRunView({
  hostKey,
  runId,
  onOpenRun
}: {
  hostKey: string
  runId: string
  onOpenRun: (hostKey: string, runId: string) => void
}): React.JSX.Element {
  const { detail, unreachable, notFound, apply } = useWorkflowRun(hostKey, runId)
  const hosts = useWorkflowHostOptions()
  const [selectedStep, setSelectedStep] = useState<string | null>(null)
  const [layout, setLayout] = useState('list')
  const [busy, setBusy] = useState(false)
  const [rerunOpen, setRerunOpen] = useState(false)
  const target = workflowHostFromKey(hostKey)
  const hostLabel = hosts.find((host) => host.key === hostKey)?.label ?? hostKey
  const statuses = useMemo(
    () => Object.fromEntries((detail?.steps ?? []).map((view) => [view.stepId, view.status])),
    [detail]
  )

  if (notFound) {
    return (
      <p className="px-5 text-sm text-muted-foreground">
        {translate(
          'auto.components.workflows.run.notFound',
          'This run no longer exists on {{value0}}.',
          { value0: hostLabel }
        )}
      </p>
    )
  }
  if (!detail) {
    return (
      <div className="flex items-center gap-2 px-5 py-8 text-sm text-muted-foreground">
        {unreachable ? (
          <>
            <AlertTriangle className="size-4 text-status-warning" />
            {translate(
              'auto.components.workflows.run.unreachableInitial',
              'Cannot reach {{value0}}: {{value1}}',
              {
                value0: hostLabel,
                value1: unreachable.message
              }
            )}
          </>
        ) : (
          <>
            <LoadingSpinner className="size-4" />
            {translate('auto.components.workflows.run.loading', 'Loading run…')}
          </>
        )}
      </div>
    )
  }

  const { run } = detail
  const terminal = WORKFLOW_TERMINAL_RUN_STATUSES.includes(run.status)
  const succeeded = detail.steps.filter((view) => view.status === 'succeeded').length
  const selectedId =
    selectedStep ??
    detail.steps.find((view) => view.status !== 'succeeded')?.stepId ??
    detail.steps[0]?.stepId
  const selectedView = detail.steps.find((view) => view.stepId === selectedId)
  const selected = run.snapshot.steps.find((step) => step.id === selectedId)

  const act = async (work: () => Promise<WorkflowRunDetail>): Promise<void> => {
    setBusy(true)
    try {
      apply(await work())
    } catch (error) {
      toast.error(workflowErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  const control = (action: WorkflowRunControlAction) =>
    act(() => controlWorkflowRun(target, run.id, action))
  const stepAction = (action: WorkflowStepPanelAction, stepId: string): void => {
    if (action === 'terminal') {
      const taskId = detail.steps.find((view) => view.stepId === stepId)?.attempts.at(-1)?.taskId
      const environmentId = target.kind === 'environment' ? target.environmentId : null
      if (taskId) {
        void focusRuntimeOrchestrationTask(taskId, environmentId, (handle) =>
          focusRendererTerminalHandle(handle, environmentId)
        ).catch((error: unknown) => toast.error(workflowErrorMessage(error)))
      }
      return
    }
    void act(() => actOnWorkflowStep(target, run.id, stepId, action))
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-3 px-3 pb-3 md:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 truncate text-base font-semibold">{run.definitionName}</h2>
          <WorkflowRunStatusBadge status={run.status} />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {run.control === 'run' &&
            (run.status === 'running' || run.status === 'awaiting_decision') ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || Boolean(unreachable)}
                onClick={() => void control('pause')}
              >
                <Pause />
                {translate('auto.components.workflows.run.pause', 'Pause')}
              </Button>
            ) : null}
            {run.control === 'pause' ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || Boolean(unreachable)}
                onClick={() => void control('resume')}
              >
                <Play />
                {translate('auto.components.workflows.run.resume', 'Resume')}
              </Button>
            ) : null}
            {run.control !== 'cancel' && run.status !== 'succeeded' ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || Boolean(unreachable)}
                onClick={() => void control('cancel')}
              >
                <Ban />
                {translate('auto.components.workflows.run.cancel', 'Cancel run')}
              </Button>
            ) : null}
            {terminal ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setRerunOpen(true)}>
                <RotateCcw />
                {translate('auto.components.workflows.run.rerun', 'Run again')}
              </Button>
            ) : null}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.workflows.run.meta',
            'Revision {{value0}} · {{value1}} · {{value2}} · started {{value3}}',
            {
              value0: run.definitionRevision,
              value1: hostLabel,
              value2: run.target.workspaceLabel,
              value3: formatUiRelativeTimeFromDate(run.createdAt)
            }
          )}
          {run.rerunOf
            ? ` · ${translate('auto.components.workflows.run.rerunOf', 're-run of an earlier run')}`
            : ''}
        </p>
        {run.control === 'pause' ? (
          <p className="text-xs text-status-warning">
            {translate(
              'auto.components.workflows.run.pausedHelp',
              'Paused: no new steps start. Steps already running keep going and their results are recorded.'
            )}
          </p>
        ) : null}
        {run.status === 'cancelling' ? (
          <p className="text-xs text-status-warning">
            {translate(
              'auto.components.workflows.run.cancellingHelp',
              'Stopping the agents this run started. A stop the host cannot confirm stays listed until it can be verified.'
            )}
          </p>
        ) : null}
        {unreachable ? (
          <p role="status" className="flex items-center gap-2 text-xs text-status-warning">
            <AlertTriangle className="size-3.5" />
            {translate(
              'auto.components.workflows.run.unreachable',
              '{{value0}} is not responding. The state below is the last one it reported and cannot be verified now; the run keeps going on the host.',
              {
                value0: hostLabel
              }
            )}
          </p>
        ) : null}
        <div className="flex items-center gap-3">
          <Progress
            value={(succeeded / Math.max(1, detail.steps.length)) * 100}
            className="max-w-md"
          />
          <span className="text-xs text-muted-foreground tabular-nums">
            {translate(
              'auto.components.workflows.run.progress',
              '{{value0}} of {{value1}} steps done',
              {
                value0: succeeded,
                value1: detail.steps.length
              }
            )}
          </span>
        </div>
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-3 pb-8 md:px-5">
        <Tabs value={layout} onValueChange={setLayout}>
          <TabsList>
            <TabsTrigger value="list">
              {translate('auto.components.workflows.run.listView', 'Steps')}
            </TabsTrigger>
            <TabsTrigger value="graph">
              {translate('auto.components.workflows.run.graphView', 'Graph')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="grid gap-4 pt-3 lg:grid-cols-[minmax(16rem,24rem)_1fr]">
          {layout === 'graph' ? (
            <div className="lg:col-span-2">
              <WorkflowGraphView
                body={run.snapshot}
                selectedIndex={Math.max(
                  0,
                  run.snapshot.steps.findIndex((step) => step.id === selectedId)
                )}
                statuses={statuses}
                onSelect={(index) => setSelectedStep(run.snapshot.steps[index]?.id ?? null)}
              />
            </div>
          ) : null}
          <ol className={layout === 'graph' ? 'hidden' : 'space-y-1.5'}>
            {detail.steps.map((view, index) => {
              const step = run.snapshot.steps.find((candidate) => candidate.id === view.stepId)
              const active = view.stepId === selectedId
              return (
                <li key={view.stepId}>
                  <button
                    type="button"
                    data-current={active ? 'true' : undefined}
                    aria-current={active ? 'step' : undefined}
                    onClick={() => setSelectedStep(view.stepId)}
                    className={
                      active
                        ? 'flex w-full items-center gap-2 rounded-md border border-ring bg-accent px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                        : 'flex w-full items-center gap-2 rounded-md border border-border px-2.5 py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                    }
                  >
                    <span className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {step?.name ?? view.stepId}
                    </span>
                    {view.attempts.length > 1 ? (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {translate(
                          'auto.components.workflows.run.attempts',
                          '{{value0}} attempts',
                          { value0: view.attempts.length }
                        )}
                      </span>
                    ) : null}
                    <WorkflowStepStatusBadge status={view.status} />
                  </button>
                </li>
              )
            })}
          </ol>
          {selected && selectedView ? (
            <div className={layout === 'graph' ? 'lg:col-span-2' : undefined}>
              <WorkflowRunStepPanel
                hostKey={hostKey}
                detail={detail}
                view={selectedView}
                step={selected}
                busy={busy || Boolean(unreachable)}
                onAction={stepAction}
                onDecide={(stepId, decision, comment) =>
                  void act(() => decideWorkflowStep(target, run.id, stepId, decision, comment))
                }
              />
            </div>
          ) : null}
        </div>
        <WorkflowRunEventLog detail={detail} />
      </div>
      {rerunOpen ? (
        <WorkflowLaunchDialog
          definition={{
            id: run.definitionId,
            kind: 'workflow',
            revision: run.definitionRevision,
            schemaVersion: WORKFLOW_SCHEMA_VERSION,
            body: run.snapshot,
            createdAt: run.createdAt,
            updatedAt: run.updatedAt
          }}
          initialParamsOverride={run.params}
          initialHostKey={hostKey}
          rerunOf={run.id}
          onOpenChange={(open) => !open && setRerunOpen(false)}
          onStarted={(nextHostKey, nextRunId) => {
            setRerunOpen(false)
            onOpenRun(nextHostKey, nextRunId)
          }}
        />
      ) : null}
    </div>
  )
}
