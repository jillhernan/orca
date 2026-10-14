import { join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import { ORCHESTRATION_WORKER_START_TASK_SPEC_MAX_BYTES } from '../../shared/orchestration-worker-start-prompt-budget'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { WorkflowDatabase } from '../workflows/workflow-database'
import { createWorkflowOrchestrationAdapter } from '../workflows/workflow-orchestration-adapter'
import { WorkflowScheduler } from '../workflows/workflow-scheduler'
import { WorkflowService } from '../workflows/workflow-service'

/**
 * Opens workflows.db and starts the scheduler, which immediately reconciles runs a previous
 * process left open. A failure here disables workflows only; every other service keeps starting.
 */
export function initializeMainProcessWorkflows(runtime: OrcaRuntimeService): void {
  try {
    const store = new WorkflowDatabase(
      join(getAppEnvironment().getPath('userData'), 'workflows.db')
    )
    const ctx = {
      store,
      port: createWorkflowOrchestrationAdapter(runtime),
      maxPromptBytes: ORCHESTRATION_WORKER_START_TASK_SPEC_MAX_BYTES
    }
    const scheduler = new WorkflowScheduler(ctx)
    runtime.setWorkflowService(new WorkflowService(ctx, scheduler))
    scheduler.start()
  } catch (error) {
    console.warn('[workflows] unavailable on this host:', error)
  }
}
