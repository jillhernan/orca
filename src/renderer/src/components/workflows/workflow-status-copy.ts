import { translate } from '@/i18n/i18n'
import type {
  WorkflowAttemptState,
  WorkflowLiveness,
  WorkflowRunStatus,
  WorkflowStepStatus
} from '../../../../shared/workflows/workflow-run-types'
import type { WorkflowValidationIssue } from '../../../../shared/workflows/workflow-validation-issues'

export function runStatusLabel(status: WorkflowRunStatus): string {
  switch (status) {
    case 'running':
      return translate('auto.components.workflows.status.run.running', 'Running')
    case 'paused':
      return translate('auto.components.workflows.status.run.paused', 'Paused')
    case 'awaiting_decision':
      return translate(
        'auto.components.workflows.status.run.awaitingDecision',
        'Waiting for your decision'
      )
    case 'succeeded':
      return translate('auto.components.workflows.status.run.succeeded', 'Completed')
    case 'failed':
      return translate('auto.components.workflows.status.run.failed', 'Failed')
    case 'blocked':
      return translate('auto.components.workflows.status.run.blocked', 'Blocked')
    case 'cancelling':
      return translate('auto.components.workflows.status.run.cancelling', 'Cancelling')
    case 'cancelled':
      return translate('auto.components.workflows.status.run.cancelled', 'Cancelled')
  }
}

export function stepStatusLabel(status: WorkflowStepStatus): string {
  switch (status) {
    case 'waiting':
      return translate('auto.components.workflows.status.step.waiting', 'Waiting for dependencies')
    case 'ready':
      return translate('auto.components.workflows.status.step.ready', 'Queued')
    case 'starting':
      return translate('auto.components.workflows.status.step.starting', 'Starting agent')
    case 'running':
      return translate('auto.components.workflows.status.step.running', 'Running')
    case 'stopping':
      return translate('auto.components.workflows.status.step.stopping', 'Stopping')
    case 'awaiting_decision':
      return translate(
        'auto.components.workflows.status.step.awaitingDecision',
        'Waiting for decision'
      )
    case 'succeeded':
      return translate('auto.components.workflows.status.step.succeeded', 'Completed')
    case 'failed':
      return translate('auto.components.workflows.status.step.failed', 'Failed')
    case 'rejected':
      return translate('auto.components.workflows.status.step.rejected', 'Rejected')
    case 'blocked':
      return translate(
        'auto.components.workflows.status.step.blocked',
        'Blocked by an earlier step'
      )
    case 'cancelled':
      return translate('auto.components.workflows.status.step.cancelled', 'Cancelled')
  }
}

export function attemptStateLabel(state: WorkflowAttemptState): string {
  switch (state) {
    case 'claimed':
    case 'starting':
      return translate('auto.components.workflows.status.attempt.starting', 'Starting')
    case 'running':
      return translate('auto.components.workflows.status.attempt.running', 'Running')
    case 'awaiting_decision':
      return translate(
        'auto.components.workflows.status.attempt.awaitingDecision',
        'Waiting for decision'
      )
    case 'succeeded':
      return translate('auto.components.workflows.status.attempt.succeeded', 'Succeeded')
    case 'approved':
      return translate('auto.components.workflows.status.attempt.approved', 'Approved')
    case 'rejected':
      return translate('auto.components.workflows.status.attempt.rejected', 'Rejected')
    case 'failed':
      return translate('auto.components.workflows.status.attempt.failed', 'Failed')
    case 'start_failed':
      return translate('auto.components.workflows.status.attempt.startFailed', 'Did not start')
    case 'stopping':
      return translate('auto.components.workflows.status.attempt.stopping', 'Stopping')
    case 'stopped':
      return translate('auto.components.workflows.status.attempt.stopped', 'Stopped')
    case 'stop_unknown':
      return translate('auto.components.workflows.status.attempt.stopUnknown', 'Stop not confirmed')
    case 'superseded':
      return translate('auto.components.workflows.status.attempt.superseded', 'Superseded')
  }
}

export function livenessLabel(liveness: WorkflowLiveness): string {
  switch (liveness) {
    case 'live':
      return translate('auto.components.workflows.status.liveness.live', 'Process live')
    case 'unverifiable':
      return translate(
        'auto.components.workflows.status.liveness.unverifiable',
        'Process state cannot be verified right now'
      )
    case 'exited':
      return translate('auto.components.workflows.status.liveness.exited', 'Process exited')
  }
}

