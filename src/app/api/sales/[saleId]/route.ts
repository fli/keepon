import { NextRequest, NextResponse } from 'next/server'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import {
  authenticateTrainerOrClientRequest,
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../../_lib/accessToken'
import { adaptSaleRow, fetchSales, saleSchema } from '../shared'

const paramsSchema = z.object({
  saleId: z.string().uuid({ message: 'saleId must be a valid UUID' }),
})

type HandlerContext = RouteContext<'/api/sales/[saleId]'>

const patchRequestBodySchema = z
  .object({
    dueAt: z.string().datetime({ offset: true }).optional(),
    note: z.union([z.string(), z.null()]).optional(),
    paymentRequestPassOnTransactionFee: z.boolean().optional(),
  })
  .strict()

class SaleNotFoundError extends Error {
  constructor() {
    super('Sale not found')
    this.name = 'SaleNotFoundError'
  }
}

class SalePaidByCardDeletionNotAllowedError extends Error {
  constructor() {
    super("Can't delete a sale that has been paid for by card. Refund first to delete.")
    this.name = 'SalePaidByCardDeletionNotAllowedError'
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

export async function GET(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map((issue) => issue.message).join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid sale identifier',
        detail: detail || undefined,
        type: '/invalid-parameter',
      }),
      { status: 400 }
    )
  }

  const auth = await authenticateTrainerOrClientRequest(request, {
    trainerExtensionFailureLogMessage: 'Failed to extend access token expiry while fetching sale for trainer request',
    clientExtensionFailureLogMessage: 'Failed to extend access token expiry while fetching sale for client request',
  })

  if (!auth.ok) {
    return auth.response
  }

  const { saleId } = paramsResult.data

  try {
    const rows = await fetchSales({
      trainerId: auth.trainerId,
      clientId: auth.actor === 'client' ? auth.clientId : undefined,
      saleId,
    })

    const saleRow = rows[0]

    if (!saleRow) {
      throw new SaleNotFoundError()
    }

    const sale = saleSchema.parse(adaptSaleRow(saleRow))

    return NextResponse.json(sale)
  } catch (error) {
    if (error instanceof SaleNotFoundError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Sale not found',
          detail: 'No sale exists for this trainer with that id.',
          type: '/sale-not-found',
        }),
        { status: 404 }
      )
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse sale data from database',
          detail: 'Sale data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch sale', { saleId, actor: auth.actor, error })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch sale',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map((issue) => issue.message).join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid sale identifier',
        detail: detail || undefined,
        type: '/invalid-parameter',
      }),
      { status: 400 }
    )
  }

  const auth = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while deleting sale',
  })

  if (!auth.ok) {
    return auth.response
  }

  const { saleId } = paramsResult.data

  try {
    await db.transaction().execute(async (trx) => {
      const saleDetails = (await trx
        .selectFrom('sale as sale')
        .innerJoin('sale_payment_status as salePaymentStatus', 'salePaymentStatus.sale_id', 'sale.id')
        .leftJoin('payment as payment', 'payment.sale_id', 'sale.id')
        .select((eb) => [
          eb.ref('sale.id').as('id'),
          sql<boolean>`COALESCE(${sql.ref('salePaymentStatus.payment_status')} = 'paid', FALSE)`.as('paidFor'),
          sql<boolean>`COALESCE(BOOL_OR(${sql.ref('payment.is_stripe')}), FALSE)`.as('paidByStripe'),
        ])
        .where('sale.id', '=', saleId)
        .where('sale.trainer_id', '=', auth.trainerId)
        .groupBy(['sale.id', 'salePaymentStatus.payment_status'])
        .executeTakeFirst()) as { id: string; paidFor: boolean; paidByStripe: boolean } | undefined

      if (!saleDetails) {
        throw new SaleNotFoundError()
      }

      if (saleDetails.paidFor && saleDetails.paidByStripe) {
        throw new SalePaidByCardDeletionNotAllowedError()
      }

      const deleteResult = await trx
        .deleteFrom('sale')
        .where('sale.id', '=', saleId)
        .where('sale.trainer_id', '=', auth.trainerId)
        .executeTakeFirst()

      const deletedCount = normalizeDeletedCount(deleteResult?.numDeletedRows ?? 0)

      if (deletedCount === 0) {
        throw new SaleNotFoundError()
      }
    })

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    if (error instanceof SaleNotFoundError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Sale not found',
          detail: 'No sale exists for this trainer with that id.',
          type: '/sale-not-found',
        }),
        { status: 404 }
      )
    }

    if (error instanceof SalePaidByCardDeletionNotAllowedError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: "Can't delete a sale that has been paid for by card. Refund first to delete.",
          type: '/cant-delete-sale-paid-by-card',
        }),
        { status: 409 }
      )
    }

    console.error('Failed to delete sale', { trainerId: auth.trainerId, saleId, error })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to delete sale',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map((issue) => issue.message).join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid sale identifier',
        detail: detail || undefined,
        type: '/invalid-parameter',
      }),
      { status: 400 }
    )
  }

  let parsedBody: z.infer<typeof patchRequestBodySchema>

  try {
    const rawBody = (await request.json()) as unknown
    const bodyResult = patchRequestBodySchema.safeParse(rawBody)

    if (!bodyResult.success) {
      const detail = bodyResult.error.issues.map((issue) => issue.message).join('; ')

      return NextResponse.json(
        buildErrorResponse({
          status: 400,
          title: 'Invalid request body',
          detail: detail || 'Request body did not match the expected schema.',
          type: '/invalid-body',
        }),
        { status: 400 }
      )
    }

    parsedBody = bodyResult.data
  } catch (error) {
    console.error('Failed to parse sale update request body', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid JSON payload',
        detail: 'Request body must be valid JSON.',
        type: '/invalid-json',
      }),
      { status: 400 }
    )
  }

  const auth = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while updating sale',
  })

  if (!auth.ok) {
    return auth.response
  }

  const { saleId } = paramsResult.data

  const hasDueAt = Object.prototype.hasOwnProperty.call(parsedBody, 'dueAt')
  const hasNote = Object.prototype.hasOwnProperty.call(parsedBody, 'note')
  const hasPassOnFee = Object.prototype.hasOwnProperty.call(parsedBody, 'paymentRequestPassOnTransactionFee')

  const updatePayload: Record<string, unknown> = {}

  if (hasDueAt) {
    updatePayload.due_time = parsedBody.dueAt ? new Date(parsedBody.dueAt) : null
  }

  if (hasNote) {
    updatePayload.note = parsedBody.note ? parsedBody.note.trim() : ''
  }

  if (hasPassOnFee) {
    updatePayload.payment_request_pass_on_transaction_fee = parsedBody.paymentRequestPassOnTransactionFee
  }

  const hasUpdates = hasDueAt || hasNote || hasPassOnFee

  try {
    if (hasUpdates) {
      const updatedRow = await db
        .updateTable('sale')
        .set({
          ...updatePayload,
          updated_at: new Date(),
        })
        .where('sale.id', '=', saleId)
        .where('sale.trainer_id', '=', auth.trainerId)
        .returning('id')
        .executeTakeFirst()

      if (!updatedRow) {
        return NextResponse.json(
          buildErrorResponse({
            status: 404,
            title: 'Sale not found',
            detail: 'No sale exists for this trainer with that id.',
            type: '/sale-not-found',
          }),
          { status: 404 }
        )
      }
    }

    const rows = await fetchSales({ trainerId: auth.trainerId, saleId })
    const saleRow = rows[0]

    if (!saleRow) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Sale not found',
          detail: 'No sale exists for this trainer with that id.',
          type: '/sale-not-found',
        }),
        { status: 404 }
      )
    }

    const sale = saleSchema.parse(adaptSaleRow(saleRow))

    return NextResponse.json(sale)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse sale data from database',
          detail: 'Sale data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to update sale', { saleId, trainerId: auth.trainerId, error })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to update sale',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
