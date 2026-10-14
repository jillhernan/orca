/**
 * Prompt variables are plain text substitution: `{{params.<id>}}`, `{{steps.<id>.summary}}` and
 * `{{steps.<id>.artifacts}}`. Nothing is evaluated. Braces whose content does not start with
 * `param`/`step` stay literal so prompts can quote JSX (`style={{ … }}`) or other templates.
 */

export type WorkflowStepOutputField = 'summary' | 'artifacts'

export type WorkflowPromptReference =
  | { kind: 'param'; parameterId: string; raw: string; start: number; end: number }
  | {
      kind: 'step'
      stepId: string
      field: WorkflowStepOutputField
      raw: string
      start: number
      end: number
    }
  | { kind: 'invalid'; raw: string; start: number; end: number }

const TOKEN_PATTERN = /\{\{([^{}]*)\}\}/g
const REFERENCE_ATTEMPT_PATTERN = /^\s*(params?|steps?)\b/
const PARAM_REFERENCE_PATTERN = /^\s*params\.([a-z][a-z0-9_]{0,47})\s*$/
const STEP_REFERENCE_PATTERN = /^\s*steps\.([a-z0-9][a-z0-9_-]{0,47})\.(summary|artifacts)\s*$/

export function scanWorkflowPromptReferences(text: string): WorkflowPromptReference[] {
  const references: WorkflowPromptReference[] = []
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const inner = match[1] ?? ''
    if (!REFERENCE_ATTEMPT_PATTERN.test(inner)) {
      continue
    }
    const start = match.index ?? 0
    const raw = match[0]
    const end = start + raw.length
    const param = PARAM_REFERENCE_PATTERN.exec(inner)
    if (param?.[1]) {
      references.push({ kind: 'param', parameterId: param[1], raw, start, end })
      continue
    }
    const step = STEP_REFERENCE_PATTERN.exec(inner)
    if (step?.[1] && (step[2] === 'summary' || step[2] === 'artifacts')) {
      references.push({ kind: 'step', stepId: step[1], field: step[2], raw, start, end })
      continue
    }
    references.push({ kind: 'invalid', raw, start, end })
  }
  return references
}

/** Replaces valid references; invalid ones are left verbatim (validation blocks them earlier). */
export function renderWorkflowPromptTemplate(
  text: string,
  resolve: (reference: Exclude<WorkflowPromptReference, { kind: 'invalid' }>) => string
): string {
  let output = ''
  let cursor = 0
  for (const reference of scanWorkflowPromptReferences(text)) {
    if (reference.kind === 'invalid') {
      continue
    }
    output += text.slice(cursor, reference.start) + resolve(reference)
    cursor = reference.end
  }
  return output + text.slice(cursor)
}

export function formatWorkflowParamReference(parameterId: string): string {
  return `{{params.${parameterId}}}`
}

export function formatWorkflowStepReference(
  stepId: string,
  field: WorkflowStepOutputField
): string {
  return `{{steps.${stepId}.${field}}}`
}

/** Rewrites references to a renamed step so editing an id does not orphan its consumers. */
export function renameWorkflowStepReferences(text: string, from: string, to: string): string {
  return renderWorkflowPromptTemplate(text, (reference) =>
    reference.kind === 'step' && reference.stepId === from
      ? formatWorkflowStepReference(to, reference.field)
      : reference.raw
  )
}
