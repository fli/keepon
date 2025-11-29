import { NextRequest, NextResponse } from 'next/server'
import { db, sql } from '@/lib/db'
import { z, ZodError } from 'zod'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../../../_lib/accessToken'
import {
  adaptClientSessionRow,
  RawClientSessionRow,
} from '../../../_lib/clientSessionsSchema'

export const runtime = 'nodejs'

const paramsSchema = z.object({
  clientSessionId: z
    .string()
    .trim()
    .min(1, 'Client session id must not be empty.')
    .uuid({ message: 'Client session id must be a valid UUID.' }),
})

type HandlerContext = RouteContext<'/api/clientSessions/[clientSessionId]/confirm'>

class ClientSessionNotFoundError extends Error {
  constructor() {
    super('Client session not found')
    this.name = 'ClientSessionNotFoundError'
  }
}

const normalizeUpdatedCount = (value: unknown) => {
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

export async function POST(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

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
      'Failed to extend access token expiry while confirming client session',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const rawRow = await db.transaction().execute(async trx => {
      const updateResult = await trx
        .updateTable('client_session')
        .set({
          state: 'confirmed',
          confirm_time: sql<Date>`NOW()`,
        })
        .where('id', '=', clientSessionId)
        .where('trainer_id', '=', authorization.trainerId)
        .executeTakeFirst()

      const updatedCount = normalizeUpdatedCount(updateResult?.numUpdatedRows)
      if (updatedCount === 0) {
        throw new ClientSessionNotFoundError()
      }

      const row = (await trx
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
        throw new ClientSessionNotFoundError()
      }

      return row
    })

    const clientSession = adaptClientSessionRow(rawRow)

    return NextResponse.json(clientSession)
  } catch (error) {
    if (error instanceof ClientSessionNotFoundError) {
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

    console.error('Failed to confirm client session', {
      trainerId: authorization.trainerId,
      clientSessionId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to confirm client session',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
