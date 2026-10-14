import type { SqliteRow } from '../sqlite/sqlite-statement'
import {
  applySequentialDependencies,
  WorkflowDefinitionBodySchema,
  type WorkflowDefinitionBody,
  type WorkflowParameterValue
} from '../../shared/workflows/workflow-definition'

export function text(row: SqliteRow, column: string): string {
  const value = row[column]
  if (typeof value !== 'string') {
    throw new Error(`workflows.db column ${column} is not text`)
  }
  return value
}

export function optionalText(row: SqliteRow, column: string): string | null {
  const value = row[column]
  return typeof value === 'string' ? value : null
}

export function integer(row: SqliteRow, column: string): number {
  const value = row[column]
  if (typeof value === 'number') {
    return value
  }
  if (typeof value === 'bigint') {
    return Number(value)
  }
  throw new Error(`workflows.db column ${column} is not an integer`)
}

/** Parses stored JSON, returning null for absent or malformed values instead of throwing. */
export function json(row: SqliteRow, column: string): unknown {
  const value = optionalText(row, column)
  if (value === null) {
    return null
  }
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Reads a stored body, filling fields a future optional addition might lack. Unreadable bodies
 * surface as an error on that record only, never on the whole list.
 */
export function readDefinitionBody(raw: unknown): WorkflowDefinitionBody {
  const candidate = isRecord(raw)
    ? {
        description: '',
        dependencyMode: 'graph',
        maxConcurrency: 1,
        parameters: [],
        ...raw,
        steps: Array.isArray(raw.steps)
          ? raw.steps.map((step: unknown) =>
              isRecord(step)
                ? { dependsOn: [], inputs: [], workspaceMode: 'shared', kind: 'agent', ...step }
                : step
            )
          : raw.steps
      }
    : raw
  const parsed = WorkflowDefinitionBodySchema.safeParse(candidate)
  if (!parsed.success) {
    throw new Error(`Stored workflow definition is unreadable: ${parsed.error.issues[0]?.message}`)
  }
  return applySequentialDependencies(parsed.data)
}

export function readParams(raw: unknown): Record<string, WorkflowParameterValue> {
  if (!isRecord(raw)) {
    return {}
  }
  const values: Record<string, WorkflowParameterValue> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      values[key] = value
    }
  }
  return values
}
