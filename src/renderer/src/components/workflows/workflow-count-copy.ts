import { translate } from '@/i18n/i18n'

export function workflowStepCountLabel(count: number): string {
  return count === 1
    ? translate('auto.components.workflows.list.stepCount_one', '{{count}} step', { count })
    : translate('auto.components.workflows.list.stepCount_other', '{{count}} steps', { count })
}

export function workflowRunProgressLabel(done: number, count: number): string {
  return count === 1
    ? translate('auto.components.workflows.run.progress_one', '{{done}} of {{count}} step done', {
        done,
        count
      })
    : translate(
        'auto.components.workflows.run.progress_other',
        '{{done}} of {{count}} steps done',
        { done, count }
      )
}

export function workflowHistoryStepsLabel(done: number, count: number): string {
  return count === 1
    ? translate('auto.components.workflows.history.steps_one', '{{done}}/{{count}} step', {
        done,
        count
      })
    : translate('auto.components.workflows.history.steps_other', '{{done}}/{{count}} steps', {
        done,
        count
      })
}
