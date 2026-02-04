import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { authenticateTrainerRequest, buildErrorResponse } from '../../../../_lib/accessToken'

const paramsSchema = z.object({
  sessionId: z.string({ message: 'Session id is required.' }).trim().min(1, 'Session id must not be empty.'),
  clientId: z.string({ message: 'Client id is required.' }).trim().min(1, 'Client id must not be empty.'),
})

const querySchema = z.object({
  future: z
    .union([z.boolean(), z.literal('true'), z.literal('false')])
    .optional()
    .transform((value) => (value === undefined ? false : value === true || value === 'true')),
})

const deleteResponseSchema = z.object({
  deletedPayments: z.array(z.string().uuid()),
  deletedClientSessions: z.array(z.string().uuid()),
})

type HandlerContext = RouteContext<'/api/sessions/[sessionId]/clients/[clientId]'>

type RawDetailRow = {
  client_session_id: string
  paid_for: boolean
  deletable_sale_id: string | null
}

type SessionSeriesRow = {
  session_series_id: string
  session_start: Date
}

class ClientSessionNotFoundError extends Error {
  constructor() {
    super('Client appointment not found')
    this.name = 'ClientSessionNotFoundError'
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

export async function DELETE(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map((issue) => issue.message).join('; ')

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

  const url = new URL(request.url)
  const queryResult = querySchema.safeParse({
    future: url.searchParams.get('future') ?? undefined,
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
    extensionFailureLogMessage: 'Failed to extend access token expiry while deleting client from session',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { sessionId, clientId } = paramsResult.data
  const { future } = queryResult.data

  try {
    const transactionResult = await db.transaction().execute(async (trx) => {
      const sessionSeriesRow = await trx
        .selectFrom('session_series')
        .innerJoin('session', 'session.session_series_id', 'session_series.id')
        .innerJoin('client_session', 'client_session.session_id', 'session.id')
        .select((eb) => [
          eb.ref('session_series.id').as('session_series_id'),
          eb.ref('session.start').as('session_start'),
        ])
        .where('session_series.trainer_id', '=', authorization.trainerId)
        .where('client_session.client_id', '=', clientId)
        .where('client_session.session_id', '=', sessionId)
        .executeTakeFirst()

      if (!sessionSeriesRow) {
        throw new ClientSessionNotFoundError()
      }

      const deletablePayments = trx
        .selectFrom('payment')
        .select('sale_id')
        .where((eb) => eb.or([eb('payment.is_credit_pack', '=', true), eb('payment.is_subscription', '=', true)]))
        .as('deletable_payments')

      let detailsQuery = trx
        .selectFrom('client_session')
        .innerJoin('session', 'client_session.session_id', 'session.id')
        .leftJoin('sale_payment_status', 'sale_payment_status.sale_id', 'client_session.sale_id')
        .leftJoin(deletablePayments, 'deletable_payments.sale_id', 'client_session.sale_id')
        .select((eb) => [
          eb.ref('client_session.id').as('client_session_id'),
          eb.ref('sale_payment_status.payment_status').as('payment_status'),
          eb.ref('deletable_payments.sale_id').as('deletable_sale_id'),
        ])
        .where('session.session_series_id', '=', sessionSeriesRow.session_series_id)
        .where('session.start', '>=', sessionSeriesRow.session_start)
        .where('client_session.client_id', '=', clientId)

      if (!future) {
        detailsQuery = detailsQuery.where('session.id', '=', sessionId)
      }

      const detailRows = await detailsQuery.execute()

      const details: RawDetailRow[] = detailRows.map((row) => ({
        client_session_id: row.client_session_id,
        paid_for: row.payment_status === 'paid',
        deletable_sale_id: row.deletable_sale_id ?? null,
      }))

      if (details.length === 0) {
        throw new ClientSessionNotFoundError()
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

      const clientSessionIds = details.map((detail) => detail.client_session_id)

      const deletedClientSessions = await trx
        .deleteFrom('client_session')
        .where('client_session.id', 'in', clientSessionIds)
        .where('client_session.trainer_id', '=', authorization.trainerId)
        .returning((eb) => [eb.ref('client_session.id').as('id')])
        .execute()

      if (deletedClientSessions.length !== clientSessionIds.length) {
        throw new Error(`Deleted ${deletedClientSessions.length} of ${clientSessionIds.length} client sessions`)
      }

      const deletedIds = deletedClientSessions.map((row) => row.id)

      return {
        deletedPayments: deletedIds,
        deletedClientSessions: deletedIds,
      }
    })

    const responseBody = deleteResponseSchema.parse(transactionResult)

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof ClientSessionNotFoundError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Client session not found',
          type: '/resource-not-found',
        }),
        { status: 404 }
      )
    }

    if (error instanceof PaidAppointmentDeletionError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'Client has already paid for the appointment. Please refund before deleting.',
          type: '/cant-delete-paid-appointment',
        }),
        { status: 409 }
      )
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to validate session client deletion response',
          detail: 'Session client deletion response did not match the expected schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to delete client from session', {
      trainerId: authorization.trainerId,
      sessionId,
      clientId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to delete client from session',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
