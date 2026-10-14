import Database from '../sqlite/sync-database'
import { hardenSqliteDatabaseFiles } from '../sqlite/harden-database-files'
import { WorkflowDefinitionStore } from './workflow-definition-store'
import { WorkflowRunStore } from './workflow-run-store'
import { migrateWorkflowDatabase } from './workflow-store-schema'
import { WorkflowServiceError } from './workflow-service-error'

/** workflows.db: definitions, their immutable revisions, runs, attempts and run events. */
export class WorkflowDatabase {
  readonly definitions: WorkflowDefinitionStore
  readonly runs: WorkflowRunStore
  private readonly db: Database

  constructor(path: (string & {}) | ':memory:') {
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.pragma('busy_timeout = 5000')
    const { newerSchema } = migrateWorkflowDatabase(this.db)
    if (newerSchema) {
      this.db.close()
      throw new WorkflowServiceError(
        'workflow_unavailable',
        'Workflows were saved by a newer version of Orca. Update Orca to open them; nothing was changed.'
      )
    }
    hardenSqliteDatabaseFiles(path)
    this.definitions = new WorkflowDefinitionStore(this.db)
    this.runs = new WorkflowRunStore(this.db)
  }

  close(): void {
    this.db.close()
  }
}
