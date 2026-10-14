import {
  applySequentialDependencies,
  createEmptyWorkflowStep,
  nextWorkflowStepId,
  pruneStepInputs,
  type WorkflowDefinitionBody,
  type WorkflowDependencyMode,
  type WorkflowParameter,
  type WorkflowStep
} from './workflow-definition'
import { ancestorsUntil } from './workflow-graph'
import { renameWorkflowStepReferences } from './workflow-prompt-template'

/** Every edit returns a new body; a sequential definition re-derives its chain after each one. */
function finish(body: WorkflowDefinitionBody): WorkflowDefinitionBody {
  return applySequentialDependencies(body)
}

export function addWorkflowStep(
  body: WorkflowDefinitionBody,
  name: string,
  afterIndex = body.steps.length - 1
): { body: WorkflowDefinitionBody; index: number } {
  const step = createEmptyWorkflowStep(nextWorkflowStepId(body.steps), name)
  const index = Math.min(Math.max(afterIndex + 1, 0), body.steps.length)
  const steps = [...body.steps.slice(0, index), step, ...body.steps.slice(index)]
  return { body: finish({ ...body, steps }), index }
}

export function duplicateWorkflowStep(
  body: WorkflowDefinitionBody,
  index: number,
  nameSuffix: string
): { body: WorkflowDefinitionBody; index: number } {
  const source = body.steps[index]
  if (!source) {
    return { body, index }
  }
  const copy: WorkflowStep = {
    ...source,
    id: nextWorkflowStepId(body.steps),
    name: `${source.name}${nameSuffix}`
  }
  const steps = [...body.steps.slice(0, index + 1), copy, ...body.steps.slice(index + 1)]
  return { body: finish({ ...body, steps }), index: index + 1 }
}

/** Removes a step and every edge pointing at it; prompt references stay and are flagged. */
export function removeWorkflowStep(
  body: WorkflowDefinitionBody,
  index: number
): WorkflowDefinitionBody {
  const removed = body.steps[index]
  if (!removed) {
    return body
  }
  const steps = body.steps
    .filter((_, position) => position !== index)
    .map((step) =>
      pruneStepInputs({ ...step, dependsOn: step.dependsOn.filter((dep) => dep !== removed.id) })
    )
  return finish({ ...body, steps })
}

export function moveWorkflowStep(
  body: WorkflowDefinitionBody,
  from: number,
  to: number
): WorkflowDefinitionBody {
  if (from === to || !body.steps[from] || to < 0 || to >= body.steps.length) {
    return body
  }
  const steps = [...body.steps]
  const [moved] = steps.splice(from, 1)
  if (moved) {
    steps.splice(to, 0, moved)
  }
  return finish({ ...body, steps })
}

/** Applies field edits; renaming an id follows it through edges, inputs and prompt references. */
export function updateWorkflowStep(
  body: WorkflowDefinitionBody,
  index: number,
  patch: Partial<WorkflowStep>
): WorkflowDefinitionBody {
  const current = body.steps[index]
  if (!current) {
    return body
  }
  const next = { ...current, ...patch }
  const renamed = patch.id !== undefined && patch.id !== current.id ? patch.id : null
  const steps = body.steps.map((step, position) => {
    const base = position === index ? next : step
    if (!renamed) {
      return base
    }
    return {
      ...base,
      dependsOn: base.dependsOn.map((dep) => (dep === current.id ? renamed : dep)),
      inputs: base.inputs.map((input) =>
        input.stepId === current.id ? { ...input, stepId: renamed } : input
      ),
      prompt: renameWorkflowStepReferences(base.prompt, current.id, renamed)
    }
  })
  return finish({ ...body, steps })
}

/** Switching to graph keeps today's edges, so a sequential definition means the same thing after. */
export function setWorkflowDependencyMode(
  body: WorkflowDefinitionBody,
  mode: WorkflowDependencyMode
): WorkflowDefinitionBody {
  return finish({ ...body, dependencyMode: mode })
}

export function wouldCreateDependencyCycle(
  body: WorkflowDefinitionBody,
  stepId: string,
  dependencyId: string
): boolean {
  if (stepId === dependencyId) {
    return true
  }
  // Adding stepId → dependencyId closes a loop when stepId is already an ancestor of dependencyId.
  return ancestorsUntil(body.steps, dependencyId, () => false).has(stepId)
}

export function setWorkflowDependency(
  body: WorkflowDefinitionBody,
  stepId: string,
  dependencyId: string,
  enabled: boolean
): WorkflowDefinitionBody {
  if (body.dependencyMode !== 'graph') {
    return body
  }
  if (enabled && wouldCreateDependencyCycle(body, stepId, dependencyId)) {
    return body
  }
  const steps = body.steps.map((step) => {
    if (step.id !== stepId) {
      return step
    }
    if (enabled) {
      return step.dependsOn.includes(dependencyId)
        ? step
        : {
            ...step,
            dependsOn: [...step.dependsOn, dependencyId],
            inputs: [...step.inputs, { stepId: dependencyId, summary: true, artifacts: true }]
          }
    }
    return pruneStepInputs({
      ...step,
      dependsOn: step.dependsOn.filter((dep) => dep !== dependencyId)
    })
  })
  return finish({ ...body, steps })
}

export function setWorkflowStepInput(
  body: WorkflowDefinitionBody,
  stepId: string,
  dependencyId: string,
  field: 'summary' | 'artifacts',
  value: boolean
): WorkflowDefinitionBody {
  const steps = body.steps.map((step) => {
    if (step.id !== stepId || !step.dependsOn.includes(dependencyId)) {
      return step
    }
    const existing = step.inputs.find((input) => input.stepId === dependencyId)
    const updated = {
      ...(existing ?? { stepId: dependencyId, summary: false, artifacts: false }),
      [field]: value
    }
    return {
      ...step,
      inputs: existing
        ? step.inputs.map((input) => (input.stepId === dependencyId ? updated : input))
        : [...step.inputs, updated]
    }
  })
  return finish({ ...body, steps })
}

export function nextWorkflowParameterId(
  parameters: readonly Pick<WorkflowParameter, 'id'>[]
): string {
  const taken = new Set(parameters.map((parameter) => parameter.id))
  for (let index = parameters.length + 1; ; index += 1) {
    const candidate = `param_${index}`
    if (!taken.has(candidate)) {
      return candidate
    }
  }
}

export function addWorkflowParameter(
  body: WorkflowDefinitionBody,
  label: string
): WorkflowDefinitionBody {
  const parameter: WorkflowParameter = {
    id: nextWorkflowParameterId(body.parameters),
    label,
    type: 'text',
    required: false
  }
  return { ...body, parameters: [...body.parameters, parameter] }
}

export function updateWorkflowParameter(
  body: WorkflowDefinitionBody,
  index: number,
  patch: Partial<WorkflowParameter>
): WorkflowDefinitionBody {
  return {
    ...body,
    parameters: body.parameters.map((parameter, position) =>
      position === index ? { ...parameter, ...patch } : parameter
    )
  }
}

export function removeWorkflowParameter(
  body: WorkflowDefinitionBody,
  index: number
): WorkflowDefinitionBody {
  return { ...body, parameters: body.parameters.filter((_, position) => position !== index) }
}
