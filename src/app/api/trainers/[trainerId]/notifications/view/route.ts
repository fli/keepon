import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { authenticateTrainerRequest, buildErrorResponse } from '../../../../_lib/accessToken'

const LEGACY_INVALID_JSON_MESSAGE = 'Unexpected token \'"\', "#" is not valid JSON'

const responseSchema = z.object({
  count: z.number().int().nonnegative(),
})

type HandlerContext = RouteContext<'/api/trainers/[trainerId]/notifications/view'>

export async function PUT(request: NextRequest, context: HandlerContext) {
  void context

  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const rawBody = await request.text()
    if (rawBody.trim().length > 0) {
      try {
        const parsed = JSON.parse(rawBody)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return NextResponse.json(
            buildErrorResponse({
              status: 400,
              title: LEGACY_INVALID_JSON_MESSAGE,
            }),
            { status: 400 }
          )
        }
      } catch {
        return NextResponse.json(
          buildErrorResponse({
            status: 400,
            title: LEGACY_INVALID_JSON_MESSAGE,
          }),
          { status: 400 }
        )
      }
    }
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while marking notifications as viewed',
  })

  if (!authorization.ok) {
    return authorization.response
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
      typeof result?.numUpdatedRows === 'bigint' ? Number(result.numUpdatedRows) : Number(result?.numUpdatedRows ?? 0)

    const responseBody = responseSchema.parse({ count: updatedCount })

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to build notification response',
          detail: 'Notification update result did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to mark trainer notifications as viewed for trainer', authorization.trainerId, error)

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
