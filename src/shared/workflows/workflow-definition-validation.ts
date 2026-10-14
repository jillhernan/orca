import {
  WORKFLOW_DESCRIPTION_MAX_LENGTH,
  WORKFLOW_MAX_CONCURRENCY_LIMIT,
  WORKFLOW_MAX_STEPS,
  WORKFLOW_NAME_MAX_LENGTH,
  WORKFLOW_STEP_ID_PATTERN,
  WORKFLOW_STEP_TEXT_MAX_LENGTH,
  type WorkflowDefinitionBody,
  type WorkflowStep
} from './workflow-definition'
import { validateWorkflowParameters } from './workflow-parameter-validation'
import {
  validateCycles,
  validateIsolatedIntegration,
  validateStepReferences
} from './workflow-step-graph-rules'
import {
  stepIssue,
  workflowIssue,
  type WorkflowValidationIssue
} from './workflow-validation-issues'

export type WorkflowValidationContext = {
  /** Agent ids enabled on the target host. Omitted when unknown, which skips the agent check. */
  availableAgents?: readonly string[]
}

export function validateWorkflowDefinition(
  body: WorkflowDefinitionBody,
  context: WorkflowValidationContext = {}
): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = []
  const name = body.name.trim()
  if (name.length === 0) {
    issues.push(workflowIssue('name', 'name_required', 'Workflow needs a name.'))
  } else if (name.length > WORKFLOW_NAME_MAX_LENGTH) {
    issues.push(
      workflowIssue(
        'name',
        'name_too_long',
        `Name must be at most ${WORKFLOW_NAME_MAX_LENGTH} characters.`
      )
    )
  }
  if (body.description.length > WORKFLOW_DESCRIPTION_MAX_LENGTH) {
    issues.push(
      workflowIssue(
        'description',
        'description_too_long',
        `Description must be at most ${WORKFLOW_DESCRIPTION_MAX_LENGTH} characters.`
      )
    )
  }
  if (
    !Number.isInteger(body.maxConcurrency) ||
    body.maxConcurrency < 1 ||
    body.maxConcurrency > WORKFLOW_MAX_CONCURRENCY_LIMIT
  ) {
    issues.push(
      workflowIssue(
        'maxConcurrency',
        'max_concurrency_invalid',
        `Max parallel steps must be a whole number from 1 to ${WORKFLOW_MAX_CONCURRENCY_LIMIT}.`
      )
    )
  }
  if (
    context.availableAgents &&
    body.defaultAgent &&
    !context.availableAgents.includes(body.defaultAgent)
  ) {
    issues.push(
      workflowIssue(
        'defaultAgent',
        'agent_unavailable',
        `Default agent "${body.defaultAgent}" is not available on this host.`,
        { agent: body.defaultAgent }
      )
    )
  }
  issues.push(...validateWorkflowParameters(body.parameters))
  if (body.steps.length === 0) {
    issues.push(workflowIssue('steps', 'steps_required', 'Add at least one step.'))
    return issues
  }
  if (body.steps.length > WORKFLOW_MAX_STEPS) {
    issues.push(
      workflowIssue(
        'steps',
        'steps_too_many',
        `A workflow can have at most ${WORKFLOW_MAX_STEPS} steps.`
      )
    )
  }
  const parameterIds = new Set(body.parameters.map((parameter) => parameter.id))
  const stepIds = new Set(body.steps.map((step) => step.id))
  const seenIds = new Set<string>()
  body.steps.forEach((step, index) => {
    issues.push(...validateStepFields(step, index, seenIds, context))
    seenIds.add(step.id)
    issues.push(...validateStepEdges(step, index, stepIds))
    issues.push(...validateStepReferences(step, index, stepIds, parameterIds))
  })
  issues.push(...validateCycles(body.steps))
  if (!issues.some((issue) => issue.code === 'dependency_cycle')) {
    issues.push(...validateIsolatedIntegration(body.steps))
  }
  return issues
}

function validateStepFields(
  step: WorkflowStep,
  index: number,
  seenIds: ReadonlySet<string>,
  context: WorkflowValidationContext
): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = []
  if (!WORKFLOW_STEP_ID_PATTERN.test(step.id)) {
    issues.push(
      stepIssue(
        index,
        step.id,
        'id',
        'step_id_invalid',
        `Step id "${step.id}" must use lowercase letters, digits, - or _ (max 48).`
      )
    )
  } else if (seenIds.has(step.id)) {
    issues.push(
      stepIssue(index, step.id, 'id', 'step_id_duplicate', `Step id "${step.id}" is used twice.`)
    )
  }
  if (step.name.trim().length === 0) {
    issues.push(stepIssue(index, step.id, 'name', 'step_name_required', 'Step needs a name.'))
  }
  if (step.prompt.trim().length === 0) {
    issues.push(
      stepIssue(
        index,
        step.id,
        'prompt',
        'step_prompt_required',
        step.kind === 'agent' ? 'Step needs a prompt.' : 'Step needs a question for the reviewer.'
      )
    )
  } else if (step.prompt.length > WORKFLOW_STEP_TEXT_MAX_LENGTH) {
    issues.push(
      stepIssue(
        index,
        step.id,
        'prompt',
        'step_prompt_too_long',
        `Prompt must be at most ${WORKFLOW_STEP_TEXT_MAX_LENGTH} characters.`
      )
    )
  }
  if (step.kind !== 'agent') {
    return issues
  }
  if (context.availableAgents && step.agent && !context.availableAgents.includes(step.agent)) {
    issues.push(
      stepIssue(
        index,
        step.id,
        'agent',
        'agent_unavailable',
        `Agent "${step.agent}" is not available on this host.`,
        { agent: step.agent }
      )
    )
  }
  if (step.effort && !step.model) {
    issues.push(
      stepIssue(
        index,
        step.id,
        'effort',
        'effort_requires_model',
        'Choose a model before choosing a reasoning level.'
      )
    )
  }
  return issues
}

function validateStepEdges(
  step: WorkflowStep,
  index: number,
  stepIds: ReadonlySet<string>
): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = []
  const seenDeps = new Set<string>()
  for (const dep of step.dependsOn) {
    if (dep === step.id) {
      issues.push(
        stepIssue(index, step.id, 'dependsOn', 'dependency_self', 'A step cannot depend on itself.')
      )
    } else if (!stepIds.has(dep)) {
      issues.push(
        stepIssue(
          index,
          step.id,
          'dependsOn',
          'dependency_missing',
          `Depends on unknown step "${dep}".`,
          { dependency: dep }
        )
      )
    } else if (seenDeps.has(dep)) {
      issues.push(
        stepIssue(
          index,
          step.id,
          'dependsOn',
          'dependency_duplicate',
          `Dependency on "${dep}" is listed twice.`,
          { dependency: dep }
        )
      )
    }
    seenDeps.add(dep)
  }
  const deps = new Set(step.dependsOn)
  for (const input of step.inputs) {
    if (!deps.has(input.stepId)) {
      issues.push(
        stepIssue(
          index,
          step.id,
          'inputs',
          'input_not_predecessor',
          `Input "${input.stepId}" is not a direct predecessor of this step.`,
          { dependency: input.stepId }
        )
      )
    }
  }
  if (step.kind === 'integration' && step.dependsOn.length === 0) {
    issues.push(
      stepIssue(
        index,
        step.id,
        'dependsOn',
        'integration_requires_dependency',
        'A code integration step must depend on the branches it integrates.'
      )
    )
  }
  return issues
}
