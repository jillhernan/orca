import { RotateCw, Square, SquareTerminal, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { getAgentLabel } from '@/lib/agent-catalog'
import { formatUiRelativeTimeFromDate } from '@/i18n/relative-time-format'
import { formatNativeChatDuration } from '../../../../shared/native-chat-turn-status'
import { isTuiAgent } from '../../../../shared/tui-agent-config'
import type { WorkflowStep } from '../../../../shared/workflows/workflow-definition'
import type {
  WorkflowAttempt,
  WorkflowRunDetail,
  WorkflowStepView
} from '../../../../shared/workflows/workflow-run-types'
import { WorkflowStepStatusBadge } from './WorkflowStatusBadge'
import { WorkflowArtifactList } from './WorkflowArtifactList'
import { WorkflowDecisionPanel } from './WorkflowDecisionPanel'
import { attemptStateLabel, livenessLabel } from './workflow-status-copy'

export type WorkflowStepPanelAction = 'retry' | 'stop' | 'reopen' | 'terminal'

function duration(attempt: WorkflowAttempt): string | null {
  if (!attempt.startedAt) {
    return null
  }
  const end = attempt.finishedAt ? Date.parse(attempt.finishedAt) : Date.now()
  return formatNativeChatDuration((end - Date.parse(attempt.startedAt)) / 1000)
}

function AttemptCard({
  hostKey,
  attempt
}: {
  hostKey: string
  attempt: WorkflowAttempt
}): React.JSX.Element {
  const elapsed = duration(attempt)
  const agent = attempt.input?.agent
  return (
    <li className="space-y-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          {translate('auto.components.workflows.attempt.title', 'Attempt {{value0}}', {
            value0: attempt.attemptNo
          })}
        </span>
        <span>{attemptStateLabel(attempt.state)}</span>
        {agent ? <span>{isTuiAgent(agent) ? getAgentLabel(agent) : agent}</span> : null}
        {attempt.startedAt ? (
          <span>
            {translate('auto.components.workflows.attempt.started', 'Started {{value0}}', {
              value0: formatUiRelativeTimeFromDate(attempt.startedAt)
            })}
          </span>
        ) : null}
        {elapsed ? <span>{elapsed}</span> : null}
        {attempt.liveness && (attempt.state === 'running' || attempt.state === 'stop_unknown') ? (
          <span>{livenessLabel(attempt.liveness)}</span>
        ) : null}
      </div>
      {attempt.failure ? (
        <p
          className={
            attempt.state === 'running' ? 'text-xs text-status-warning' : 'text-xs text-destructive'
          }
        >
          {attempt.failure}
        </p>
      ) : null}
      {attempt.result?.summary ? (
        <details className="group">
          <summary className="cursor-pointer text-xs font-medium">
            {translate('auto.components.workflows.attempt.result', 'Result summary')}
          </summary>
          <p className="mt-1 max-h-72 overflow-auto text-sm whitespace-pre-wrap scrollbar-sleek">
            {attempt.result.summary}
          </p>
        </details>
      ) : null}
      <WorkflowArtifactList hostKey={hostKey} attempt={attempt} />
      {attempt.input ? (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">
            {translate(
              'auto.components.workflows.attempt.prompt',
              'Prompt sent ({{value0}} bytes)',
              {
                value0: attempt.input.byteLength
              }
            )}
          </summary>
          {attempt.input.truncations.length > 0 ? (
            <p className="mt-1 text-xs text-status-warning">
              {translate(
                'auto.components.workflows.attempt.trimmed',
                'Some earlier results were trimmed to fit the prompt limit; the prompt marks each cut.'
              )}
            </p>
          ) : null}
          <pre className="scrollbar-sleek mt-1 max-h-72 overflow-auto rounded bg-muted p-2 font-mono text-xs whitespace-pre-wrap">
            {attempt.input.prompt}
          </pre>
        </details>
      ) : null}
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">
          {translate('auto.components.workflows.attempt.diagnostics', 'Orchestration details')}
        </summary>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-xs text-muted-foreground">
          <dt>{translate('auto.components.workflows.attempt.diagTask', 'Task')}</dt>
          <dd className="truncate">{attempt.taskId ?? '—'}</dd>
          <dt>{translate('auto.components.workflows.attempt.diagDispatch', 'Dispatch')}</dt>
          <dd className="truncate">{attempt.dispatchId ?? '—'}</dd>
          {attempt.retryOfDispatchId ? (
            <>
              <dt>{translate('auto.components.workflows.attempt.diagRetryOf', 'Retry of')}</dt>
              <dd className="truncate">{attempt.retryOfDispatchId}</dd>
            </>
          ) : null}
          {attempt.gateId ? (
            <>
              <dt>{translate('auto.components.workflows.attempt.diagGate', 'Gate')}</dt>
              <dd className="truncate">{attempt.gateId}</dd>
            </>
          ) : null}
          {attempt.target ? (
            <>
              <dt>{translate('auto.components.workflows.attempt.diagWhere', 'Where')}</dt>
              <dd className="truncate">{attempt.target.path ?? attempt.target.workspaceLabel}</dd>
            </>
          ) : null}
        </dl>
      </details>
    </li>
  )
}

