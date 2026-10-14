import { useMemo } from 'react'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { AgentIcon, getAgentCatalog, getAgentLabel } from '@/lib/agent-catalog'
import { useDetectedAgents } from '@/hooks/useDetectedAgents'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { isTuiAgentEnabled } from '../../../../shared/tui-agent-selection'
import { isTuiAgent } from '../../../../shared/tui-agent-config'
import { useWorkflowModelCatalog } from './use-workflow-model-catalog'

const INHERIT = '__inherit__'

/** Agents detected and enabled on this computer; launch re-checks them on the chosen host. */
export function useWorkflowAgentIds(): { agents: string[]; loading: boolean } {
  const detected = useDetectedAgents(null)
  const disabled = useAppStore((state) => state.settings?.disabledTuiAgents)
  return useMemo(
    () => ({
      agents: getAgentCatalog()
        .map((entry) => entry.id)
        .filter(
          (id) => (detected.detectedIds ?? []).includes(id) && isTuiAgentEnabled(id, disabled)
        ),
      loading: detected.isLoading
    }),
    [detected.detectedIds, detected.isLoading, disabled]
  )
}

export function WorkflowAgentFields({
  idPrefix,
  agent,
  model,
  effort,
  inheritLabel,
  agentError,
  showLaunchPreferences,
  onChange
}: {
  idPrefix: string
  agent: string | undefined
  model: string | undefined
  effort: string | undefined
  inheritLabel: string
  agentError?: string | null
  showLaunchPreferences: boolean
  onChange: (patch: { agent?: string; model?: string; effort?: string }) => void
}): React.JSX.Element {
  const { agents, loading } = useWorkflowAgentIds()
  const options = agent && !agents.includes(agent) ? [...agents, agent] : agents
  const catalog = useWorkflowModelCatalog(showLaunchPreferences ? (agent ?? null) : null)
  const selectedModel =
    catalog.status === 'ready' ? catalog.models.find((entry) => entry.id === model) : undefined
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-agent`}>
          {translate('auto.components.workflows.agent.label', 'Agent')}
        </Label>
        <Select
          value={agent ?? INHERIT}
          onValueChange={(value) =>
            onChange({
              agent: value === INHERIT ? undefined : value,
              model: undefined,
              effort: undefined
            })
          }
        >
          <SelectTrigger
            id={`${idPrefix}-agent`}
            aria-invalid={Boolean(agentError)}
            className="w-full"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={INHERIT}>{inheritLabel}</SelectItem>
            {options.map((id) => (
              <SelectItem key={id} value={id}>
                <AgentIcon agent={isTuiAgent(id) ? id : null} />
                {isTuiAgent(id) ? getAgentLabel(id) : id}
                {agents.includes(id)
                  ? null
                  : ` · ${translate('auto.components.workflows.agent.notDetected', 'not detected here')}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {agentError ? <p className="text-xs text-destructive">{agentError}</p> : null}
        {loading && agents.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {translate('auto.components.workflows.agent.detecting', 'Detecting agents…')}
          </p>
        ) : null}
      </div>
      {showLaunchPreferences ? (
        <>
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-model`}>
              {translate('auto.components.workflows.agent.model', 'Model')}
            </Label>
            <Select
              value={model ?? INHERIT}
              disabled={!agent || catalog.status !== 'ready'}
              onValueChange={(value) =>
                onChange({ model: value === INHERIT ? undefined : value, effort: undefined })
              }
            >
              <SelectTrigger id={`${idPrefix}-model`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={INHERIT}>
                  {translate(
                    'auto.components.workflows.agent.modelDefault',
                    "Agent's configured model"
                  )}
                </SelectItem>
                {catalog.status === 'ready'
                  ? catalog.models.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {entry.label}
                      </SelectItem>
                    ))
                  : null}
                {model && catalog.status === 'ready' && !selectedModel ? (
                  <SelectItem value={model}>{model}</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-effort`}>
              {translate('auto.components.workflows.agent.effort', 'Reasoning level')}
            </Label>
            <Select
              value={effort ?? INHERIT}
              disabled={!selectedModel || selectedModel.efforts.length === 0}
              onValueChange={(value) => onChange({ effort: value === INHERIT ? undefined : value })}
            >
              <SelectTrigger id={`${idPrefix}-effort`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={INHERIT}>
                  {translate('auto.components.workflows.agent.effortDefault', "Model's default")}
                </SelectItem>
                {(selectedModel?.efforts ?? []).map((choice) => (
                  <SelectItem key={choice.value} value={choice.value}>
                    {choice.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      ) : null}
    </div>
  )
}
