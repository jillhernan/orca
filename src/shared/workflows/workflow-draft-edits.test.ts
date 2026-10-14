import { describe, expect, it } from 'vitest'
import {
  applySequentialDependencies,
  createEmptyWorkflowBody,
  type WorkflowDefinitionBody,
  type WorkflowStep
} from './workflow-definition'
import {
  addWorkflowStep,
  moveWorkflowStep,
  removeWorkflowStep,
  setWorkflowDependency,
  setWorkflowDependencyMode,
  updateWorkflowStep,
  wouldCreateDependencyCycle
} from './workflow-draft-edits'
import { validateWorkflowDefinition } from './workflow-definition-validation'

function step(id: string, overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    id,
    name: id,
    kind: 'agent',
    prompt: `Do ${id}`,
    dependsOn: [],
    inputs: [],
    workspaceMode: 'shared',
    ...overrides
  }
}

function sequential(ids: string[]): WorkflowDefinitionBody {
  return applySequentialDependencies({
    ...createEmptyWorkflowBody('W'),
    steps: ids.map((id) => step(id))
  })
}

const deps = (body: WorkflowDefinitionBody) => body.steps.map((s) => [s.id, s.dependsOn])

describe('workflow draft edits', () => {
  it('inserts after the selected step and keeps a sequential chain', () => {
    const { body, index } = addWorkflowStep(sequential(['a', 'b']), 'New', 0)
    expect(index).toBe(1)
    expect(deps(body)).toEqual([
      ['a', []],
      ['step-3', ['a']],
      ['b', ['step-3']]
    ])
  })

  it('re-derives the chain when steps move in sequential mode', () => {
    expect(deps(moveWorkflowStep(sequential(['a', 'b', 'c']), 2, 0))).toEqual([
      ['c', []],
      ['a', ['c']],
      ['b', ['a']]
    ])
  })

  it('keeps the same meaning when a sequential workflow switches to graph mode', () => {
    const graph = setWorkflowDependencyMode(sequential(['a', 'b', 'c']), 'graph')
    expect(deps(graph)).toEqual([
      ['a', []],
      ['b', ['a']],
      ['c', ['b']]
    ])
    // Reordering a graph only changes display order, never the edges.
    expect(deps(moveWorkflowStep(graph, 2, 0))).toEqual([
      ['c', ['b']],
      ['a', []],
      ['b', ['a']]
    ])
  })

  it('follows a renamed step id through edges, inputs and prompt references', () => {
    const graph = setWorkflowDependencyMode(sequential(['plan', 'build']), 'graph')
    const withRef = updateWorkflowStep(graph, 1, { prompt: 'Use {{steps.plan.summary}}' })
    const renamed = updateWorkflowStep(withRef, 0, { id: 'design' })
    expect(renamed.steps[1]).toMatchObject({
      dependsOn: ['design'],
      inputs: [{ stepId: 'design', summary: true, artifacts: true }],
      prompt: 'Use {{steps.design.summary}}'
    })
    expect(validateWorkflowDefinition(renamed)).toEqual([])
  })

  it('refuses edges that would close a loop and cleans up removed ones', () => {
    const graph = setWorkflowDependencyMode(sequential(['a', 'b', 'c']), 'graph')
    expect(wouldCreateDependencyCycle(graph, 'a', 'c')).toBe(true)
    expect(setWorkflowDependency(graph, 'a', 'c', true)).toBe(graph)
    const diamond = setWorkflowDependency(
      setWorkflowDependency(graph, 'c', 'b', false),
      'c',
      'a',
      true
    )
    expect(diamond.steps[2]).toMatchObject({
      dependsOn: ['a'],
      inputs: [{ stepId: 'a', summary: true, artifacts: true }]
    })
  })

  it('drops edges into a removed step', () => {
    const graph = setWorkflowDependencyMode(sequential(['a', 'b', 'c']), 'graph')
    const pruned = removeWorkflowStep(graph, 1)
    expect(deps(pruned)).toEqual([
      ['a', []],
      ['c', []]
    ])
    expect(pruned.steps[1]?.inputs).toEqual([])
  })
})
