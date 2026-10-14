import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type {
  WorkflowParameter,
  WorkflowParameterValue
} from '../../../../shared/workflows/workflow-definition'

const UNSET = '__unset__'

/** One typed control per parameter type; used for defaults in the editor and values at launch. */
export function WorkflowParameterInput({
  id,
  label,
  parameter,
  value,
  error,
  onChange
}: {
  id: string
  label: string
  parameter: WorkflowParameter
  value: WorkflowParameterValue | undefined
  error?: string | null
  onChange: (value: WorkflowParameterValue | undefined) => void
}): React.JSX.Element {
  const invalid = Boolean(error)
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {parameter.required ? <span aria-hidden="true"> *</span> : null}
      </Label>
      {parameter.type === 'multiline' ? (
        <Textarea
          id={id}
          value={typeof value === 'string' ? value : ''}
          aria-invalid={invalid}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : parameter.type === 'number' ? (
        <Input
          id={id}
          type="number"
          min={parameter.min}
          max={parameter.max}
          value={typeof value === 'number' ? value : ''}
          aria-invalid={invalid}
          onChange={(event) =>
            onChange(event.target.value === '' ? undefined : Number(event.target.value))
          }
        />
      ) : parameter.type === 'boolean' ? (
        <div className="flex h-9 items-center">
          <Switch
            id={id}
            checked={value === true}
            onCheckedChange={(checked) => onChange(checked)}
          />
        </div>
      ) : parameter.type === 'enum' ? (
        <Select
          value={typeof value === 'string' && value ? value : UNSET}
          onValueChange={(next) => onChange(next === UNSET ? undefined : next)}
        >
          <SelectTrigger id={id} aria-invalid={invalid} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNSET}>
              {translate('auto.components.workflows.params.noChoice', 'No choice')}
            </SelectItem>
            {(parameter.options ?? [])
              .filter((option) => option.trim().length > 0)
              .map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          id={id}
          value={typeof value === 'string' ? value : ''}
          aria-invalid={invalid}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : parameter.description ? (
        <p className="text-xs text-muted-foreground">{parameter.description}</p>
      ) : null}
    </div>
  )
}
