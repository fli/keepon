import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { intervalFromMinutes, toPoint } from '@/lib/db/values'
import { uuidOrNil } from '@/lib/uuid'
import { authenticateTrainerRequest, buildErrorResponse } from '../../_lib/accessToken'
import { parseStrictJsonBody } from '../../_lib/strictJson'
import {
  adaptSaleProductRow,
  fetchSaleProducts,
  geoSchema,
  saleProductSchema,
  type FetchSaleProductFilters,
} from '../shared'

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

class CantEditProductPricePaidByStripeError extends Error {
  constructor() {
    super("You can't edit a product that has been paid by a Stripe payment.")
    this.name = 'CantEditProductPricePaidByStripeError'
  }
}

const determineSaleProductType = (flags: {
  isService: boolean | null
  isCreditPack: boolean | null
  isItem: boolean | null
}) => {
  if (flags.isService) {
    return 'service' as const
  }
  if (flags.isCreditPack) {
    return 'creditPack' as const
  }
  if (flags.isItem) {
    return 'item' as const
  }
  throw new Error('Sale product row has unsupported type flags')
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

const moneyRegex = /^(?:-\d)?\d*?(?:\.\d+)?$/

const moneyAmountSchema = z
  .string({ message: 'price  should be string' })
  .transform((value) => value.trim())
  .refine((value) => moneyRegex.test(value), { message: 'price  should be Money' })
  .refine((value) => Number.parseFloat(value) >= 0, {
    message: 'price  should be greater than or equal to 0',
  })
  .transform((value) => Number.parseFloat(value).toFixed(2))

const nullableTrimmedStringSchema = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined || value === null) {
      return value === null ? null : undefined
    }
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  })

const patchRequestBodySchema = z
  .object({
    price: moneyAmountSchema.optional(),
    name: z.string().trim().min(1, 'name must not be empty').optional(),
    quantity: z
      .number({ message: 'quantity  should be number' })
      .int()
      .min(1, 'quantity  should be greater than or equal to 1')
      .optional(),
    totalCredits: z
      .number({ message: 'totalCredits  should be number' })
      .int()
      .min(0, 'totalCredits  should be greater than or equal to 0')
      .optional(),
    durationMinutes: z
      .number({ message: 'durationMinutes  should be number' })
      .int()
      .min(1, 'durationMinutes  should be greater than or equal to 1')
      .optional(),
    location: nullableTrimmedStringSchema,
    address: nullableTrimmedStringSchema,
    geo: geoSchema.nullable().optional(),
    googlePlaceId: nullableTrimmedStringSchema,
  })
  .strict()

