import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Play, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { translate } from '@/i18n/i18n'
import type {
  WorkflowDefinition,
  WorkflowDefinitionBody,
  WorkflowDefinitionKind
} from '../../../../shared/workflows/workflow-definition'
import { validateWorkflowDefinition } from '../../../../shared/workflows/workflow-definition-validation'
import {
  createWorkflowDefinition,
  getWorkflowDefinition,
  updateWorkflowDefinition,
  workflowErrorCode,
  workflowErrorMessage
} from './workflow-client'
import { issueMessage } from './workflow-status-copy'
import { WorkflowStepList } from './WorkflowStepList'
import { WorkflowStepEditor } from './WorkflowStepEditor'
import { WorkflowGraphView } from './WorkflowGraphView'
import { WorkflowParametersEditor } from './WorkflowParametersEditor'
import { WorkflowSettingsFields } from './WorkflowSettingsFields'
import { WorkflowLaunchDialog } from './WorkflowLaunchDialog'
import { useWorkflowAgentIds } from './WorkflowAgentFields'
import type { WorkflowEditorSeed } from './workflows-route'

type Loaded = {
  definition: WorkflowDefinition | null
  kind: WorkflowDefinitionKind
  body: WorkflowDefinitionBody
}

export function WorkflowEditorView({
  definitionId,
  seed,
  onSaved,
  onOpenRun,
  onBack
}: {
  definitionId: string | null
  seed?: WorkflowEditorSeed
  onSaved: (definitionId: string) => void
  onOpenRun: (hostKey: string, runId: string) => void
  onBack: () => void
}): React.JSX.Element {
  const [loaded, setLoaded] = useState<Loaded | null>(
    definitionId
      ? null
      : { definition: null, kind: seed?.kind ?? 'workflow', body: seed?.body ?? emptyBody() }
  )
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState<WorkflowDefinitionBody | null>(loaded?.body ?? null)
  const [selected, setSelected] = useState(0)
  const [tab, setTab] = useState('steps')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [launching, setLaunching] = useState<WorkflowDefinition | null>(null)
  const { agents } = useWorkflowAgentIds()

  const loadedId = loaded?.definition?.id ?? null
  useEffect(() => {
    if (!definitionId || definitionId === loadedId) {
      return
    }
    let cancelled = false
    getWorkflowDefinition(definitionId)
      .then((definition) => {
        if (!cancelled) {
          setLoaded({ definition, kind: definition.kind, body: definition.body })
          setDraft(definition.body)
        }
      })
      .catch((error: unknown) => !cancelled && setLoadError(workflowErrorMessage(error)))
    return () => {
      cancelled = true
    }
  }, [definitionId, loadedId])

  const issues = useMemo(
    () =>
      draft
        ? validateWorkflowDefinition(draft, agents.length > 0 ? { availableAgents: agents } : {})
        : [],
    [draft, agents]
  )
  // Agent availability here reflects this computer; the target host re-checks it at launch.
  const blocking = issues.filter((issue) => issue.code !== 'agent_unavailable')
  const dirty = Boolean(draft && loaded && (loaded.definition === null || draft !== loaded.body))

  if (loadError) {
    return (
      <div
        role="alert"
        className="mx-3 flex items-center gap-3 rounded-md border border-destructive/40 px-3 py-2 text-sm md:mx-5"
      >
        <AlertCircle className="size-4 text-destructive" />
        <span className="min-w-0 flex-1 text-destructive">{loadError}</span>
        <Button type="button" variant="outline" size="sm" onClick={onBack}>
          {translate('auto.components.workflows.editor.back', 'Back to workflows')}
        </Button>
      </div>
    )
  }
  if (!draft || !loaded) {
    return (
      <div className="flex items-center gap-2 px-5 py-8 text-sm text-muted-foreground">
        <LoadingSpinner className="size-4" />
        {translate('auto.components.workflows.editor.loading', 'Loading workflow…')}
      </div>
    )
  }

  const save = async (): Promise<WorkflowDefinition | null> => {
    setSaving(true)
    setSaveError(null)
    try {
      const saved = loaded.definition
        ? await updateWorkflowDefinition(loaded.definition.id, draft, loaded.definition.revision)
        : await createWorkflowDefinition({ kind: loaded.kind, body: draft })
      setLoaded({ definition: saved, kind: saved.kind, body: saved.body })
      setDraft(saved.body)
      toast.success(translate('auto.components.workflows.editor.saved', 'Workflow saved'))
      if (!loaded.definition) {
        onSaved(saved.id)
      }
      return saved
    } catch (error) {
      setSaveError(
        workflowErrorCode(error) === 'workflow_revision_conflict'
          ? translate(
              'auto.components.workflows.editor.conflict',
              'This workflow was changed elsewhere since you opened it. Copy your changes, reopen it, and apply them again.'
            )
          : workflowErrorMessage(error)
      )
      return null
    } finally {
      setSaving(false)
    }
  }

  const run = async (): Promise<void> => {
    const definition = dirty || !loaded.definition ? await save() : loaded.definition
    if (definition) {
      setLaunching(definition)
    }
  }

  const change = (body: WorkflowDefinitionBody, selectIndex?: number): void => {
    setDraft(body)
    if (selectIndex !== undefined) {
      setSelected(selectIndex)
    }
  }
  const workflowIssues = issues.filter((issue) => issue.field.startsWith('workflow.'))
  const isTemplate = loaded.kind === 'template'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-end gap-2 px-3 pb-3 md:px-5">
        <div className="min-w-0 flex-1 space-y-1">
          <Input
            id="workflow-name"
            aria-label={translate('auto.components.workflows.editor.name', 'Workflow name')}
            value={draft.name}
            aria-invalid={issues.some((issue) => issue.field === 'workflow.name')}
            placeholder={translate(
              'auto.components.workflows.editor.namePlaceholder',
              'Workflow name'
            )}
            onChange={(event) => change({ ...draft, name: event.target.value })}
          />
        </div>
        <span className="pb-2 text-xs text-muted-foreground" aria-live="polite">
          {blocking.length > 0
            ? translate(
                'auto.components.workflows.editor.issueCount',
                '{{value0}} to fix before running',
                { value0: blocking.length }
              )
            : dirty
              ? translate('auto.components.workflows.editor.unsaved', 'Unsaved changes')
              : translate('auto.components.workflows.editor.ready', 'Ready to run')}
        </span>
        <Button
          type="button"
          variant="outline"
          disabled={saving || !dirty}
          onClick={() => void save()}
        >
          <Save />
          {translate('auto.components.workflows.editor.save', 'Save')}
        </Button>
        {isTemplate ? null : (
          <Button type="button" disabled={saving || blocking.length > 0} onClick={() => void run()}>
            <Play />
            {dirty
              ? translate('auto.components.workflows.editor.saveAndRun', 'Save and run')
              : translate('auto.components.workflows.editor.run', 'Run')}
          </Button>
        )}
      </div>
      {saveError ? (
        <p role="alert" className="mx-3 mb-2 text-sm text-destructive md:mx-5">
          {saveError}
        </p>
      ) : null}
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto px-3 pb-8 md:px-5">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="workflow-description">
              {translate('auto.components.workflows.editor.description', 'Description (optional)')}
            </Label>
            <Textarea
              id="workflow-description"
              value={draft.description}
              onChange={(event) => change({ ...draft, description: event.target.value })}
            />
          </div>
          <WorkflowSettingsFields body={draft} issues={workflowIssues} onChange={change} />
          {workflowIssues
            .filter((issue) => issue.field === 'workflow.steps')
            .map((issue) => (
              <p key={issue.code} className="text-sm text-destructive">
                {issueMessage(issue)}
              </p>
            ))}
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="steps">
                {translate('auto.components.workflows.editor.tabSteps', 'Steps')}
              </TabsTrigger>
              <TabsTrigger value="graph">
                {translate('auto.components.workflows.editor.tabGraph', 'Dependency graph')}
              </TabsTrigger>
              <TabsTrigger value="parameters">
                {translate(
                  'auto.components.workflows.editor.tabParameters',
                  'Parameters ({{value0}})',
                  {
                    value0: draft.parameters.length
                  }
                )}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="steps">
              <div className="grid gap-4 pt-2 lg:grid-cols-[minmax(16rem,22rem)_1fr]">
                <WorkflowStepList
                  body={draft}
                  selectedIndex={selected}
                  issues={issues}
                  onSelect={setSelected}
                  onChange={change}
                />
                <WorkflowStepEditor
                  body={draft}
                  index={selected}
                  issues={issues}
                  onChange={change}
                />
              </div>
            </TabsContent>
            <TabsContent value="graph">
              <div className="space-y-4 pt-2">
                <WorkflowGraphView
                  body={draft}
                  selectedIndex={selected}
                  issues={issues}
                  onSelect={setSelected}
                  onChange={change}
                />
                <WorkflowStepEditor
                  body={draft}
                  index={selected}
                  issues={issues}
                  onChange={change}
                />
              </div>
            </TabsContent>
            <TabsContent value="parameters">
              <div className="pt-2">
                <WorkflowParametersEditor body={draft} issues={issues} onChange={change} />
              </div>
            </TabsContent>
          </Tabs>
        </div>
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
    </div>
  )
}

function emptyBody(): WorkflowDefinitionBody {
  return {
    name: '',
    description: '',
    dependencyMode: 'sequential',
    maxConcurrency: 1,
    parameters: [],
    steps: []
  }
}
