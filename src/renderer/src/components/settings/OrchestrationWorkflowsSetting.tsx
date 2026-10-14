import { ArrowRight, Workflow } from 'lucide-react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { Button } from '@/components/ui/button'
import { SettingsSwitchRow } from './SettingsFormControls'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'

/** Workflows run on orchestration, so their sidebar shortcut lives with the orchestration settings. */
export function OrchestrationWorkflowsSetting({
  settings,
  updateSettings
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
}): React.JSX.Element {
  const openWorkflowsPage = useAppStore((state) => state.openWorkflowsPage)
  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex items-start gap-3">
        <Workflow className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="text-sm font-medium">
            {translate('auto.components.settings.orchestrationWorkflows.title', 'Workflows')}
          </h3>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.orchestrationWorkflows.description',
              'Build multi-step agent workflows with dependencies, approvals and reusable templates. Each run is an orchestration Run whose steps are Tasks.'
            )}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={openWorkflowsPage}>
          {translate('auto.components.settings.orchestrationWorkflows.open', 'Open Workflows')}
          <ArrowRight />
        </Button>
      </div>
      <SettingsSwitchRow
        label={translate(
          'auto.components.settings.orchestrationWorkflows.showButton',
          'Show Workflows Button'
        )}
        description={translate(
          'auto.components.settings.orchestrationWorkflows.showButtonDescription',
          'Show the Workflows shortcut in the sidebar.'
        )}
        checked={settings.showWorkflowsButton !== false}
        onChange={() =>
          void updateSettings({ showWorkflowsButton: settings.showWorkflowsButton === false })
        }
      />
    </div>
  )
}
