import { useEffect, useState } from 'react'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type {
  AgentSessionModelCatalogResult,
  AgentSessionModelOption
} from '../../../../shared/agent-session-wire'

export type WorkflowModelCatalog =
  | { status: 'idle' | 'loading' | 'unavailable' }
  | { status: 'ready'; models: AgentSessionModelOption[] }

// Why a module cache: every step card asks for the same agent's catalog, and the listing only
// changes when the agent's own configuration does.
const catalogByAgent = new Map<string, Promise<AgentSessionModelOption[] | null>>()

function loadCatalog(agent: string): Promise<AgentSessionModelOption[] | null> {
  let pending = catalogByAgent.get(agent)
  if (!pending) {
    pending = callRuntimeRpc<AgentSessionModelCatalogResult>(
      { kind: 'local' },
      'agentSession.modelCatalog',
      { agent },
      { timeoutMs: 15_000 }
    )
      .then((result) => (result.origin === 'unknown' ? null : result.models))
      // Agents without a model listing (or hosts that predate it) offer only their own default.
      .catch(() => null)
    catalogByAgent.set(agent, pending)
  }
  return pending
}

/** Models this computer's host reports for an agent; never a hard-coded list. */
export function useWorkflowModelCatalog(agent: string | null): WorkflowModelCatalog {
  const [catalog, setCatalog] = useState<WorkflowModelCatalog>({ status: 'idle' })
  useEffect(() => {
    if (!agent) {
      setCatalog({ status: 'idle' })
      return
    }
    let cancelled = false
    setCatalog({ status: 'loading' })
    void loadCatalog(agent).then((models) => {
      if (!cancelled) {
        setCatalog(
          models && models.length > 0 ? { status: 'ready', models } : { status: 'unavailable' }
        )
      }
    })
    return () => {
      cancelled = true
    }
  }, [agent])
  return catalog
}
