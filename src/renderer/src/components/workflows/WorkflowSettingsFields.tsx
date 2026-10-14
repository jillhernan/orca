import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import {
  WORKFLOW_MAX_CONCURRENCY_LIMIT,
  type WorkflowDefinitionBody
} from '../../../../shared/workflows/workflow-definition'
import { setWorkflowDependencyMode } from '../../../../shared/workflows/workflow-draft-edits'
import type { WorkflowValidationIssue } from '../../../../shared/workflows/workflow-validation-issues'
import { WorkflowAgentFields } from './WorkflowAgentFields'
import { issueMessage } from './workflow-status-copy'

export function WorkflowSettingsFields({
  body,
  issues,
  onChange
}: {
  body: WorkflowDefinitionBody
  issues: readonly WorkflowValidationIssue[]
  onChange: (body: WorkflowDefinitionBody) => void
}): React.JSX.Element {
  const errorFor = (field: string): string | null => {
    const issue = issues.find((candidate) => candidate.field === `workflow.${field}`)
    return issue ? issueMessage(issue) : null
  }
  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <WorkflowAgentFields
        idPrefix="workflow-default"
        agent={body.defaultAgent}
        model={undefined}
        effort={undefined}
        inheritLabel={translate(
          'auto.components.workflows.settings.hostDefault',
          "Host's default agent"
        )}
        agentError={errorFor('defaultAgent')}
        showLaunchPreferences={false}
        onChange={(patch) => onChange({ ...body, defaultAgent: patch.agent })}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="workflow-mode">
            {translate('auto.components.workflows.settings.mode', 'Step order')}
          </Label>
          <Select
            value={body.dependencyMode}
            onValueChange={(value) =>
              onChange(setWorkflowDependencyMode(body, value === 'graph' ? 'graph' : 'sequential'))
            }
          >
            <SelectTrigger id="workflow-mode" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sequential">
                {translate(
                  'auto.components.workflows.settings.sequential',
                  'One after another, in list order'
                )}
              </SelectItem>
              <SelectItem value="graph">
                {translate(
                  'auto.components.workflows.settings.graph',
                  'By dependencies (branches and joins)'
                )}
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {body.dependencyMode === 'sequential'
              ? translate(
                  'auto.components.workflows.settings.sequentialHelp',
                  'Switching to dependencies keeps the current order as the starting graph.'
                )
              : translate(
                  'auto.components.workflows.settings.graphHelp',
                  'Switching back to list order replaces the dependencies with a simple chain.'
                )}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="workflow-concurrency">
            {translate(
              'auto.components.workflows.settings.concurrency',
              'Max parallel agent steps'
            )}
          </Label>
          <Input
            id="workflow-concurrency"
            type="number"
            min={1}
            max={WORKFLOW_MAX_CONCURRENCY_LIMIT}
            step={1}
            value={body.maxConcurrency}
            aria-invalid={Boolean(errorFor('maxConcurrency'))}
            onChange={(event) => onChange({ ...body, maxConcurrency: Number(event.target.value) })}
          />
          <p className="text-xs text-muted-foreground">
            {errorFor('maxConcurrency') ??
              translate(
                'auto.components.workflows.settings.concurrencyHelp',
                'Steps that share the run workspace still take turns; only isolated steps run side by side.'
              )}
          </p>
        </div>
      </div>
      {body.defaultTarget ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">
            {translate(
              'auto.components.workflows.settings.defaultTarget',
              'Default workspace for runs: {{value0}}',
              {
                value0: body.defaultTarget.workspaceId
              }
            )}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => onChange({ ...body, defaultTarget: undefined })}
          >
            <X />
            {translate('auto.components.workflows.settings.clearTarget', 'Clear')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
