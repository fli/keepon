import { db } from '@/lib/db'
import { z } from 'zod'
import {
  parseNotificationRows,
  notificationListSchema,
  type RawNotificationRow,
} from '../app/api/trainers/[trainerId]/notifications/_shared'

export type NotificationList = z.infer<typeof notificationListSchema>

export async function listTrainerNotifications(
  trainerId: string,
  userId: string,
  options?: { limit?: number }
): Promise<NotificationList> {
  const limit = options?.limit

  let query = db
    .selectFrom('vw_legacy_app_notification')
    .select(({ ref }) => [
      ref('vw_legacy_app_notification.id').as('id'),
      ref('vw_legacy_app_notification.user_id').as('userId'),
      ref('vw_legacy_app_notification.alert').as('alert'),
      ref('vw_legacy_app_notification.created').as('created'),
      ref('vw_legacy_app_notification.viewed').as('viewed'),
      ref('vw_legacy_app_notification.model_name').as('modelName'),
      ref('vw_legacy_app_notification.model_id').as('modelId'),
      ref('vw_legacy_app_notification.expiration_interval').as(
        'expirationInterval'
      ),
      ref('vw_legacy_app_notification.notification_type').as(
        'notificationType'
      ),
      ref('vw_legacy_app_notification.client_id').as('clientId'),
      ref('vw_legacy_app_notification.message_type').as('messageType'),
      ref('vw_legacy_app_notification.category').as('category'),
    ])
    .where('vw_legacy_app_notification.user_id', '=', userId)
    .orderBy('vw_legacy_app_notification.created', 'desc')

  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
    query = query.limit(limit)
  }

  const rows = (await query.execute()) as RawNotificationRow[]

  return parseNotificationRows(rows)
}
