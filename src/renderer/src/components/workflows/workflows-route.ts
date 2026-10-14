import type {
  WorkflowDefinitionBody,
  WorkflowDefinitionKind
} from '../../../../shared/workflows/workflow-definition'

export type WorkflowEditorSeed = {
  kind: WorkflowDefinitionKind
  body: WorkflowDefinitionBody
}

export type WorkflowsRoute =
  | { kind: 'list' }
  | { kind: 'editor'; definitionId: string | null; seed?: WorkflowEditorSeed }
  | { kind: 'run'; hostKey: string; runId: string }
  | { kind: 'history'; definitionId?: string }

/** A route plus the identity it keeps while the page replaces it in place. */
export type WorkflowsNavEntry = { navId: number; route: WorkflowsRoute }

let lastNavId = 0

export function createWorkflowsNavEntry(route: WorkflowsRoute): WorkflowsNavEntry {
  lastNavId += 1
  return { navId: lastNavId, route }
}

/**
 * Where the page was, kept across unmounts so jumping to an agent terminal and back reopens the
 * same run instead of the list. Renderer-session memory only; nothing here is durable state.
 */
export const workflowsNavMemory: { stack: WorkflowsNavEntry[] } = {
  stack: [createWorkflowsNavEntry({ kind: 'list' })]
}
