import type Database from '../sqlite/sync-database'
import type { SqliteRow } from '../sqlite/sqlite-statement'
import { generateId } from '../runtime/orchestration/db/generated-id'
import {
  applySequentialDependencies,
  WORKFLOW_SCHEMA_VERSION,
  type WorkflowDefinition,
  type WorkflowDefinitionBody,
  type WorkflowDefinitionKind
} from '../../shared/workflows/workflow-definition'
import { integer, json, optionalText, readDefinitionBody, text } from './workflow-store-rows'
import { WorkflowServiceError } from './workflow-service-error'

const SELECT_DEFINITION = `
  SELECT d.id, d.kind, d.current_revision, d.created_at, d.updated_at,
         r.schema_version, r.body
  FROM workflow_definitions d
  JOIN workflow_revisions r ON r.definition_id = d.id AND r.revision = d.current_revision`

function readDefinition(row: SqliteRow): WorkflowDefinition {
  const kind = text(row, 'kind') === 'template' ? 'template' : 'workflow'
  return {
    id: text(row, 'id'),
    kind,
    revision: integer(row, 'current_revision'),
    schemaVersion: integer(row, 'schema_version'),
    body: readDefinitionBody(json(row, 'body')),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at')
  }
}

export class WorkflowDefinitionStore {
  constructor(private readonly db: Database) {}

  list(kind?: WorkflowDefinitionKind): { definitions: WorkflowDefinition[]; unreadable: string[] } {
    const rows = this.db
      .prepare(
        `${SELECT_DEFINITION} WHERE d.deleted_at IS NULL ${kind ? 'AND d.kind = ?' : ''}
         ORDER BY d.updated_at DESC`
      )
      .all(...(kind ? [kind] : []))
    const definitions: WorkflowDefinition[] = []
    const unreadable: string[] = []
    for (const row of rows) {
      try {
        definitions.push(readDefinition(row))
      } catch {
        unreadable.push(optionalText(row, 'id') ?? 'unknown')
      }
    }
    return { definitions, unreadable }
  }

  get(id: string): WorkflowDefinition | null {
    const row = this.db
      .prepare(`${SELECT_DEFINITION} WHERE d.id = ? AND d.deleted_at IS NULL`)
      .get(id)
    return row ? readDefinition(row) : null
  }

  getRevision(id: string, revision: number): WorkflowDefinitionBody | null {
    const row = this.db
      .prepare('SELECT body FROM workflow_revisions WHERE definition_id = ? AND revision = ?')
      .get(id, revision)
    return row ? readDefinitionBody(json(row, 'body')) : null
  }

  /** Idempotent per `requestId`: a retried create returns the definition the first call made. */
  create(input: {
    kind: WorkflowDefinitionKind
    body: WorkflowDefinitionBody
    requestId?: string
  }): WorkflowDefinition {
    if (input.requestId) {
      const existing = this.db
        .prepare('SELECT id FROM workflow_definitions WHERE create_request_id = ?')
        .get(input.requestId)
      if (existing) {
        const found = this.get(text(existing, 'id'))
        if (found) {
          return found
        }
      }
    }
    const id = generateId('wf')
    const now = new Date().toISOString()
    const body = applySequentialDependencies(input.body)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db
        .prepare(
          `INSERT INTO workflow_definitions (id, kind, current_revision, create_request_id, created_at, updated_at)
           VALUES (?, ?, 1, ?, ?, ?)`
        )
        .run(id, input.kind, input.requestId ?? null, now, now)
      this.insertRevision(id, 1, body, now)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return this.requireDefinition(id)
  }

  /**
   * Writes a new immutable revision. `expectedRevision` fences concurrent editors: saving over a
   * revision someone else already replaced is refused instead of silently discarding their edit.
   */
  update(id: string, body: WorkflowDefinitionBody, expectedRevision: number): WorkflowDefinition {
    const now = new Date().toISOString()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const row = this.db
        .prepare(
          'SELECT current_revision FROM workflow_definitions WHERE id = ? AND deleted_at IS NULL'
        )
        .get(id)
      if (!row) {
        throw new WorkflowServiceError(
          'workflow_definition_not_found',
          `Workflow ${id} was not found.`
        )
      }
      const current = integer(row, 'current_revision')
      if (current !== expectedRevision) {
        throw new WorkflowServiceError(
          'workflow_revision_conflict',
          `Workflow ${id} changed since it was opened (revision ${current}, editing ${expectedRevision}). Reload it before saving.`
        )
      }
      const next = current + 1
      this.insertRevision(id, next, applySequentialDependencies(body), now)
      this.db
        .prepare(
          'UPDATE workflow_definitions SET current_revision = ?, updated_at = ? WHERE id = ?'
        )
        .run(next, now, id)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return this.requireDefinition(id)
  }

  /** Soft delete: revisions stay so run history can still show the version it ran. */
  delete(id: string): void {
    this.db
      .prepare(
        'UPDATE workflow_definitions SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
      )
      .run(new Date().toISOString(), new Date().toISOString(), id)
  }

  private insertRevision(
    id: string,
    revision: number,
    body: WorkflowDefinitionBody,
    now: string
  ): void {
    this.db
      .prepare(
        `INSERT INTO workflow_revisions (definition_id, revision, schema_version, body, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, revision, WORKFLOW_SCHEMA_VERSION, JSON.stringify(body), now)
  }

  private requireDefinition(id: string): WorkflowDefinition {
    const definition = this.get(id)
    if (!definition) {
      throw new WorkflowServiceError(
        'workflow_definition_not_found',
        `Workflow ${id} was not found.`
      )
    }
    return definition
  }
}
