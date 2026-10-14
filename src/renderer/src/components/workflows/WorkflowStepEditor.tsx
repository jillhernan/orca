import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import {
  WORKFLOW_STEP_KINDS,
  WORKFLOW_WORKSPACE_MODES,
  type WorkflowDefinitionBody,
  type WorkflowStep
} from '../../../../shared/workflows/workflow-definition'
import {
  setWorkflowDependency,
  setWorkflowStepInput,
  updateWorkflowStep,
  wouldCreateDependencyCycle
} from '../../../../shared/workflows/workflow-draft-edits'
import type { WorkflowValidationIssue } from '../../../../shared/workflows/workflow-validation-issues'
import { WorkflowAgentFields } from './WorkflowAgentFields'
import { WorkflowPromptField } from './WorkflowPromptField'
import { issueMessage } from './workflow-status-copy'

function fieldErrors(
  issues: readonly WorkflowValidationIssue[],
  index: number,
  field: string
): string[] {
  return issues.filter((issue) => issue.field === `steps.${index}.${field}`).map(issueMessage)
}

export function WorkflowStepEditor({
  body,
  index,
  issues,
  onChange
}: {
  body: WorkflowDefinitionBody
  index: number
  issues: readonly WorkflowValidationIssue[]
  onChange: (body: WorkflowDefinitionBody) => void
}): React.JSX.Element | null {
  const step = body.steps[index]
  if (!step) {
    return null
  }
  const idPrefix = `workflow-step-${index}`
  const update = (patch: Partial<WorkflowStep>): void =>
    onChange(updateWorkflowStep(body, index, patch))
  const predecessors = body.steps.filter((candidate) => step.dependsOn.includes(candidate.id))
  const errors = (field: string) => fieldErrors(issues, index, field)
  const isAgent = step.kind === 'agent'
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem_12rem]">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-name`}>
            {translate('auto.components.workflows.step.name', 'Step name')}
          </Label>
          <Input
            id={`${idPrefix}-name`}
            value={step.name}
            aria-invalid={errors('name').length > 0}
            onChange={(event) => update({ name: event.target.value })}
          />
          {errors('name').map((error) => (
            <p key={error} className="text-xs text-destructive">
              {error}
            </p>
          ))}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-id`}>
            {translate('auto.components.workflows.step.id', 'Step id')}
          </Label>
          <Input
            id={`${idPrefix}-id`}
            value={step.id}
            spellCheck={false}
            aria-invalid={errors('id').length > 0}
            onChange={(event) => update({ id: event.target.value.trim() })}
          />
          {errors('id').map((error) => (
            <p key={error} className="text-xs text-destructive">
              {error}
            </p>
          ))}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-kind`}>
            {translate('auto.components.workflows.step.kind', 'Step type')}
          </Label>
          <Select
            value={step.kind}
            onValueChange={(value) => {
              const kind = WORKFLOW_STEP_KINDS.find((candidate) => candidate === value)
              if (kind) {
                update({ kind })
              }
            }}
          >
            <SelectTrigger id={`${idPrefix}-kind`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="agent">
                {translate('auto.components.workflows.step.kindAgent', 'Agent step')}
              </SelectItem>
              <SelectItem value="approval">
                {translate('auto.components.workflows.step.kindApproval', 'Approval')}
              </SelectItem>
              <SelectItem value="integration">
                {translate('auto.components.workflows.step.kindIntegration', 'Code integration')}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {step.kind === 'integration' ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.workflows.step.integrationHelp',
            'Pauses the run until you have merged the branches from the isolated steps before it into the run workspace. The run shows each branch and its changed files; nothing is merged automatically.'
          )}
        </p>
      ) : null}
      {step.kind === 'approval' ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.workflows.step.approvalHelp',
            'Pauses the run until you approve or reject. Only your decision in Orca releases the next steps; an agent report never does.'
          )}
        </p>
      ) : null}
      <WorkflowPromptField
        id={`${idPrefix}-prompt`}
        label={
          isAgent
            ? translate('auto.components.workflows.step.prompt', 'Instructions for the agent')
            : translate('auto.components.workflows.step.question', 'Question for the reviewer')
        }
        placeholder={
          isAgent
            ? translate(
                'auto.components.workflows.step.promptPlaceholder',
                'Describe what this step should do.'
              )
            : translate(
                'auto.components.workflows.step.questionPlaceholder',
                'What should the reviewer check?'
              )
        }
        value={step.prompt}
        parameters={body.parameters}
        predecessors={predecessors}
        errors={errors('prompt')}
        onChange={(prompt) => update({ prompt })}
      />
      {isAgent ? (
        <>
          <WorkflowAgentFields
            idPrefix={idPrefix}
            agent={step.agent}
            model={step.model}
            effort={step.effort}
            inheritLabel={
              body.defaultAgent
                ? translate('auto.components.workflows.step.inheritWorkflow', 'Workflow default')
                : translate('auto.components.workflows.step.inheritHost', "Host's default agent")
            }
            agentError={[...errors('agent'), ...errors('effort')][0] ?? null}
            showLaunchPreferences
            onChange={update}
          />
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-workspace`}>
              {translate('auto.components.workflows.step.workspace', 'Where it works')}
            </Label>
            <Select
              value={step.workspaceMode}
              onValueChange={(value) => {
                const workspaceMode = WORKFLOW_WORKSPACE_MODES.find(
                  (candidate) => candidate === value
                )
                if (workspaceMode) {
                  update({ workspaceMode })
                }
              }}
            >
              <SelectTrigger
                id={`${idPrefix}-workspace`}
                className="w-full sm:w-80"
                aria-invalid={errors('workspaceMode').length > 0}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="shared">
                  {translate(
                    'auto.components.workflows.step.shared',
                    'The run workspace (changes visible to later steps)'
                  )}
                </SelectItem>
                <SelectItem value="isolated">
                  {translate(
                    'auto.components.workflows.step.isolated',
                    'Its own new worktree (Git only, can run in parallel)'
                  )}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      ) : null}
      <WorkflowDependencyFields
        body={body}
        step={step}
        index={index}
        errors={[...errors('dependsOn'), ...errors('inputs')]}
        onChange={onChange}
      />
      {isAgent ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-expected`}>
            {translate('auto.components.workflows.step.expected', 'Expected output (optional)')}
          </Label>
          <Textarea
            id={`${idPrefix}-expected`}
            value={step.expectedOutput ?? ''}
            onChange={(event) => update({ expectedOutput: event.target.value || undefined })}
          />
        </div>
      ) : null}
    </div>
  )
}

