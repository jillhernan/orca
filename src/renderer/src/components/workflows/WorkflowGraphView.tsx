import { useMemo, useRef, useState } from 'react'
import { Bot, GitMerge, Hand, Link2, Maximize2, Minus, Plus, Unlink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type {
  WorkflowDefinitionBody,
  WorkflowStep
} from '../../../../shared/workflows/workflow-definition'
import {
  setWorkflowDependency,
  wouldCreateDependencyCycle
} from '../../../../shared/workflows/workflow-draft-edits'
import { workflowStepLayers } from '../../../../shared/workflows/workflow-graph'
import type { WorkflowStepStatus } from '../../../../shared/workflows/workflow-run-types'
import type { WorkflowValidationIssue } from '../../../../shared/workflows/workflow-validation-issues'
import { WorkflowStatusIcon } from './WorkflowStatusBadge'
import { stepStatusLabel } from './workflow-status-copy'

const NODE_W = 184
const NODE_H = 56
const GAP_X = 72
const GAP_Y = 20
const PAD = 16
const NO_ISSUES: readonly WorkflowValidationIssue[] = []

type Edge = { from: string; to: string }

function layout(steps: readonly WorkflowStep[]) {
  const layers = workflowStepLayers(steps)
  const columns: string[][] = []
  for (const step of steps) {
    const layer = layers.get(step.id) ?? 0
    ;(columns[layer] ??= []).push(step.id)
  }
  const positions = new Map<string, { x: number; y: number }>()
  columns.forEach((column, layer) =>
    column.forEach((id, row) =>
      positions.set(id, { x: PAD + layer * (NODE_W + GAP_X), y: PAD + row * (NODE_H + GAP_Y) })
    )
  )
  const rows = Math.max(1, ...columns.map((column) => column.length))
  return {
    positions,
    width: PAD * 2 + Math.max(1, columns.length) * (NODE_W + GAP_X) - GAP_X,
    height: PAD * 2 + rows * (NODE_H + GAP_Y) - GAP_Y
  }
}

function edgePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const x1 = from.x + NODE_W
  const y1 = from.y + NODE_H / 2
  const x2 = to.x
  const y2 = to.y + NODE_H / 2
  const bend = Math.max(24, (x2 - x1) / 2)
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`
}

function KindIcon({ step }: { step: WorkflowStep }): React.JSX.Element {
  if (step.kind === 'approval') {
    return <Hand aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
  }
  if (step.kind === 'integration') {
    return <GitMerge aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
  }
  return <Bot aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
}

/**
 * Layered view of the same definition the step list edits. Editing here is optional: every edge can
 * also be changed with the "Runs after" checkboxes, so the graph is never the only way in.
 */
export function WorkflowGraphView({
  body,
  selectedIndex,
  issues = NO_ISSUES,
  statuses,
  onSelect,
  onChange
}: {
  body: WorkflowDefinitionBody
  selectedIndex: number
  issues?: readonly WorkflowValidationIssue[]
  statuses?: Readonly<Record<string, WorkflowStepStatus>>
  onSelect: (index: number) => void
  onChange?: (body: WorkflowDefinitionBody) => void
}): React.JSX.Element {
  const { positions, width, height } = useMemo(() => layout(body.steps), [body.steps])
  const edges = useMemo<Edge[]>(
    () => body.steps.flatMap((step) => step.dependsOn.map((dep) => ({ from: dep, to: step.id }))),
    [body.steps]
  )
  const [scale, setScale] = useState(1)
  const [connectFrom, setConnectFrom] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const editable = Boolean(onChange) && body.dependencyMode === 'graph'
  const selectedId = body.steps[selectedIndex]?.id

  const clickNode = (index: number, id: string): void => {
    setSelectedEdge(null)
    if (!connecting || !onChange) {
      onSelect(index)
      return
    }
    if (!connectFrom) {
      setConnectFrom(id)
      setNotice(
        translate(
          'auto.components.workflows.graph.pickTarget',
          'Now choose the step that should run after it.'
        )
      )
      return
    }
    if (connectFrom !== id && wouldCreateDependencyCycle(body, id, connectFrom)) {
      setNotice(
        translate(
          'auto.components.workflows.graph.wouldLoop',
          'That connection would create a loop, so it was not added.'
        )
      )
    } else if (connectFrom !== id) {
      onChange(setWorkflowDependency(body, id, connectFrom, true))
      setNotice(null)
    }
    setConnectFrom(null)
    setConnecting(false)
  }

  const fit = (): void => {
    const available = viewport.current?.clientWidth ?? width
    setScale(Math.min(1, Math.max(0.4, (available - 8) / width)))
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={translate('auto.components.workflows.graph.zoomOut', 'Zoom out')}
          onClick={() => setScale((value) => Math.max(0.4, value - 0.1))}
        >
          <Minus />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={translate('auto.components.workflows.graph.zoomIn', 'Zoom in')}
          onClick={() => setScale((value) => Math.min(2, value + 0.1))}
        >
          <Plus />
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={fit}>
          <Maximize2 />
          {translate('auto.components.workflows.graph.fit', 'Fit')}
        </Button>
        {editable ? (
          <>
            <Button
              type="button"
              variant={connecting ? 'secondary' : 'outline'}
              size="sm"
              aria-pressed={connecting}
              onClick={() => {
                setConnecting((value) => !value)
                setConnectFrom(null)
                setNotice(
                  connecting
                    ? null
                    : translate(
                        'auto.components.workflows.graph.pickSource',
                        'Choose the step that must finish first.'
                      )
                )
              }}
            >
              <Link2 />
              {translate('auto.components.workflows.graph.connect', 'Connect steps')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!selectedEdge}
              onClick={() => {
                if (selectedEdge && onChange) {
                  onChange(setWorkflowDependency(body, selectedEdge.to, selectedEdge.from, false))
                  setSelectedEdge(null)
                }
              }}
            >
              <Unlink />
              {translate('auto.components.workflows.graph.removeEdge', 'Remove connection')}
            </Button>
          </>
        ) : onChange ? (
          <span className="text-xs text-muted-foreground">
            {translate(
              'auto.components.workflows.graph.sequentialHint',
              'Steps run in list order. Choose “By dependencies” above to draw branches.'
            )}
          </span>
        ) : null}
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {Math.round(scale * 100)}%
        </span>
      </div>
      {notice ? (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {notice}
        </p>
      ) : null}
      <div
        ref={viewport}
        className="scrollbar-sleek max-h-[28rem] overflow-auto rounded-md border border-border bg-background"
      >
        <div className="relative" style={{ width: width * scale, height: height * scale }}>
          <div
            className="absolute top-0 left-0 origin-top-left"
            style={{ width, height, transform: `scale(${scale})` }}
          >
            <svg width={width} height={height} className="absolute inset-0" aria-hidden="true">
              <defs>
                <marker
                  id="workflow-graph-arrow"
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 8 4 L 0 8 z" className="fill-muted-foreground" />
                </marker>
              </defs>
              {edges.map((edge) => {
                const from = positions.get(edge.from)
                const to = positions.get(edge.to)
                if (!from || !to) {
                  return null
                }
                const selected = selectedEdge?.from === edge.from && selectedEdge.to === edge.to
                const d = edgePath(from, to)
                return (
                  <g key={`${edge.from}->${edge.to}`}>
                    <path
                      d={d}
                      className={selected ? 'stroke-ring' : 'stroke-muted-foreground/60'}
                      strokeWidth={selected ? 2.5 : 1.5}
                      fill="none"
                      markerEnd="url(#workflow-graph-arrow)"
                    />
                    {editable ? (
                      <path
                        d={d}
                        stroke="transparent"
                        strokeWidth={12}
                        fill="none"
                        className="pointer-events-auto cursor-pointer"
                        onClick={() => setSelectedEdge(edge)}
                      />
                    ) : null}
                  </g>
                )
              })}
            </svg>
            {body.steps.map((step, index) => {
              const position = positions.get(step.id)
              if (!position) {
                return null
              }
              const status = statuses?.[step.id]
              const hasIssues = issues.some((issue) => issue.stepIndex === index)
              const isSource = connectFrom === step.id
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => clickNode(index, step.id)}
                  aria-current={step.id === selectedId ? 'step' : undefined}
                  aria-label={
                    status
                      ? `${step.name || step.id}: ${stepStatusLabel(status)}`
                      : step.name || step.id
                  }
                  className={cn(
                    'absolute flex flex-col justify-center gap-0.5 rounded-md border bg-card px-2.5 text-left text-card-foreground shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    step.id === selectedId || isSource
                      ? 'border-ring'
                      : hasIssues
                        ? 'border-destructive'
                        : 'border-border',
                    isSource ? 'bg-accent' : 'hover:bg-accent'
                  )}
                  style={{ left: position.x, top: position.y, width: NODE_W, height: NODE_H }}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <KindIcon step={step} />
                    <span className="truncate text-sm font-medium">{step.name || step.id}</span>
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    {status ? (
                      <>
                        <WorkflowStatusIcon status={status} />
                        <span className="truncate">{stepStatusLabel(status)}</span>
                      </>
                    ) : (
                      <span className="truncate">
                        {step.kind === 'agent' && step.workspaceMode === 'isolated'
                          ? translate('auto.components.workflows.graph.isolated', 'Own worktree')
                          : step.id}
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
