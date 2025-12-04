import { NextRequest, NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { authenticateTrainerRequest, buildErrorResponse } from '../../../../_lib/accessToken'
import { paramsSchema } from '../_shared'
import { listTrainerNotifications } from '@/server/notifications'

type HandlerContext = RouteContext<'/api/trainers/[trainerId]/notifications/all'>

export async function GET(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map((issue) => issue.message).join('; ')
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
    extensionFailureLogMessage: 'Failed to extend access token expiry while fetching notifications',
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
    const notifications = await listTrainerNotifications(authorization.trainerId, authorization.userId)

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
