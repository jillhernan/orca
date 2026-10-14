import { translate } from '@/i18n/i18n'
import type {
  WorkflowRunDetail,
  WorkflowRunEvent
} from '../../../../shared/workflows/workflow-run-types'

function eventLabel(event: WorkflowRunEvent): string {
  switch (event.kind) {
    case 'run_started':
      return translate('auto.components.workflows.events.runStarted', 'Run started')
    case 'run_paused':
      return translate('auto.components.workflows.events.paused', 'Paused')
    case 'run_resumed':
      return translate('auto.components.workflows.events.resumed', 'Resumed')
    case 'run_cancel_requested':
      return translate('auto.components.workflows.events.cancelRequested', 'Cancel requested')
    case 'step_dispatching':
      return translate('auto.components.workflows.events.dispatching', 'Starting agent')
    case 'step_started':
      return translate('auto.components.workflows.events.started', 'Agent took the task')
    case 'step_adopted':
      return translate('auto.components.workflows.events.adopted', 'Reattached after restart')
    case 'step_succeeded':
      return translate('auto.components.workflows.events.succeeded', 'Step succeeded')
    case 'step_failed':
      return translate('auto.components.workflows.events.failed', 'Step failed')
    case 'step_start_failed':
      return translate('auto.components.workflows.events.startFailed', 'Agent did not start')
    case 'step_stop_requested':
      return translate('auto.components.workflows.events.stopRequested', 'Stop requested')
    case 'step_stopped':
      return translate('auto.components.workflows.events.stopped', 'Stopped')
    case 'retry_requested':
      return translate('auto.components.workflows.events.retry', 'Retry requested')
    case 'decision_requested':
      return translate(
        'auto.components.workflows.events.decisionRequested',
        'Waiting for a decision'
      )
    case 'decision_recorded':
      return event.payload?.decision === 'approved'
        ? translate('auto.components.workflows.events.approved', 'Approved')
        : translate('auto.components.workflows.events.rejected', 'Rejected')
    case 'decision_reopened':
      return translate('auto.components.workflows.events.reopened', 'Decision reopened')
    case 'decision_cancelled':
      return translate(
        'auto.components.workflows.events.decisionCancelled',
        'Decision closed by cancel'
      )
    default:
      return event.kind
  }
}

function eventDetail(event: WorkflowRunEvent): string | null {
  const payload = event.payload ?? {}
  const text = [payload.comment, payload.reason, payload.failure].find(
    (value): value is string => typeof value === 'string' && value.length > 0
  )
  return text ?? null
}

/** The run's own audit trail: who decided what and when the host changed a step. */
export function WorkflowRunEventLog({ detail }: { detail: WorkflowRunDetail }): React.JSX.Element {
  const stepName = (id: string | null): string | null =>
    id ? (detail.run.snapshot.steps.find((step) => step.id === id)?.name ?? id) : null
  return (
    <details className="mt-6">
      <summary className="cursor-pointer text-sm font-medium">
        {translate('auto.components.workflows.events.title', 'Activity log ({{value0}})', {
          value0: detail.events.length
        })}
      </summary>
      <ol className="mt-2 space-y-1">
        {detail.events.toReversed().map((event) => {
          const name = stepName(event.stepId)
          const extra = eventDetail(event)
          return (
            <li key={event.seq} className="grid grid-cols-[9rem_1fr] gap-3 text-xs">
              <time className="text-muted-foreground tabular-nums" dateTime={event.createdAt}>
                {new Date(event.createdAt).toLocaleString()}
              </time>
              <span className="min-w-0">
                <span className="font-medium">{eventLabel(event)}</span>
                {name ? <span className="text-muted-foreground"> · {name}</span> : null}
                <span className="text-muted-foreground">
                  {' · '}
                  {event.actor === 'user'
                    ? translate('auto.components.workflows.events.byYou', 'by you')
                    : translate('auto.components.workflows.events.byOrca', 'by Orca')}
                </span>
                {extra ? (
                  <span className="block whitespace-pre-wrap text-muted-foreground">{extra}</span>
                ) : null}
              </span>
            </li>
          )
        })}
      </ol>
    </details>
  )
}
