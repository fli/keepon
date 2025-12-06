import { NextRequest, NextResponse } from 'next/server'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import { authenticateTrainerRequest, buildErrorResponse } from '../../_lib/accessToken'
import { adaptSessionRow, RawSessionRow } from '../shared'

const paramsSchema = z.object({
  sessionId: z.string().trim().min(1, 'sessionId must not be empty'),
})

const deleteResponseSchema = z.object({
  count: z.number().int().nonnegative(),
})

type HandlerContext = RouteContext<'/api/sessions/[sessionId]'>

class SessionNotFoundError extends Error {
  constructor() {
    super('Appointment not found')
    this.name = 'SessionNotFoundError'
  }
}

class PaidAppointmentDeletionError extends Error {
  constructor() {
    super('Cannot delete paid appointment')
    this.name = 'PaidAppointmentDeletionError'
  }
}

type RawDeleteDetailRow = {
  paid_for: boolean
  deletable_sale_id: string | null
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

export async function GET(request: NextRequest, context: HandlerContext) {
  const parsedParams = paramsSchema.safeParse(await context.params)

  if (!parsedParams.success) {
    const detail = parsedParams.error.issues.map((issue) => issue.message).join('; ')
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid path parameters',
        detail: detail || 'Request path parameters did not match the expected schema.',
        type: '/invalid-path-parameters',
      }),
      { status: 400 }
    )
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while fetching session',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { sessionId } = parsedParams.data

  try {
    const row = (await db
      .selectFrom('vw_legacy_session_2 as v')
      .innerJoin('session as s', 's.id', 'v.id')
      .selectAll('v')
      .where('v.id', '=', sessionId)
      .where('s.trainer_id', '=', authorization.trainerId)
      .executeTakeFirst()) as RawSessionRow | undefined

    if (!row) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Appointment not found',
          detail: 'No appointment exists with the provided identifier.',
          type: '/not-found',
        }),
        { status: 404 }
      )
    }

    const session = adaptSessionRow(row)

    return NextResponse.json(session)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse session data from database',
          detail: 'Session data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch session', sessionId, error)

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch session',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest, context: HandlerContext) {
  const parsedParams = paramsSchema.safeParse(await context.params)

  if (!parsedParams.success) {
    const detail = parsedParams.error.issues.map((issue) => issue.message).join('; ')
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid path parameters',
        detail: detail || 'Request path parameters did not match the expected schema.',
        type: '/invalid-path-parameters',
      }),
      { status: 400 }
    )
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while deleting session',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { sessionId } = parsedParams.data

  try {
    const transactionResult = await db.transaction().execute(async (trx) => {
      const detailsResult = await sql<RawDeleteDetailRow>`
        SELECT
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
       WHERE session_series.trainer_id = ${authorization.trainerId}
         AND session.id = ${sessionId}
      `.execute(trx)

      const details = detailsResult.rows

      if (details.length === 0) {
        throw new SessionNotFoundError()
      }

      const hasBlockingPayment = details.some((detail) => detail.paid_for && !detail.deletable_sale_id)

      if (hasBlockingPayment) {
        throw new PaidAppointmentDeletionError()
      }

      const deletableSaleIds = Array.from(
        new Set(details.map((detail) => detail.deletable_sale_id).filter((value): value is string => Boolean(value)))
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

      const deletedSession = await trx
        .deleteFrom('session')
        .where('session.id', '=', sessionId)
        .where('session.trainer_id', '=', authorization.trainerId)
        .returning((eb) => [eb.ref('session.id').as('id')])
        .executeTakeFirst()

      if (!deletedSession) {
        throw new SessionNotFoundError()
      }

      return { count: 1 }
    })

    const responseBody = deleteResponseSchema.parse(transactionResult)

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof SessionNotFoundError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Appointment not found',
          detail: 'No appointment exists with the provided identifier.',
          type: '/not-found',
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
          detail: 'Session deletion response did not match the expected schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to delete session', {
      trainerId: authorization.trainerId,
      sessionId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to delete session',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
