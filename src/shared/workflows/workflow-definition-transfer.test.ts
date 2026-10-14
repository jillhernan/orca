import { describe, expect, it } from 'vitest'
import {
  applySequentialDependencies,
  createEmptyWorkflowBody,
  WORKFLOW_SCHEMA_VERSION,
  type WorkflowDefinitionBody
} from './workflow-definition'
import { exportWorkflowDefinition, importWorkflowDefinition } from './workflow-definition-transfer'

function body(): WorkflowDefinitionBody {
  return applySequentialDependencies({
    ...createEmptyWorkflowBody('Feature'),
    defaultAgent: 'claude',
    defaultTarget: { hostId: 'ssh:c2', workspaceId: 'repo::/home/me/secret-project' },
    parameters: [{ id: 'goal', label: 'Goal', type: 'multiline', required: true }],
    steps: ['plan', 'build'].map((id) => ({
      id,
      name: id,
      kind: 'agent' as const,
      prompt: `Do ${id} for {{params.goal}}`,
      dependsOn: [],
      inputs: [],
      workspaceMode: 'shared' as const
    }))
  })
}

function document(
  overrides: Record<string, unknown>,
  definition: unknown = JSON.parse(exportWorkflowDefinition(body(), 'workflow')).definition
) {
  return JSON.stringify({
    kind: 'orca.workflow',
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    definition,
    ...overrides
  })
}

describe('workflow export/import', () => {
  it('exports the definition without host bindings and imports it back', () => {
    const json = exportWorkflowDefinition(body(), 'template')
    expect(json).not.toContain('secret-project')
    expect(json).not.toContain('defaultTarget')
    const parsed = JSON.parse(json)
    expect(parsed).toMatchObject({
      kind: 'orca.workflow',
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      definitionKind: 'template'
    })
    const imported = importWorkflowDefinition(json)
    const { defaultTarget: _dropped, ...expected } = body()
    expect(imported).toEqual({ ok: true, kind: 'template', body: expected })
  })

  it('refuses a newer schema version with an update hint', () => {
    const result = importWorkflowDefinition(
      document({ schemaVersion: WORKFLOW_SCHEMA_VERSION + 1 })
    )
    expect(result).toMatchObject({ ok: false, reason: 'newer_version' })
    expect(result.ok ? '' : result.message).toMatch(/Update Orca/)
  })

  it('refuses files that are not workflow exports', () => {
    expect(importWorkflowDefinition('{oops')).toMatchObject({ ok: false, reason: 'not_json' })
    expect(importWorkflowDefinition('{"kind":"other"}')).toMatchObject({
      ok: false,
      reason: 'not_workflow'
    })
  })

  it('refuses unknown fields instead of dropping them', () => {
    const definition = {
      ...JSON.parse(exportWorkflowDefinition(body(), 'workflow')).definition,
      schedule: '0 * * * *'
    }
    expect(importWorkflowDefinition(document({}, definition))).toMatchObject({
      ok: false,
      reason: 'invalid'
    })
  })

  it('refuses broken graphs as a whole and reports where', () => {
    const definition = JSON.parse(exportWorkflowDefinition(body(), 'workflow')).definition
    definition.dependencyMode = 'graph'
    definition.steps[0].dependsOn = ['build']
    const result = importWorkflowDefinition(document({}, definition))
    expect(result.ok).toBe(false)
    expect(result.ok ? [] : result.issues.map((issue) => [issue.code, issue.field])).toEqual([
      ['dependency_cycle', 'steps.0.dependsOn']
    ])
  })

  it('accepts incomplete text so it can be finished in the editor', () => {
    const definition = JSON.parse(exportWorkflowDefinition(body(), 'workflow')).definition
    definition.steps[1].prompt = ''
    expect(importWorkflowDefinition(document({}, definition)).ok).toBe(true)
  })
})
