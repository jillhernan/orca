import type {
  WorkflowDefinitionBody,
  WorkflowParameterValue,
  WorkflowStepKind,
  WorkflowWorkspaceMode
} from './workflow-definition'
import type { WorkflowRunTarget } from './workflow-run-types'
import type { WorkflowValidationIssue } from './workflow-validation-issues'

export type WorkflowLaunchInput = {
  /** Client-generated; a repeated start with the same id returns the run the first one created. */
  requestId: string
  definitionId: string
  definitionRevision: number
  /** The exact definition this run executes; later edits never reach it. */
  snapshot: WorkflowDefinitionBody
  params: Record<string, WorkflowParameterValue>
  workspaceId: string
  maxConcurrency?: number
  rerunOf?: string
}

export type WorkflowAgentSource = 'step' | 'workflow' | 'host'

export type WorkflowLaunchStepPlan = {
  stepId: string
  kind: WorkflowStepKind
  agent: string | null
  agentSource: WorkflowAgentSource | null
  model: string | null
  effort: string | null
  workspaceMode: WorkflowWorkspaceMode
  /** The prompt as the agent will receive it; earlier results appear as placeholders. */
  prompt: string | null
  byteLength: number
}

export type WorkflowLaunchNote =
  | 'isolated_from_commit'
  | 'folder_runs_serially'
  | 'shared_steps_take_turns'

export type WorkflowLaunchPlan = {
  issues: WorkflowValidationIssue[]
  target: WorkflowRunTarget | null
  params: Record<string, WorkflowParameterValue>
  maxConcurrency: number
  steps: WorkflowLaunchStepPlan[]
  notes: WorkflowLaunchNote[]
}
