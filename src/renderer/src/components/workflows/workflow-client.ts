import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type {
  WorkflowDefinition,
  WorkflowDefinitionBody,
  WorkflowDefinitionKind
} from '../../../../shared/workflows/workflow-definition'
import type {
  WorkflowLaunchInput,
  WorkflowLaunchPlan
} from '../../../../shared/workflows/workflow-launch-types'
import type {
  WorkflowRunDetail,
  WorkflowRunStatus,
  WorkflowRunSummary
} from '../../../../shared/workflows/workflow-run-types'
import type { WorkflowValidationIssue } from '../../../../shared/workflows/workflow-validation-issues'

/** Definitions are stored by this app's own runtime (notes D7); runs live on the host that executes them. */
const DEFINITION_HOST: RuntimeClientTarget = { kind: 'local' }

export type WorkflowDefinitionList = {
  definitions: WorkflowDefinition[]
  unreadable: string[]
  latestRuns: Record<string, WorkflowRunSummary>
}

export function listWorkflowDefinitions(
  kind?: WorkflowDefinitionKind
): Promise<WorkflowDefinitionList> {
  return callRuntimeRpc(DEFINITION_HOST, 'workflow.definitionList', kind ? { kind } : {})
}

export async function getWorkflowDefinition(id: string): Promise<WorkflowDefinition> {
  const result = await callRuntimeRpc<{ definition: WorkflowDefinition }>(
    DEFINITION_HOST,
    'workflow.definitionShow',
    { id }
  )
  return result.definition
}

export async function createWorkflowDefinition(input: {
  kind: WorkflowDefinitionKind
  body: WorkflowDefinitionBody
  requestId?: string
}): Promise<WorkflowDefinition> {
  const result = await callRuntimeRpc<{ definition: WorkflowDefinition }>(
    DEFINITION_HOST,
    'workflow.definitionCreate',
    input
  )
  return result.definition
}

export async function updateWorkflowDefinition(
  id: string,
  body: WorkflowDefinitionBody,
  expectedRevision: number
): Promise<WorkflowDefinition> {
  const result = await callRuntimeRpc<{ definition: WorkflowDefinition }>(
    DEFINITION_HOST,
    'workflow.definitionUpdate',
    { id, body, expectedRevision }
  )
  return result.definition
}

export async function deleteWorkflowDefinition(id: string): Promise<void> {
  await callRuntimeRpc(DEFINITION_HOST, 'workflow.definitionDelete', { id })
}

export async function previewWorkflowLaunch(
  target: RuntimeClientTarget,
  input: WorkflowLaunchInput
): Promise<WorkflowLaunchPlan> {
  const result = await callRuntimeRpc<{ plan: WorkflowLaunchPlan }>(
    target,
    'workflow.launchPreview',
    input,
    { timeoutMs: 30_000 }
  )
  return result.plan
}

export function startWorkflowRun(
  target: RuntimeClientTarget,
  input: WorkflowLaunchInput
): Promise<WorkflowRunDetail> {
  // Why the long timeout: the host may wait for the first agent's readiness before answering.
  return callRuntimeRpc(target, 'workflow.runStart', input, { timeoutMs: 150_000 })
}

export function listWorkflowRuns(
  target: RuntimeClientTarget,
  filter: { definitionId?: string; statuses?: WorkflowRunStatus[]; limit?: number } = {}
): Promise<{ runs: WorkflowRunSummary[] }> {
  return callRuntimeRpc(target, 'workflow.runList', filter, { timeoutMs: 15_000 })
}

export function showWorkflowRun(
  target: RuntimeClientTarget,
  id: string
): Promise<WorkflowRunDetail> {
  return callRuntimeRpc(target, 'workflow.runShow', { id }, { timeoutMs: 15_000 })
}

export type WorkflowRunControlAction = 'pause' | 'resume' | 'cancel'

export function controlWorkflowRun(
  target: RuntimeClientTarget,
  id: string,
  action: WorkflowRunControlAction
): Promise<WorkflowRunDetail> {
  const method =
    action === 'pause'
      ? 'workflow.runPause'
      : action === 'resume'
        ? 'workflow.runResume'
        : 'workflow.runCancel'
  return callRuntimeRpc(target, method, { id }, { timeoutMs: 60_000 })
}

export type WorkflowStepAction = 'retry' | 'stop' | 'reopen'

export function actOnWorkflowStep(
  target: RuntimeClientTarget,
  runId: string,
  stepId: string,
  action: WorkflowStepAction
): Promise<WorkflowRunDetail> {
  const method =
    action === 'retry'
      ? 'workflow.stepRetry'
      : action === 'stop'
        ? 'workflow.stepStop'
        : 'workflow.stepReopenDecision'
  return callRuntimeRpc(target, method, { runId, stepId }, { timeoutMs: 150_000 })
}

export function decideWorkflowStep(
  target: RuntimeClientTarget,
  runId: string,
  stepId: string,
  decision: 'approved' | 'rejected',
  comment: string
): Promise<WorkflowRunDetail> {
  return callRuntimeRpc(
    target,
    'workflow.stepDecide',
    { runId, stepId, decision, comment },
    { timeoutMs: 150_000 }
  )
}

/** Field-located issues a refused save or launch carried back, if any. */
export function workflowErrorIssues(error: unknown): WorkflowValidationIssue[] {
  if (!(error instanceof RuntimeRpcCallError)) {
    return []
  }
  const data: unknown = error.response.error.data
  if (
    typeof data !== 'object' ||
    data === null ||
    !('issues' in data) ||
    !Array.isArray(data.issues)
  ) {
    return []
  }
  return data.issues.filter(
    (issue: unknown): issue is WorkflowValidationIssue =>
      typeof issue === 'object' && issue !== null && 'code' in issue && 'field' in issue
  )
}

export function workflowErrorCode(error: unknown): string | null {
  return error instanceof RuntimeRpcCallError ? error.code : null
}

export function workflowErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
