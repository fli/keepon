import { NextRequest, NextResponse } from 'next/server'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import {
  authenticateTrainerOrClientRequest,
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../../_lib/accessToken'
import { adaptSaleProductRow, fetchSaleProducts, saleProductSchema, type FetchSaleProductFilters } from '../shared'

const paramsSchema = z.object({
  saleProductId: z
    .string()
    .trim()
    .min(1, 'Sale product id is required')
    .uuid({ message: 'Sale product id must be a valid UUID' }),
})

type HandlerContext = RouteContext<'/api/saleProducts/[saleProductId]'>

class SaleProductNotFoundError extends Error {
  constructor() {
    super('Sale product not found')
    this.name = 'SaleProductNotFoundError'
  }
}

class PaidSaleProductDeletionNotAllowedError extends Error {
  constructor() {
    super("Can't delete sale products for a paid sale")
    this.name = 'PaidSaleProductDeletionNotAllowedError'
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
        title: 'Invalid sale product identifier',
        detail: detail || 'Request parameters did not match the expected sale product identifier schema.',
        type: '/invalid-parameter',
      }),
      { status: 400 }
    )
  }

  const authorization = await authenticateTrainerOrClientRequest(request, {
    trainerExtensionFailureLogMessage:
      'Failed to extend access token expiry while fetching sale product for trainer request',
    clientExtensionFailureLogMessage:
      'Failed to extend access token expiry while fetching sale product for client request',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { saleProductId } = paramsResult.data

  try {
    const filters: FetchSaleProductFilters = {
      saleProductId,
    }

    if (authorization.actor === 'client') {
      filters.clientId = authorization.clientId
    }

    const rows = await fetchSaleProducts(authorization.trainerId, filters)
    const saleProductRow = rows[0]

    if (!saleProductRow) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Sale product not found',
          detail: 'We could not find a sale product with the specified identifier for the authenticated account.',
          type: '/sale-product-not-found',
        }),
        { status: 404 }
      )
    }

    const responseBody = saleProductSchema.parse(adaptSaleProductRow(saleProductRow))

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse sale product data from database',
          detail: 'Sale product data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error(
      'Failed to fetch sale product',
      authorization.trainerId,
      authorization.actor === 'client' ? authorization.clientId : undefined,
      saleProductId,
      error
    )

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch sale product',
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
        title: 'Invalid sale product identifier',
        detail: detail || 'Request parameters did not match the expected sale product identifier schema.',
        type: '/invalid-parameter',
      }),
      { status: 400 }
    )
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while deleting sale product',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { saleProductId } = paramsResult.data

  try {
    await db.transaction().execute(async (trx) => {
      const saleDetails = (await trx
        .selectFrom('sale_product as saleProduct')
        .innerJoin('sale', 'sale.id', 'saleProduct.sale_id')
        .leftJoin('sale_payment_status as salePaymentStatus', 'salePaymentStatus.sale_id', 'sale.id')
        .select((eb) => [
          eb.ref('sale.id').as('saleId'),
          sql<boolean>`COALESCE(${sql.ref('salePaymentStatus.payment_status')} = 'paid', FALSE)`.as('paid'),
        ])
        .where('saleProduct.id', '=', saleProductId)
        .where('saleProduct.trainer_id', '=', authorization.trainerId)
        .executeTakeFirst()) as { saleId: string; paid: boolean } | undefined

      if (!saleDetails) {
        throw new SaleProductNotFoundError()
      }

      if (saleDetails.paid) {
        throw new PaidSaleProductDeletionNotAllowedError()
      }

      const deleteResult = await trx
        .deleteFrom('sale_product')
        .where('sale_product.id', '=', saleProductId)
        .where('sale_product.trainer_id', '=', authorization.trainerId)
        .executeTakeFirst()

      const deletedCount = normalizeDeletedCount(deleteResult?.numDeletedRows ?? 0)

      if (deletedCount === 0) {
        throw new SaleProductNotFoundError()
      }
    })

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    if (error instanceof SaleProductNotFoundError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Sale product not found',
          detail: 'We could not find a sale product with the specified identifier for the authenticated trainer.',
          type: '/sale-product-not-found',
        }),
        { status: 404 }
      )
    }

    if (error instanceof PaidSaleProductDeletionNotAllowedError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: "Can't edit details for sale that has been paid for",
          type: '/cant-edit-paid-sale',
        }),
        { status: 409 }
      )
    }

    console.error('Failed to delete sale product', {
      trainerId: authorization.trainerId,
      saleProductId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to delete sale product',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
