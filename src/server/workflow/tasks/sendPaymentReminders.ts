import type { WorkflowTaskPayloadMap } from '@/server/workflow/types'
import { APP_NAME, NO_REPLY_EMAIL } from '@/app/api/_lib/constants'
import { db } from '@/lib/db'
import { createClientDashboardLink } from '@/server/workflow/links'
import { enqueueWorkflowTask } from '@/server/workflow/outbox'
import { parseScheduledAt, scheduleNextRecurringTaskSafe } from '@/server/workflow/schedules'
import ctaEmail from '@/server/workflow/templates/ctaEmail'
import { joinIgnoreEmpty } from '@/server/workflow/utils'

export const handleSendPaymentRemindersTask = async ({
  scheduledAt,
}: WorkflowTaskPayloadMap['sendPaymentReminders']) => {
  const scheduleBase = parseScheduledAt(scheduledAt)

  try {
    const details = await db
      .selectFrom('vw_due_payment_reminders')
      .select([
        'last_reminder as lastReminder',
        'trainer_id as trainerId',
        'trainer_user_id as trainerUserId',
        'service_provider_name as serviceProviderName',
        'brand_color as brandColor',
        'business_logo_url as businessLogoUrl',
        'client_id as clientId',
        'client_first_name as clientFirstName',
        'client_last_name as clientLastName',
        'client_email as clientEmail',
        'overdue_count as overdueCount',
      ])
      .execute()

    for (const reminder of details) {
      await db.transaction().execute(async (trx) => {
        if (!reminder.clientEmail) {
          await enqueueWorkflowTask(trx, 'user.notify', {
            userId: reminder.trainerUserId,
            title: joinIgnoreEmpty(reminder.clientFirstName, reminder.clientLastName),
            body: 'We attempted to send them a payment reminder but there is no email on file. Add one to help you get paid.',
            messageType: 'failure',
            notificationType: 'reminder',
            clientId: reminder.clientId,
          })
          return
        }

        const link = await createClientDashboardLink(trx, {
          clientId: reminder.clientId,
          clientEmail: reminder.clientEmail,
        })

        await Promise.all([
          trx
            .insertInto('client_payment_reminder')
            .values({
              trainer_id: reminder.trainerId,
              client_id: reminder.clientId,
              send_time: new Date(),
              send_success: true,
            })
            .execute(),
          reminder.lastReminder
            ? enqueueWorkflowTask(trx, 'user.notify', {
                userId: reminder.trainerUserId,
                title: joinIgnoreEmpty(reminder.clientFirstName, reminder.clientLastName),
                body: `We've reminded this client about outstanding payments over the past 14 days. We'd suggest following up.`,
                messageType: 'default',
                notificationType: 'reminder',
                clientId: reminder.clientId,
              })
            : Promise.resolve(),
        ])

        const overdueLabel = reminder.overdueCount > 1 ? 'outstanding payments' : 'an outstanding payment'

        await trx
          .insertInto('mail')
          .values({
            from_email: NO_REPLY_EMAIL,
            from_name: `${reminder.serviceProviderName} via ${APP_NAME}`,
            to_email: reminder.clientEmail,
            client_id: reminder.clientId,
            trainer_id: reminder.trainerId,
            subject: `Payment Reminder for ${reminder.serviceProviderName}`,
            html: ctaEmail({
              receivingReason: `you have an overdue payment for ${reminder.serviceProviderName}`,
              brandColor: reminder.brandColor ?? undefined,
              logo: reminder.businessLogoUrl
                ? {
                    url: reminder.businessLogoUrl,
                    alt: reminder.serviceProviderName,
                  }
                : undefined,
              bodyHeading: 'Payment Reminder',
              button: {
                link,
                text: 'Review your outstanding payments',
              },
              bodyHtml: `<p>Hi there,</p>
              <p>Just a reminder that you have ${overdueLabel} due for ${reminder.serviceProviderName}. Click <a href="${link.toString()}">here</a> to review now.</p>
              <p>Best regards,<br> The ${APP_NAME} Team</p>`,
            }),
          })
          .execute()
      })
    }
  } finally {
    await scheduleNextRecurringTaskSafe(db, 'sendPaymentReminders', scheduleBase)
  }
}
