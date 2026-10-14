import { z } from 'zod'

/** Version of the definition body; stored on every revision and in exported JSON. */
export const WORKFLOW_SCHEMA_VERSION = 1 as const

export const WORKFLOW_MAX_CONCURRENCY_LIMIT = 8
export const WORKFLOW_MAX_STEPS = 50
export const WORKFLOW_MAX_PARAMETERS = 30
export const WORKFLOW_NAME_MAX_LENGTH = 120
export const WORKFLOW_DESCRIPTION_MAX_LENGTH = 2_000
export const WORKFLOW_STEP_TEXT_MAX_LENGTH = 40_000
export const WORKFLOW_PARAMETER_TEXT_MAX_LENGTH = 20_000

export const WORKFLOW_STEP_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/
export const WORKFLOW_PARAMETER_ID_PATTERN = /^[a-z][a-z0-9_]{0,47}$/

export const WORKFLOW_STEP_KINDS = ['agent', 'approval', 'integration'] as const
export type WorkflowStepKind = (typeof WORKFLOW_STEP_KINDS)[number]

/** `shared` runs in the run's workspace; `isolated` gets its own new child worktree (Git only). */
export const WORKFLOW_WORKSPACE_MODES = ['shared', 'isolated'] as const
export type WorkflowWorkspaceMode = (typeof WORKFLOW_WORKSPACE_MODES)[number]

/** `sequential` derives each step's dependency from list order; `graph` keeps explicit edges. */
export const WORKFLOW_DEPENDENCY_MODES = ['sequential', 'graph'] as const
export type WorkflowDependencyMode = (typeof WORKFLOW_DEPENDENCY_MODES)[number]

export const WORKFLOW_PARAMETER_TYPES = ['text', 'multiline', 'number', 'boolean', 'enum'] as const
export type WorkflowParameterType = (typeof WORKFLOW_PARAMETER_TYPES)[number]

export type WorkflowParameterValue = string | number | boolean

const ParameterValueSchema = z.union([z.string(), z.number(), z.boolean()])

export const WorkflowParameterSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(WORKFLOW_PARAMETER_TYPES),
  required: z.boolean(),
  description: z.string().optional(),
  defaultValue: ParameterValueSchema.optional(),
  options: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional()
})
export type WorkflowParameter = z.infer<typeof WorkflowParameterSchema>

export const WorkflowStepInputSchema = z.object({
  stepId: z.string(),
  summary: z.boolean(),
  artifacts: z.boolean()
})
/** Which parts of a direct predecessor's result are appended to this step's prompt. */
export type WorkflowStepInput = z.infer<typeof WorkflowStepInputSchema>

export const WorkflowStepSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(WORKFLOW_STEP_KINDS),
  /** Agent steps: the task prompt. Approval/integration steps: the question shown to the user. */
  prompt: z.string(),
  /** Unset inherits the workflow default, then the host's configured default agent. */
  agent: z.string().optional(),
  /** Opaque provider ids; unset keeps the agent's own configuration. */
  model: z.string().optional(),
  effort: z.string().optional(),
  dependsOn: z.array(z.string()),
  inputs: z.array(WorkflowStepInputSchema),
  expectedOutput: z.string().optional(),
  workspaceMode: z.enum(WORKFLOW_WORKSPACE_MODES)
})
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>

/** Host-bound defaults; never exported, re-chosen after import. */
export const WorkflowDefaultTargetSchema = z.object({
  hostId: z.string(),
  workspaceId: z.string()
})
export type WorkflowDefaultTarget = z.infer<typeof WorkflowDefaultTargetSchema>

export const WorkflowDefinitionBodySchema = z.object({
  name: z.string(),
  description: z.string(),
  defaultAgent: z.string().optional(),
  defaultTarget: WorkflowDefaultTargetSchema.optional(),
  dependencyMode: z.enum(WORKFLOW_DEPENDENCY_MODES),
  maxConcurrency: z.number(),
  parameters: z.array(WorkflowParameterSchema),
  steps: z.array(WorkflowStepSchema)
})
export type WorkflowDefinitionBody = z.infer<typeof WorkflowDefinitionBodySchema>

export const WORKFLOW_DEFINITION_KINDS = ['workflow', 'template'] as const
export type WorkflowDefinitionKind = (typeof WORKFLOW_DEFINITION_KINDS)[number]

/** A stored definition: stable identity plus the body of its current revision. */
export type WorkflowDefinition = {
  id: string
  kind: WorkflowDefinitionKind
  revision: number
  schemaVersion: number
  body: WorkflowDefinitionBody
  createdAt: string
  updatedAt: string
}

export function createEmptyWorkflowStep(id: string, name: string): WorkflowStep {
  return {
    id,
    name,
    kind: 'agent',
    prompt: '',
    dependsOn: [],
    inputs: [],
    workspaceMode: 'shared'
  }
}

export function createEmptyWorkflowBody(name: string): WorkflowDefinitionBody {
  return {
    name,
    description: '',
    dependencyMode: 'sequential',
    maxConcurrency: 1,
    parameters: [],
    steps: []
  }
}

/**
 * Re-derives a sequential definition's edges from list order. Inputs that still name the new
 * predecessor are kept; a step that gains a predecessor gets both of its outputs by default.
 */
export function applySequentialDependencies(body: WorkflowDefinitionBody): WorkflowDefinitionBody {
  if (body.dependencyMode !== 'sequential') {
    return body
  }
  const steps = body.steps.map((step, index) => {
    const previous = index > 0 ? body.steps[index - 1] : undefined
    if (!previous) {
      return { ...step, dependsOn: [], inputs: [] }
    }
    const kept = step.inputs.find((input) => input.stepId === previous.id)
    return {
      ...step,
      dependsOn: [previous.id],
      inputs: [kept ?? { stepId: previous.id, summary: true, artifacts: true }]
    }
  })
  return { ...body, steps }
}

/** Drops inputs whose step is no longer a direct predecessor, keeping user choices for the rest. */
export function pruneStepInputs(step: WorkflowStep): WorkflowStep {
  const deps = new Set(step.dependsOn)
  return { ...step, inputs: step.inputs.filter((input) => deps.has(input.stepId)) }
}

/** Suggests a step id that does not collide with existing ones. */
export function nextWorkflowStepId(steps: readonly Pick<WorkflowStep, 'id'>[]): string {
  const taken = new Set(steps.map((step) => step.id))
  for (let index = steps.length + 1; ; index += 1) {
    const candidate = `step-${index}`
    if (!taken.has(candidate)) {
      return candidate
    }
  }
}
