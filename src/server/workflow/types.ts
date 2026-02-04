import { z } from 'zod'

export const workflowTaskTypeSchema = z.enum([
  'user.notify',
  'payment-plan.charge-outstanding',
  'sendMail',
  'sendSms',
  'processStripeEvent',
  'processMandrillEvent',
  'createStripeAccount',
  'mailchimp.subscribe',
  'mailchimp.refresh_user_properties',
  'updateMailchimpListMemberTags',
  'refreshAppStoreReceipts',
  'chargePaymentPlans',
  'sendPaymentReminders',
  'sendAppointmentReminders',
  'tagTrialledDidntSub',
])

export type WorkflowTaskType = z.infer<typeof workflowTaskTypeSchema>

const userNotifyPayloadSchema = z
  .object({
    userId: z.string().trim().min(1),
    title: z.string().trim().min(1),
    body: z.string().trim().min(1),
    messageType: z.enum(['default', 'success', 'failure']).default('default'),
    notificationType: z.enum(['transaction', 'reminder', 'general']).default('general'),
  })
  .and(
    z.object({
      clientId: z.string().trim().min(1).optional(),
      sessionPackId: z.string().trim().min(1).optional(),
      paymentPlanId: z.string().trim().min(1).optional(),
      paymentId: z.string().trim().min(1).optional(),
      paymentPlanPaymentId: z.string().trim().min(1).optional(),
      deviceTokens: z.array(z.string().trim().min(1)).optional(),
      skipAppNotification: z.boolean().optional(),
    })
  )

const chargeOutstandingPayloadSchema = z.object({
  paymentPlanId: z.string().trim().min(1),
  forScheduledTask: z.boolean().optional(),
})

const sendMailPayloadSchema = z.object({ id: z.string().trim().min(1) })
const sendSmsPayloadSchema = z.object({ id: z.string().trim().min(1) })
const processStripeEventPayloadSchema = z.object({ id: z.string().trim().min(1) })
const processMandrillEventPayloadSchema = z.object({
  ts: z.string().trim().min(1),
  _id: z.string().trim().min(1),
  event: z.enum(['send', 'hard_bounce', 'soft_bounce', 'open', 'click', 'reject', 'unsub', 'spam', 'deferral']),
})
const createStripeAccountPayloadSchema = z.object({
  trainerId: z.string().trim().min(1),
})
const mailchimpSubscribePayloadSchema = z.object({
  trainerId: z.string().trim().min(1),
})
const mailchimpRefreshUserPropertiesPayloadSchema = z.object({
  trainerId: z.string().trim().min(1),
  email: z.string().trim().min(1),
})

const mailchimpListMemberTagSchema = z.object({
  name: z.string().trim().min(1),
  status: z.enum(['active', 'inactive']),
})

const updateMailchimpListMemberTagsPayloadSchema = z.object({
  trainerId: z.string().trim().min(1),
  tags: z.array(mailchimpListMemberTagSchema).min(1),
})

const scheduledTaskPayloadSchema = z.object({
  scheduledAt: z.string().datetime({ offset: true }).optional(),
})

export const workflowTaskPayloadSchemas = {
  'user.notify': userNotifyPayloadSchema,
  'payment-plan.charge-outstanding': chargeOutstandingPayloadSchema,
  sendMail: sendMailPayloadSchema,
  sendSms: sendSmsPayloadSchema,
  processStripeEvent: processStripeEventPayloadSchema,
  processMandrillEvent: processMandrillEventPayloadSchema,
  createStripeAccount: createStripeAccountPayloadSchema,
  'mailchimp.subscribe': mailchimpSubscribePayloadSchema,
  'mailchimp.refresh_user_properties': mailchimpRefreshUserPropertiesPayloadSchema,
  updateMailchimpListMemberTags: updateMailchimpListMemberTagsPayloadSchema,
  refreshAppStoreReceipts: scheduledTaskPayloadSchema,
  chargePaymentPlans: scheduledTaskPayloadSchema,
  sendPaymentReminders: scheduledTaskPayloadSchema,
  sendAppointmentReminders: scheduledTaskPayloadSchema,
  tagTrialledDidntSub: scheduledTaskPayloadSchema,
} as const satisfies Record<WorkflowTaskType, z.ZodTypeAny>

export type WorkflowTaskPayloadMap = {
  [K in WorkflowTaskType]: z.infer<(typeof workflowTaskPayloadSchemas)[K]>
}

export const parseWorkflowTaskPayload = <TTaskType extends WorkflowTaskType>(taskType: TTaskType, payload: unknown) => {
  const schema = workflowTaskPayloadSchemas[taskType]
  return schema.parse(payload) as WorkflowTaskPayloadMap[TTaskType]
}

export type WorkflowTaskEnvelope<TTaskType extends WorkflowTaskType = WorkflowTaskType> = {
  outboxId: string
  taskType: TTaskType
  payload: WorkflowTaskPayloadMap[TTaskType]
  dedupeKey: string | null
}
