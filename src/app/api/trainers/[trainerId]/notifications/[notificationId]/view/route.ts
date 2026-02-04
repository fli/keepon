import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { authenticateTrainerRequest, buildErrorResponse } from '../../../../../_lib/accessToken'

const LEGACY_INVALID_JSON_MESSAGE = 'Unexpected token \'"\', "#" is not valid JSON'

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
  const params = await context.params
  const notificationId = params.notificationId

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while marking notification as viewed',
  })

  if (!authorization.ok) {
    return authorization.response
  }
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
          type: '/resource-not-found',
        }),
        { status: 404 }
      )
    }

    return new Response(null, { status: 204 })
  } catch (error) {
    console.error('Failed to mark notification as viewed for trainer', notificationId, error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Something on our end went wrong.',
      }),
      { status: 500 }
    )
  }
}
