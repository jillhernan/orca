import { useState } from 'react'
import { Check, GitBranch, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import { branchName } from '@/lib/git-utils'
import type { WorkflowStep } from '../../../../shared/workflows/workflow-definition'
import type { WorkflowRunDetail } from '../../../../shared/workflows/workflow-run-types'
import { WorkflowArtifactList } from './WorkflowArtifactList'

function latestSuccess(detail: WorkflowRunDetail, stepId: string) {
  const view = detail.steps.find((candidate) => candidate.stepId === stepId)
  return (view?.attempts ?? []).findLast(
    (attempt) => attempt.state === 'succeeded' || attempt.state === 'approved'
  )
}

/**
 * The reviewer's view of an approval or integration step: the question, what the steps before it
 * produced, and for integration the branches that still need merging. Only these buttons settle it.
 */
export function WorkflowDecisionPanel({
  hostKey,
  detail,
  step,
  busy,
  onDecide
}: {
  hostKey: string
  detail: WorkflowRunDetail
  step: WorkflowStep
  busy: boolean
  onDecide: (decision: 'approved' | 'rejected', comment: string) => void
}): React.JSX.Element {
  const [comment, setComment] = useState('')
  const integration = step.kind === 'integration'
  const upstream = step.dependsOn.map((dep) => ({
    step: detail.run.snapshot.steps.find((candidate) => candidate.id === dep),
    attempt: latestSuccess(detail, dep)
  }))
  return (
    <div className="space-y-3 rounded-md border border-status-warning-border p-3">
      <p className="text-sm font-medium whitespace-pre-wrap">{step.prompt}</p>
      {integration ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.workflows.decision.integrationHelp',
            'Merge each branch below into the run workspace ({{value0}}) with your usual Git tools or review flow, resolve any conflicts, then confirm. Orca does not merge or force anything; dependent steps start only after you confirm.',
            { value0: detail.run.target.workspaceLabel }
          )}
        </p>
      ) : null}
      <ul className="space-y-2">
        {upstream.map(({ step: dep, attempt }) => (
          <li key={dep?.id ?? 'missing'} className="space-y-1 rounded-md bg-muted p-2">
            <p className="text-xs font-medium">{dep?.name ?? dep?.id}</p>
            {attempt?.target?.isolated ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <GitBranch aria-hidden="true" className="size-3.5" />
                {translate(
                  'auto.components.workflows.decision.branch',
                  'Branch {{value0}} in {{value1}}',
                  {
                    value0: attempt.target.branch ? branchName(attempt.target.branch) : '?',
                    value1: attempt.target.path ?? attempt.target.workspaceLabel
                  }
                )}
              </p>
            ) : null}
            {attempt?.result?.summary ? (
              <p className="line-clamp-6 text-xs whitespace-pre-wrap">{attempt.result.summary}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.workflows.decision.noSummary',
                  'No summary was reported.'
                )}
              </p>
            )}
            {attempt ? <WorkflowArtifactList hostKey={hostKey} attempt={attempt} /> : null}
          </li>
        ))}
      </ul>
      <div className="space-y-1.5">
        <Label htmlFor={`decision-${step.id}`}>
          {translate(
            'auto.components.workflows.decision.comment',
            'Comment (passed to the next steps)'
          )}
        </Label>
        <Textarea
          id={`decision-${step.id}`}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => onDecide('rejected', comment)}
        >
          <X />
          {translate('auto.components.workflows.decision.reject', 'Reject')}
        </Button>
        <Button type="button" disabled={busy} onClick={() => onDecide('approved', comment)}>
          <Check />
          {integration
            ? translate('auto.components.workflows.decision.integrated', 'Code is integrated')
            : translate('auto.components.workflows.decision.approve', 'Approve')}
        </Button>
      </div>
    </div>
  )
}
