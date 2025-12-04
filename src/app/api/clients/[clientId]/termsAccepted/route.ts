import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import {
  authenticateClientRequest,
  buildErrorResponse,
} from '../../../_lib/accessToken'

const paramsSchema = z.object({
  clientId: z
    .string()
    .trim()
    .min(1, 'Client id is required')
    .uuid({ message: 'Client id must be a valid UUID' }),
})

type HandlerContext = RouteContext<'/api/clients/[clientId]/termsAccepted'>

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
    const detail = paramsResult.error.issues
      .map(issue => issue.message)
      .join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid client identifier',
        detail:
          detail ||
          'Request parameters did not match the expected client identifier schema.',
        type: '/invalid-parameter',
      }),
      { status: 400 }
    )
  }

  const { clientId } = paramsResult.data

  const authorization = await authenticateClientRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while accepting client terms',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  if (authorization.clientId !== clientId) {
    return NextResponse.json(
      buildErrorResponse({
        status: 403,
        title: 'Forbidden',
        detail:
          'You are not permitted to update terms for another client.',
        type: '/forbidden',
      }),
      { status: 403 }
    )
  }

  try {
    const result = await db
      .updateTable('client')
      .set({
        terms_accepted: true,
      })
      .where('id', '=', authorization.clientId)
      .where('trainer_id', '=', authorization.trainerId)
      .executeTakeFirst()

    const updatedCount = toNumber(result?.numUpdatedRows ?? 0)

    if (updatedCount === 0) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Client not found',
          detail:
            'No client exists with the specified identifier for the authenticated access token.',
          type: '/client-not-found',
        }),
        { status: 404 }
      )
    }

    return new Response(null, { status: 204 })
  } catch (error) {
    console.error(
      'Failed to mark client terms as accepted',
      authorization.trainerId,
      authorization.clientId,
      error
    )

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to accept terms',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
