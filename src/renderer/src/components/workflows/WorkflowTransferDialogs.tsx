import { useMemo, useRef, useState } from 'react'
import { Copy, Download, FileUp } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import type { WorkflowDefinition } from '../../../../shared/workflows/workflow-definition'
import {
  exportWorkflowDefinition,
  importWorkflowDefinition
} from '../../../../shared/workflows/workflow-definition-transfer'
import { createWorkflowDefinition, workflowErrorMessage } from './workflow-client'
import { issueMessage } from './workflow-status-copy'

export function WorkflowExportDialog({
  definition,
  onOpenChange
}: {
  definition: WorkflowDefinition | null
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const json = useMemo(
    () => (definition ? exportWorkflowDefinition(definition.body, definition.kind) : ''),
    [definition]
  )
  const save = async (): Promise<void> => {
    if (!definition) {
      return
    }
    const result = await window.api.export.saveTextFile({
      content: json,
      defaultName: definition.body.name,
      extension: 'orca-workflow.json',
      filterName: translate('auto.components.workflows.transfer.filter', 'Orca workflow')
    })
    if (result.success) {
      toast.success(translate('auto.components.workflows.transfer.saved', 'Workflow exported'))
      onOpenChange(false)
    } else if (!result.cancelled) {
      toast.error(
        result.error ??
          translate('auto.components.workflows.transfer.saveFailed', 'Could not save the file')
      )
    }
  }
  return (
    <Dialog open={definition !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {translate('auto.components.workflows.transfer.exportTitle', 'Export {{value0}}', {
              value0: definition?.body.name ?? ''
            })}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.workflows.transfer.exportDescription',
              'Steps, parameters and defaults are included. Hosts, workspaces, run history and credentials are not. Check the prompts below for anything you do not want to share; nothing is uploaded.'
            )}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          readOnly
          value={json}
          aria-label={translate('auto.components.workflows.transfer.preview', 'Export preview')}
          variant="code"
          className="max-h-[50vh] min-h-48"
        />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void navigator.clipboard
                .writeText(json)
                .then(() =>
                  toast.success(translate('auto.components.workflows.transfer.copied', 'Copied'))
                )
            }}
          >
            <Copy />
            {translate('auto.components.workflows.transfer.copy', 'Copy')}
          </Button>
          <Button type="button" onClick={() => void save()}>
            <Download />
            {translate('auto.components.workflows.transfer.save', 'Save file')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Mounted only while open, so every open starts from an empty form. */
export function WorkflowImportDialog({
  onOpenChange,
  onImported
}: {
  onOpenChange: (open: boolean) => void
  onImported: (definitionId: string) => void
}): React.JSX.Element {
  const [text, setText] = useState('')
  const [problems, setProblems] = useState<string[]>([])
  const [pending, setPending] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const runImport = async (): Promise<void> => {
    const result = importWorkflowDefinition(text)
    if (!result.ok) {
      setProblems([result.message, ...result.issues.map(issueMessage)])
      return
    }
    setPending(true)
    try {
      const definition = await createWorkflowDefinition({ kind: result.kind, body: result.body })
      toast.success(
        translate(
          'auto.components.workflows.transfer.imported',
          'Workflow imported. Choose where it runs when you start it.'
        )
      )
      onImported(definition.id)
    } catch (error) {
      setProblems([workflowErrorMessage(error)])
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {translate('auto.components.workflows.transfer.importTitle', 'Import workflow')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.workflows.transfer.importDescription',
              'Paste an exported workflow or choose its file. Importing only creates the definition; nothing runs until you start it.'
            )}
          </DialogDescription>
        </DialogHeader>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) {
              void file.text().then(setText)
            }
            event.target.value = ''
          }}
        />
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={translate(
            'auto.components.workflows.transfer.pastePlaceholder',
            '{ "kind": "orca.workflow", … }'
          )}
          aria-label={translate('auto.components.workflows.transfer.pasteLabel', 'Workflow JSON')}
          aria-invalid={problems.length > 0}
          variant="code"
          className="max-h-[50vh] min-h-48"
        />
        {problems.length > 0 ? (
          <ul role="alert" className="list-disc space-y-1 pl-5 text-sm text-destructive">
            {problems.map((problem, index) => (
              <li key={`${index}-${problem}`}>{problem}</li>
            ))}
          </ul>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => fileInput.current?.click()}>
            <FileUp />
            {translate('auto.components.workflows.transfer.chooseFile', 'Choose file')}
          </Button>
          <Button
            type="button"
            disabled={pending || text.trim().length === 0}
            onClick={() => void runImport()}
          >
            {translate('auto.components.workflows.transfer.import', 'Import')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
