import { db } from '@/lib/db'
import { z } from 'zod'
import {
  parseNotificationRows,
  notificationListSchema,
  type RawNotificationRow,
} from '../app/api/trainers/[trainerId]/notifications/_shared'

export type NotificationList = z.infer<typeof notificationListSchema>

const toNumber = (value: unknown) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }

  if (typeof value === 'bigint') {
    return Number(value)
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

export async function listTrainerNotifications(
  trainerId: string,
  userId: string,
  options?: { limit?: number }
): Promise<NotificationList> {
  const limit = options?.limit

  let query = db
    .selectFrom('vw_legacy_app_notification')
    .select((eb) => [
      eb.ref('vw_legacy_app_notification.id').as('id'),
      eb.ref('vw_legacy_app_notification.user_id').as('userId'),
      eb.ref('vw_legacy_app_notification.alert').as('alert'),
      eb.ref('vw_legacy_app_notification.created').as('created'),
      eb.ref('vw_legacy_app_notification.viewed').as('viewed'),
      eb.ref('vw_legacy_app_notification.model_name').as('modelName'),
      eb.ref('vw_legacy_app_notification.model_id').as('modelId'),
      eb.ref('vw_legacy_app_notification.expiration_interval').as('expirationInterval'),
      eb.ref('vw_legacy_app_notification.notification_type').as('notificationType'),
      eb.ref('vw_legacy_app_notification.client_id').as('clientId'),
      eb.ref('vw_legacy_app_notification.message_type').as('messageType'),
      eb.ref('vw_legacy_app_notification.category').as('category'),
    ])
    .where('vw_legacy_app_notification.user_id', '=', userId)
    .orderBy('vw_legacy_app_notification.created', 'desc')

  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
    query = query.limit(limit)
  }

  const rows = (await query.execute()) as RawNotificationRow[]

  return parseNotificationRows(rows)
}

export async function markNotificationAsViewed(
  trainerId: string,
  userId: string,
  notificationId: string
): Promise<void> {
  const result = await db
    .updateTable('app_notification')
    .set({ viewed: true })
    .where('id', '=', notificationId)
    .where('user_id', '=', userId)
    .where('trainer_id', '=', trainerId)
    .executeTakeFirst()

  const updatedCount = toNumber(result?.numUpdatedRows ?? 0)

  if (updatedCount === 0) {
    throw new Error('Notification not found for this trainer')
  }
}

export async function markAllNotificationsAsViewed(trainerId: string, userId: string): Promise<number> {
  const result = await db
    .updateTable('app_notification')
    .set({ viewed: true })
    .where('user_id', '=', userId)
    .where('trainer_id', '=', trainerId)
    .executeTakeFirst()

  return toNumber(result?.numUpdatedRows ?? 0)
}
