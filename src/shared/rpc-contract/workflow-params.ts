import { z } from 'zod'
import {
  WORKFLOW_DEFINITION_KINDS,
  WorkflowDefinitionBodySchema
} from '../workflows/workflow-definition'
import { OptionalPositiveInt, OptionalString, requiredString } from './rpc-param-primitives'

const PositiveRevision = z.number().int().positive()
const RUN_STATUSES = [
  'running',
  'paused',
  'awaiting_decision',
  'succeeded',
  'failed',
  'blocked',
  'cancelling',
  'cancelled'
] as const

export const WorkflowDefinitionList = z.object({
  kind: z.enum(WORKFLOW_DEFINITION_KINDS).optional()
})

export const WorkflowDefinitionId = z.object({
  id: requiredString('Missing workflow id')
})

export const WorkflowDefinitionRevisionParams = z.object({
  id: requiredString('Missing workflow id'),
  revision: PositiveRevision
})

export const WorkflowDefinitionCreate = z.object({
  kind: z.enum(WORKFLOW_DEFINITION_KINDS).default('workflow'),
  body: WorkflowDefinitionBodySchema,
  requestId: OptionalString
})

export const WorkflowDefinitionUpdate = z.object({
  id: requiredString('Missing workflow id'),
  body: WorkflowDefinitionBodySchema,
  expectedRevision: PositiveRevision
})

export const WorkflowLaunch = z.object({
  requestId: requiredString('Missing request id'),
  definitionId: requiredString('Missing workflow id'),
  definitionRevision: PositiveRevision,
  snapshot: WorkflowDefinitionBodySchema,
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  workspaceId: requiredString('Missing workspace'),
  maxConcurrency: z.number().int().optional(),
  rerunOf: OptionalString
})

export const WorkflowRunList = z.object({
  definitionId: OptionalString,
  statuses: z.array(z.enum(RUN_STATUSES)).optional(),
  limit: OptionalPositiveInt,
  before: OptionalString
})

export const WorkflowRunId = z.object({
  id: requiredString('Missing run id')
})

export const WorkflowStepRef = z.object({
  runId: requiredString('Missing run id'),
  stepId: requiredString('Missing step id')
})

export const WorkflowStepDecision = z.object({
  runId: requiredString('Missing run id'),
  stepId: requiredString('Missing step id'),
  decision: z.enum(['approved', 'rejected']),
  comment: z.string().max(10_000).default('')
})