function WorkflowDependencyFields({
  body,
  step,
  index,
  errors,
  onChange
}: {
  body: WorkflowDefinitionBody
  step: WorkflowStep
  index: number
  errors: string[]
  onChange: (body: WorkflowDefinitionBody) => void
}): React.JSX.Element {
  const graph = body.dependencyMode === 'graph'
  const others = body.steps.filter((candidate) => candidate.id !== step.id)
  const deps = body.steps.filter((candidate) => step.dependsOn.includes(candidate.id))
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">
        {translate('auto.components.workflows.step.dependsOn', 'Runs after')}
      </legend>
      {graph ? (
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {others.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              {translate(
                'auto.components.workflows.step.noOtherSteps',
                'Add more steps to connect them.'
              )}
            </span>
          ) : null}
          {others.map((candidate) => {
            const checked = step.dependsOn.includes(candidate.id)
            const loops = !checked && wouldCreateDependencyCycle(body, step.id, candidate.id)
            return (
              <label key={candidate.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={checked}
                  disabled={loops}
                  onCheckedChange={(value) =>
                    onChange(setWorkflowDependency(body, step.id, candidate.id, value === true))
                  }
                />
                <span className={loops ? 'text-muted-foreground' : undefined}>
                  {candidate.name || candidate.id}
                </span>
              </label>
            )
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {index === 0
            ? translate(
                'auto.components.workflows.step.firstStep',
                'First step: starts when the run starts.'
              )
            : translate(
                'auto.components.workflows.step.sequentialAfter',
                'Runs after {{value0}}. Switch the workflow to graph mode to change dependencies.',
                {
                  value0: deps[0]?.name || deps[0]?.id || ''
                }
              )}
        </p>
      )}
      {deps.length > 0 ? (
        <div className="space-y-1.5 rounded-md border border-border p-3">
          <p className="text-xs font-medium">
            {translate('auto.components.workflows.step.inputs', 'Pass to this step')}
          </p>
          {deps.map((dep) => {
            const input = step.inputs.find((entry) => entry.stepId === dep.id)
            return (
              <div key={dep.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="min-w-32 truncate text-muted-foreground">
                  {dep.name || dep.id}
                </span>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={input?.summary ?? false}
                    onCheckedChange={(value) =>
                      onChange(
                        setWorkflowStepInput(body, step.id, dep.id, 'summary', value === true)
                      )
                    }
                  />
                  {translate('auto.components.workflows.step.inputSummary', 'Result summary')}
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={input?.artifacts ?? false}
                    onCheckedChange={(value) =>
                      onChange(
                        setWorkflowStepInput(body, step.id, dep.id, 'artifacts', value === true)
                      )
                    }
                  />
                  {translate('auto.components.workflows.step.inputFiles', 'Changed files')}
                </label>
              </div>
            )
          })}
        </div>
      ) : null}
      {errors.map((error) => (
        <p key={error} className="text-xs text-destructive">
          {error}
        </p>
      ))}
    </fieldset>
  )
}
