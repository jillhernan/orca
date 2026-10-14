import {
  Ban,
  CheckCircle2,
  CircleDashed,
  CircleOff,
  CircleSlash,
  Clock,
  Hand,
  Pause,
  Square,
  XCircle
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import type {
  WorkflowRunStatus,
  WorkflowStepStatus
} from '../../../../shared/workflows/workflow-run-types'
import { runStatusLabel, stepStatusLabel } from './workflow-status-copy'

type AnyStatus = WorkflowRunStatus | WorkflowStepStatus

/** Shape plus text for every state, so status never depends on color alone. */
export function WorkflowStatusIcon({ status }: { status: AnyStatus }): React.JSX.Element {
  switch (status) {
    case 'running':
    case 'starting':
    case 'cancelling':
      return <LoadingSpinner className="size-3.5 text-muted-foreground" />
    case 'succeeded':
      return <CheckCircle2 aria-hidden="true" className="size-3.5 text-status-success" />
    case 'failed':
      return <XCircle aria-hidden="true" className="size-3.5 text-destructive" />
    case 'rejected':
      return <Ban aria-hidden="true" className="size-3.5 text-destructive" />
    case 'awaiting_decision':
      return <Hand aria-hidden="true" className="size-3.5 text-status-warning" />
    case 'paused':
      return <Pause aria-hidden="true" className="size-3.5 text-status-warning" />
    case 'stopping':
      return <Square aria-hidden="true" className="size-3.5 text-status-warning" />
    case 'blocked':
      return <CircleSlash aria-hidden="true" className="size-3.5 text-muted-foreground" />
    case 'cancelled':
      return <CircleOff aria-hidden="true" className="size-3.5 text-muted-foreground" />
    case 'ready':
      return <CircleDashed aria-hidden="true" className="size-3.5 text-muted-foreground" />
    case 'waiting':
      return <Clock aria-hidden="true" className="size-3.5 text-muted-foreground" />
  }
}

export function WorkflowRunStatusBadge({
  status
}: {
  status: WorkflowRunStatus
}): React.JSX.Element {
  return (
    <Badge variant="outline">
      <WorkflowStatusIcon status={status} />
      {runStatusLabel(status)}
    </Badge>
  )
}

export function WorkflowStepStatusBadge({
  status
}: {
  status: WorkflowStepStatus
}): React.JSX.Element {
  return (
    <Badge variant="outline">
      <WorkflowStatusIcon status={status} />
      {stepStatusLabel(status)}
    </Badge>
  )
}