export async function GET(request: NextRequest, context: HandlerContext) {
  const { saleProductId } = await context.params

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while fetching sale product',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const safeSaleProductId = uuidOrNil(saleProductId)

  try {
    const filters: FetchSaleProductFilters = {
      saleProductId: safeSaleProductId,
    }

    const rows = await fetchSaleProducts(authorization.trainerId, filters)
    const saleProductRow = rows[0]

    if (!saleProductRow) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Sale product not found',
          type: '/resource-not-found',
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

    console.error('Failed to fetch sale product', authorization.trainerId, saleProductId, error)

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

export async function PATCH(request: NextRequest, context: HandlerContext) {
  const { saleProductId } = await context.params

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while updating sale product',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const parsedJson = await parseStrictJsonBody(request)
  if (!parsedJson.ok) {
    return parsedJson.response
  }

  const bodyResult = patchRequestBodySchema.safeParse(parsedJson.data)

  if (!bodyResult.success) {
    const detail = bodyResult.error.issues.map((issue) => issue.message).join('\n')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Your parameters were invalid.',
        detail: detail || 'Your parameters were invalid.',
        type: '/invalid-parameters',
      }),
      { status: 400 }
    )
  }

  const parsedBody = bodyResult.data
  const hasUpdates = Object.values(parsedBody).some((value) => value !== undefined)

  try {
    let saleProductType: 'creditPack' | 'item' | 'service'
    let paymentId: string | null = null

    await db.transaction().execute(async (trx) => {
      const details = await trx
        .selectFrom('sale_product as saleProduct')
        .innerJoin('sale', 'sale.id', 'saleProduct.sale_id')
        .leftJoin('payment', 'payment.sale_id', 'sale.id')
        .select((eb) => [
          eb.ref('sale.id').as('saleId'),
          eb.ref('payment.is_stripe').as('isStripePayment'),
          eb.ref('payment.id').as('paymentId'),
          eb.ref('saleProduct.is_credit_pack').as('isCreditPack'),
          eb.ref('saleProduct.is_item').as('isItem'),
          eb.ref('saleProduct.is_service').as('isService'),
        ])
        .where('saleProduct.id', '=', saleProductId)
        .where('saleProduct.trainer_id', '=', authorization.trainerId)
        .executeTakeFirst()

      if (!details) {
        throw new SaleProductNotFoundError()
      }

      saleProductType = determineSaleProductType({
        isService: details.isService,
        isCreditPack: details.isCreditPack,
        isItem: details.isItem,
      })

      paymentId = details.paymentId ?? null

      if (details.isStripePayment && parsedBody.price !== undefined) {
        throw new CantEditProductPricePaidByStripeError()
      }

      if (hasUpdates) {
        const saleProductUpdate: Record<string, unknown> = {}

        if (parsedBody.price !== undefined) {
          saleProductUpdate.price = parsedBody.price
        }

        if (parsedBody.name !== undefined) {
          saleProductUpdate.name = parsedBody.name
        }

        if (Object.keys(saleProductUpdate).length > 0) {
          saleProductUpdate.updated_at = new Date()
          await trx
            .updateTable('sale_product')
            .set(saleProductUpdate)
            .where('sale_product.id', '=', saleProductId)
            .where('sale_product.trainer_id', '=', authorization.trainerId)
            .executeTakeFirst()
        }

        if (parsedBody.price !== undefined && paymentId) {
          await trx
            .updateTable('payment')
            .set({
              amount: parsedBody.price,
              updated_at: new Date(),
            })
            .where('payment.id', '=', paymentId)
            .where('payment.trainer_id', '=', authorization.trainerId)
            .executeTakeFirst()
        }

        switch (saleProductType) {
          case 'creditPack': {
            if (parsedBody.totalCredits !== undefined) {
              await trx
                .updateTable('sale_credit_pack')
                .set({
                  total_credits: parsedBody.totalCredits,
                  updated_at: new Date(),
                })
                .where('sale_credit_pack.id', '=', saleProductId)
                .where('sale_credit_pack.trainer_id', '=', authorization.trainerId)
                .executeTakeFirst()
            }
            break
          }
          case 'item': {
            if (parsedBody.quantity !== undefined) {
              await trx
                .updateTable('sale_item')
                .set({
                  quantity: parsedBody.quantity,
                  updated_at: new Date(),
                })
                .where('sale_item.id', '=', saleProductId)
                .where('sale_item.trainer_id', '=', authorization.trainerId)
                .executeTakeFirst()
            }
            break
          }
          case 'service': {
            const serviceUpdate: Record<string, unknown> = {}

            if (parsedBody.durationMinutes !== undefined) {
              serviceUpdate.duration = intervalFromMinutes(parsedBody.durationMinutes)
            }

            if (parsedBody.location !== undefined) {
              serviceUpdate.location = parsedBody.location
            }

            if (parsedBody.address !== undefined) {
              serviceUpdate.address = parsedBody.address
            }

            if (parsedBody.googlePlaceId !== undefined) {
              serviceUpdate.google_place_id = parsedBody.googlePlaceId
            }

            if (parsedBody.geo !== undefined) {
              serviceUpdate.geo = parsedBody.geo === null ? null : toPoint(parsedBody.geo.lat, parsedBody.geo.lng)
            }

            if (Object.keys(serviceUpdate).length > 0) {
              serviceUpdate.updated_at = new Date()
              await trx
                .updateTable('sale_service')
                .set(serviceUpdate)
                .where('sale_service.id', '=', saleProductId)
                .where('sale_service.trainer_id', '=', authorization.trainerId)
                .executeTakeFirst()
            }
            break
          }
        }
      }
    })

    const rows = await fetchSaleProducts(authorization.trainerId, { saleProductId })
    const saleProductRow = rows[0]

    if (!saleProductRow) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Sale product not found',
          type: '/resource-not-found',
        }),
        { status: 404 }
      )
    }

    const responseBody = saleProductSchema.parse(adaptSaleProductRow(saleProductRow))

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof SaleProductNotFoundError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Sale product not found',
          type: '/resource-not-found',
        }),
        { status: 404 }
      )
    }

    if (error instanceof CantEditProductPricePaidByStripeError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: "You can't edit a product that has been paid by a Stripe payment.",
          type: '/cant-edit-product-price-paid-by-stripe',
        }),
        { status: 409 }
      )
    }

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

    console.error('Failed to update sale product', {
      trainerId: authorization.trainerId,
      saleProductId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to update sale product',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest, context: HandlerContext) {
  const { saleProductId } = await context.params

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while deleting sale product',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    await db.transaction().execute(async (trx) => {
      const saleDetails = (await trx
        .selectFrom('sale_product as saleProduct')
        .innerJoin('sale', 'sale.id', 'saleProduct.sale_id')
        .leftJoin('sale_payment_status as salePaymentStatus', 'salePaymentStatus.sale_id', 'sale.id')
        .select((eb) => [
          eb.ref('sale.id').as('saleId'),
          eb.fn('coalesce', [eb('salePaymentStatus.payment_status', '=', 'paid'), eb.val(false)]).as('paid'),
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
          type: '/resource-not-found',
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
