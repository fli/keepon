import { NextResponse } from 'next/server'
import { db } from '@keepon/db'
import { ZodError } from 'zod'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../../../../_lib/accessToken'
import { parseNotificationRows, paramsSchema, RawNotificationRow } from '../_shared'

export const runtime = 'nodejs'

type ParamsContext = {
  params?: {
    trainerId?: string
  }
}

export async function GET(request: Request, context: ParamsContext) {
  const paramsResult = paramsSchema.safeParse(context?.params ?? {})

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map(issue => issue.message).join('; ')
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid path parameters',
        detail: detail || 'Trainer id parameter is invalid.',
        type: '/invalid-path-parameters',
      }),
      { status: 400 }
    )
  }

  const { trainerId } = paramsResult.data

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while fetching notifications',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  if (authorization.trainerId !== trainerId) {
    return NextResponse.json(
      buildErrorResponse({
        status: 403,
        title: 'Forbidden',
        detail: 'You are not permitted to access notifications for this trainer.',
        type: '/forbidden',
      }),
      { status: 403 }
    )
  }

  try {
    const rows = await db
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
      .orderBy('vw_legacy_app_notification.created', 'desc')
      .execute() as RawNotificationRow[]

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

    console.error('Failed to fetch all notifications for trainer', trainerId, error)

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
