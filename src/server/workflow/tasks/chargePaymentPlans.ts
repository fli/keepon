import type { WorkflowTaskPayloadMap } from '@/server/workflow/types'
import { APP_NAME, NO_REPLY_EMAIL } from '@/app/api/_lib/constants'
import { db } from '@/lib/db'
import { createClientDashboardLink } from '@/server/workflow/links'
import { enqueueWorkflowTask } from '@/server/workflow/outbox'
import { parseScheduledAt, scheduleNextRecurringTaskSafe } from '@/server/workflow/schedules'
import {
  handleChargeOutstandingTask,
  NoPaymentMethodOnFile,
  StripeCardError,
} from '@/server/workflow/tasks/chargeOutstanding'
import { ctaEmail } from '@/server/workflow/templates/ctaEmail'
import { joinIgnoreEmpty } from '@/server/workflow/utils'

type PaymentPlanDetailRow = {
  id: string
  trainerUserId: string
  paymentPlanName: string
  clientFirstName: string
  clientLastName: string | null
  clientEmail: string | null
  clientId: string
  trainerId: string
  trainerOnlineBookingsBusinessName: string | null
  trainerBusinessName: string | null
  trainerFirstName: string | null
  trainerLastName: string | null
  brandColor: string
  businessLogoUrl: string | null
}

