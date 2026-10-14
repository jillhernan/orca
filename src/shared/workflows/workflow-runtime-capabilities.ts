/** Hosts that answer the `workflow.*` RPC surface. Clients refuse to start runs on hosts without it. */
export const WORKFLOW_RUNTIME_CAPABILITY = 'workflow.v1' as const

export const WORKFLOW_UPDATE_REQUIRED_MESSAGE =
  'This host runs an Orca version without workflows. Update Orca on that host to run workflows there.'
