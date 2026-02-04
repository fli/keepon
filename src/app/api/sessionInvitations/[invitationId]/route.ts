import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { authenticateTrainerRequest, buildErrorResponse } from '../../_lib/accessToken'

type HandlerContext = RouteContext<'/api/sessionInvitations/[invitationId]'>

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

export async function DELETE(request: NextRequest, context: HandlerContext) {
  const { invitationId } = await context.params

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while deleting session invitation',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const deleteResult = await db
      .deleteFrom('client_session')
      .where('client_session.trainer_id', '=', authorization.trainerId)
      .where('client_session.id', '=', invitationId)
      .where('client_session.state', '=', 'invited')
      .executeTakeFirst()

    const deletedCount = normalizeDeletedCount(deleteResult?.numDeletedRows ?? 0)

    if (deletedCount === 0) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Invitation not found',
          type: '/resource-not-found',
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
