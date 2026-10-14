import { translate } from '@/i18n/i18n'
import {
  applySequentialDependencies,
  type WorkflowDefinitionBody
} from '../../../../shared/workflows/workflow-definition'

/**
 * The editable built-in example. It names no agent and no host, so it runs on whatever agent the
 * chosen host is configured for and is bound to a workspace only at launch.
 */
export function createFeatureWorkflowExample(): WorkflowDefinitionBody {
  return applySequentialDependencies({
    name: translate('auto.components.workflows.example.name', 'Add a small feature'),
    description: translate(
      'auto.components.workflows.example.description',
      'Turns a feature request into a plan, an implementation and usage notes.'
    ),
    dependencyMode: 'sequential',
    maxConcurrency: 1,
    parameters: [
      {
        id: 'feature_request',
        label: translate('auto.components.workflows.example.requestLabel', 'Feature request'),
        type: 'multiline',
        required: true,
        description: translate(
          'auto.components.workflows.example.requestDescription',
          'What the feature should do and who it is for.'
        )
      },
      {
        id: 'constraints',
        label: translate('auto.components.workflows.example.constraintsLabel', 'Constraints'),
        type: 'text',
        required: false,
        description: translate(
          'auto.components.workflows.example.constraintsDescription',
          'Optional limits, such as files to avoid or libraries to use.'
        )
      }
    ],
    steps: [
      {
        id: 'plan',
        name: translate('auto.components.workflows.example.planName', 'Implementation plan'),
        kind: 'agent',
        prompt: translate(
          'auto.components.workflows.example.planPrompt',
          'Read the feature request and the code it touches, then write a short implementation plan: the files to change, the approach, and the risks. Do not change code in this step.\n\nFeature request:\n{{params.feature_request}}\n\nConstraints: {{params.constraints}}'
        ),
        expectedOutput: translate(
          'auto.components.workflows.example.planOutput',
          'A plan of at most ten bullet points.'
        ),
        dependsOn: [],
        inputs: [],
        workspaceMode: 'shared'
      },
      {
        id: 'implement',
        name: translate('auto.components.workflows.example.implementName', 'Implement'),
        kind: 'agent',
        prompt: translate(
          'auto.components.workflows.example.implementPrompt',
          'Implement the feature by following the plan from the previous step. Add or update tests where the project already has them, and run them.\n\nFeature request:\n{{params.feature_request}}'
        ),
        expectedOutput: translate(
          'auto.components.workflows.example.implementOutput',
          'The code changes, with the list of changed files in your report.'
        ),
        dependsOn: [],
        inputs: [],
        workspaceMode: 'shared'
      },
      {
        id: 'usage',
        name: translate('auto.components.workflows.example.usageName', 'Usage notes'),
        kind: 'agent',
        prompt: translate(
          'auto.components.workflows.example.usagePrompt',
          'Write concise usage notes for the feature that was just implemented: how to use it and any limits. Put them where this project keeps documentation, or in your report if it has none.'
        ),
        expectedOutput: translate(
          'auto.components.workflows.example.usageOutput',
          'A short section a user can follow.'
        ),
        dependsOn: [],
        inputs: [],
        workspaceMode: 'shared'
      }
    ]
  })
}
