import type { WorkflowParameterValue, WorkflowStep } from './workflow-definition'
import {
  renderWorkflowPromptTemplate,
  scanWorkflowPromptReferences
} from './workflow-prompt-template'
import type { WorkflowStepOutput } from './workflow-step-output'
import { formatWorkflowArtifactList } from './workflow-step-output'

export type WorkflowPromptTruncation = {
  stepId: string
  shownBytes: number
  totalBytes: number
}

export type ComposedWorkflowPrompt = {
  text: string
  byteLength: number
  truncations: WorkflowPromptTruncation[]
  /** Predecessor results the text embeds, with the attempt each came from. */
  inputs: { stepId: string; attemptNo: number | null; summary: boolean; artifacts: boolean }[]
}

export class WorkflowPromptTooLargeError extends Error {
  constructor(
    readonly byteLength: number,
    readonly maxBytes: number
  ) {
    super(
      `The step prompt needs ${byteLength} bytes before any previous-step results, above the ${maxBytes}-byte limit. Shorten it or move large context into a workspace file.`
    )
    this.name = 'WorkflowPromptTooLargeError'
  }
}

const encoder = new TextEncoder()
const TRUNCATION_MARKER_RESERVE = 220

function byteLength(text: string): number {
  return encoder.encode(text).length
}

function truncateToBytes(text: string, maxBytes: number): string {
  if (byteLength(text) <= maxBytes) {
    return text
  }
  let output = ''
  let used = 0
  for (const char of text) {
    const size = byteLength(char)
    if (used + size > maxBytes) {
      break
    }
    output += char
    used += size
  }
  return output
}

function formatParamValue(value: WorkflowParameterValue | undefined): string {
  if (value === undefined) {
    return ''
  }
  return typeof value === 'string' ? value : String(value)
}

function pendingSummary(name: string): string {
  return `[The result of "${name}" is inserted here when that step finishes.]`
}

type SummarySlot = { stepId: string; text: string; taskId: string | null }

export function composeWorkflowStepPrompt(args: {
  workflowName: string
  step: WorkflowStep
  steps: readonly WorkflowStep[]
  params: Readonly<Record<string, WorkflowParameterValue>>
  /** Results of direct predecessors that finished; missing entries render as placeholders. */
  outputs: ReadonlyMap<string, WorkflowStepOutput>
  maxBytes: number
}): ComposedWorkflowPrompt {
  const { step, outputs } = args
  const nameOf = (id: string): string => args.steps.find((s) => s.id === id)?.name || id
  const slots: SummarySlot[] = []
  const slotToken = (index: number): string => `\u0000summary-${index}\u0000`
  const addSlot = (stepId: string): string => {
    const output = outputs.get(stepId)
    slots.push({
      stepId,
      text: output ? output.summary : pendingSummary(nameOf(stepId)),
      taskId: output?.taskId ?? null
    })
    return slotToken(slots.length - 1)
  }
  const referenced = new Set<string>()
  for (const reference of scanWorkflowPromptReferences(step.prompt)) {
    if (reference.kind === 'step') {
      referenced.add(`${reference.stepId}.${reference.field}`)
    }
  }
  const body = renderWorkflowPromptTemplate(step.prompt, (reference) => {
    if (reference.kind === 'param') {
      return formatParamValue(args.params[reference.parameterId])
    }
    if (reference.field === 'summary') {
      return addSlot(reference.stepId)
    }
    const output = outputs.get(reference.stepId)
    return output ? formatWorkflowArtifactList(output) : pendingSummary(nameOf(reference.stepId))
  })
  const sections: string[] = [body.trim()]
  const inputs: ComposedWorkflowPrompt['inputs'] = []
  const inputLines: string[] = []
  for (const input of step.inputs) {
    if (!step.dependsOn.includes(input.stepId)) {
      continue
    }
    const output = outputs.get(input.stepId)
    const includeSummary = input.summary && !referenced.has(`${input.stepId}.summary`)
    const includeArtifacts = input.artifacts && !referenced.has(`${input.stepId}.artifacts`)
    if (!includeSummary && !includeArtifacts) {
      continue
    }
    inputs.push({
      stepId: input.stepId,
      attemptNo: output?.attemptNo ?? null,
      summary: input.summary,
      artifacts: input.artifacts
    })
    inputLines.push(`### ${nameOf(input.stepId)}`)
    if (includeSummary) {
      inputLines.push(addSlot(input.stepId))
    }
    if (includeArtifacts) {
      inputLines.push(
        output ? formatWorkflowArtifactList(output) : pendingSummary(nameOf(input.stepId))
      )
    }
  }
  if (inputLines.length > 0) {
    sections.push(['## Results from previous steps', ...inputLines].join('\n\n'))
  }
  if (step.expectedOutput?.trim()) {
    sections.push(`## Expected output\n\n${step.expectedOutput.trim()}`)
  }
  sections.push(
    `---\nOrca workflow "${args.workflowName}", step "${step.name}". When you finish, report through worker_done: summarize what you did in the body and list every file you changed with --files-modified. Do not wait for questions to be answered; state any assumptions in the report.`
  )
  const template = sections.join('\n\n')
  return fillSummarySlots(template, slots, slotToken, args.maxBytes, inputs)
}

/** Fits summaries into the byte budget, shrinking the largest first and marking every cut. */
function fillSummarySlots(
  template: string,
  slots: readonly SummarySlot[],
  slotToken: (index: number) => string,
  maxBytes: number,
  inputs: ComposedWorkflowPrompt['inputs']
): ComposedWorkflowPrompt {
  const fixedBytes =
    byteLength(template) -
    slots.reduce((sum, _slot, index) => sum + byteLength(slotToken(index)), 0)
  const sizes = slots.map((slot) => byteLength(slot.text))
  const total = fixedBytes + sizes.reduce((sum, size) => sum + size, 0)
  const truncations: WorkflowPromptTruncation[] = []
  let budgets = sizes
  if (total > maxBytes) {
    const available = maxBytes - fixedBytes - slots.length * TRUNCATION_MARKER_RESERVE
    if (available < 0) {
      throw new WorkflowPromptTooLargeError(fixedBytes, maxBytes)
    }
    budgets = waterFill(sizes, available)
  }
  let text = template
  slots.forEach((slot, index) => {
    const budget = budgets[index] ?? 0
    const size = sizes[index] ?? 0
    let value = slot.text
    if (budget < size) {
      value = `${truncateToBytes(slot.text, budget)}\n[Trimmed by Orca to fit the prompt limit: ${budget} of ${size} bytes shown.${slot.taskId ? ` The full result is on orchestration task ${slot.taskId}.` : ''}]`
      truncations.push({ stepId: slot.stepId, shownBytes: budget, totalBytes: size })
    }
    text = text.replace(slotToken(index), () => value)
  })
  return { text, byteLength: byteLength(text), truncations, inputs }
}

/** Largest-first fair share: small values stay whole, large ones share what is left equally. */
function waterFill(sizes: readonly number[], available: number): number[] {
  const order = sizes.map((size, index) => ({ size, index })).sort((a, b) => a.size - b.size)
  const budgets = Array.from({ length: sizes.length }, () => 0)
  let remaining = available
  order.forEach((entry, position) => {
    const share = Math.floor(remaining / (order.length - position))
    const granted = Math.min(entry.size, share)
    budgets[entry.index] = granted
    remaining -= granted
  })
  return budgets
}
