import { useEffect, useMemo, useRef, useState } from 'react'
import { Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { translate } from '@/i18n/i18n'
import { createNonSecureContextUuid } from '../../../../shared/non-secure-context-uuid'
import type {
  WorkflowDefinition,
  WorkflowParameterValue
} from '../../../../shared/workflows/workflow-definition'
import type {
  WorkflowLaunchInput,
  WorkflowLaunchPlan
} from '../../../../shared/workflows/workflow-launch-types'
import type { WorkflowValidationIssue } from '../../../../shared/workflows/workflow-validation-issues'
import {
  previewWorkflowLaunch,
  startWorkflowRun,
  updateWorkflowDefinition,
  workflowErrorIssues,
  workflowErrorMessage
} from './workflow-client'
import {
  describeHostAvailability,
  listWorkflowWorkspaces,
  localWorkflowHostOption,
  useWorkflowHostOptions,
  workflowHostFromKey,
  type WorkflowWorkspaceOption
} from './workflow-hosts'
import { issueMessage, stepScopedIssueMessage } from './workflow-status-copy'
import { WorkflowParameterInput } from './WorkflowParameterInput'
import { WorkflowLaunchPlanPreview } from './WorkflowLaunchPlanPreview'

function initialParams(definition: WorkflowDefinition): Record<string, WorkflowParameterValue> {
  const values: Record<string, WorkflowParameterValue> = {}
  for (const parameter of definition.body.parameters) {
    if (parameter.defaultValue !== undefined) {
      values[parameter.id] = parameter.defaultValue
    }
  }
  return values
}

export function WorkflowLaunchDialog({
  definition,
  initialParamsOverride,
  initialHostKey,
  rerunOf,
  onOpenChange,
  onStarted
}: {
  definition: WorkflowDefinition
  initialParamsOverride?: Record<string, WorkflowParameterValue>
  initialHostKey?: string
  rerunOf?: string
  onOpenChange: (open: boolean) => void
  onStarted: (hostKey: string, runId: string) => void
}): React.JSX.Element {
  const hosts = useWorkflowHostOptions()
  const defaultTarget = definition.body.defaultTarget
  const [hostKey, setHostKey] = useState(initialHostKey ?? defaultTarget?.hostId ?? 'local')
  const [workspaces, setWorkspaces] = useState<WorkflowWorkspaceOption[] | null>(null)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [workspaceId, setWorkspaceId] = useState<string>('')
  const [params, setParams] = useState(() => initialParamsOverride ?? initialParams(definition))
  const [maxConcurrency, setMaxConcurrency] = useState(definition.body.maxConcurrency)
  const [remember, setRemember] = useState(false)
  const [plan, setPlan] = useState<WorkflowLaunchPlan | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [startIssues, setStartIssues] = useState<WorkflowValidationIssue[]>([])
  const [startError, setStartError] = useState<string | null>(null)
  const requestId = useRef(createNonSecureContextUuid())
  const host = hosts.find((option) => option.key === hostKey) ?? localWorkflowHostOption()
  const target = workflowHostFromKey(host.key)
  const hostBlocked = describeHostAvailability(host)
  const preferredWorkspace = defaultTarget?.hostId === host.key ? defaultTarget.workspaceId : null

  useEffect(() => {
    setWorkspaces(null)
    setWorkspaceError(null)
    if (hostBlocked) {
      return
    }
    let cancelled = false
    listWorkflowWorkspaces(workflowHostFromKey(host.key))
      .then((options) => {
        if (cancelled) {
          return
        }
        setWorkspaces(options)
        setWorkspaceId((current) =>
          options.some((option) => option.id === current)
            ? current
            : (options.find((option) => option.id === preferredWorkspace)?.id ?? '')
        )
      })
      .catch((error: unknown) => !cancelled && setWorkspaceError(workflowErrorMessage(error)))
    return () => {
      cancelled = true
    }
  }, [host.key, hostBlocked, preferredWorkspace])

  const input = useMemo<WorkflowLaunchInput>(
    () => ({
      requestId: requestId.current,
      definitionId: definition.id,
      definitionRevision: definition.revision,
      snapshot: definition.body,
      params,
      workspaceId,
      maxConcurrency,
      ...(rerunOf ? { rerunOf } : {})
    }),
    [definition, params, workspaceId, maxConcurrency, rerunOf]
  )

  useEffect(() => {
    if (hostBlocked || !workspaceId) {
      setPlan(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      previewWorkflowLaunch(workflowHostFromKey(host.key), input)
        .then((next) => {
          if (!cancelled) {
            setPlan(next)
            setPlanError(null)
          }
        })
        .catch((error: unknown) => !cancelled && setPlanError(workflowErrorMessage(error)))
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [input, host.key, hostBlocked, workspaceId])

  const issues = startIssues.length > 0 ? startIssues : (plan?.issues ?? [])
  const paramError = (id: string): string | null => {
    const issue = issues.find((candidate) => candidate.field === `launch.params.${id}`)
    return issue ? issueMessage(issue) : null
  }
  const otherIssues = issues.filter((issue) => !issue.field.startsWith('launch.params.'))
  const canStart = Boolean(
    !hostBlocked && workspaceId && plan && plan.issues.length === 0 && !starting
  )

  const start = async (): Promise<void> => {
    setStarting(true)
    setStartError(null)
    setStartIssues([])
    try {
      const detail = await startWorkflowRun(target, input)
      if (
        remember &&
        (defaultTarget?.hostId !== host.key || defaultTarget.workspaceId !== workspaceId)
      ) {
        await updateWorkflowDefinition(
          definition.id,
          { ...definition.body, defaultTarget: { hostId: host.key, workspaceId } },
          definition.revision
        ).catch(() => undefined)
      }
      onStarted(host.key, detail.run.id)
    } catch (error) {
      setStartIssues(workflowErrorIssues(error))
      setStartError(workflowErrorMessage(error))
      setStarting(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {translate('auto.components.workflows.launch.title', 'Run {{value0}}', {
              value0: definition.body.name
            })}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.workflows.launch.description',
              'Revision {{value0}}. The run keeps this exact version and these parameters even if the workflow is edited later.',
              { value0: definition.revision }
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="scrollbar-sleek max-h-[65vh] space-y-5 overflow-y-auto pr-1">
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="workflow-launch-host">
                {translate('auto.components.workflows.launch.host', 'Execution host')}
              </Label>
              <Select value={host.key} onValueChange={setHostKey}>
                <SelectTrigger id="workflow-launch-host" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {hosts.map((option) => (
                    <SelectItem key={option.key} value={option.key}>
                      {option.label}
                      {option.availability === 'offline'
                        ? ` · ${translate('auto.components.workflows.launch.offline', 'offline')}`
                        : option.availability === 'unsupported'
                          ? ` · ${translate('auto.components.workflows.launch.needsUpdate', 'needs update')}`
                          : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {hostBlocked ? <p className="text-xs text-destructive">{hostBlocked}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="workflow-launch-workspace">
                {translate('auto.components.workflows.launch.workspace', 'Workspace')}
              </Label>
              <Select
                value={workspaceId}
                onValueChange={setWorkspaceId}
                disabled={!workspaces || workspaces.length === 0}
              >
                <SelectTrigger
                  id="workflow-launch-workspace"
                  className="w-full"
                  aria-invalid={issues.some((issue) => issue.field === 'launch.workspace')}
                >
                  <SelectValue
                    placeholder={
                      workspaces
                        ? translate(
                            'auto.components.workflows.launch.chooseWorkspace',
                            'Choose a workspace'
                          )
                        : translate(
                            'auto.components.workflows.launch.loadingWorkspaces',
                            'Loading workspaces…'
                          )
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {(workspaces ?? []).map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                      <span className="text-muted-foreground">
                        {' '}
                        ·{' '}
                        {option.isGit
                          ? option.detail
                          : translate('auto.components.workflows.launch.folder', 'folder')}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {workspaceError ? <p className="text-xs text-destructive">{workspaceError}</p> : null}
              {workspaces && workspaces.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {translate(
                    'auto.components.workflows.launch.noWorkspaces',
                    'This host has no workspaces yet. Add a project in Orca first.'
                  )}
                </p>
              ) : null}
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={remember}
                  onCheckedChange={(value) => setRemember(value === true)}
                />
                {translate(
                  'auto.components.workflows.launch.remember',
                  'Use this host and workspace by default'
                )}
              </label>
            </div>
          </section>
          {definition.body.parameters.length > 0 ? (
            <section className="space-y-3">
              <h3 className="text-sm font-medium">
                {translate('auto.components.workflows.launch.parameters', 'Parameters')}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {definition.body.parameters.map((parameter) => (
                  <WorkflowParameterInput
                    key={parameter.id}
                    id={`workflow-launch-param-${parameter.id}`}
                    label={parameter.label || parameter.id}
                    parameter={parameter}
                    value={params[parameter.id]}
                    error={paramError(parameter.id)}
                    onChange={(value) =>
                      setParams((current) => {
                        const next = { ...current }
                        if (value === undefined) {
                          delete next[parameter.id]
                        } else {
                          next[parameter.id] = value
                        }
                        return next
                      })
                    }
                  />
                ))}
              </div>
            </section>
          ) : null}
          {definition.body.dependencyMode === 'graph' ? (
            <section className="max-w-xs space-y-1.5">
              <Label htmlFor="workflow-launch-concurrency">
                {translate(
                  'auto.components.workflows.launch.concurrency',
                  'Max parallel agent steps'
                )}
              </Label>
              <Input
                id="workflow-launch-concurrency"
                type="number"
                min={1}
                max={8}
                value={maxConcurrency}
                onChange={(event) => setMaxConcurrency(Number(event.target.value))}
              />
            </section>
          ) : null}
          <section className="space-y-2">
            <h3 className="text-sm font-medium">
              {translate('auto.components.workflows.launch.preview', 'What will run')}
            </h3>
            {otherIssues.length > 0 ? (
              <ul role="alert" className="list-disc space-y-1 pl-5 text-sm text-destructive">
                {otherIssues.map((issue) => (
                  <li key={`${issue.field}:${issue.code}:${issue.message}`}>
                    {stepScopedIssueMessage(issue, definition.body.steps)}
                  </li>
                ))}
              </ul>
            ) : null}
            {planError ? <p className="text-sm text-destructive">{planError}</p> : null}
            {plan ? (
              <WorkflowLaunchPlanPreview body={definition.body} plan={plan} />
            ) : workspaceId && !hostBlocked ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoadingSpinner className="size-4" />
                {translate(
                  'auto.components.workflows.launch.checking',
                  'Checking the workflow on this host…'
                )}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {translate(
                  'auto.components.workflows.launch.pickWorkspace',
                  'Choose a workspace to see the plan.'
                )}
              </p>
            )}
          </section>
          {startError && startIssues.length === 0 ? (
            <p role="alert" className="text-sm text-destructive">
              {startError}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {translate('auto.components.workflows.launch.cancel', 'Cancel')}
          </Button>
          <Button type="button" disabled={!canStart} onClick={() => void start()}>
            {starting ? <LoadingSpinner className="size-4" /> : <Play />}
            {starting
              ? translate('auto.components.workflows.launch.starting', 'Starting…')
              : translate('auto.components.workflows.launch.run', 'Start run')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
