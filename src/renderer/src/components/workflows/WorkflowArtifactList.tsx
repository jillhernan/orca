import { Copy, ExternalLink, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { useAppStore } from '@/store'
import { openQuickOpenFile } from '@/components/quick-open-file-navigation'
import {
  normalizeExecutionHostId,
  toRuntimeExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import type { WorkflowAttempt } from '../../../../shared/workflows/workflow-run-types'

const MAX_SHOWN = 30

/** The workspace's host as this window names it; a paired host reports its own machine as local. */
function clientExecutionHostId(hostKey: string, reported: string): ExecutionHostId | undefined {
  if (hostKey.startsWith('environment:')) {
    return toRuntimeExecutionHostId(hostKey.slice('environment:'.length))
  }
  return normalizeExecutionHostId(reported) ?? undefined
}

/**
 * Files an attempt reported, opened through the workspace's own file channel. A path is always
 * relative to the host that ran the step and is never read from this machine directly.
 */
export function WorkflowArtifactList({
  hostKey,
  attempt
}: {
  hostKey: string
  attempt: WorkflowAttempt
}): React.JSX.Element | null {
  const target = attempt.target
  const executionHostId = target ? clientExecutionHostId(hostKey, target.hostId) : undefined
  const known = useAppStore((state) =>
    target ? Boolean(state.getKnownWorktreeById(target.workspaceId, executionHostId)) : false
  )
  const artifacts = attempt.result?.artifacts ?? []
  if (artifacts.length === 0) {
    return null
  }
  const open = async (path: string): Promise<void> => {
    if (!target?.path || !activateAndRevealWorktree(target.workspaceId, { executionHostId })) {
      toast.error(
        translate(
          'auto.components.workflows.artifacts.unknownWorkspace',
          'Open this workspace in Orca to view its files.'
        )
      )
      return
    }
    try {
      await openQuickOpenFile(path, target.workspaceId, target.path, { pathQuery: path })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }
  return (
    <ul className="space-y-0.5">
      {artifacts.slice(0, MAX_SHOWN).map((artifact) => (
        <li
          key={`${artifact.kind}:${artifact.path}`}
          className="flex min-w-0 items-center gap-1.5 text-xs"
        >
          <FileText aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-mono" title={artifact.path}>
            {artifact.kind === 'report'
              ? translate('auto.components.workflows.artifacts.report', 'Report: {{value0}}', {
                  value0: artifact.path
                })
              : artifact.path}
          </span>
          {known ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={translate('auto.components.workflows.artifacts.open', 'Open file')}
                  onClick={() => void open(artifact.path)}
                >
                  <ExternalLink />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={4}>
                {translate('auto.components.workflows.artifacts.open', 'Open file')}
              </TooltipContent>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={translate('auto.components.workflows.artifacts.copy', 'Copy path')}
                onClick={() => void navigator.clipboard.writeText(artifact.path)}
              >
                <Copy />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              {translate('auto.components.workflows.artifacts.copy', 'Copy path')}
            </TooltipContent>
          </Tooltip>
        </li>
      ))}
      {artifacts.length > MAX_SHOWN ? (
        <li className="text-xs text-muted-foreground">
          {translate('auto.components.workflows.artifacts.more', '… and {{value0}} more', {
            value0: artifacts.length - MAX_SHOWN
          })}
        </li>
      ) : null}
    </ul>
  )
}
