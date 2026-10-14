import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { WorkflowListView } from './WorkflowListView'
import { WorkflowEditorView } from './WorkflowEditorView'
import { WorkflowRunView } from './WorkflowRunView'
import { WorkflowRunHistoryView } from './WorkflowRunHistoryView'
import {
  createWorkflowsNavEntry,
  workflowsNavMemory,
  type WorkflowsNavEntry,
  type WorkflowsRoute
} from './workflows-route'

function routeLabel(route: WorkflowsRoute): string {
  switch (route.kind) {
    case 'list':
      return translate('auto.components.workflows.page.title', 'Workflows')
    case 'editor':
      return route.definitionId
        ? translate('auto.components.workflows.page.editWorkflow', 'Edit workflow')
        : translate('auto.components.workflows.page.newWorkflow', 'New workflow')
    case 'run':
      return translate('auto.components.workflows.page.run', 'Run')
    case 'history':
      return translate('auto.components.workflows.page.history', 'Run history')
  }
}

export default function WorkflowsPage(): React.JSX.Element {
  const [stack, setStack] = useState<WorkflowsNavEntry[]>(() => workflowsNavMemory.stack)
  const stackRef = useRef(stack)
  stackRef.current = stack
  useEffect(
    () => () => {
      workflowsNavMemory.stack = stackRef.current
    },
    []
  )
  const top = stack.at(-1) ?? createWorkflowsNavEntry({ kind: 'list' })
  const route = top.route
  const push = useCallback(
    (next: WorkflowsRoute) => setStack((current) => [...current, createWorkflowsNavEntry(next)]),
    []
  )
  // Keeps the entry's identity, so a view updating its own route is not remounted.
  const replace = useCallback(
    (next: WorkflowsRoute) =>
      setStack((current) => {
        const last = current.at(-1)
        const entry = last ? { navId: last.navId, route: next } : createWorkflowsNavEntry(next)
        return [...current.slice(0, -1), entry]
      }),
    []
  )
  const goTo = useCallback(
    (index: number) => setStack((current) => current.slice(0, index + 1)),
    []
  )
  const back = useCallback(
    () => setStack((current) => (current.length > 1 ? current.slice(0, -1) : current)),
    []
  )
  const openRun = useCallback(
    (hostKey: string, runId: string) => push({ kind: 'run', hostKey, runId }),
    [push]
  )

  return (
    <main className="relative flex h-full min-h-0 flex-col bg-background pt-5 text-foreground md:pt-6">
      <header
        className="flex shrink-0 items-center px-3 pb-3 md:px-5"
        style={{ paddingRight: 'max(0.75rem, var(--window-controls-width, 0px))' }}
      >
        <nav
          aria-label={translate(
            'auto.components.workflows.page.breadcrumb',
            'Workflows breadcrumb'
          )}
          className="flex min-w-0 items-center text-sm"
        >
          {stack.map(({ navId, route: entry }, index) => {
            const last = index === stack.length - 1
            return (
              <React.Fragment key={navId}>
                {index > 0 ? (
                  <ChevronRight className="mx-1 size-3.5 shrink-0 text-muted-foreground" />
                ) : null}
                {last ? (
                  <h1
                    className={
                      index === 0
                        ? 'truncate text-base font-semibold leading-8'
                        : 'truncate font-medium leading-8'
                    }
                    aria-current="page"
                  >
                    {routeLabel(entry)}
                  </h1>
                ) : (
                  <button
                    type="button"
                    className="truncate rounded-sm leading-8 text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => goTo(index)}
                  >
                    {routeLabel(entry)}
                  </button>
                )}
              </React.Fragment>
            )
          })}
        </nav>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        {route.kind === 'list' ? (
          <WorkflowListView
            onOpenEditor={(definitionId, seed) => push({ kind: 'editor', definitionId, seed })}
            onOpenRun={openRun}
            onOpenHistory={(definitionId) => push({ kind: 'history', definitionId })}
          />
        ) : null}
        {route.kind === 'editor' ? (
          <WorkflowEditorView
            // Saving a new workflow updates this route; the editor must keep its state across that.
            key={top.navId}
            definitionId={route.definitionId}
            seed={route.seed}
            onSaved={(definitionId) => replace({ kind: 'editor', definitionId })}
            onOpenRun={openRun}
            onBack={back}
          />
        ) : null}
        {route.kind === 'run' ? (
          <WorkflowRunView
            key={`${route.hostKey}:${route.runId}`}
            hostKey={route.hostKey}
            runId={route.runId}
            onOpenRun={(hostKey, runId) => replace({ kind: 'run', hostKey, runId })}
          />
        ) : null}
        {route.kind === 'history' ? (
          <WorkflowRunHistoryView initialDefinitionId={route.definitionId} onOpenRun={openRun} />
        ) : null}
      </div>
    </main>
  )
}
