import type { WorkflowStep } from './workflow-definition'
import { ancestorsUntil, findDependencyCycles } from './workflow-graph'
import { scanWorkflowPromptReferences } from './workflow-prompt-template'
import { stepIssue, type WorkflowValidationIssue } from './workflow-validation-issues'
export function validateStepReferences(
  step: WorkflowStep,
  index: number,
  stepIds: ReadonlySet<string>,
  parameterIds: ReadonlySet<string>
): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = []
  const deps = new Set(step.dependsOn)
  for (const reference of scanWorkflowPromptReferences(step.prompt)) {
    if (reference.kind === 'invalid') {
      issues.push(
        stepIssue(
          index,
          step.id,
          'prompt',
          'reference_invalid',
          `${reference.raw} is not a valid variable. Use {{params.<id>}} or {{steps.<id>.summary}}.`,
          { reference: reference.raw }
        )
      )
    } else if (reference.kind === 'param' && !parameterIds.has(reference.parameterId)) {
      issues.push(
        stepIssue(
          index,
          step.id,
          'prompt',
          'reference_unknown_param',
          `${reference.raw} names an unknown parameter.`,
          { reference: reference.raw }
        )
      )
    } else if (reference.kind === 'step' && !stepIds.has(reference.stepId)) {
      issues.push(
        stepIssue(
          index,
          step.id,
          'prompt',
          'reference_unknown_step',
          `${reference.raw} names an unknown step.`,
          { reference: reference.raw }
        )
      )
    } else if (reference.kind === 'step' && !deps.has(reference.stepId)) {
      issues.push(
        stepIssue(
          index,
          step.id,
          'prompt',
          'reference_not_predecessor',
          `${reference.raw} must name a direct predecessor of this step.`,
          { reference: reference.raw }
        )
      )
    }
  }
  return issues
}

export function validateCycles(steps: readonly WorkflowStep[]): WorkflowValidationIssue[] {
  const indexById = new Map(steps.map((step, index) => [step.id, index]))
  return findDependencyCycles(steps).map((cycle) => {
    const first = cycle[0] ?? ''
    const index = indexById.get(first) ?? 0
    const path = cycle.join(' → ')
    return stepIssue(
      index,
      first,
      'dependsOn',
      'dependency_cycle',
      `Dependencies form a loop: ${path}.`,
      { cycle: path }
    )
  })
}

/**
 * An isolated step works in its own worktree, so its code only reaches later agent steps after
 * someone integrates it. Every path from an isolated step to a later agent step must therefore
 * pass through a code integration step.
 */
export function validateIsolatedIntegration(
  steps: readonly WorkflowStep[]
): WorkflowValidationIssue[] {
  const byId = new Map(steps.map((step) => [step.id, step]))
  const issues: WorkflowValidationIssue[] = []
  steps.forEach((step, index) => {
    if (step.kind !== 'agent') {
      return
    }
    const reachable = ancestorsUntil(steps, step.id, (id) => byId.get(id)?.kind === 'integration')
    const isolated = [...reachable].filter((id) => {
      const ancestor = byId.get(id)
      return ancestor?.kind === 'agent' && ancestor.workspaceMode === 'isolated'
    })
    if (isolated.length > 0) {
      const names = isolated.map((id) => byId.get(id)?.name || id).join(', ')
      issues.push(
        stepIssue(
          index,
          step.id,
          'dependsOn',
          'integration_required',
          `Code from isolated step(s) ${names} reaches this step without a code integration step.`,
          { steps: names }
        )
      )
    }
  })
  return issues
}
