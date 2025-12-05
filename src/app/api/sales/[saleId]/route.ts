import { NextRequest, NextResponse } from 'next/server'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import { authenticateTrainerRequest, buildErrorResponse } from '../../_lib/accessToken'

const paramsSchema = z.object({
  saleId: z.string().uuid({ message: 'saleId must be a valid UUID' }),
})

type HandlerContext = RouteContext<'/api/sales/[saleId]'>

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
