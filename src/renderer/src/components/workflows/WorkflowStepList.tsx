import { useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Bot,
  Copy,
  GitMerge,
  GripVertical,
  Hand,
  Plus,
  Trash2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type {
  WorkflowDefinitionBody,
  WorkflowStep
} from '../../../../shared/workflows/workflow-definition'
import {
  addWorkflowStep,
  duplicateWorkflowStep,
  moveWorkflowStep,
  removeWorkflowStep
} from '../../../../shared/workflows/workflow-draft-edits'
import type { WorkflowValidationIssue } from '../../../../shared/workflows/workflow-validation-issues'

function StepKindIcon({ step }: { step: WorkflowStep }): React.JSX.Element {
  if (step.kind === 'approval') {
    return <Hand aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
  }
  if (step.kind === 'integration') {
    return <GitMerge aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
  }
  return <Bot aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
}

function IconAction({
  label,
  onClick,
  disabled,
  children
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

/** Ordered step cards. Reordering works by keyboard (up/down) as well as by dragging the handle. */
export function WorkflowStepList({
  body,
  selectedIndex,
  issues,
  onSelect,
  onChange
}: {
  body: WorkflowDefinitionBody
  selectedIndex: number
  issues: readonly WorkflowValidationIssue[]
  onSelect: (index: number) => void
  onChange: (body: WorkflowDefinitionBody, selectIndex?: number) => void
}): React.JSX.Element {
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const move = (from: number, to: number): void => onChange(moveWorkflowStep(body, from, to), to)
  return (
    <div className="space-y-2">
      <ol className="space-y-1.5">
        {body.steps.map((step, index) => {
          const stepIssues = issues.filter((issue) => issue.stepIndex === index).length
          const selected = index === selectedIndex
          return (
            <li
              key={step.id}
              onDragOver={(event) => {
                if (dragFrom !== null) {
                  event.preventDefault()
                }
              }}
              onDrop={(event) => {
                event.preventDefault()
                if (dragFrom !== null) {
                  move(dragFrom, index)
                }
                setDragFrom(null)
              }}
              data-current={selected ? 'true' : undefined}
              className={cn(
                'group flex items-center gap-1.5 rounded-md border px-1.5 py-1.5 transition-colors',
                selected ? 'border-ring bg-accent' : 'border-border hover:bg-accent'
              )}
            >
              <span
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move'
                  setDragFrom(index)
                }}
                onDragEnd={() => setDragFrom(null)}
                className="cursor-grab text-muted-foreground"
                aria-hidden="true"
              >
                <GripVertical className="size-3.5" />
              </span>
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-current={selected ? 'step' : undefined}
                onClick={() => onSelect(index)}
              >
                <span className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                  {index + 1}
                </span>
                <StepKindIcon step={step} />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {step.name ||
                    translate('auto.components.workflows.stepList.unnamed', 'Unnamed step')}
                </span>
                {step.workspaceMode === 'isolated' && step.kind === 'agent' ? (
                  <span className="shrink-0 rounded border border-border px-1 text-3xs text-muted-foreground">
                    {translate('auto.components.workflows.stepList.isolated', 'isolated')}
                  </span>
                ) : null}
                {stepIssues > 0 ? (
                  <span className="shrink-0 text-xs text-destructive">
                    {translate('auto.components.workflows.stepList.issues', '{{value0}} to fix', {
                      value0: stepIssues
                    })}
                  </span>
                ) : null}
              </button>
              <span className="flex shrink-0 items-center opacity-70 group-hover:opacity-100 group-focus-within:opacity-100">
                <IconAction
                  label={translate('auto.components.workflows.stepList.moveUp', 'Move up')}
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                >
                  <ArrowUp />
                </IconAction>
                <IconAction
                  label={translate('auto.components.workflows.stepList.moveDown', 'Move down')}
                  disabled={index === body.steps.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  <ArrowDown />
                </IconAction>
                <IconAction
                  label={translate(
                    'auto.components.workflows.stepList.duplicate',
                    'Duplicate step'
                  )}
                  onClick={() => {
                    const result = duplicateWorkflowStep(
                      body,
                      index,
                      translate('auto.components.workflows.stepList.copySuffix', ' (copy)')
                    )
                    onChange(result.body, result.index)
                  }}
                >
                  <Copy />
                </IconAction>
                <IconAction
                  label={translate('auto.components.workflows.stepList.delete', 'Delete step')}
                  onClick={() =>
                    onChange(
                      removeWorkflowStep(body, index),
                      Math.max(0, Math.min(index, body.steps.length - 2))
                    )
                  }
                >
                  <Trash2 />
                </IconAction>
              </span>
            </li>
          )
        })}
      </ol>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => {
          const result = addWorkflowStep(
            body,
            translate('auto.components.workflows.stepList.newStep', 'New step'),
            selectedIndex
          )
          onChange(result.body, result.index)
        }}
      >
        <Plus />
        {translate('auto.components.workflows.stepList.add', 'Add step')}
      </Button>
    </div>
  )
}
