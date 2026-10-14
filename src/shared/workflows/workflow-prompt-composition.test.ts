import { describe, expect, it } from 'vitest'
import type { WorkflowStep } from './workflow-definition'
import {
  composeWorkflowStepPrompt,
  WorkflowPromptTooLargeError
} from './workflow-prompt-composition'
import type { WorkflowStepOutput } from './workflow-step-output'
import {
  parseWorkerReportResult,
  workerReportArtifacts,
  workerReportSummary
} from './workflow-step-output'

const plan: WorkflowStep = {
  id: 'plan',
  name: 'Plan',
  kind: 'agent',
  prompt: 'Plan {{params.goal}}',
  dependsOn: [],
  inputs: [],
  workspaceMode: 'shared'
}

function implement(prompt: string, inputs = [{ stepId: 'plan', summary: true, artifacts: true }]) {
  return { ...plan, id: 'impl', name: 'Implement', prompt, dependsOn: ['plan'], inputs }
}

const planOutput: WorkflowStepOutput = {
  stepId: 'plan',
  attemptNo: 2,
  taskId: 'task_1',
  dispatchId: 'dispatch_9',
  summary: 'Use a trie.',
  artifacts: [{ kind: 'file', path: 'docs/plan.md' }],
  target: {
    hostId: 'ssh:c2',
    workspaceId: 'wt1',
    workspaceLabel: 'feature',
    isolated: false,
    path: '/srv/repo'
  }
}

function compose(step: WorkflowStep, outputs = new Map([['plan', planOutput]]), maxBytes = 60_000) {
  return composeWorkflowStepPrompt({
    workflowName: 'Feature',
    step,
    steps: [plan, step],
    params: { goal: 'search' },
    outputs,
    maxBytes
  })
}

describe('composeWorkflowStepPrompt', () => {
  it('substitutes parameters and appends chosen predecessor results', () => {
    const composed = compose(implement('Build {{params.goal}}.'))
    expect(composed.text).toContain('Build search.')
    expect(composed.text).toContain('## Results from previous steps')
    expect(composed.text).toContain('Use a trie.')
    expect(composed.text).toContain('- docs/plan.md')
    expect(composed.text).toContain('host ssh:c2')
    expect(composed.inputs).toEqual([
      { stepId: 'plan', attemptNo: 2, summary: true, artifacts: true }
    ])
    expect(composed.truncations).toEqual([])
  })

  it('does not repeat a summary the prompt already references', () => {
    const composed = compose(implement('Follow: {{steps.plan.summary}}'))
    expect(composed.text.split('Use a trie.')).toHaveLength(2)
    expect(composed.text).toContain('- docs/plan.md')
  })

  it('omits inputs the step did not select', () => {
    const composed = compose(
      implement('Go', [{ stepId: 'plan', summary: false, artifacts: false }])
    )
    expect(composed.text).not.toContain('Results from previous steps')
    expect(composed.inputs).toEqual([])
  })

  it('renders placeholders before predecessors have run', () => {
    const composed = compose(implement('Go'), new Map())
    expect(composed.text).toContain(
      '[The result of "Plan" is inserted here when that step finishes.]'
    )
  })

  it('trims oversized results with a visible marker naming the full result', () => {
    const big = { ...planOutput, summary: 'x'.repeat(5_000) }
    const composed = compose(implement('Go'), new Map([['plan', big]]), 2_000)
    expect(composed.byteLength).toBeLessThanOrEqual(2_000)
    expect(composed.truncations).toHaveLength(1)
    expect(composed.truncations[0]?.totalBytes).toBe(5_000)
    expect(composed.text).toContain('The full result is on orchestration task task_1.')
  })

  it('refuses a prompt that cannot fit even without results', () => {
    expect(() => compose(implement('y'.repeat(3_000)), new Map(), 1_000)).toThrow(
      WorkflowPromptTooLargeError
    )
  })
})

describe('worker report results', () => {
  it('reads the orchestration worker_done result format', () => {
    const report = parseWorkerReportResult(
      JSON.stringify({
        provenance: 'worker_report',
        outcome: 'succeeded',
        subject: 'Done',
        body: 'Added search.',
        filesModified: ['src/a.ts', 3],
        reportPath: 'out/report.md'
      })
    )
    expect(report && workerReportSummary(report)).toBe('Done\n\nAdded search.')
    expect(report && workerReportArtifacts(report)).toEqual([
      { kind: 'file', path: 'src/a.ts' },
      { kind: 'report', path: 'out/report.md' }
    ])
  })

  it('ignores results that are not worker reports', () => {
    expect(parseWorkerReportResult('{"reason":"waiting"}')).toBeNull()
    expect(parseWorkerReportResult('not json')).toBeNull()
  })
})
