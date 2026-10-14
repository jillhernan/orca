import { z } from 'zod'
import {
  applySequentialDependencies,
  WORKFLOW_DEFINITION_KINDS,
  WORKFLOW_SCHEMA_VERSION,
  WorkflowDefinitionBodySchema,
  WorkflowParameterSchema,
  WorkflowStepSchema,
  type WorkflowDefinitionBody,
  type WorkflowDefinitionKind
} from './workflow-definition'
import { validateWorkflowDefinition } from './workflow-definition-validation'
import type { WorkflowValidationIssue } from './workflow-validation-issues'

export const WORKFLOW_EXPORT_KIND = 'orca.workflow'

/** Issues that make a file unusable; incomplete text (an empty prompt) is left for the editor. */
const IMPORT_BLOCKING_CODES = new Set<WorkflowValidationIssue['code']>([
  'name_required',
  'max_concurrency_invalid',
  'steps_too_many',
  'parameters_too_many',
  'step_id_invalid',
  'step_id_duplicate',
  'dependency_self',
  'dependency_missing',
  'dependency_duplicate',
  'dependency_cycle',
  'input_not_predecessor',
  'reference_invalid',
  'reference_unknown_param',
  'reference_unknown_step',
  'reference_not_predecessor',
  'param_id_invalid',
  'param_id_duplicate',
  'param_options_required',
  'param_default_invalid',
  'param_range_invalid'
])

// Strict on purpose: an unknown field means a newer or hand-edited file, and dropping it silently
// would import something other than what the file describes.
const PortableBodySchema = WorkflowDefinitionBodySchema.omit({ defaultTarget: true })
  .extend({
    steps: z.array(WorkflowStepSchema.strict()),
    parameters: z.array(WorkflowParameterSchema.strict())
  })
  .strict()

const ExportDocumentSchema = z
  .object({
    kind: z.literal(WORKFLOW_EXPORT_KIND),
    schemaVersion: z.number().int().positive(),
    exportedAt: z.string().optional(),
    definitionKind: z.enum(WORKFLOW_DEFINITION_KINDS).optional(),
    definition: z.unknown()
  })
  .strict()

/**
 * The portable form of a definition. Host bindings (default workspace and host) are left out:
 * they name places on one machine and are chosen again after import. Run history is never part
 * of a definition, so it cannot leak into an export.
 */
export function exportWorkflowDefinition(
  body: WorkflowDefinitionBody,
  kind: WorkflowDefinitionKind
): string {
  const { defaultTarget: _target, ...portable } = body
  return JSON.stringify(
    {
      kind: WORKFLOW_EXPORT_KIND,
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      definitionKind: kind,
      definition: portable
    },
    null,
    2
  )
}

export type WorkflowImportResult =
  | { ok: true; body: WorkflowDefinitionBody; kind: WorkflowDefinitionKind }
  | {
      ok: false
      reason: 'not_json' | 'not_workflow' | 'newer_version' | 'invalid'
      message: string
      issues: WorkflowValidationIssue[]
    }

function failure(
  reason: 'not_json' | 'not_workflow' | 'newer_version' | 'invalid',
  message: string,
  issues: WorkflowValidationIssue[] = []
): WorkflowImportResult {
  return { ok: false, reason, message, issues }
}

/** All or nothing: any blocking problem refuses the whole file and nothing is created. */
export function importWorkflowDefinition(text: string): WorkflowImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return failure('not_json', 'The file is not valid JSON.')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return failure('not_workflow', 'This is not an Orca workflow export.')
  }
  if (Reflect.get(parsed, 'kind') !== WORKFLOW_EXPORT_KIND) {
    return failure('not_workflow', 'This is not an Orca workflow export.')
  }
  const version: unknown = Reflect.get(parsed, 'schemaVersion')
  if (typeof version === 'number' && version > WORKFLOW_SCHEMA_VERSION) {
    return failure(
      'newer_version',
      `This workflow uses schema version ${version}; this Orca reads up to version ${WORKFLOW_SCHEMA_VERSION}. Update Orca to import it.`
    )
  }
  const document = ExportDocumentSchema.safeParse(parsed)
  if (!document.success) {
    return failure(
      'invalid',
      `The file header is invalid: ${document.error.issues[0]?.message ?? 'unknown field'}.`
    )
  }
  const body = PortableBodySchema.safeParse(document.data.definition)
  if (!body.success) {
    const issue = body.error.issues[0]
    const where = issue?.path.join('.') || 'definition'
    return failure(
      'invalid',
      `The definition is invalid at ${where}: ${issue?.message ?? 'unexpected value'}.`
    )
  }
  const normalized = applySequentialDependencies(body.data)
  const blocking = validateWorkflowDefinition(normalized).filter((issue) =>
    IMPORT_BLOCKING_CODES.has(issue.code)
  )
  if (blocking.length > 0) {
    return failure(
      'invalid',
      'The workflow has problems that must be fixed in the file before import.',
      blocking
    )
  }
  return { ok: true, body: normalized, kind: document.data.definitionKind ?? 'workflow' }
}
