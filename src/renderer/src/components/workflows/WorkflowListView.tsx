import React, { useMemo, useState } from 'react'
import { History, LayoutTemplate, Plus, RotateCw, Sparkles, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { translate } from '@/i18n/i18n'
import {
  createEmptyWorkflowBody,
  createEmptyWorkflowStep,
  type WorkflowDefinition,
  type WorkflowDefinitionBody
} from '../../../../shared/workflows/workflow-definition'
import type { WorkflowRunSummary } from '../../../../shared/workflows/workflow-run-types'
import { createFeatureWorkflowExample } from './builtin-workflow-templates'
import { createWorkflowDefinition, workflowErrorMessage } from './workflow-client'
import { useWorkflowDefinitions } from './use-workflow-definitions'
import { WorkflowListRow, type WorkflowRowAction } from './WorkflowListRow'
import { WorkflowDeleteDialog } from './WorkflowDeleteDialog'
import { WorkflowLaunchDialog } from './WorkflowLaunchDialog'
import { WorkflowExportDialog, WorkflowImportDialog } from './WorkflowTransferDialogs'
import type { WorkflowEditorSeed } from './workflows-route'

/** A copy that keeps the steps and parameters but drops anything bound to a host. */
function portableCopy(body: WorkflowDefinitionBody, name: string): WorkflowDefinitionBody {
  const { defaultTarget: _target, ...rest } = body
  return { ...rest, name }
}

function newWorkflowSeed(): WorkflowEditorSeed {
  const body = createEmptyWorkflowBody(
    translate('auto.components.workflows.list.untitled', 'Untitled workflow')
  )
  const step = createEmptyWorkflowStep(
    'step-1',
    translate('auto.components.workflows.list.firstStep', 'First step')
  )
  return { kind: 'workflow', body: { ...body, steps: [step] } }
}

export function WorkflowListView({
  onOpenEditor,
  onOpenRun,
  onOpenHistory
}: {
  onOpenEditor: (definitionId: string | null, seed?: WorkflowEditorSeed) => void
  onOpenRun: (hostKey: string, runId: string) => void
  onOpenHistory: (definitionId?: string) => void
}): React.JSX.Element {
  const definitions = useWorkflowDefinitions()
  const [query, setQuery] = useState('')
  const [launching, setLaunching] = useState<WorkflowDefinition | null>(null)
  const [deleting, setDeleting] = useState<WorkflowDefinition | null>(null)
  const [exporting, setExporting] = useState<WorkflowDefinition | null>(null)
  const [importing, setImporting] = useState(false)
  const [busy, setBusy] = useState(false)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const all = definitions.data?.definitions ?? []
    return needle
      ? all.filter((definition) =>
          `${definition.body.name}\n${definition.body.description}`.toLowerCase().includes(needle)
        )
      : all
  }, [definitions.data, query])
  const workflows = filtered.filter((definition) => definition.kind === 'workflow')
  const templates = filtered.filter((definition) => definition.kind === 'template')
  const latestRuns = definitions.data?.latestRuns ?? {}
  const hasAny = (definitions.data?.definitions.length ?? 0) > 0

  const copyAs = async (
    definition: WorkflowDefinition,
    kind: 'workflow' | 'template',
    name: string
  ) => {
    setBusy(true)
    try {
      await createWorkflowDefinition({ kind, body: portableCopy(definition.body, name) })
      toast.success(
        kind === 'template'
          ? translate('auto.components.workflows.list.templateSaved', 'Saved as template')
          : translate('auto.components.workflows.list.duplicated', 'Workflow duplicated')
      )
      await definitions.refresh()
    } catch (error) {
      toast.error(workflowErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const onAction = (action: WorkflowRowAction, definition: WorkflowDefinition): void => {
    const copyName = translate('auto.components.workflows.list.copyName', '{{value0}} (copy)', {
      value0: definition.body.name
    })
    switch (action) {
      case 'open':
        onOpenEditor(definition.id)
        return
      case 'run':
        setLaunching(definition)
        return
      case 'duplicate':
        void copyAs(definition, definition.kind, copyName)
        return
      case 'template':
        void copyAs(definition, 'template', definition.body.name)
        return
      case 'use-template':
        onOpenEditor(null, {
          kind: 'workflow',
          body: portableCopy(definition.body, definition.body.name)
        })
        return
      case 'export':
        setExporting(definition)
        return
      case 'history':
        onOpenHistory(definition.id)
        return
      case 'delete':
        setDeleting(definition)
    }
  }

  const openLatestRun = (run: WorkflowRunSummary): void => onOpenRun('local', run.id)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 pb-3 md:px-5">
        <div className="w-full max-w-xs">
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={translate('auto.components.workflows.list.search', 'Search workflows')}
            aria-label={translate('auto.components.workflows.list.search', 'Search workflows')}
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenHistory()}>
            <History />
            {translate('auto.components.workflows.list.allRuns', 'Run history')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setImporting(true)}>
            <Upload />
            {translate('auto.components.workflows.list.import', 'Import')}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => onOpenEditor(null, newWorkflowSeed())}
          >
            <Plus />
            {translate('auto.components.workflows.list.new', 'New workflow')}
          </Button>
        </div>
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-3 pb-8 md:px-5">
        {definitions.status === 'error' ? (
          <div
            role="alert"
            className="mb-4 flex items-start gap-3 rounded-md border border-destructive/40 px-3 py-2 text-sm"
          >
            <span className="min-w-0 flex-1 text-destructive">{definitions.error}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void definitions.refresh()}
            >
              <RotateCw />
              {translate('auto.components.workflows.list.retry', 'Retry')}
            </Button>
          </div>
        ) : null}
        {definitions.status === 'loading' && !definitions.data ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <LoadingSpinner className="size-4" />
            {translate('auto.components.workflows.list.loading', 'Loading workflows…')}
          </div>
        ) : null}
        {definitions.data && !hasAny ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center">
            <Sparkles className="size-7 text-muted-foreground" />
            <div className="space-y-1">
              <h2 className="text-base font-semibold">
                {translate(
                  'auto.components.workflows.list.emptyTitle',
                  'Chain agents into a workflow'
                )}
              </h2>
              <p className="max-w-md text-sm text-muted-foreground">
                {translate(
                  'auto.components.workflows.list.emptyDescription',
                  'Each step runs an agent through Orca orchestration. Results flow to the next step, and you approve where it matters.'
                )}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" onClick={() => onOpenEditor(null, newWorkflowSeed())}>
                <Plus />
                {translate('auto.components.workflows.list.new', 'New workflow')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  onOpenEditor(null, { kind: 'workflow', body: createFeatureWorkflowExample() })
                }
              >
                <LayoutTemplate />
                {translate('auto.components.workflows.list.startFromExample', 'Start from example')}
              </Button>
            </div>
          </div>
        ) : null}
        {hasAny ? (
          <section className="space-y-2 pb-6">
            <h2 className="text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
              {translate('auto.components.workflows.list.workflowsHeading', 'Workflows')}
            </h2>
            {workflows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {translate(
                  'auto.components.workflows.list.noMatches',
                  'No workflows match this search.'
                )}
              </p>
            ) : (
              <div role="list" className="space-y-1.5">
                {workflows.map((definition) => (
                  <WorkflowListRow
                    key={definition.id}
                    definition={definition}
                    latestRun={latestRuns[definition.id]}
                    onAction={onAction}
                    onOpenLatestRun={openLatestRun}
                  />
                ))}
              </div>
            )}
          </section>
        ) : null}
        {definitions.data ? (
          <section className="space-y-2">
            <h2 className="text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
              {translate('auto.components.workflows.list.templatesHeading', 'Templates')}
            </h2>
            <div role="list" className="space-y-1.5">
              <div
                role="listitem"
                className="flex min-w-0 items-center gap-3 rounded-md border border-dashed border-border px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {translate('auto.components.workflows.example.name', 'Add a small feature')}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {translate(
                      'auto.components.workflows.list.builtinDescription',
                      'Built-in example: feature request → plan → implementation → usage notes'
                    )}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    onOpenEditor(null, { kind: 'workflow', body: createFeatureWorkflowExample() })
                  }
                >
                  <LayoutTemplate />
                  {translate('auto.components.workflows.list.useTemplate', 'Use template')}
                </Button>
              </div>
              {templates.map((definition) => (
                <WorkflowListRow
                  key={definition.id}
                  definition={definition}
                  latestRun={undefined}
                  onAction={onAction}
                  onOpenLatestRun={openLatestRun}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>
      {launching ? (
        <WorkflowLaunchDialog
          definition={launching}
          onOpenChange={(open) => !open && setLaunching(null)}
          onStarted={(hostKey, runId) => {
            setLaunching(null)
            onOpenRun(hostKey, runId)
          }}
        />
      ) : null}
      {deleting ? (
        <WorkflowDeleteDialog
          key={deleting.id}
          definition={deleting}
          onOpenChange={(open) => !open && setDeleting(null)}
          onDeleted={() => {
            setDeleting(null)
            void definitions.refresh()
          }}
          onOpenHistory={(definitionId) => {
            setDeleting(null)
            onOpenHistory(definitionId)
          }}
        />
      ) : null}
      <WorkflowExportDialog
        definition={exporting}
        onOpenChange={(open) => !open && setExporting(null)}
      />
      {importing ? (
        <WorkflowImportDialog
          onOpenChange={setImporting}
          onImported={(definitionId) => {
            setImporting(false)
            void definitions.refresh()
            onOpenEditor(definitionId)
          }}
        />
      ) : null}
    </div>
  )
}
