import type Database from '../sqlite/sync-database'

/** `user_version` of workflows.db. Each step below is idempotent so a retried open is safe. */
export const WORKFLOW_DB_SCHEMA_VERSION = 1

const V1_SCHEMA = `
CREATE TABLE IF NOT EXISTS workflow_definitions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'workflow',
  current_revision INTEGER NOT NULL,
  create_request_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS workflow_revisions (
  definition_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (definition_id, revision)
);
CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  start_request_id TEXT NOT NULL UNIQUE,
  definition_id TEXT NOT NULL,
  definition_revision INTEGER NOT NULL,
  definition_name TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  params TEXT NOT NULL,
  host_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  workspace_label TEXT NOT NULL,
  workspace_path TEXT,
  repo_id TEXT,
  workspace_is_git INTEGER NOT NULL,
  orchestration_run_id TEXT,
  max_concurrency INTEGER NOT NULL,
  control TEXT NOT NULL,
  status TEXT NOT NULL,
  rerun_of TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS workflow_runs_by_definition ON workflow_runs(definition_id, created_at);
CREATE INDEX IF NOT EXISTS workflow_runs_by_status ON workflow_runs(status, updated_at);
CREATE TABLE IF NOT EXISTS workflow_attempts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  attempt_no INTEGER NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  task_id TEXT,
  dispatch_id TEXT,
  gate_id TEXT,
  retry_of_dispatch_id TEXT,
  terminal_handle TEXT,
  input_snapshot TEXT,
  target TEXT,
  result TEXT,
  failure TEXT,
  liveness TEXT,
  retry_requested_at TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (run_id, step_id, attempt_no)
);
CREATE INDEX IF NOT EXISTS workflow_attempts_by_run ON workflow_attempts(run_id, step_id);
CREATE TABLE IF NOT EXISTS workflow_events (
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  step_id TEXT,
  attempt_id TEXT,
  actor TEXT NOT NULL,
  payload TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, seq)
);
`

/**
 * Brings the schema to the current version inside one transaction. A database written by a newer
 * build is left untouched and reported, so an older build never rewrites tables it cannot read.
 */
export function migrateWorkflowDatabase(db: Database): { newerSchema: boolean } {
  const stored = Number(db.pragma('user_version', { simple: true }) ?? 0)
  if (stored > WORKFLOW_DB_SCHEMA_VERSION) {
    return { newerSchema: true }
  }
  if (stored === WORKFLOW_DB_SCHEMA_VERSION) {
    return { newerSchema: false }
  }
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(V1_SCHEMA)
    db.pragma(`user_version = ${WORKFLOW_DB_SCHEMA_VERSION}`)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return { newerSchema: false }
}