/** Localized text for an issue; falls back to the host's English message for codes this build lacks. */
export function issueMessage(issue: WorkflowValidationIssue): string {
  const detail = issue.detail ?? {}
  const value0 = String(
    detail.reference ?? detail.dependency ?? detail.agent ?? detail.cycle ?? detail.steps ?? ''
  )
  switch (issue.code) {
    case 'name_required':
      return translate('auto.components.workflows.issue.nameRequired', 'Give the workflow a name.')
    case 'steps_required':
      return translate('auto.components.workflows.issue.stepsRequired', 'Add at least one step.')
    case 'step_id_invalid':
      return translate(
        'auto.components.workflows.issue.stepIdInvalid',
        'Use lowercase letters, digits, - or _ for the step id (up to 48).'
      )
    case 'step_id_duplicate':
      return translate(
        'auto.components.workflows.issue.stepIdDuplicate',
        'Another step already uses this id.'
      )
    case 'step_name_required':
      return translate('auto.components.workflows.issue.stepNameRequired', 'Give the step a name.')
    case 'step_prompt_required':
      return translate(
        'auto.components.workflows.issue.stepPromptRequired',
        'Write the instructions for this step.'
      )
    case 'dependency_self':
      return translate(
        'auto.components.workflows.issue.dependencySelf',
        'A step cannot depend on itself.'
      )
    case 'dependency_missing':
      return translate(
        'auto.components.workflows.issue.dependencyMissing',
        'Depends on a step that does not exist: {{value0}}.',
        { value0 }
      )
    case 'dependency_duplicate':
      return translate(
        'auto.components.workflows.issue.dependencyDuplicate',
        'The dependency on {{value0}} is listed twice.',
        { value0 }
      )
    case 'dependency_cycle':
      return translate(
        'auto.components.workflows.issue.dependencyCycle',
        'These dependencies form a loop: {{value0}}.',
        { value0 }
      )
    case 'input_not_predecessor':
      return translate(
        'auto.components.workflows.issue.inputNotPredecessor',
        '{{value0}} is not a direct predecessor of this step.',
        { value0 }
      )
    case 'integration_required':
      return translate(
        'auto.components.workflows.issue.integrationRequired',
        'Code from isolated step(s) {{value0}} reaches this step without a code integration step in between.',
        { value0 }
      )
    case 'reference_invalid':
      return translate(
        'auto.components.workflows.issue.referenceInvalid',
        '{{value0}} is not a valid variable. Use Insert variable to pick one.',
        { value0 }
      )
    case 'reference_unknown_param':
      return translate(
        'auto.components.workflows.issue.referenceUnknownParam',
        '{{value0}} names a parameter that does not exist.',
        { value0 }
      )
    case 'reference_unknown_step':
      return translate(
        'auto.components.workflows.issue.referenceUnknownStep',
        '{{value0}} names a step that does not exist.',
        { value0 }
      )
    case 'reference_not_predecessor':
      return translate(
        'auto.components.workflows.issue.referenceNotPredecessor',
        '{{value0}} must name a direct predecessor of this step.',
        { value0 }
      )
    case 'agent_unavailable':
      return value0
        ? translate(
            'auto.components.workflows.issue.agentUnavailable',
            'Agent {{value0}} is not available on this host.',
            { value0 }
          )
        : translate(
            'auto.components.workflows.issue.agentMissing',
            'This host has no default agent. Choose an agent for this step or the workflow.'
          )
    case 'target_required':
      return translate(
        'auto.components.workflows.issue.targetRequired',
        'Choose a workspace on this host.'
      )
    case 'target_not_git':
      return translate(
        'auto.components.workflows.issue.targetNotGit',
        'Isolated steps need a Git repository; this workspace is a plain folder.'
      )
    default:
      return issue.message
  }
}

/** For flat issue lists: a step-scoped issue names its step, so two steps' issues stay distinct. */
export function stepScopedIssueMessage(
  issue: WorkflowValidationIssue,
  steps: readonly { id: string; name: string }[]
): string {
  const step = issue.stepId ? steps.find((candidate) => candidate.id === issue.stepId) : undefined
  return step
    ? translate('auto.components.workflows.issue.stepPrefixed', '{{step}}: {{message}}', {
        step: step.name || step.id,
        message: issueMessage(issue)
      })
    : issueMessage(issue)
}
