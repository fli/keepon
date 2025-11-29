import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z, ZodError } from 'zod'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../../_lib/accessToken'
import {
  adaptClientSessionRow,
  RawClientSessionRow,
} from '../../_lib/clientSessionsSchema'

export const runtime = 'nodejs'

const paramsSchema = z.object({
  clientSessionId: z
    .string()
    .trim()
    .min(1, 'Client session id is required'),
})

type RouteContext = {
  params?: {
    clientSessionId?: string
  }
}

export async function GET(request: Request, context: RouteContext) {
  const paramsResult = paramsSchema.safeParse(context?.params ?? {})

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map(issue => issue.message).join('; ')
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid path parameters',
        detail:
          detail ||
          'Client session id parameter did not match the expected schema.',
        type: '/invalid-path-parameters',
      }),
      { status: 400 }
    )
  }

  const { clientSessionId } = paramsResult.data

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while fetching client session',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const row = (await db
      .selectFrom('vw_legacy_client_session as v')
      .innerJoin('client_session as cs', 'cs.id', 'v.id')
      .select(({ ref }) => [
        ref('v.id').as('id'),
        ref('v.clientId').as('clientId'),
        ref('v.sessionId').as('sessionId'),
        ref('v.createdAt').as('createdAt'),
        ref('v.state').as('state'),
        ref('v.bookingQuestion').as('bookingQuestion'),
        ref('v.bookingQuestionResponse').as('bookingQuestionResponse'),
        ref('v.price').as('price'),
        ref('v.attended').as('attended'),
        ref('v.payment').as('payment'),
        ref('v.notes').as('notes'),
        ref('v.saleId').as('saleId'),
        ref('v.cancelTime').as('cancelTime'),
        ref('v.cancelReason').as('cancelReason'),
        ref('v.acceptTime').as('acceptTime'),
        ref('v.declineTime').as('declineTime'),
        ref('v.inviteTime').as('inviteTime'),
        ref('v.confirmTime').as('confirmTime'),
      ])
      .where('cs.trainer_id', '=', authorization.trainerId)
      .where('v.id', '=', clientSessionId)
      .executeTakeFirst()) as RawClientSessionRow | undefined

    if (!row) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Client session not found',
          detail:
            'We could not find a client session with the specified identifier for the authenticated trainer.',
          type: '/client-session-not-found',
        }),
        { status: 404 }
      )
    }

    const clientSession = adaptClientSessionRow(row)

    return NextResponse.json(clientSession)
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse client session data from database',
          detail:
            'Client session data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error(
      'Failed to fetch client session',
      authorization.trainerId,
      clientSessionId,
      error
    )

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch client session',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
