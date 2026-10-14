import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Database from '../sqlite/sync-database'
import {
  createEmptyWorkflowBody,
  type WorkflowDefinitionBody
} from '../../shared/workflows/workflow-definition'
import { WorkflowDatabase } from './workflow-database'
import { WORKFLOW_DB_SCHEMA_VERSION } from './workflow-store-schema'

const dirs: string[] = []

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'orca-workflows-'))
  dirs.push(dir)
  return join(dir, 'workflows.db')
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function threeSteps(name = 'Feature'): WorkflowDefinitionBody {
  return {
    ...createEmptyWorkflowBody(name),
    steps: ['plan', 'build', 'docs'].map((id) => ({
      id,
      name: id,
      kind: 'agent' as const,
      prompt: `Do ${id}`,
      dependsOn: [],
      inputs: [],
      workspaceMode: 'shared' as const
    }))
  }
}

const target = {
  hostId: 'local',
  workspaceId: 'wt_1',
  workspaceLabel: 'main',
  workspacePath: '/repo',
  repoId: 'repo_1',
  isGit: true
}

describe('WorkflowDatabase', () => {
  it('keeps definitions, order and revisions across a reopen', () => {
    const path = tempDbPath()
    const first = new WorkflowDatabase(path)
    const created = first.definitions.create({ kind: 'workflow', body: threeSteps() })
    const reordered = { ...created.body, steps: created.body.steps.toReversed() }
    first.definitions.update(created.id, reordered, created.revision)
    first.close()

    const reopened = new WorkflowDatabase(path)
    const loaded = reopened.definitions.get(created.id)
    expect(loaded?.revision).toBe(2)
    expect(loaded?.body.steps.map((step) => step.id)).toEqual(['docs', 'build', 'plan'])
    // Sequential mode re-derives the chain from the saved order.
    expect(loaded?.body.steps.map((step) => step.dependsOn)).toEqual([[], ['docs'], ['build']])
    expect(reopened.definitions.getRevision(created.id, 1)?.steps.map((s) => s.id)).toEqual([
      'plan',
      'build',
      'docs'
    ])
    reopened.close()
  })

  it('refuses a save over a revision someone else replaced', () => {
    const db = new WorkflowDatabase(':memory:')
    const created = db.definitions.create({ kind: 'workflow', body: threeSteps() })
    db.definitions.update(created.id, threeSteps('Second'), 1)
    expect(() => db.definitions.update(created.id, threeSteps('Stale'), 1)).toThrow(
      /changed since it was opened/
    )
    expect(db.definitions.get(created.id)?.body.name).toBe('Second')
  })

  it('makes create idempotent per request and deletes softly', () => {
    const db = new WorkflowDatabase(':memory:')
    const a = db.definitions.create({ kind: 'template', body: threeSteps(), requestId: 'req-1' })
    const b = db.definitions.create({ kind: 'template', body: threeSteps(), requestId: 'req-1' })
    expect(b.id).toBe(a.id)
    db.definitions.delete(a.id)
    expect(db.definitions.list().definitions).toEqual([])
    expect(db.definitions.getRevision(a.id, 1)?.name).toBe('Feature')
  })

  it('creates one run per start request', () => {
    const db = new WorkflowDatabase(':memory:')
    const insert = {
      startRequestId: 'start-1',
      definitionId: 'wf_1',
      definitionRevision: 1,
      snapshot: threeSteps(),
      params: { goal: 'x' },
      target,
      maxConcurrency: 1,
      rerunOf: null
    }
    const first = db.runs.createRun(insert)
    const replay = db.runs.createRun(insert)
    expect(first.created).toBe(true)
    expect(replay.created).toBe(false)
    expect(replay.run.id).toBe(first.run.id)
    expect(db.runs.listRuns({ limit: 10 })).toHaveLength(1)
  })

  it('claims at most one active attempt per step and numbers retries', () => {
    const db = new WorkflowDatabase(':memory:')
    const { run } = db.runs.createRun({
      startRequestId: 's',
      definitionId: 'wf',
      definitionRevision: 1,
      snapshot: threeSteps(),
      params: {},
      target,
      maxConcurrency: 1,
      rerunOf: null
    })
    const claim = () =>
      db.runs.claimAttempt({
        runId: run.id,
        stepId: 'plan',
        kind: 'agent',
        state: 'claimed',
        input: null,
        taskId: null,
        retryOfDispatchId: null
      })
    const first = claim()
    expect(first?.attemptNo).toBe(1)
    expect(claim()).toBeNull()
    // A stale writer that expects `claimed` cannot overwrite a newer state.
    expect(
      db.runs.updateAttempt(first!.id, { state: 'failed', failure: 'boom' }, ['claimed'])
    ).toBe(true)
    expect(db.runs.updateAttempt(first!.id, { state: 'succeeded' }, ['claimed'])).toBe(false)
    expect(claim()?.attemptNo).toBe(2)
    expect(db.runs.getAttempt(first!.id)?.failure).toBe('boom')
  })

  it('appends run events in order', () => {
    const db = new WorkflowDatabase(':memory:')
    db.runs.appendEvent({ runId: 'r', kind: 'run_started', actor: 'user' })
    db.runs.appendEvent({
      runId: 'r',
      kind: 'decision',
      actor: 'user',
      payload: { decision: 'approved' }
    })
    expect(db.runs.listEvents('r').map((event) => [event.seq, event.kind])).toEqual([
      [1, 'run_started'],
      [2, 'decision']
    ])
  })

  it('leaves a database written by a newer build untouched', () => {
    const path = tempDbPath()
    const raw = new Database(path)
    raw.pragma(`user_version = ${WORKFLOW_DB_SCHEMA_VERSION + 1}`)
    raw.close()
    expect(() => new WorkflowDatabase(path)).toThrow(/newer version of Orca/)
    const check = new Database(path)
    expect(Number(check.pragma('user_version', { simple: true }))).toBe(
      WORKFLOW_DB_SCHEMA_VERSION + 1
    )
    check.close()
  })
})