export const handleChargePaymentPlansTask = async ({ scheduledAt }: WorkflowTaskPayloadMap['chargePaymentPlans']) => {
  const scheduleBase = parseScheduledAt(scheduledAt)
  try {
    const now = new Date()
    const retryThreshold = new Date(now.getTime() - 16 * 60 * 60 * 1000)

    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('payment_plan')
        .set({ status: 'ended' })
        .where('end_', '<=', now)
        .where('status', 'not in', ['cancelled', 'ended'])
        .execute()

      await trx.selectFrom('vw_generate_payment_plan_payments').select('id').execute()
    })

    const paymentPlanIdsResult = await db
      .selectFrom('payment_plan_payment')
      .innerJoin('payment_plan', 'payment_plan_payment.payment_plan_id', 'payment_plan.id')
      .select('payment_plan_payment.payment_plan_id as paymentPlanId')
      .where('payment_plan_payment.date', '<=', now)
      .where('payment_plan_payment.amount_outstanding', '>', '0')
      .where((eb) =>
        eb.or([
          eb.and([
            eb('payment_plan_payment.status', '=', 'pending'),
            eb('payment_plan.status', '=', 'active'),
            eb('payment_plan.end_', '>', now),
          ]),
          eb.and([
            eb('payment_plan_payment.status', '=', 'rejected'),
            eb('payment_plan_payment.retry_count', '<', 10),
            eb.or([
              eb('payment_plan_payment.last_retry_time', 'is', null),
              eb('payment_plan_payment.last_retry_time', '<=', retryThreshold),
            ]),
          ]),
        ])
      )
      .distinct()
      .execute()

    const paymentPlanIds = paymentPlanIdsResult.map((row) => row.paymentPlanId)

    for (const paymentPlanId of paymentPlanIds) {
      try {
        await handleChargeOutstandingTask({ paymentPlanId, forScheduledTask: true })
      } catch (error) {
        await db.transaction().execute(async (trx) => {
          const details = await trx
            .selectFrom('payment_plan_payment')
            .innerJoin('payment_plan', 'payment_plan_payment.payment_plan_id', 'payment_plan.id')
            .innerJoin('trainer', 'payment_plan.trainer_id', 'trainer.id')
            .innerJoin('client', 'client.id', 'payment_plan.client_id')
            .select([
              'payment_plan_payment.id as id',
              'trainer.user_id as trainerUserId',
              'trainer.online_bookings_business_name as trainerOnlineBookingsBusinessName',
              'trainer.business_name as trainerBusinessName',
              'trainer.first_name as trainerFirstName',
              'trainer.last_name as trainerLastName',
              'trainer.brand_color as brandColor',
              'trainer.business_logo_url as businessLogoUrl',
              'payment_plan.name as paymentPlanName',
              'client.first_name as clientFirstName',
              'client.last_name as clientLastName',
              'client.email as clientEmail',
              'client.id as clientId',
              'trainer.id as trainerId',
            ])
            .where('payment_plan.id', '=', paymentPlanId)
            .where('payment_plan_payment.date', '<=', now)
            .where('payment_plan_payment.amount_outstanding', '>', '0')
            .where((eb) =>
              eb.or([
                eb.and([
                  eb('payment_plan_payment.status', '=', 'pending'),
                  eb('payment_plan.status', '=', 'active'),
                  eb('payment_plan.end_', '>', now),
                ]),
                eb.and([
                  eb('payment_plan_payment.status', '=', 'rejected'),
                  eb('payment_plan_payment.retry_count', '<', 10),
                  eb.or([
                    eb('payment_plan_payment.last_retry_time', 'is', null),
                    eb('payment_plan_payment.last_retry_time', '<=', retryThreshold),
                  ]),
                ]),
              ])
            )
            .execute()

          if (details.length === 0) {
            return
          }

          const {
            trainerUserId,
            paymentPlanName,
            clientFirstName,
            clientLastName,
            clientEmail,
            clientId,
            businessLogoUrl,
            brandColor,
            trainerId,
            trainerOnlineBookingsBusinessName,
            trainerBusinessName,
            trainerFirstName,
            trainerLastName,
          } = details[0]

          const serviceProviderName =
            trainerOnlineBookingsBusinessName ??
            trainerBusinessName ??
            joinIgnoreEmpty(trainerFirstName, trainerLastName)

          let notification: string
          if (error instanceof NoPaymentMethodOnFile || error instanceof StripeCardError) {
            if (clientEmail) {
              notification = `A payment for Subscription: ${paymentPlanName} has failed. We've already let your client know and will try again tomorrow.`
            } else {
              notification = `A payment for Subscription: ${paymentPlanName} has failed. We couldn't notify your client because they don't have an email on file, but we will try again tomorrow.`
            }
          } else {
            notification = `A payment for Subscription: ${paymentPlanName} has failed. We will try again tomorrow`
          }

          const paymentPlanPaymentIds = details.map((detail) => detail.id)

          await Promise.all([
            trx
              .updateTable('payment_plan_payment')
              .set((eb) => ({
                status: 'rejected',
                retry_count: eb('retry_count', '+', 1),
                last_retry_time: now,
              }))
              .where('id', 'in', paymentPlanPaymentIds)
              .execute(),
            enqueueWorkflowTask(trx, 'user.notify', {
              notificationType: 'transaction',
              messageType: 'failure',
              title: joinIgnoreEmpty(clientFirstName, clientLastName),
              body: notification,
              userId: trainerUserId,
              paymentPlanId,
            }),
          ])

          if ((error instanceof NoPaymentMethodOnFile || error instanceof StripeCardError) && clientEmail) {
            const link = await createClientDashboardLink(trx, { clientId, clientEmail })
            await trx
              .insertInto('mail')
              .values({
                from_email: NO_REPLY_EMAIL,
                from_name: `${serviceProviderName} via ${APP_NAME}`,
                to_email: clientEmail,
                trainer_id: trainerId,
                client_id: clientId,
                subject: `${serviceProviderName} via ${APP_NAME}: Subscription Payment Failed`,
                html: ctaEmail({
                  receivingReason: `you have a subscription with ${serviceProviderName}`,
                  brandColor,
                  logo: businessLogoUrl
                    ? {
                        url: businessLogoUrl,
                        alt: serviceProviderName,
                      }
                    : undefined,
                  bodyHeading: 'Subscription Payment Failed',
                  button: {
                    link,
                    text: 'Go to Dashboard',
                  },
                  bodyHtml: `<p>Hi, </p>
                      <p>Just a quick email to let you know we tried to deduct a subscription payment
                      out of your account on behalf of ${serviceProviderName}
                      but unfortunately it failed${
                        error instanceof Error && error.message
                          ? ` because:</p> <p style="font-weight:700;">${error.message}</p>`
                          : '.</p>'
                      }
                      <p>We’ll try again in another 24 hours.
                      However if you need to update your card details or wish to resolve this
                      before we next try, click <a href="${link.toString()}">here</a> to access your account.</p>
                      <p>Best Regards</p><p>The ${APP_NAME} Team</p>`,
                }),
              })
              .execute()
          }
        })
      }
    }
  } finally {
    await scheduleNextRecurringTaskSafe(db, 'chargePaymentPlans', scheduleBase)
  }
}
