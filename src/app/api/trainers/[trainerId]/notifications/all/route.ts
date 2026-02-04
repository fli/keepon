import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { listTrainerNotifications } from '@/server/notifications'
import { authenticateTrainerRequest, buildErrorResponse } from '../../../../_lib/accessToken'

type HandlerContext = RouteContext<'/api/trainers/[trainerId]/notifications/all'>

export async function GET(request: NextRequest, context: HandlerContext) {
  void context

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while fetching notifications',
  })

  if (!authorization.ok) {
    return authorization.response
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

    console.error('Failed to fetch all notifications for trainer', authorization.trainerId, error)

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
