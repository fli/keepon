import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { authenticateTrainerRequest, buildErrorResponse } from '../../../../../_lib/accessToken'

const paramsSchema = z.object({
  trainerId: z.string().min(1, 'Trainer id is required'),
  notificationId: z.string().min(1, 'Notification id is required'),
})

type HandlerContext = RouteContext<'/api/trainers/[trainerId]/notifications/[notificationId]/view'>

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

export async function PUT(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map((issue) => issue.message).join('; ')
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid path parameters',
        detail: detail || 'Trainer id or notification id parameter is invalid.',
        type: '/invalid-path-parameters',
      }),
      { status: 400 }
    )
  }

  const { trainerId, notificationId } = paramsResult.data

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while marking notification as viewed',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  if (authorization.trainerId !== trainerId) {
    return NextResponse.json(
      buildErrorResponse({
        status: 403,
        title: 'Forbidden',
        detail: 'You are not permitted to modify notifications for this trainer.',
        type: '/forbidden',
      }),
      { status: 403 }
    )
  }

  try {
    const result = await db
      .updateTable('app_notification')
      .set({ viewed: true })
      .where('user_id', '=', authorization.userId)
      .where('id', '=', notificationId)
      .executeTakeFirst()

    const updatedCount = toNumber(result?.numUpdatedRows ?? 0)

    if (updatedCount === 0) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Notification not found',
          detail: 'No notification exists with the specified identifier for the authenticated trainer.',
          type: '/notification-not-found',
        }),
        { status: 404 }
      )
    }

    return new Response(null, { status: 204 })
  } catch (error) {
    console.error('Failed to mark notification as viewed for trainer', trainerId, notificationId, error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to update notification',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
