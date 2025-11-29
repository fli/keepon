import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../../_lib/accessToken'

export const runtime = 'nodejs'

const paramsSchema = z.object({
  invitationId: z
    .string()
    .trim()
    .min(1, 'Session invitation id is required')
    .uuid({ message: 'Session invitation id must be a valid UUID' }),
})

type RouteContext = {
  params?: {
    invitationId?: string
  }
}

const normalizeDeletedCount = (value: unknown) => {
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

export async function DELETE(request: Request, context: RouteContext) {
  const paramsResult = paramsSchema.safeParse(context?.params ?? {})

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues
      .map(issue => issue.message)
      .join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid session invitation identifier',
        detail:
          detail ||
          'Request parameters did not match the expected session invitation identifier schema.',
        type: '/invalid-parameter',
      }),
      { status: 400 }
    )
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while deleting session invitation',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { invitationId } = paramsResult.data

  try {
    const deleteResult = await db
      .deleteFrom('client_session')
      .where('client_session.trainer_id', '=', authorization.trainerId)
      .where('client_session.id', '=', invitationId)
      .where('client_session.state', '=', 'invited')
      .executeTakeFirst()

    const deletedCount = normalizeDeletedCount(
      deleteResult?.numDeletedRows ?? 0
    )

    if (deletedCount === 0) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Session invitation not found',
          detail:
            'We could not find an invitation with the specified identifier for the authenticated trainer.',
          type: '/session-invitation-not-found',
        }),
        { status: 404 }
      )
    }

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    console.error('Failed to delete session invitation', error, {
      trainerId: authorization.trainerId,
      invitationId,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to delete session invitation',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
