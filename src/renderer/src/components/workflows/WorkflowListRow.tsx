import { Copy, Download, History, LayoutTemplate, MoreHorizontal, Play, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { formatUiRelativeTimeFromDate } from '@/i18n/relative-time-format'
import type { WorkflowDefinition } from '../../../../shared/workflows/workflow-definition'
import type { WorkflowRunSummary } from '../../../../shared/workflows/workflow-run-types'
import { WorkflowRunStatusBadge } from './WorkflowStatusBadge'
import { workflowStepCountLabel } from './workflow-count-copy'

export type WorkflowRowAction =
  | 'open'
  | 'run'
  | 'duplicate'
  | 'template'
  | 'use-template'
  | 'export'
  | 'history'
  | 'delete'

export function WorkflowListRow({
  definition,
  latestRun,
  onAction,
  onOpenLatestRun
}: {
  definition: WorkflowDefinition
  latestRun: WorkflowRunSummary | undefined
  onAction: (action: WorkflowRowAction, definition: WorkflowDefinition) => void
  onOpenLatestRun: (run: WorkflowRunSummary) => void
}): React.JSX.Element {
  const isTemplate = definition.kind === 'template'
  const steps = definition.body.steps.length
  return (
    <div
      role="listitem"
      className="group flex min-w-0 items-center gap-3 rounded-md border border-border px-3 py-2 transition-colors hover:bg-accent"
    >
      <button
        type="button"
        className="min-w-0 flex-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onAction('open', definition)}
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm font-medium">{definition.body.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {workflowStepCountLabel(steps)}
          </span>
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {definition.body.description ||
            translate('auto.components.workflows.list.noDescription', 'No description')}
        </span>
      </button>
      <span className="hidden shrink-0 text-xs text-muted-foreground md:inline">
        {translate('auto.components.workflows.list.updated', 'Updated {{value0}}', {
          value0: formatUiRelativeTimeFromDate(definition.updatedAt)
        })}
      </span>
      {isTemplate ? null : latestRun ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="hidden shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"
              onClick={() => onOpenLatestRun(latestRun)}
            >
              <WorkflowRunStatusBadge status={latestRun.status} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            {translate('auto.components.workflows.list.openLatestRun', 'Open latest run')}
          </TooltipContent>
        </Tooltip>
      ) : (
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
          {translate('auto.components.workflows.list.neverRun', 'Never run')}
        </span>
      )}
      {isTemplate ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onAction('use-template', definition)}
        >
          <LayoutTemplate />
          {translate('auto.components.workflows.list.useTemplate', 'Use template')}
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onAction('run', definition)}
        >
          <Play />
          {translate('auto.components.workflows.list.run', 'Run')}
        </Button>
      )}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={translate('auto.components.workflows.list.moreActions', 'More actions')}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>
            {translate('auto.components.workflows.list.moreActions', 'More actions')}
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onAction('duplicate', definition)}>
            <Copy />
            {translate('auto.components.workflows.list.duplicate', 'Duplicate')}
          </DropdownMenuItem>
          {isTemplate ? null : (
            <DropdownMenuItem onSelect={() => onAction('template', definition)}>
              <LayoutTemplate />
              {translate('auto.components.workflows.list.saveAsTemplate', 'Save as template')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => onAction('export', definition)}>
            <Download />
            {translate('auto.components.workflows.list.export', 'Export JSON')}
          </DropdownMenuItem>
          {isTemplate ? null : (
            <DropdownMenuItem onSelect={() => onAction('history', definition)}>
              <History />
              {translate('auto.components.workflows.list.runHistory', 'Run history')}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => onAction('delete', definition)}>
            <Trash2 />
            {translate('auto.components.workflows.list.delete', 'Delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
