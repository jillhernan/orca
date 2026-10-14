import { useRef } from 'react'
import { Braces } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import type {
  WorkflowParameter,
  WorkflowStep
} from '../../../../shared/workflows/workflow-definition'
import {
  formatWorkflowParamReference,
  formatWorkflowStepReference
} from '../../../../shared/workflows/workflow-prompt-template'

/** Prompt text plus a picker for the variables this step may use: parameters and direct predecessors. */
export function WorkflowPromptField({
  id,
  label,
  value,
  placeholder,
  parameters,
  predecessors,
  errors,
  onChange
}: {
  id: string
  label: string
  value: string
  placeholder: string
  parameters: readonly WorkflowParameter[]
  predecessors: readonly WorkflowStep[]
  errors: readonly string[]
  onChange: (value: string) => void
}): React.JSX.Element {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const insert = (token: string): void => {
    const element = textarea.current
    const start = element?.selectionStart ?? value.length
    const end = element?.selectionEnd ?? value.length
    onChange(`${value.slice(0, start)}${token}${value.slice(end)}`)
    requestAnimationFrame(() => {
      element?.focus()
      element?.setSelectionRange(start + token.length, start + token.length)
    })
  }
  const hasVariables = parameters.length > 0 || predecessors.length > 0
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="xs" disabled={!hasVariables}>
              <Braces />
              {translate('auto.components.workflows.prompt.insertVariable', 'Insert variable')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {parameters.length > 0 ? (
              <>
                <DropdownMenuLabel>
                  {translate('auto.components.workflows.prompt.parameters', 'Parameters')}
                </DropdownMenuLabel>
                {parameters.map((parameter) => (
                  <DropdownMenuItem
                    key={parameter.id}
                    onSelect={() => insert(formatWorkflowParamReference(parameter.id))}
                  >
                    {parameter.label || parameter.id}
                  </DropdownMenuItem>
                ))}
              </>
            ) : null}
            {parameters.length > 0 && predecessors.length > 0 ? <DropdownMenuSeparator /> : null}
            {predecessors.length > 0 ? (
              <>
                <DropdownMenuLabel>
                  {translate('auto.components.workflows.prompt.previousSteps', 'Previous steps')}
                </DropdownMenuLabel>
                {predecessors.flatMap((step) => [
                  <DropdownMenuItem
                    key={`${step.id}-summary`}
                    onSelect={() => insert(formatWorkflowStepReference(step.id, 'summary'))}
                  >
                    {translate(
                      'auto.components.workflows.prompt.summaryOf',
                      'Summary of {{value0}}',
                      {
                        value0: step.name || step.id
                      }
                    )}
                  </DropdownMenuItem>,
                  <DropdownMenuItem
                    key={`${step.id}-artifacts`}
                    onSelect={() => insert(formatWorkflowStepReference(step.id, 'artifacts'))}
                  >
                    {translate(
                      'auto.components.workflows.prompt.filesOf',
                      'Files changed by {{value0}}',
                      {
                        value0: step.name || step.id
                      }
                    )}
                  </DropdownMenuItem>
                ])}
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Textarea
        ref={textarea}
        id={id}
        value={value}
        placeholder={placeholder}
        aria-invalid={errors.length > 0}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-40"
      />
      {errors.map((error) => (
        <p key={error} className="text-xs text-destructive">
          {error}
        </p>
      ))}
    </div>
  )
}