export function WorkflowRunStepPanel({
  hostKey,
  detail,
  view,
  step,
  busy,
  onAction,
  onDecide
}: {
  hostKey: string
  detail: WorkflowRunDetail
  view: WorkflowStepView
  step: WorkflowStep
  busy: boolean
  onAction: (action: WorkflowStepPanelAction, stepId: string) => void
  onDecide: (stepId: string, decision: 'approved' | 'rejected', comment: string) => void
}): React.JSX.Element {
  const latest = view.attempts.at(-1)
  const cancelled = detail.run.control === 'cancel'
  const blockers = view.blockedBy.map(
    (id) => detail.run.snapshot.steps.find((candidate) => candidate.id === id)?.name ?? id
  )
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{step.name || step.id}</h3>
        <WorkflowStepStatusBadge status={view.status} />
      </div>
      {blockers.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.workflows.stepPanel.blockedBy',
            'Waiting on {{value0}}, which did not succeed.',
            {
              value0: blockers.join(', ')
            }
          )}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {latest?.taskId &&
        (view.status === 'running' || view.status === 'starting' || view.status === 'stopping') ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onAction('terminal', step.id)}
          >
            <SquareTerminal />
            {translate('auto.components.workflows.stepPanel.openTerminal', 'Open agent terminal')}
          </Button>
        ) : null}
        {step.kind === 'agent' &&
        (view.status === 'running' || view.status === 'starting') &&
        !cancelled ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => onAction('stop', step.id)}
          >
            <Square />
            {translate('auto.components.workflows.stepPanel.stop', 'Stop this attempt')}
          </Button>
        ) : null}
        {view.status === 'failed' && !cancelled ? (
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => onAction('retry', step.id)}
          >
            <RotateCw />
            {translate('auto.components.workflows.stepPanel.retry', 'Retry step')}
          </Button>
        ) : null}
        {view.status === 'rejected' && !cancelled ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => onAction('reopen', step.id)}
          >
            <Undo2 />
            {translate('auto.components.workflows.stepPanel.reopen', 'Decide again')}
          </Button>
        ) : null}
      </div>
      {view.status === 'failed' && step.kind === 'agent' && !cancelled ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.workflows.stepPanel.retryHelp',
            'A retry is a new attempt with the same prompt and inputs; finished steps keep their results. The workspace may still hold partial changes from the failed attempt, and Orca does not reset it. To change parameters or the definition, start a new run instead.'
          )}
        </p>
      ) : null}
      {view.status === 'awaiting_decision' && !cancelled ? (
        <WorkflowDecisionPanel
          hostKey={hostKey}
          detail={detail}
          step={step}
          busy={busy}
          onDecide={(decision, comment) => onDecide(step.id, decision, comment)}
        />
      ) : null}
      {view.attempts.length > 0 ? (
        <ol className="space-y-2">
          {view.attempts.toReversed().map((attempt) => (
            <AttemptCard key={attempt.id} hostKey={hostKey} attempt={attempt} />
          ))}
        </ol>
      ) : (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.workflows.stepPanel.notStarted',
            'This step has not started yet.'
          )}
        </p>
      )}
    </div>
  )
}
