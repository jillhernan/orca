import { describe, expect, it } from 'vitest'
import {
  applySequentialDependencies,
  createEmptyWorkflowBody,
  type WorkflowDefinitionBody,
  type WorkflowParameter,
  type WorkflowStep
} from './workflow-definition'
import { validateWorkflowDefinition } from './workflow-definition-validation'
import { resolveWorkflowParameterValues } from './workflow-parameter-validation'

function step(id: string, overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    id,
    name: `Step ${id}`,
    kind: 'agent',
    prompt: `Do ${id}`,
    dependsOn: [],
    inputs: [],
    workspaceMode: 'shared',
    ...overrides
  }
}

function body(steps: WorkflowStep[], overrides: Partial<WorkflowDefinitionBody> = {}) {
  return { ...createEmptyWorkflowBody('Ship it'), steps, ...overrides }
}

function codes(definition: WorkflowDefinitionBody, availableAgents?: string[]) {
  return validateWorkflowDefinition(definition, { availableAgents }).map((issue) => [
    issue.code,
    issue.field
  ])
}

describe('validateWorkflowDefinition', () => {
  it('accepts a sequential three-step workflow derived from list order', () => {
    const definition = applySequentialDependencies(body([step('a'), step('b'), step('c')]))
    expect(definition.steps.map((s) => s.dependsOn)).toEqual([[], ['a'], ['b']])
    expect(definition.steps[2]?.inputs).toEqual([{ stepId: 'b', summary: true, artifacts: true }])
    expect(validateWorkflowDefinition(definition)).toEqual([])
  })

  it('keeps an input choice when a reorder keeps the same predecessor', () => {
    const definition = applySequentialDependencies(
      body([
        step('a'),
        step('b', { dependsOn: ['a'], inputs: [{ stepId: 'a', summary: true, artifacts: false }] })
      ])
    )
    expect(definition.steps[1]?.inputs).toEqual([{ stepId: 'a', summary: true, artifacts: false }])
  })

  it('locates empty names, prompts and missing steps on their fields', () => {
    expect(codes(body([]))).toEqual([['steps_required', 'workflow.steps']])
    expect(codes(body([step('a', { name: ' ', prompt: '' })], { name: '' }))).toEqual([
      ['name_required', 'workflow.name'],
      ['step_name_required', 'steps.0.name'],
      ['step_prompt_required', 'steps.0.prompt']
    ])
  })

  it('rejects invalid and duplicate step ids', () => {
    expect(codes(body([step('Bad Id'), step('a'), step('a')]))).toEqual([
      ['step_id_invalid', 'steps.0.id'],
      ['step_id_duplicate', 'steps.2.id']
    ])
  })

  it('rejects self, dangling and duplicate edges', () => {
    const issues = codes(
      body([step('a', { dependsOn: ['a'] }), step('b', { dependsOn: ['ghost', 'a', 'a'] })], {
        dependencyMode: 'graph'
      })
    )
    expect(issues).toContainEqual(['dependency_self', 'steps.0.dependsOn'])
    expect(issues).toContainEqual(['dependency_missing', 'steps.1.dependsOn'])
    expect(issues).toContainEqual(['dependency_duplicate', 'steps.1.dependsOn'])
  })

  it('reports a cycle once with its path', () => {
    const issues = validateWorkflowDefinition(
      body(
        [
          step('a', { dependsOn: ['c'] }),
          step('b', { dependsOn: ['a'] }),
          step('c', { dependsOn: ['b'] })
        ],
        { dependencyMode: 'graph' }
      )
    ).filter((issue) => issue.code === 'dependency_cycle')
    expect(issues).toHaveLength(1)
    expect(issues[0]?.detail?.cycle).toBe('a → c → b → a')
  })

  it('checks prompt references against parameters and direct predecessors', () => {
    const definition = body(
      [
        step('a'),
        step('b', { dependsOn: ['a'] }),
        step('c', {
          dependsOn: ['b'],
          prompt:
            'Use {{params.goal}} {{params.nope}} {{steps.a.summary}} {{steps.zz.summary}} {{param.goal}} style={{ color: "red" }} {{steps.b.artifacts}}'
        })
      ],
      {
        dependencyMode: 'graph',
        parameters: [{ id: 'goal', label: 'Goal', type: 'text', required: true }]
      }
    )
    expect(codes(definition).map(([code]) => code)).toEqual([
      'reference_unknown_param',
      'reference_not_predecessor',
      'reference_unknown_step',
      'reference_invalid'
    ])
  })

  it('requires inputs to name direct predecessors', () => {
    expect(
      codes(
        body(
          [step('a'), step('b', { inputs: [{ stepId: 'a', summary: true, artifacts: true }] })],
          {
            dependencyMode: 'graph'
          }
        )
      )
    ).toEqual([['input_not_predecessor', 'steps.1.inputs']])
  })

  it('requires a code integration step after isolated branches', () => {
    const diamond = (joinKind: WorkflowStep['kind']) =>
      body(
        [
          step('a'),
          step('b', { dependsOn: ['a'], workspaceMode: 'isolated' }),
          step('c', { dependsOn: ['a'], workspaceMode: 'isolated' }),
          step('d', { dependsOn: ['b', 'c'], kind: joinKind }),
          step('e', { dependsOn: ['d'] })
        ],
        { dependencyMode: 'graph', maxConcurrency: 2 }
      )
    expect(codes(diamond('agent'))).toEqual([
      ['integration_required', 'steps.3.dependsOn'],
      ['integration_required', 'steps.4.dependsOn']
    ])
    expect(codes(diamond('integration'))).toEqual([])
    expect(codes(diamond('approval')).map(([code]) => code)).toEqual(['integration_required'])
  })

  it('flags agents the host does not offer and effort without a model', () => {
    expect(
      codes(body([step('a', { agent: 'ghost', effort: 'high' })], { defaultAgent: 'nope' }), [
        'claude'
      ])
    ).toEqual([
      ['agent_unavailable', 'workflow.defaultAgent'],
      ['agent_unavailable', 'steps.0.agent'],
      ['effort_requires_model', 'steps.0.effort']
    ])
  })

  it('validates parameter schema entries', () => {
    expect(
      codes(
        body([step('a')], {
          parameters: [
            { id: '1bad', label: 'x', type: 'text', required: false },
            { id: 'pick', label: '', type: 'enum', required: true, options: [] },
            {
              id: 'n',
              label: 'N',
              type: 'number',
              required: false,
              min: 5,
              max: 1,
              defaultValue: 'x'
            }
          ]
        })
      )
    ).toEqual([
      ['param_id_invalid', 'parameters.0.id'],
      ['param_label_required', 'parameters.1.label'],
      ['param_options_required', 'parameters.1.options'],
      ['param_range_invalid', 'parameters.2.min'],
      ['param_default_invalid', 'parameters.2.defaultValue']
    ])
  })
})

