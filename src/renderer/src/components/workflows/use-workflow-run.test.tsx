// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowRunDetail } from '../../../../shared/workflows/workflow-run-types'
import { useWorkflowRun } from './use-workflow-run'

const mocks = vi.hoisted(() => ({ showWorkflowRun: vi.fn() }))

vi.mock('./workflow-client', () => ({
  showWorkflowRun: (...args: unknown[]) => mocks.showWorkflowRun(...args),
  workflowErrorCode: (error: unknown) =>
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : null,
  workflowErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error))
}))

function detail(status: WorkflowRunDetail['run']['status']): WorkflowRunDetail {
  return {
    run: {
      id: 'wfrun_1',
      definitionId: 'wf_1',
      definitionRevision: 1,
      definitionName: 'Feature',
      snapshot: {
        name: 'Feature',
        description: '',
        dependencyMode: 'sequential',
        maxConcurrency: 1,
        parameters: [],
        steps: []
      },
      params: {},
      target: {
        hostId: 'local',
        workspaceId: 'wt_1',
        workspaceLabel: 'main',
        workspacePath: '/repo',
        repoId: 'repo_1',
        isGit: true
      },
      orchestrationRunId: 'run_1',
      maxConcurrency: 1,
      control: 'run',
      status,
      rerunOf: null,
      createdAt: '2026-10-13T00:00:00.000Z',
      updatedAt: '2026-10-13T00:00:00.000Z',
      finishedAt: null
    },
    steps: [],
    events: []
  }
}

async function flush(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('useWorkflowRun', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.showWorkflowRun.mockReset()
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('keeps the last snapshot and marks the host unreachable instead of dropping the run', async () => {
    mocks.showWorkflowRun
      .mockResolvedValueOnce(detail('running'))
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValue(detail('succeeded'))
    const { result } = renderHook(() => useWorkflowRun('environment:env-1', 'wfrun_1'))

    await flush(0)
    expect(result.current.detail?.run.status).toBe('running')
    expect(mocks.showWorkflowRun).toHaveBeenCalledWith(
      { kind: 'environment', environmentId: 'env-1' },
      'wfrun_1'
    )

    await flush(1_600)
    expect(result.current.unreachable?.message).toBe('connection lost')
    expect(result.current.detail?.run.status).toBe('running')

    // Reconnecting brings a fresh snapshot; nothing needs replaying.
    await flush(1_600)
    expect(result.current.unreachable).toBeNull()
    expect(result.current.detail?.run.status).toBe('succeeded')
  })

  it('reports a run the host no longer has', async () => {
    mocks.showWorkflowRun.mockRejectedValue(
      Object.assign(new Error('gone'), { code: 'workflow_run_not_found' })
    )
    const { result } = renderHook(() => useWorkflowRun('local', 'wfrun_missing'))
    await flush(0)
    expect(result.current.notFound).toBe(true)
  })

  it('stops polling after unmount', async () => {
    mocks.showWorkflowRun.mockResolvedValue(detail('running'))
    const { unmount } = renderHook(() => useWorkflowRun('local', 'wfrun_1'))
    await flush(0)
    const calls = mocks.showWorkflowRun.mock.calls.length
    unmount()
    await flush(10_000)
    expect(mocks.showWorkflowRun.mock.calls.length).toBe(calls)
  })
})
