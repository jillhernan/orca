import {
  WORKFLOW_MAX_PARAMETERS,
  WORKFLOW_PARAMETER_ID_PATTERN,
  WORKFLOW_PARAMETER_TEXT_MAX_LENGTH,
  type WorkflowParameter,
  type WorkflowParameterValue
} from './workflow-definition'
import {
  launchIssue,
  parameterIssue,
  workflowIssue,
  type WorkflowValidationIssue
} from './workflow-validation-issues'

/** Why a value does not fit a parameter, or null when it does. Shared by defaults and launch values. */
export function describeParameterValueProblem(
  parameter: WorkflowParameter,
  value: WorkflowParameterValue
): string | null {
  switch (parameter.type) {
    case 'text':
    case 'multiline':
      if (typeof value !== 'string') {
        return 'must be text'
      }
      if (parameter.type === 'text' && value.includes('\n')) {
        return 'must be a single line'
      }
      return value.length > WORKFLOW_PARAMETER_TEXT_MAX_LENGTH
        ? `must be at most ${WORKFLOW_PARAMETER_TEXT_MAX_LENGTH} characters`
        : null
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 'must be a number'
      }
      if (parameter.min !== undefined && value < parameter.min) {
        return `must be at least ${parameter.min}`
      }
      return parameter.max !== undefined && value > parameter.max
        ? `must be at most ${parameter.max}`
        : null
    case 'boolean':
      return typeof value === 'boolean' ? null : 'must be true or false'
    case 'enum':
      return typeof value === 'string' && (parameter.options ?? []).includes(value)
        ? null
        : 'must be one of the listed options'
  }
}

function isBlank(value: WorkflowParameterValue | undefined): boolean {
  return value === undefined || (typeof value === 'string' && value.trim().length === 0)
}

export function validateWorkflowParameters(
  parameters: readonly WorkflowParameter[]
): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = []
  if (parameters.length > WORKFLOW_MAX_PARAMETERS) {
    issues.push(
      workflowIssue(
        'parameters',
        'parameters_too_many',
        `A workflow can have at most ${WORKFLOW_MAX_PARAMETERS} parameters.`
      )
    )
  }
  const seen = new Set<string>()
  parameters.forEach((parameter, index) => {
    const id = parameter.id
    if (!WORKFLOW_PARAMETER_ID_PATTERN.test(id)) {
      issues.push(
        parameterIssue(
          index,
          id,
          'id',
          'param_id_invalid',
          `Parameter id "${id}" must start with a lowercase letter and use only a-z, 0-9 and _.`
        )
      )
    } else if (seen.has(id)) {
      issues.push(
        parameterIssue(index, id, 'id', 'param_id_duplicate', `Parameter id "${id}" is used twice.`)
      )
    }
    seen.add(id)
    if (parameter.label.trim().length === 0) {
      issues.push(
        parameterIssue(index, id, 'label', 'param_label_required', 'Parameter needs a label.')
      )
    }
    if (parameter.type === 'enum') {
      const options = parameter.options ?? []
      const usable = options.filter((option) => option.trim().length > 0)
      if (usable.length === 0 || usable.length !== options.length) {
        issues.push(
          parameterIssue(
            index,
            id,
            'options',
            'param_options_required',
            'A choice parameter needs at least one non-empty option.'
          )
        )
      }
    }
    if (
      parameter.type === 'number' &&
      parameter.min !== undefined &&
      parameter.max !== undefined &&
      parameter.min > parameter.max
    ) {
      issues.push(
        parameterIssue(index, id, 'min', 'param_range_invalid', 'Minimum is greater than maximum.')
      )
    }
    if (parameter.defaultValue !== undefined && !isBlank(parameter.defaultValue)) {
      const problem = describeParameterValueProblem(parameter, parameter.defaultValue)
      if (problem) {
        issues.push(
          parameterIssue(
            index,
            id,
            'defaultValue',
            'param_default_invalid',
            `Default value ${problem}.`
          )
        )
      }
    }
  })
  return issues
}

/** Resolves launch values against the schema: defaults fill gaps, unknown keys are refused. */
export function resolveWorkflowParameterValues(
  parameters: readonly WorkflowParameter[],
  provided: Readonly<Record<string, WorkflowParameterValue>>
): { values: Record<string, WorkflowParameterValue>; issues: WorkflowValidationIssue[] } {
  const issues: WorkflowValidationIssue[] = []
  const values: Record<string, WorkflowParameterValue> = {}
  const known = new Set(parameters.map((parameter) => parameter.id))
  for (const key of Object.keys(provided)) {
    if (!known.has(key)) {
      issues.push(
        launchIssue(`params.${key}`, 'param_value_unknown', `Unknown parameter "${key}".`, {
          parameterId: key
        })
      )
    }
  }
  for (const parameter of parameters) {
    const value = Object.hasOwn(provided, parameter.id)
      ? provided[parameter.id]
      : parameter.defaultValue
    const field = `params.${parameter.id}`
    if (value === undefined || isBlank(value)) {
      if (parameter.required) {
        issues.push(
          launchIssue(field, 'param_value_required', `${parameter.label} is required.`, {
            parameterId: parameter.id
          })
        )
      } else {
        values[parameter.id] = parameter.type === 'boolean' ? false : ''
      }
      continue
    }
    const problem = describeParameterValueProblem(parameter, value)
    if (problem) {
      issues.push(
        launchIssue(field, 'param_value_invalid', `${parameter.label} ${problem}.`, {
          parameterId: parameter.id
        })
      )
      continue
    }
    values[parameter.id] = value
  }
  return { values, issues }
}
