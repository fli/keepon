import { FatalError, getStepMetadata } from 'workflow'
import { db } from '@/lib/db'
import { normalizeErrorMessage, OUTBOX_STATUS } from '@/server/workflow/outbox'
import { handleChargeOutstandingTask } from '@/server/workflow/tasks/chargeOutstanding'
import { handleChargePaymentPlansTask } from '@/server/workflow/tasks/chargePaymentPlans'
import { handleCreateStripeAccountTask } from '@/server/workflow/tasks/createStripeAccount'
import {
  handleMailchimpRefreshUserPropertiesTask,
  handleMailchimpSubscribeTask,
  handleUpdateMailchimpListMemberTagsTask,
} from '@/server/workflow/tasks/mailchimp'
import { handleProcessMandrillEventTask } from '@/server/workflow/tasks/processMandrillEvent'
import { handleProcessStripeEventTask } from '@/server/workflow/tasks/processStripeEvent'
import { handleRefreshAppStoreReceiptsTask } from '@/server/workflow/tasks/refreshAppStoreReceipts'
import { handleSendAppointmentRemindersTask } from '@/server/workflow/tasks/sendAppointmentReminders'
import { handleSendMailTask } from '@/server/workflow/tasks/sendMail'
import { handleSendPaymentRemindersTask } from '@/server/workflow/tasks/sendPaymentReminders'
import { handleSendSmsTask } from '@/server/workflow/tasks/sendSms'
import { handleTagTrialledDidntSubTask } from '@/server/workflow/tasks/tagTrialledDidntSub'
import { handleUserNotifyTask } from '@/server/workflow/tasks/userNotify'
import { parseWorkflowTaskPayload, workflowTaskTypeSchema, type WorkflowTaskEnvelope } from '@/server/workflow/types'

const createUnsupportedTaskError = (taskType: string) =>
  new FatalError(`Workflow task '${taskType}' is not implemented in keepon-solito yet.`)

const upsertTaskExecutionAsRunning = async (outboxId: string, taskType: string, stepId: string) => {
  const staleAfterMinutes = 5

  return db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom('workflow_task_execution')
      .select((eb) => [
        eb.ref('owner_step_id').as('ownerStepId'),
        eb.ref('completed_at').as('completedAt'),
        eb.ref('updated_at').as('updatedAt'),
      ])
      .where('outbox_id', '=', outboxId)
      .forUpdate()
      .executeTakeFirst()

    if (!existing) {
      const now = new Date()
      await trx
        .insertInto('workflow_task_execution')
        .values({
          outbox_id: outboxId,
          task_type: taskType,
          owner_step_id: stepId,
          status: 'running',
          attempts: 1,
        })
        .execute()

      await trx
        .updateTable('workflow_outbox')
        .set({ status: OUTBOX_STATUS.Running, updated_at: now, last_error: null })
        .where('id', '=', outboxId)
        .execute()

      return true
    }

    if (existing.completedAt) {
      return false
    }

    const staleCutoff = new Date(Date.now() - staleAfterMinutes * 60_000)
    const shouldClaimOwnership = existing.ownerStepId === stepId || existing.updatedAt < staleCutoff

    if (!shouldClaimOwnership) {
      return false
    }

    const now = new Date()
    await trx
      .updateTable('workflow_task_execution')
      .set((eb) => ({
        owner_step_id: stepId,
        status: 'running',
        attempts: eb('attempts', '+', 1),
        updated_at: now,
      }))
      .where('outbox_id', '=', outboxId)
      .execute()

    await trx
      .updateTable('workflow_outbox')
      .set({ status: OUTBOX_STATUS.Running, updated_at: now, last_error: null })
      .where('id', '=', outboxId)
      .execute()

    return true
  })
}

const markTaskExecutionAsCompleted = async (outboxId: string) => {
  await db.transaction().execute(async (trx) => {
    const now = new Date()
    await trx
      .updateTable('workflow_task_execution')
      .set({ status: 'completed', completed_at: now, updated_at: now, last_error: null })
      .where('outbox_id', '=', outboxId)
      .execute()

    await trx
      .updateTable('workflow_outbox')
      .set({ status: OUTBOX_STATUS.Completed, completed_at: now, updated_at: now, last_error: null })
      .where('id', '=', outboxId)
      .execute()
  })
}

