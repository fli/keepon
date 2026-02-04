import type { WorkflowTaskPayloadMap } from '@/server/workflow/types'
import { db } from '@/lib/db'
import { sendApnNotification, canSendApn, type ApnPayload } from '@/server/workflow/apn'
import { enqueueWorkflowTask } from '@/server/workflow/outbox'

const isUnregisteredReason = (reason?: string) =>
  Boolean(reason && (reason === 'Unregistered' || reason === 'DeviceTokenNotForTopic' || reason === 'BadDeviceToken'))

const isServerFailure = (failure: { error?: Error; status?: number }) => {
  if (failure.error && failure.error.message === 'stream ended unexpectedly') {
    return true
  }

  return typeof failure.status === 'number' && failure.status >= 500
}

export const handleUserNotifyTask = async (payload: WorkflowTaskPayloadMap['user.notify']) => {
  await db.transaction().execute(async (trx) => {
    const {
      deviceTokens,
      userId,
      clientId,
      paymentPlanId,
      paymentId,
      paymentPlanPaymentId,
      sessionPackId,
      body,
      messageType,
      notificationType,
      title,
      skipAppNotification,
    } = payload

    const devicesToNotify = deviceTokens?.length
      ? deviceTokens
      : (
          await trx
            .selectFrom('installation')
            .select((eb) => [eb.ref('installation.device_token').as('deviceToken')])
            .where('installation.user_id', '=', userId)
            .execute()
        ).map((row) => row.deviceToken)

    let appNotificationId: string | null = null
    if (!skipAppNotification) {
      const trainerRow = await trx
        .selectFrom('trainer')
        .select((eb) => [eb.ref('trainer.id').as('trainerId')])
        .where('trainer.user_id', '=', userId)
        .executeTakeFirst()

      if (trainerRow?.trainerId) {
        const notificationRow = await trx
          .insertInto('app_notification')
          .values({
            trainer_id: trainerRow.trainerId,
            user_id: userId,
            user_type: 'trainer',
            client_id: clientId ?? null,
            payment_plan_id: paymentPlanId ?? null,
            payment_id: paymentId ?? null,
            payment_plan_payment_id: paymentPlanPaymentId ?? null,
            session_pack_id: sessionPackId ?? null,
            body,
            message_type: messageType,
            notification_type: notificationType,
          })
          .returning('id')
          .executeTakeFirst()

        appNotificationId = notificationRow?.id ?? null
      }
    }

    if (!devicesToNotify.length || !canSendApn()) {
      return
    }

    const payloadForApn: ApnPayload = {
      aps: {
        alert: {
          title,
          body,
        },
        category: notificationType,
        userId,
        clientId,
        modelId: paymentId ?? paymentPlanId ?? paymentPlanPaymentId ?? sessionPackId ?? undefined,
        modelName: paymentId
          ? 'payment'
          : paymentPlanId
            ? 'paymentPlan'
            : paymentPlanPaymentId
              ? 'paymentPlanPayment'
              : sessionPackId
                ? 'sessionPackId'
                : undefined,
        messageType,
        notificationType,
        appNotificationId,
      },
    }

    const response = await sendApnNotification(payloadForApn, devicesToNotify)
    if (!response) {
      return
    }

    try {
      const unregistered = response.failed
        .filter((failure) => isUnregisteredReason(failure.response?.reason))
        .map((failure) => failure.device)

      if (unregistered.length > 0) {
        await trx
          .deleteFrom('installation')
          .where('user_id', '=', userId)
          .where('device_token', 'in', unregistered)
          .execute()
      }

      const serverFailed = response.failed.filter((failure) =>
        isServerFailure({
          error: failure.error instanceof Error ? failure.error : undefined,
          status: failure.status,
        })
      )

      if (serverFailed.length > 0) {
        await enqueueWorkflowTask(
          trx,
          'user.notify',
          {
            ...payload,
            deviceTokens: serverFailed.map((failure) => failure.device),
          },
          {
            availableAt: new Date(Date.now() + 60_000),
          }
        )
      }
    } catch (error) {
      console.error('Failed to handle APN response', error)
    }
  })
}
