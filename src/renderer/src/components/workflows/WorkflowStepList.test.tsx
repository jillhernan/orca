// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  applySequentialDependencies,
  createEmptyWorkflowBody,
  type WorkflowDefinitionBody
} from '../../../../shared/workflows/workflow-definition'
import { validateWorkflowDefinition } from '../../../../shared/workflows/workflow-definition-validation'
import { WorkflowStepList } from './WorkflowStepList'

function body(ids: string[]): WorkflowDefinitionBody {
  return applySequentialDependencies({
    ...createEmptyWorkflowBody('Feature'),
    steps: ids.map((id) => ({
      id,
      name: `Step ${id}`,
      kind: 'agent' as const,
      prompt: id === 'b' ? '' : `Do ${id}`,
      dependsOn: [],
      inputs: [],
      workspaceMode: 'shared' as const
    }))
  })
}

function renderList(
  definition: WorkflowDefinitionBody,
  onChange = vi.fn<(next: WorkflowDefinitionBody, selectIndex?: number) => void>()
) {
  render(
    <TooltipProvider>
      <WorkflowStepList
        body={definition}
        selectedIndex={0}
        issues={validateWorkflowDefinition(definition)}
        onSelect={vi.fn()}
        onChange={onChange}
      />
    </TooltipProvider>
  )
  return onChange
}

describe('WorkflowStepList', () => {
  afterEach(cleanup)

  it('reorders with the move buttons and re-derives the sequential chain', () => {
    const onChange = renderList(body(['a', 'b', 'c']))
    fireEvent.click(screen.getAllByRole('button', { name: 'Move down' })[0]!)
    const [next, selected] = onChange.mock.calls[0] ?? []
    expect(next?.steps.map((step) => step.id)).toEqual(['b', 'a', 'c'])
    expect(next?.steps.map((step) => step.dependsOn)).toEqual([[], ['b'], ['a']])
    expect(selected).toBe(1)
  })

  it('disables moves past either end and shows which steps need fixing', () => {
    renderList(body(['a', 'b']))
    expect(screen.getAllByRole('button', { name: 'Move up' })[0]).toHaveProperty('disabled', true)
    expect(screen.getAllByRole('button', { name: 'Move down' })[1]).toHaveProperty('disabled', true)
    expect(screen.getByText('1 to fix')).toBeTruthy()
  })
})