const markTaskExecutionAsFailed = async (outboxId: string, errorMessage: string) => {
  await db.transaction().execute(async (trx) => {
    const now = new Date()
    await trx
      .updateTable('workflow_task_execution')
      .set({ status: 'failed', last_error: errorMessage, updated_at: now })
      .where('outbox_id', '=', outboxId)
      .execute()

    await trx
      .updateTable('workflow_outbox')
      .set({ status: OUTBOX_STATUS.Failed, failed_at: now, last_error: errorMessage, updated_at: now })
      .where('id', '=', outboxId)
      .execute()
  })
}

const executeTaskByType = async (taskType: WorkflowTaskEnvelope['taskType'], payload: unknown) => {
  switch (taskType) {
    case 'user.notify': {
      await handleUserNotifyTask(parseWorkflowTaskPayload('user.notify', payload))
      return
    }

    case 'payment-plan.charge-outstanding': {
      await handleChargeOutstandingTask(parseWorkflowTaskPayload('payment-plan.charge-outstanding', payload))
      return
    }

    case 'chargePaymentPlans': {
      await handleChargePaymentPlansTask(parseWorkflowTaskPayload('chargePaymentPlans', payload))
      return
    }

    case 'sendMail': {
      await handleSendMailTask(parseWorkflowTaskPayload('sendMail', payload))
      return
    }

    case 'sendSms': {
      await handleSendSmsTask(parseWorkflowTaskPayload('sendSms', payload))
      return
    }

    case 'sendPaymentReminders': {
      await handleSendPaymentRemindersTask(parseWorkflowTaskPayload('sendPaymentReminders', payload))
      return
    }

    case 'sendAppointmentReminders': {
      await handleSendAppointmentRemindersTask(parseWorkflowTaskPayload('sendAppointmentReminders', payload))
      return
    }

    case 'processStripeEvent': {
      await handleProcessStripeEventTask(parseWorkflowTaskPayload('processStripeEvent', payload))
      return
    }

    case 'processMandrillEvent': {
      await handleProcessMandrillEventTask(parseWorkflowTaskPayload('processMandrillEvent', payload))
      return
    }

    case 'refreshAppStoreReceipts': {
      await handleRefreshAppStoreReceiptsTask(parseWorkflowTaskPayload('refreshAppStoreReceipts', payload))
      return
    }

    case 'createStripeAccount': {
      await handleCreateStripeAccountTask(parseWorkflowTaskPayload('createStripeAccount', payload))
      return
    }

    case 'mailchimp.subscribe': {
      await handleMailchimpSubscribeTask(parseWorkflowTaskPayload('mailchimp.subscribe', payload))
      return
    }

    case 'mailchimp.refresh_user_properties': {
      await handleMailchimpRefreshUserPropertiesTask(
        parseWorkflowTaskPayload('mailchimp.refresh_user_properties', payload)
      )
      return
    }

    case 'updateMailchimpListMemberTags': {
      await handleUpdateMailchimpListMemberTagsTask(parseWorkflowTaskPayload('updateMailchimpListMemberTags', payload))
      return
    }

    case 'tagTrialledDidntSub': {
      await handleTagTrialledDidntSubTask(parseWorkflowTaskPayload('tagTrialledDidntSub', payload))
      return
    }

    default: {
      const neverTaskType: never = taskType
      throw createUnsupportedTaskError(neverTaskType)
    }
  }
}

async function executeWorkflowOutboxTask(input: {
  outboxId: string
  taskType: string
  payload: unknown
  dedupeKey: string | null
}) {
  'use step'

  const { stepId } = getStepMetadata()
  const taskType = workflowTaskTypeSchema.parse(input.taskType)
  const payload = parseWorkflowTaskPayload(taskType, input.payload)
  const envelope: WorkflowTaskEnvelope = {
    outboxId: input.outboxId,
    taskType,
    payload,
    dedupeKey: input.dedupeKey,
  }

  const shouldRunTask = await upsertTaskExecutionAsRunning(envelope.outboxId, envelope.taskType, stepId)

  if (!shouldRunTask) {
    return { outcome: 'deduped' as const }
  }

  try {
    await executeTaskByType(envelope.taskType, envelope.payload)
    await markTaskExecutionAsCompleted(envelope.outboxId)
    return { outcome: 'completed' as const }
  } catch (error) {
    const errorMessage = normalizeErrorMessage(error)
    await markTaskExecutionAsFailed(envelope.outboxId, errorMessage)
    throw error
  }
}

export async function processOutboxTaskWorkflow(input: {
  outboxId: string
  taskType: string
  payload: unknown
  dedupeKey: string | null
}) {
  'use workflow'

  if (!input.outboxId) {
    throw new FatalError('Missing outbox id')
  }

  await executeWorkflowOutboxTask(input)
}