describe('resolveWorkflowParameterValues', () => {
  const parameters: WorkflowParameter[] = [
    { id: 'goal', label: 'Goal', type: 'multiline', required: true },
    {
      id: 'tier',
      label: 'Tier',
      type: 'enum',
      required: false,
      options: ['s', 'm'],
      defaultValue: 'm'
    },
    { id: 'count', label: 'Count', type: 'number', required: false, min: 1 },
    { id: 'dry', label: 'Dry run', type: 'boolean', required: false }
  ]

  it('fills defaults and keeps provided values per run', () => {
    const resolved = resolveWorkflowParameterValues(parameters, { goal: 'Add search', count: 3 })
    expect(resolved.issues).toEqual([])
    expect(resolved.values).toEqual({ goal: 'Add search', tier: 'm', count: 3, dry: false })
  })

  it('refuses missing, invalid and unknown values with their field', () => {
    const resolved = resolveWorkflowParameterValues(parameters, {
      tier: 'xl',
      count: 0,
      extra: 'x'
    })
    expect(resolved.issues.map((issue) => [issue.code, issue.field])).toEqual([
      ['param_value_unknown', 'launch.params.extra'],
      ['param_value_required', 'launch.params.goal'],
      ['param_value_invalid', 'launch.params.tier'],
      ['param_value_invalid', 'launch.params.count']
    ])
  })
})
