import { defineMethod } from '../core'
import {
  WorkflowDefinitionCreate,
  WorkflowDefinitionId,
  WorkflowDefinitionList,
  WorkflowDefinitionRevisionParams,
  WorkflowDefinitionUpdate,
  WorkflowLaunch,
  WorkflowRunId,
  WorkflowRunList,
  WorkflowStepDecision,
  WorkflowStepRef
} from '../../../../shared/rpc-contract/workflow-params'

// Why one namespace: clients gate the whole surface on the `workflow.v1` capability, and an older
// host answers method_not_found for every name here instead of a partial feature.
export const WORKFLOW_METHODS = [
  defineMethod({
    name: 'workflow.definitionList',
    permission: 'workspace',
    params: WorkflowDefinitionList,
    handler: (params, { runtime }) => runtime.getWorkflowService().listDefinitions(params.kind)
  }),
  defineMethod({
    name: 'workflow.definitionShow',
    permission: 'workspace',
    params: WorkflowDefinitionId,
    handler: (params, { runtime }) => ({
      definition: runtime.getWorkflowService().getDefinition(params.id)
    })
  }),
  defineMethod({
    name: 'workflow.definitionRevision',
    permission: 'workspace',
    params: WorkflowDefinitionRevisionParams,
    handler: (params, { runtime }) => ({
      body: runtime.getWorkflowService().getRevision(params.id, params.revision)
    })
  }),
  defineMethod({
    name: 'workflow.definitionCreate',
    permission: 'workspace',
    params: WorkflowDefinitionCreate,
    handler: (params, { runtime }) => ({
      definition: runtime.getWorkflowService().createDefinition(params)
    })
  }),
  defineMethod({
    name: 'workflow.definitionUpdate',
    permission: 'workspace',
    params: WorkflowDefinitionUpdate,
    handler: (params, { runtime }) => ({
      definition: runtime
        .getWorkflowService()
        .updateDefinition(params.id, params.body, params.expectedRevision)
    })
  }),
  defineMethod({
    name: 'workflow.definitionDelete',
    permission: 'workspace',
    params: WorkflowDefinitionId,
    handler: (params, { runtime }) => {
      runtime.getWorkflowService().deleteDefinition(params.id)
      return { deleted: true }
    }
  }),
  defineMethod({
    name: 'workflow.launchPreview',
    permission: 'workspace',
    params: WorkflowLaunch,
    handler: async (params, { runtime }) => ({
      plan: await runtime.getWorkflowService().planLaunch(params)
    })
  }),
  defineMethod({
    name: 'workflow.runStart',
    permission: 'workspace',
    params: WorkflowLaunch,
    handler: (params, { runtime }) => runtime.getWorkflowService().startRun(params)
  }),
  defineMethod({
    name: 'workflow.runList',
    permission: 'workspace',
    params: WorkflowRunList,
    handler: (params, { runtime }) => runtime.getWorkflowService().listRuns(params)
  }),
  defineMethod({
    name: 'workflow.runShow',
    permission: 'workspace',
    params: WorkflowRunId,
    handler: (params, { runtime }) => runtime.getWorkflowService().showRun(params.id)
  }),
  defineMethod({
    name: 'workflow.runPause',
    permission: 'workspace',
    params: WorkflowRunId,
    handler: (params, { runtime }) => runtime.getWorkflowService().pauseRun(params.id)
  }),
  defineMethod({
    name: 'workflow.runResume',
    permission: 'workspace',
    params: WorkflowRunId,
    handler: (params, { runtime }) => runtime.getWorkflowService().resumeRun(params.id)
  }),
  defineMethod({
    name: 'workflow.runCancel',
    permission: 'workspace',
    params: WorkflowRunId,
    handler: (params, { runtime }) => runtime.getWorkflowService().cancelRun(params.id)
  }),
  defineMethod({
    name: 'workflow.stepRetry',
    permission: 'workspace',
    params: WorkflowStepRef,
    handler: (params, { runtime }) =>
      runtime.getWorkflowService().retryStep(params.runId, params.stepId)
  }),
  defineMethod({
    name: 'workflow.stepStop',
    permission: 'workspace',
    params: WorkflowStepRef,
    handler: (params, { runtime }) =>
      runtime.getWorkflowService().stopStep(params.runId, params.stepId)
  }),
  defineMethod({
    name: 'workflow.stepDecide',
    permission: 'workspace',
    params: WorkflowStepDecision,
    handler: (params, { runtime }) =>
      runtime
        .getWorkflowService()
        .decide(params.runId, params.stepId, params.decision, params.comment)
  }),
  defineMethod({
    name: 'workflow.stepReopenDecision',
    permission: 'workspace',
    params: WorkflowStepRef,
    handler: (params, { runtime }) =>
      runtime.getWorkflowService().reopenDecision(params.runId, params.stepId)
  })
]
