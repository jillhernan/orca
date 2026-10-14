import { useState } from 'react'
import { ChevronDown, ChevronRight, Info } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { getAgentLabel } from '@/lib/agent-catalog'
import type { WorkflowDefinitionBody } from '../../../../shared/workflows/workflow-definition'
import type {
  WorkflowLaunchNote,
  WorkflowLaunchPlan
} from '../../../../shared/workflows/workflow-launch-types'
import { isTuiAgent } from '../../../../shared/tui-agent-config'

function noteText(note: WorkflowLaunchNote): string {
  switch (note) {
    case 'isolated_from_commit':
      return translate(
        'auto.components.workflows.launch.noteIsolated',
        'Isolated steps start in a new worktree branched from the run workspace’s latest commit when they start. Uncommitted changes are not copied into them.'
      )
    case 'folder_runs_serially':
      return translate(
        'auto.components.workflows.launch.noteFolder',
        'This workspace is a plain folder, so every step runs in it one at a time.'
      )
    case 'shared_steps_take_turns':
      return translate(
        'auto.components.workflows.launch.noteShared',
        'Steps that use the run workspace take turns so two agents never edit the same folder at once.'
      )
  }
}

function agentText(agent: string | null, source: string | null): string {
  if (!agent) {
    return translate('auto.components.workflows.launch.noAgent', 'No agent available')
  }
  const label = isTuiAgent(agent) ? getAgentLabel(agent) : agent
  return source === 'host'
    ? translate('auto.components.workflows.launch.hostAgent', '{{value0}} (host default)', {
        value0: label
      })
    : label
}

/** What the host will run: each step's agent, workspace mode and final prompt, plus caveats. */
export function WorkflowLaunchPlanPreview({
  body,
  plan
}: {
  body: WorkflowDefinitionBody
  plan: WorkflowLaunchPlan
}): React.JSX.Element {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="space-y-3">
      {plan.notes.map((note) => (
        <p key={note} className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          {noteText(note)}
        </p>
      ))}
      <ol className="space-y-1.5">
        {plan.steps.map((stepPlan, index) => {
          const step = body.steps.find((candidate) => candidate.id === stepPlan.stepId)
          const expanded = open === stepPlan.stepId
          return (
            <li key={stepPlan.stepId} className="rounded-md border border-border">
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : stepPlan.stepId)}
              >
                {expanded ? (
                  <ChevronDown className="size-3.5 shrink-0" />
                ) : (
                  <ChevronRight className="size-3.5 shrink-0" />
                )}
                <span className="w-5 shrink-0 text-xs text-muted-foreground tabular-nums">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {step?.name ?? stepPlan.stepId}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {stepPlan.kind === 'agent'
                    ? `${agentText(stepPlan.agent, stepPlan.agentSource)}${stepPlan.model ? ` · ${stepPlan.model}` : ''}${stepPlan.workspaceMode === 'isolated' ? ` · ${translate('auto.components.workflows.launch.isolated', 'own worktree')}` : ''}`
                    : stepPlan.kind === 'approval'
                      ? translate(
                          'auto.components.workflows.launch.approval',
                          'Waits for your approval'
                        )
                      : translate(
                          'auto.components.workflows.launch.integration',
                          'Waits for you to integrate code'
                        )}
                </span>
              </button>
              {expanded ? (
                <div className="border-t border-border px-3 py-2">
                  {stepPlan.prompt ? (
                    <>
                      <p className="mb-1 text-xs text-muted-foreground">
                        {translate(
                          'auto.components.workflows.launch.promptCaption',
                          'Prompt the agent receives ({{value0}} bytes). Results of earlier steps replace the bracketed placeholders.',
                          {
                            value0: stepPlan.byteLength
                          }
                        )}
                      </p>
                      <pre className="scrollbar-sleek max-h-64 overflow-auto rounded bg-muted p-2 font-mono text-xs whitespace-pre-wrap">
                        {stepPlan.prompt}
                      </pre>
                    </>
                  ) : (
                    <p className="text-xs whitespace-pre-wrap text-muted-foreground">
                      {step?.prompt}
                    </p>
                  )}
                </div>
              ) : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
