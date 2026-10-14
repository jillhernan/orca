export type WorkflowValidationCode =
  | 'name_required'
  | 'name_too_long'
  | 'description_too_long'
  | 'max_concurrency_invalid'
  | 'steps_required'
  | 'steps_too_many'
  | 'step_id_invalid'
  | 'step_id_duplicate'
  | 'step_name_required'
  | 'step_prompt_required'
  | 'step_prompt_too_long'
  | 'agent_unavailable'
  | 'effort_requires_model'
  | 'dependency_self'
  | 'dependency_missing'
  | 'dependency_duplicate'
  | 'dependency_cycle'
  | 'input_not_predecessor'
  | 'integration_requires_dependency'
  | 'integration_required'
  | 'reference_invalid'
  | 'reference_unknown_param'
  | 'reference_unknown_step'
  | 'reference_not_predecessor'
  | 'parameters_too_many'
  | 'param_id_invalid'
  | 'param_id_duplicate'
  | 'param_label_required'
  | 'param_options_required'
  | 'param_default_invalid'
  | 'param_range_invalid'
  | 'param_value_required'
  | 'param_value_invalid'
  | 'param_value_unknown'
  | 'target_required'
  | 'target_not_git'
  | 'prompt_too_large'

/**
 * `field` locates the control to highlight: `workflow.<field>`, `steps.<index>.<field>`,
 * `parameters.<index>.<field>`, `launch.<field>` or `launch.params.<id>`.
 */
export type WorkflowValidationIssue = {
  code: WorkflowValidationCode
  field: string
  message: string
  stepIndex?: number
  stepId?: string
  parameterIndex?: number
  parameterId?: string
  /** Values the message interpolates, so a localized renderer can rebuild it. */
  detail?: Record<string, string | number>
}

export function stepIssue(
  index: number,
  stepId: string,
  field: string,
  code: WorkflowValidationCode,
  message: string,
  detail?: Record<string, string | number>
): WorkflowValidationIssue {
  return {
    code,
    field: `steps.${index}.${field}`,
    message,
    stepIndex: index,
    stepId,
    ...(detail ? { detail } : {})
  }
}

export function parameterIssue(
  index: number,
  parameterId: string,
  field: string,
  code: WorkflowValidationCode,
  message: string
): WorkflowValidationIssue {
  return {
    code,
    field: `parameters.${index}.${field}`,
    message,
    parameterIndex: index,
    parameterId
  }
}

export function workflowIssue(
  field: string,
  code: WorkflowValidationCode,
  message: string,
  detail?: Record<string, string | number>
): WorkflowValidationIssue {
  return { code, field: `workflow.${field}`, message, ...(detail ? { detail } : {}) }
}

export function launchIssue(
  field: string,
  code: WorkflowValidationCode,
  message: string,
  extra: Partial<WorkflowValidationIssue> = {}
): WorkflowValidationIssue {
  return { code, field: `launch.${field}`, message, ...extra }
}

/** One line per issue for receipts and errors that cannot render field highlights. */
export function summarizeWorkflowIssues(issues: readonly WorkflowValidationIssue[]): string {
  return issues
    .slice(0, 5)
    .map((issue) => issue.message)
    .join(' ')
    .concat(issues.length > 5 ? ` (+${issues.length - 5} more)` : '')
}
