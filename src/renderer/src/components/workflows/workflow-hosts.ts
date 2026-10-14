import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import { getLocalExecutionHostLabel } from '../../../../shared/execution-host'
import { isFolderRepo } from '../../../../shared/repo-kind'
import type { Repo } from '../../../../shared/repo-types'
import type { FolderWorkspace } from '../../../../shared/folder-workspace-types'
import type { RuntimeWorktreeListResult } from '../../../../shared/runtime-worktree-contracts'
import { WORKFLOW_RUNTIME_CAPABILITY } from '../../../../shared/workflows/workflow-runtime-capabilities'

export type WorkflowHostAvailability = 'available' | 'offline' | 'unsupported'

export type WorkflowHostOption = {
  key: string
  target: RuntimeClientTarget
  label: string
  availability: WorkflowHostAvailability
}

export function workflowHostKey(target: RuntimeClientTarget): string {
  return target.kind === 'environment' ? `environment:${target.environmentId}` : 'local'
}

export function workflowHostFromKey(key: string): RuntimeClientTarget {
  return key.startsWith('environment:')
    ? { kind: 'environment', environmentId: key.slice('environment:'.length) }
    : { kind: 'local' }
}

export function localWorkflowHostOption(): WorkflowHostOption {
  return {
    key: 'local',
    target: { kind: 'local' },
    label: getLocalExecutionHostLabel(),
    availability: 'available'
  }
}

/** This app's runtime plus every paired host; a host without `workflow.v1` is listed but unusable. */
export function useWorkflowHostOptions(): WorkflowHostOption[] {
  const environments = useAppStore((state) => state.runtimeEnvironments)
  const statuses = useAppStore((state) => state.runtimeStatusByEnvironmentId)
  return useMemo(() => {
    const local = localWorkflowHostOption()
    const remote = environments.map((environment): WorkflowHostOption => {
      const status = statuses.get(environment.id)?.status ?? null
      return {
        key: `environment:${environment.id}`,
        target: { kind: 'environment', environmentId: environment.id },
        label: environment.name,
        availability: !status
          ? 'offline'
          : status.capabilities?.includes(WORKFLOW_RUNTIME_CAPABILITY)
            ? 'available'
            : 'unsupported'
      }
    })
    return [local, ...remote]
  }, [environments, statuses])
}

export function describeHostAvailability(option: WorkflowHostOption): string | null {
  if (option.availability === 'offline') {
    return translate(
      'auto.components.workflows.hosts.offline',
      'This host is offline. Reconnect it before starting a run there.'
    )
  }
  if (option.availability === 'unsupported') {
    return translate(
      'auto.components.workflows.hosts.unsupported',
      'This host runs an Orca version without workflows. Update Orca on that host to run workflows there.'
    )
  }
  return null
}

export type WorkflowWorkspaceOption = {
  id: string
  label: string
  detail: string
  isGit: boolean
}

/** Workspaces exactly as the chosen host knows them, so a run never names another host's folder. */
export async function listWorkflowWorkspaces(
  target: RuntimeClientTarget
): Promise<WorkflowWorkspaceOption[]> {
  const [repos, worktrees, folders] = await Promise.all([
    callRuntimeRpc<{ repos: Repo[] }>(target, 'repo.list', undefined, { timeoutMs: 15_000 }),
    callRuntimeRpc<RuntimeWorktreeListResult>(
      target,
      'worktree.list',
      { limit: 500 },
      { timeoutMs: 20_000 }
    ),
    callRuntimeRpc<{ folderWorkspaces: FolderWorkspace[] }>(
      target,
      'folderWorkspace.list',
      undefined,
      {
        timeoutMs: 15_000
      }
    ).catch(() => ({ folderWorkspaces: [] }))
  ])
  const repoById = new Map(repos.repos.map((repo) => [repo.id, repo]))
  const options: WorkflowWorkspaceOption[] = worktrees.worktrees
    .filter((worktree) => !worktree.isArchived)
    .map((worktree) => {
      const repo = repoById.get(worktree.repoId)
      const repoName = repo?.displayName ?? worktree.repoId
      return {
        id: worktree.id,
        label: worktree.displayName || worktree.git.branch || worktree.git.path,
        detail: worktree.git.branch ? `${repoName} · ${worktree.git.branch}` : repoName,
        isGit: repo ? !isFolderRepo(repo) : false
      }
    })
  for (const folder of folders.folderWorkspaces) {
    options.push({
      id: `folder:${folder.id}`,
      label: folder.name,
      detail: folder.folderPath,
      isGit: false
    })
  }
  return options
}
