import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
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
  WORKFLOW_PARAMETER_TYPES,
  type WorkflowDefinitionBody,
  type WorkflowParameter,
  type WorkflowParameterType
} from '../../../../shared/workflows/workflow-definition'
import {
  addWorkflowParameter,
  removeWorkflowParameter,
  updateWorkflowParameter
} from '../../../../shared/workflows/workflow-draft-edits'
import type { WorkflowValidationIssue } from '../../../../shared/workflows/workflow-validation-issues'
import { WorkflowParameterInput } from './WorkflowParameterInput'

let lastRowKey = 0

function nextRowKey(): string {
  lastRowKey += 1
  return `param-row-${lastRowKey}`
}

function typeLabel(type: WorkflowParameterType): string {
  switch (type) {
    case 'text':
      return translate('auto.components.workflows.params.typeText', 'Text')
    case 'multiline':
      return translate('auto.components.workflows.params.typeMultiline', 'Multi-line text')
    case 'number':
      return translate('auto.components.workflows.params.typeNumber', 'Number')
    case 'boolean':
      return translate('auto.components.workflows.params.typeBoolean', 'Yes / no')
    case 'enum':
      return translate('auto.components.workflows.params.typeEnum', 'Choice')
  }
}

export function WorkflowParametersEditor({
  body,
  issues,
  onChange
}: {
  body: WorkflowDefinitionBody
  issues: readonly WorkflowValidationIssue[]
  onChange: (body: WorkflowDefinitionBody) => void
}): React.JSX.Element {
  // Why: the variable name is editable, so it cannot be the React key without remounting the
  // field on every keystroke; each row keeps a client-only key instead.
  const [rowKeys, setRowKeys] = useState(() => body.parameters.map(() => nextRowKey()))
  const keys =
    rowKeys.length === body.parameters.length
      ? rowKeys
      : body.parameters.map((_, position) => rowKeys[position] ?? nextRowKey())
  const update = (index: number, patch: Partial<WorkflowParameter>): void =>
    onChange(updateWorkflowParameter(body, index, patch))
  const remove = (index: number): void => {
    setRowKeys(keys.filter((_, position) => position !== index))
    onChange(removeWorkflowParameter(body, index))
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {translate(
          'auto.components.workflows.params.help',
          'Parameters become a form when the workflow starts. Use Insert variable in a step prompt to place a value. Values are inserted as plain text; nothing is executed. Do not use parameters for passwords or tokens.'
        )}
      </p>
      {body.parameters.map((parameter, index) => {
        const errors = issues
          .filter((issue) => issue.parameterIndex === index)
          .map((issue) => issue.message)
        const idPrefix = `workflow-param-${index}`
        return (
          <div key={keys[index]} className="space-y-3 rounded-md border border-border p-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_12rem_auto]">
              <div className="space-y-1.5">
                <Label htmlFor={`${idPrefix}-label`}>
                  {translate('auto.components.workflows.params.label', 'Label')}
                </Label>
                <Input
                  id={`${idPrefix}-label`}
                  value={parameter.label}
                  onChange={(event) => update(index, { label: event.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${idPrefix}-id`}>
                  {translate('auto.components.workflows.params.id', 'Variable name')}
                </Label>
                <Input
                  id={`${idPrefix}-id`}
                  value={parameter.id}
                  spellCheck={false}
                  onChange={(event) => update(index, { id: event.target.value.trim() })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${idPrefix}-type`}>
                  {translate('auto.components.workflows.params.type', 'Type')}
                </Label>
                <Select
                  value={parameter.type}
                  onValueChange={(value) => {
                    const type = WORKFLOW_PARAMETER_TYPES.find((candidate) => candidate === value)
                    if (type) {
                      update(index, {
                        type,
                        defaultValue: undefined,
                        options: type === 'enum' ? (parameter.options ?? ['']) : undefined
                      })
                    }
                  }}
                >
                  <SelectTrigger id={`${idPrefix}-type`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WORKFLOW_PARAMETER_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {typeLabel(type)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-3 pb-1.5">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={parameter.required}
                    onCheckedChange={(value) => update(index, { required: value === true })}
                  />
                  {translate('auto.components.workflows.params.required', 'Required')}
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={translate(
                    'auto.components.workflows.params.remove',
                    'Remove parameter'
                  )}
                  onClick={() => remove(index)}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
            {parameter.type === 'enum' ? (
              <div className="space-y-1.5">
                <Label htmlFor={`${idPrefix}-options`}>
                  {translate('auto.components.workflows.params.options', 'Choices (one per line)')}
                </Label>
                <Textarea
                  id={`${idPrefix}-options`}
                  value={(parameter.options ?? []).join('\n')}
                  onChange={(event) => update(index, { options: event.target.value.split('\n') })}
                />
              </div>
            ) : null}
            {parameter.type === 'number' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`${idPrefix}-min`}>
                    {translate('auto.components.workflows.params.min', 'Minimum')}
                  </Label>
                  <Input
                    id={`${idPrefix}-min`}
                    type="number"
                    value={parameter.min ?? ''}
                    onChange={(event) =>
                      update(index, {
                        min: event.target.value === '' ? undefined : Number(event.target.value)
                      })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${idPrefix}-max`}>
                    {translate('auto.components.workflows.params.max', 'Maximum')}
                  </Label>
                  <Input
                    id={`${idPrefix}-max`}
                    type="number"
                    value={parameter.max ?? ''}
                    onChange={(event) =>
                      update(index, {
                        max: event.target.value === '' ? undefined : Number(event.target.value)
                      })
                    }
                  />
                </div>
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <WorkflowParameterInput
                id={`${idPrefix}-default`}
                label={translate('auto.components.workflows.params.default', 'Default value')}
                parameter={parameter}
                value={parameter.defaultValue}
                onChange={(defaultValue) => update(index, { defaultValue })}
              />
              <div className="space-y-1.5">
                <Label htmlFor={`${idPrefix}-description`}>
                  {translate('auto.components.workflows.params.description', 'Help text')}
                </Label>
                <Input
                  id={`${idPrefix}-description`}
                  value={parameter.description ?? ''}
                  onChange={(event) =>
                    update(index, { description: event.target.value || undefined })
                  }
                />
              </div>
            </div>
            {errors.map((error) => (
              <p key={error} className="text-xs text-destructive">
                {error}
              </p>
            ))}
          </div>
        )
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setRowKeys([...keys, nextRowKey()])
          onChange(
            addWorkflowParameter(
              body,
              translate('auto.components.workflows.params.newLabel', 'New parameter')
            )
          )
        }}
      >
        <Plus />
        {translate('auto.components.workflows.params.add', 'Add parameter')}
      </Button>
    </div>
  )
}
