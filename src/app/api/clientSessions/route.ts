import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { authenticateTrainerRequest, buildErrorResponse } from '../_lib/accessToken'
import { adaptClientSessionRow, clientSessionListSchema, RawClientSessionRow } from '../_lib/clientSessionsSchema'

const querySchema = z.object({
  sessionId: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
})

export async function GET(request: Request) {
  const url = new URL(request.url)
  const sessionIdParam = url.searchParams.get('sessionId')
  const clientIdParam = url.searchParams.get('clientId')

  const normalizedQuery = {
    sessionId: sessionIdParam && sessionIdParam.trim().length > 0 ? sessionIdParam.trim() : undefined,
    clientId: clientIdParam && clientIdParam.trim().length > 0 ? clientIdParam.trim() : undefined,
  }

  const queryResult = querySchema.safeParse(normalizedQuery)

  if (!queryResult.success) {
    const detail = queryResult.error.issues.map((issue) => issue.message).join('; ')
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid query parameters',
        detail: detail || 'Request query parameters did not match the expected schema.',
        type: '/invalid-query',
      }),
      { status: 400 }
    )
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while fetching client sessions',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    let query = db
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

    if (queryResult.data.sessionId) {
      query = query.where('v.sessionId', '=', queryResult.data.sessionId)
    }

    if (queryResult.data.clientId) {
      query = query.where('v.clientId', '=', queryResult.data.clientId)
    }

    const rows = (await query.orderBy('v.createdAt', 'desc').execute()) as RawClientSessionRow[]

    const clientSessions = rows.map((row) => adaptClientSessionRow(row))

    const parsedClientSessions = clientSessionListSchema.parse(clientSessions)

    return NextResponse.json(parsedClientSessions)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse client session data from database',
          detail: 'Client session data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch client sessions', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch client sessions',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
