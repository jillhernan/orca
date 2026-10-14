import { useCallback, useEffect, useRef, useState } from 'react'
import {
  listWorkflowDefinitions,
  workflowErrorMessage,
  type WorkflowDefinitionList
} from './workflow-client'

export type WorkflowDefinitionsState =
  | { status: 'loading'; data: WorkflowDefinitionList | null; error: null }
  | { status: 'ready'; data: WorkflowDefinitionList; error: null }
  | { status: 'error'; data: WorkflowDefinitionList | null; error: string }

/** The local definition list; a reload keeps the previous rows on screen while it runs. */
export function useWorkflowDefinitions(): WorkflowDefinitionsState & {
  refresh: () => Promise<void>
} {
  const [state, setState] = useState<WorkflowDefinitionsState>({
    status: 'loading',
    data: null,
    error: null
  })
  const generation = useRef(0)
  const refresh = useCallback(async () => {
    const current = ++generation.current
    setState((previous) => ({ status: 'loading', data: previous.data, error: null }))
    try {
      const data = await listWorkflowDefinitions()
      if (current === generation.current) {
        setState({ status: 'ready', data, error: null })
      }
    } catch (error) {
      if (current === generation.current) {
        setState((previous) => ({
          status: 'error',
          data: previous.data,
          error: workflowErrorMessage(error)
        }))
      }
    }
  }, [])
  useEffect(() => {
    void refresh()
    // Why: definitions created from the CLI or another window appear only after a refetch.
    const refreshOnFocus = (): void => void refresh()
    window.addEventListener('focus', refreshOnFocus)
    return () => {
      window.removeEventListener('focus', refreshOnFocus)
      generation.current += 1
    }
  }, [refresh])
  return { ...state, refresh }
}
