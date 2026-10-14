import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import type { WorkflowDefinition } from '../../../../shared/workflows/workflow-definition'
import {
  deleteWorkflowDefinition,
  workflowErrorCode,
  workflowErrorMessage
} from './workflow-client'

/** Deleting a definition never touches its runs; one with runs in progress is refused by the host. Mounted per definition, so each open starts clean. */
export function WorkflowDeleteDialog({
  definition,
  onOpenChange,
  onDeleted,
  onOpenHistory
}: {
  definition: WorkflowDefinition | null
  onOpenChange: (open: boolean) => void
  onDeleted: () => void
  onOpenHistory: (definitionId: string) => void
}): React.JSX.Element {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<{ message: string; activeRuns: boolean } | null>(null)

  const confirm = async (): Promise<void> => {
    if (!definition) {
      return
    }
    setPending(true)
    setError(null)
    try {
      await deleteWorkflowDefinition(definition.id)
      onDeleted()
    } catch (caught) {
      setError({
        message: workflowErrorMessage(caught),
        activeRuns: workflowErrorCode(caught) === 'workflow_definition_has_active_runs'
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={definition !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {translate('auto.components.workflows.delete.title', 'Delete {{value0}}?', {
              value0: definition?.body.name ?? ''
            })}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.workflows.delete.description',
              'The workflow definition is removed. Its run history stays, with the exact version each run used.'
            )}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <div role="alert" className="space-y-2 text-sm text-destructive">
            <p>{error.message}</p>
            {error.activeRuns && definition ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => onOpenHistory(definition.id)}
              >
                {translate('auto.components.workflows.delete.openRuns', 'Open its runs')}
              </Button>
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {translate('auto.components.workflows.delete.cancel', 'Cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => void confirm()}
          >
            {translate('auto.components.workflows.delete.confirm', 'Delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
