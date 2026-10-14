import { useCallback, useEffect, useRef, useState } from 'react'
import {
  WORKFLOW_TERMINAL_RUN_STATUSES,
  type WorkflowRunDetail
} from '../../../../shared/workflows/workflow-run-types'
import { showWorkflowRun, workflowErrorCode, workflowErrorMessage } from './workflow-client'
import { workflowHostFromKey } from './workflow-hosts'

const ACTIVE_POLL_MS = 1_500
const SETTLED_POLL_MS = 10_000

export type WorkflowRunState = {
  detail: WorkflowRunDetail | null
  /** Set while the host cannot be reached; `detail` then holds the last snapshot it sent. */
  unreachable: { message: string; since: number } | null
  notFound: boolean
  apply: (detail: WorkflowRunDetail) => void
  refresh: () => Promise<void>
}

/**
 * Follows one run with full snapshots from its host. Polling only refreshes the view; the host's
 * scheduler drives the run whether or not this page is open.
 */
export function useWorkflowRun(hostKey: string, runId: string): WorkflowRunState {
  const [detail, setDetail] = useState<WorkflowRunDetail | null>(null)
  const [unreachable, setUnreachable] = useState<WorkflowRunState['unreachable']>(null)
  const [notFound, setNotFound] = useState(false)
  const [tick, setTick] = useState(0)
  // Why: over SSH a snapshot can take longer than the poll interval; overlapping reads add load only.
  const inFlight = useRef(false)

  const refresh = useCallback(async () => {
    if (inFlight.current) {
      return
    }
    inFlight.current = true
    try {
      const next = await showWorkflowRun(workflowHostFromKey(hostKey), runId)
      setDetail(next)
      setUnreachable(null)
      setNotFound(false)
    } catch (error) {
      if (workflowErrorCode(error) === 'workflow_run_not_found') {
        setNotFound(true)
        return
      }
      setUnreachable(
        (current) => current ?? { message: workflowErrorMessage(error), since: Date.now() }
      )
    } finally {
      inFlight.current = false
    }
  }, [hostKey, runId])

  const status = detail?.run.status
  const settled = status !== undefined && WORKFLOW_TERMINAL_RUN_STATUSES.includes(status)

  useEffect(() => {
    if (document.visibilityState === 'visible') {
      void refresh()
    }
    const timer = setTimeout(
      () => setTick((value) => value + 1),
      settled ? SETTLED_POLL_MS : ACTIVE_POLL_MS
    )
    return () => clearTimeout(timer)
  }, [refresh, settled, tick])

  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') {
        void refresh()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  return { detail, unreachable, notFound, apply: setDetail, refresh }
}
