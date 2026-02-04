import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { db } from '@/lib/db'
import type { RawNotificationRow } from '../_shared'
import { authenticateTrainerRequest, buildErrorResponse } from '../../../../_lib/accessToken'
import { parseNotificationRows } from '../_shared'

type HandlerContext = RouteContext<'/api/trainers/[trainerId]/notifications/new'>

export async function GET(request: NextRequest, context: HandlerContext) {
  void context

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while fetching notifications',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const rows = (await db
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

    console.error('Failed to fetch notifications for trainer', error)

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
