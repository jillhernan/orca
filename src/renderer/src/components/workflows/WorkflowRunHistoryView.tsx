import { useCallback, useEffect, useMemo, useState } from 'react'
import { RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { translate } from '@/i18n/i18n'
import { formatUiRelativeTimeFromDate } from '@/i18n/relative-time-format'
import type {
  WorkflowRunStatus,
  WorkflowRunSummary
} from '../../../../shared/workflows/workflow-run-types'
import { listWorkflowRuns, workflowErrorMessage } from './workflow-client'
import { describeHostAvailability, useWorkflowHostOptions } from './workflow-hosts'
import { runStatusLabel } from './workflow-status-copy'
import { WorkflowRunStatusBadge } from './WorkflowStatusBadge'
import { workflowHistoryStepsLabel } from './workflow-count-copy'

const ALL = '__all__'
const STATUSES: WorkflowRunStatus[] = [
  'running',
  'paused',
  'awaiting_decision',
  'succeeded',
  'failed',
  'blocked',
  'cancelling',
  'cancelled'
]

type HostRuns = { hostKey: string; label: string; runs: WorkflowRunSummary[]; error: string | null }

export function WorkflowRunHistoryView({
  initialDefinitionId,
  onOpenRun
}: {
  initialDefinitionId?: string
  onOpenRun: (hostKey: string, runId: string) => void
}): React.JSX.Element {
  const hosts = useWorkflowHostOptions()
  const [definitionFilter, setDefinitionFilter] = useState(initialDefinitionId ?? ALL)
  const [statusFilter, setStatusFilter] = useState(ALL)
  const [hostFilter, setHostFilter] = useState(ALL)
  const [results, setResults] = useState<HostRuns[] | null>(null)
  const [loading, setLoading] = useState(false)
  const usableHosts = useMemo(
    () => hosts.filter((host) => host.availability === 'available'),
    [hosts]
  )
  const unusableHosts = hosts.filter((host) => host.availability !== 'available')

  const load = useCallback(async () => {
    setLoading(true)
    const loaded = await Promise.all(
      usableHosts.map(async (host): Promise<HostRuns> => {
        try {
          const { runs } = await listWorkflowRuns(host.target, { limit: 200 })
          return { hostKey: host.key, label: host.label, runs, error: null }
        } catch (error) {
          return {
            hostKey: host.key,
            label: host.label,
            runs: [],
            error: workflowErrorMessage(error)
          }
        }
      })
    )
    setResults(loaded)
    setLoading(false)
  }, [usableHosts])

  useEffect(() => {
    void load()
  }, [load])

  const rows = useMemo(() => {
    const all = (results ?? []).flatMap((host) => host.runs.map((run) => ({ host, run })))
    return all
      .filter(
        ({ host, run }) =>
          (definitionFilter === ALL || run.definitionId === definitionFilter) &&
          (statusFilter === ALL || run.status === statusFilter) &&
          (hostFilter === ALL || host.hostKey === hostFilter)
      )
      .sort((a, b) => b.run.createdAt.localeCompare(a.run.createdAt))
  }, [results, definitionFilter, statusFilter, hostFilter])

  const definitions = useMemo(() => {
    const names = new Map<string, string>()
    for (const host of results ?? []) {
      for (const run of host.runs) {
        names.set(run.definitionId, run.definitionName)
      }
    }
    return [...names]
  }, [results])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 pb-3 md:px-5">
        <Select value={definitionFilter} onValueChange={setDefinitionFilter}>
          <SelectTrigger
            size="sm"
            aria-label={translate('auto.components.workflows.history.workflowFilter', 'Workflow')}
            className="w-56"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>
              {translate('auto.components.workflows.history.allWorkflows', 'All workflows')}
            </SelectItem>
            {definitions.map(([id, name]) => (
              <SelectItem key={id} value={id}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger
            size="sm"
            aria-label={translate('auto.components.workflows.history.statusFilter', 'Status')}
            className="w-48"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>
              {translate('auto.components.workflows.history.allStatuses', 'Any status')}
            </SelectItem>
            {STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {runStatusLabel(status)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={hostFilter} onValueChange={setHostFilter}>
          <SelectTrigger
            size="sm"
            aria-label={translate('auto.components.workflows.history.hostFilter', 'Host')}
            className="w-48"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>
              {translate('auto.components.workflows.history.allHosts', 'All hosts')}
            </SelectItem>
            {usableHosts.map((host) => (
              <SelectItem key={host.key} value={host.key}>
                {host.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? <LoadingSpinner className="size-4" /> : <RotateCw />}
          {translate('auto.components.workflows.history.refresh', 'Refresh')}
        </Button>
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-3 pb-8 md:px-5">
        {unusableHosts.map((host) => (
          <p key={host.key} className="mb-2 text-xs text-muted-foreground">
            {host.label}: {describeHostAvailability(host)}
          </p>
        ))}
        {(results ?? [])
          .filter((host) => host.error)
          .map((host) => (
            <p key={host.hostKey} role="alert" className="mb-2 text-xs text-destructive">
              {translate(
                'auto.components.workflows.history.hostError',
                'Could not list runs on {{value0}}: {{value1}}',
                {
                  value0: host.label,
                  value1: host.error ?? ''
                }
              )}
            </p>
          ))}
        {results === null ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <LoadingSpinner className="size-4" />
            {translate('auto.components.workflows.history.loading', 'Loading runs…')}
          </p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            {translate('auto.components.workflows.history.empty', 'No runs match these filters.')}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map(({ host, run }) => (
              <li key={`${host.hostKey}:${run.id}`}>
                <button
                  type="button"
                  className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onOpenRun(host.hostKey, run.id)}
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {run.definitionName}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {translate(
                      'auto.components.workflows.history.meta',
                      'rev {{value0}} · {{value1}} · {{value2}}',
                      {
                        value0: run.definitionRevision,
                        value1: host.label,
                        value2: run.target.workspaceLabel
                      }
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {workflowHistoryStepsLabel(run.succeededSteps, run.stepCount)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatUiRelativeTimeFromDate(run.createdAt)}
                  </span>
                  <WorkflowRunStatusBadge status={run.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
