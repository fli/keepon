import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../../../../_lib/accessToken'

export const runtime = 'nodejs'

const paramsSchema = z.object({
  trainerId: z.string().min(1, 'Trainer id is required'),
})

const responseSchema = z.object({
  count: z.number().int().nonnegative(),
})

type ParamsContext = {
  params?: {
    trainerId?: string
  }
}

export async function PUT(request: Request, context: ParamsContext) {
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
      'Failed to extend access token expiry while marking notifications as viewed',
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
      .set({
        viewed: true,
      })
      .where('user_id', '=', authorization.userId)
      .executeTakeFirst()

    const updatedCount =
      typeof result?.numUpdatedRows === 'bigint'
        ? Number(result.numUpdatedRows)
        : Number(result?.numUpdatedRows ?? 0)

    const responseBody = responseSchema.parse({ count: updatedCount })

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to build notification response',
          detail:
            'Notification update result did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error(
      'Failed to mark trainer notifications as viewed for trainer',
      trainerId,
      error
    )

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to update notifications',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
