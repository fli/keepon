import { NextResponse } from 'next/server'
import { db } from '@keepon/db'
import { ZodError } from 'zod'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../../_lib/accessToken'
import {
  parseNotificationRows,
  RawNotificationRow,
} from '../../../../apps/next/app/api/trainers/[trainerId]/notifications/_shared'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while fetching notifications',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const rows = (await db
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
      .where('vw_legacy_app_notification.user_id', '=', authorization.userId)
      .where('vw_legacy_app_notification.viewed', '=', false)
      .orderBy('vw_legacy_app_notification.created', 'desc')
      .execute()) as RawNotificationRow[]

    const notifications = parseNotificationRows(rows)

    return NextResponse.json(notifications)
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse notification data from database',
          detail: 'Notification data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch notifications', error, {
      trainerId: authorization.trainerId,
      userId: authorization.userId,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch notifications',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
