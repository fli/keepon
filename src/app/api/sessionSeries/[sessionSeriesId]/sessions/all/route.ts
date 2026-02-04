import { NextRequest, NextResponse } from 'next/server'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import { authenticateTrainerRequest, buildErrorResponse } from '../../../../_lib/accessToken'

const paramsSchema = z.object({
  sessionSeriesId: z.string().trim().min(1, 'Session series id is required'),
})

const querySchema = z.object({
  sessionId: z.string().trim().min(1, 'Session id is required'),
})

const deleteResponseSchema = z.object({
  succeeded: z.literal(true),
  deletedClientSessions: z.array(z.string().uuid()),
  deletedPayments: z.array(z.string().uuid()),
  deletedSessions: z.array(z.string().uuid()),
  deletedSessionSeries: z.array(z.string().uuid()),
})

type HandlerContext = RouteContext<'/api/sessionSeries/[sessionSeriesId]/sessions/all'>

type RawDetailRow = {
  session_id: string
  client_session_id: string | null
  paid_for: boolean
  deletable_sale_id: string | null
}

type NormalizedDetailRow = {
  sessionId: string
  clientSessionId: string | null
  paidFor: boolean
  deletableSaleId: string | null
}

class SessionSeriesNotFoundError extends Error {
  constructor() {
    super('Session series not found')
    this.name = 'SessionSeriesNotFoundError'
  }
}

class PaidAppointmentDeletionError extends Error {
  constructor() {
    super('Cannot delete paid appointment')
    this.name = 'PaidAppointmentDeletionError'
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

const normalizeDetails = (rows: RawDetailRow[]): NormalizedDetailRow[] =>
  rows.map((row) => ({
    sessionId: row.session_id,
    clientSessionId: row.client_session_id,
    paidFor: row.paid_for,
    deletableSaleId: row.deletable_sale_id,
  }))

export async function DELETE(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map((issue) => issue.message).join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid session series identifier',
        detail: detail || 'Request parameters did not match the expected session series identifier schema.',
        type: '/invalid-parameter',
      }),
      { status: 400 }
    )
  }

  const url = new URL(request.url)
  const queryResult = querySchema.safeParse({
    sessionId: url.searchParams.get('sessionId'),
  })

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
    extensionFailureLogMessage: 'Failed to extend access token expiry while deleting session series sessions',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { sessionSeriesId } = paramsResult.data
  const { sessionId } = queryResult.data

  try {
    const transactionResult = await db.transaction().execute(async (trx) => {
      const detailsResult = await sql<RawDetailRow>`
        SELECT
          session.id AS session_id,
          client_session.id AS client_session_id,
          COALESCE(sale_payment_status.payment_status = 'paid', FALSE) AS paid_for,
          deletable_payments.sale_id AS deletable_sale_id
        FROM session
        JOIN session_series ON session_series.id = session.session_series_id
        LEFT JOIN client_session ON client_session.session_id = session.id
        LEFT JOIN sale_payment_status
          ON sale_payment_status.sale_id = client_session.sale_id
        LEFT JOIN (
          SELECT sale_id
            FROM payment
           WHERE payment.is_credit_pack OR payment.is_subscription
        ) AS deletable_payments
          ON deletable_payments.sale_id = client_session.sale_id
       WHERE session_series.id = ${sessionSeriesId}
         AND session_series.trainer_id = ${authorization.trainerId}
         AND session.start >= (
           SELECT start FROM session WHERE id = ${sessionId}
         )
      `.execute(trx)

      const details = normalizeDetails(detailsResult.rows)

      if (details.length === 0) {
        throw new SessionSeriesNotFoundError()
      }

      const hasBlockingPayment = details.some((detail) => detail.paidFor && !detail.deletableSaleId)

      if (hasBlockingPayment) {
        throw new PaidAppointmentDeletionError()
      }

      const deletableSaleIds = Array.from(
        new Set(details.map((detail) => detail.deletableSaleId).filter((value): value is string => Boolean(value)))
      )

      if (deletableSaleIds.length > 0) {
        const deleteSalesResult = await trx
          .deleteFrom('sale')
          .where('sale.id', 'in', deletableSaleIds)
          .where('sale.trainer_id', '=', authorization.trainerId)
          .executeTakeFirst()

        const deletedSalesCount = normalizeDeletedCount(deleteSalesResult?.numDeletedRows)

        if (deletedSalesCount !== deletableSaleIds.length) {
          throw new Error(`Deleted ${deletedSalesCount} of ${deletableSaleIds.length} sale records`)
        }
      }

      const sessionIds = Array.from(new Set(details.map((detail) => detail.sessionId)))

      if (sessionIds.length === 0) {
        throw new SessionSeriesNotFoundError()
      }

      const deletedSessions = await trx
        .deleteFrom('session')
        .where('session.id', 'in', sessionIds)
        .where('session.trainer_id', '=', authorization.trainerId)
        .returning((eb) => [eb.ref('session.id').as('id')])
        .execute()

      if (deletedSessions.length !== sessionIds.length) {
        throw new Error(`Deleted ${deletedSessions.length} of ${sessionIds.length} sessions`)
      }

      const deletedSessionSeriesResult = await sql<{ id: string }>`
        DELETE FROM session_series
         WHERE id = ${sessionSeriesId}
           AND trainer_id = ${authorization.trainerId}
           AND NOT EXISTS (
             SELECT 1
               FROM session
              WHERE session.session_series_id = ${sessionSeriesId}
           )
         RETURNING id
      `.execute(trx)

      const deletedClientSessions = details
        .map((detail) => detail.clientSessionId)
        .filter((value): value is string => Boolean(value))

      return {
        succeeded: true as const,
        deletedClientSessions,
        deletedPayments: deletedClientSessions,
        deletedSessions: deletedSessions.map((row) => row.id),
        deletedSessionSeries: deletedSessionSeriesResult.rows.map((row) => row.id),
      }
    })

    const responseBody = deleteResponseSchema.parse(transactionResult)

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof SessionSeriesNotFoundError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Appointment series not found.',
          type: '/resource-not-found',
        }),
        { status: 404 }
      )
    }

    if (error instanceof PaidAppointmentDeletionError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'One or more clients has paid for the appointment. Please refund first before deleting.',
          type: '/cant-delete-paid-appointment',
        }),
        { status: 409 }
      )
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to validate session deletion response',
          detail: 'The response did not match the expected schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to delete session series sessions', {
      trainerId: authorization.trainerId,
      sessionSeriesId,
      sessionId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to delete session series sessions',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
