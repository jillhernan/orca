/** Where an attempt ran. Paths belong to that host and are never read as local paths. */
export type WorkflowExecutionTarget = {
  hostId: string
  workspaceId: string
  workspaceLabel: string
  isolated: boolean
  branch?: string | null
  path?: string | null
}

export type WorkflowArtifactRef = { kind: 'file' | 'report'; path: string }

export type WorkflowDecisionRecord = {
  decision: 'approved' | 'rejected'
  comment: string
  decidedAt: string
}

/** The hand-off one finished attempt passes to its dependents. */
export type WorkflowStepOutput = {
  stepId: string
  attemptNo: number
  taskId: string | null
  dispatchId: string | null
  summary: string
  artifacts: WorkflowArtifactRef[]
  target: WorkflowExecutionTarget | null
  decision?: WorkflowDecisionRecord
}

/** The `tasks.result` JSON written by orchestration's worker_done settlement. */
export type WorkerReportResult = {
  outcome: 'succeeded' | 'failed'
  subject: string
  body: string
  filesModified: string[]
  reportPath: string | null
  completedAt: string | null
}

const MAX_LISTED_ARTIFACTS = 50

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' ? value : null
}

export function parseWorkerReportResult(raw: string | null | undefined): WorkerReportResult | null {
  if (!raw) {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null
  }
  const record = Object.fromEntries(Object.entries(parsed))
  const outcome = record.outcome
  if (outcome !== 'succeeded' && outcome !== 'failed') {
    return null
  }
  const files = Array.isArray(record.filesModified)
    ? record.filesModified.filter((file): file is string => typeof file === 'string')
    : []
  return {
    outcome,
    subject: readString(record, 'subject') ?? '',
    body: readString(record, 'body') ?? '',
    filesModified: files,
    reportPath: readString(record, 'reportPath'),
    completedAt: readString(record, 'completedAt')
  }
}

export function workerReportSummary(report: WorkerReportResult): string {
  const subject = report.subject.trim()
  const body = report.body.trim()
  if (!subject) {
    return body
  }
  return body && body !== subject ? `${subject}\n\n${body}` : subject
}

export function workerReportArtifacts(report: WorkerReportResult): WorkflowArtifactRef[] {
  const artifacts: WorkflowArtifactRef[] = report.filesModified.map((path) => ({
    kind: 'file',
    path
  }))
  if (report.reportPath) {
    artifacts.push({ kind: 'report', path: report.reportPath })
  }
  return artifacts
}

export function describeExecutionTarget(target: WorkflowExecutionTarget): string {
  const where = target.isolated
    ? `isolated worktree${target.branch ? ` on branch ${target.branch}` : ''}`
    : `workspace "${target.workspaceLabel}"`
  return target.path
    ? `${where} at ${target.path} (host ${target.hostId})`
    : `${where} (host ${target.hostId})`
}

export function formatWorkflowArtifactList(output: WorkflowStepOutput): string {
  if (output.artifacts.length === 0) {
    return 'No files were reported.'
  }
  const listed = output.artifacts
    .slice(0, MAX_LISTED_ARTIFACTS)
    .map((artifact) =>
      artifact.kind === 'report' ? `- report: ${artifact.path}` : `- ${artifact.path}`
    )
  const more = output.artifacts.length - listed.length
  const lines = [
    output.target ? `Files in the ${describeExecutionTarget(output.target)}:` : 'Files:',
    ...listed
  ]
  if (more > 0) {
    lines.push(`- … ${more} more (see task ${output.taskId ?? 'result'})`)
  }
  return lines.join('\n')
}
