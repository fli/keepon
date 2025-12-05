import { NextResponse } from 'next/server'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import { authenticateTrainerOrClientRequest, authenticateTrainerRequest, buildErrorResponse } from '../_lib/accessToken'
import {
  adaptSaleProductRow,
  fetchSaleProducts,
  geoSchema,
  saleProductListSchema,
  saleProductSchema,
  saleProductTypeSchema,
} from './shared'

type PgError = { code?: string; constraint?: string }

const isPgError = (error: unknown): error is PgError =>
  typeof error === 'object' && error !== null && 'code' in error && typeof (error as PgError).code === 'string'

class SaleNotFoundError extends Error {}
class SaleAlreadyHasProductError extends Error {}

const querySchema = z.object({
  type: saleProductTypeSchema.optional(),
  saleId: z.string().min(1).optional(),
  updatedAfter: z
    .string()
    .transform((value) => {
      const parsed = new Date(value)
      if (Number.isNaN(parsed.getTime())) {
        throw new Error('updatedAfter must be a valid ISO 8601 datetime string')
      }
      return parsed
    })
    .optional(),
  clientId: z.string().min(1).optional(),
})

export async function GET(request: Request) {
  const url = new URL(request.url)
  const typeParam = url.searchParams.get('type')
  const saleIdParam = url.searchParams.get('saleId')
  const updatedAfterParam = url.searchParams.get('updatedAfter')
  const clientIdParam = url.searchParams.get('clientId')

  const normalize = (value: string | null) => (value && value.trim().length > 0 ? value.trim() : undefined)

  const queryResult = querySchema.safeParse({
    type: normalize(typeParam),
    saleId: normalize(saleIdParam),
    updatedAfter: normalize(updatedAfterParam),
    clientId: normalize(clientIdParam),
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

  const authorization = await authenticateTrainerOrClientRequest(request, {
    trainerExtensionFailureLogMessage:
      'Failed to extend access token expiry while fetching sale products for trainer request',
    clientExtensionFailureLogMessage:
      'Failed to extend access token expiry while fetching sale products for client request',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const filters = queryResult.data

    if (authorization.actor === 'client') {
      if (filters.clientId && filters.clientId !== authorization.clientId) {
        return NextResponse.json(
          buildErrorResponse({
            status: 403,
            title: 'You are not authorized to view sale products for other clients',
            type: '/forbidden',
          }),
          { status: 403 }
        )
      }
      filters.clientId = authorization.clientId
    }

    const rows = await fetchSaleProducts(authorization.trainerId, {
      type: filters.type,
      saleId: filters.saleId,
      updatedAfter: filters.updatedAfter,
      clientId: filters.clientId,
    })

    const saleProducts = rows.map((row) => adaptSaleProductRow(row))

    const parsedSaleProducts = saleProductListSchema.parse(saleProducts)

    return NextResponse.json(parsedSaleProducts)
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

    console.error('Failed to fetch sale products', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch sale products',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}

const moneyAmountSchema = z
  .union([z.string(), z.number()])
  .transform((value) => {
    const numeric =
      typeof value === 'number'
        ? value
        : (() => {
            const trimmed = value.trim()
            return Number.parseFloat(trimmed)
          })()

    if (!Number.isFinite(numeric)) {
      throw new Error('price must be a valid number')
    }

    if (numeric < 0) {
      throw new Error('price must be at least 0')
    }

    return numeric.toFixed(2)
  })
  .pipe(z.string().regex(/^\d+(?:\.\d{2})$/, 'price must be a non-negative amount with two decimals'))

const baseSaleProductSchema = z.object({
  saleId: z.string().uuid({ message: 'saleId must be a valid UUID' }),
  price: moneyAmountSchema,
  currency: z.string().trim().min(1, 'currency must not be empty'),
  name: z.string().trim().min(1, 'name must not be empty'),
  productId: z
    .string()
    .trim()
    .min(1, 'productId must not be empty')
    .nullable()
    .optional(),
})

const createSaleProductSchema = z.discriminatedUnion('type', [
  baseSaleProductSchema.extend({
    type: z.literal('creditPack'),
    totalCredits: z.number().int().min(0, 'totalCredits must be at least 0'),
  }),
  baseSaleProductSchema.extend({
    type: z.literal('item'),
    quantity: z.number().int().min(1, 'quantity must be at least 1').optional(),
  }),
  baseSaleProductSchema.extend({
    type: z.literal('service'),
    durationMinutes: z.number().int().min(1, 'durationMinutes must be at least 1'),
    location: z.string().nullable().optional(),
    address: z.string().nullable().optional(),
    geo: geoSchema.nullable().optional(),
    googlePlaceId: z.string().nullable().optional(),
  }),
])

const toNullableTrimmedString = (value?: string | null) => {
  if (value === null || value === undefined) {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function POST(request: Request) {
  let body: unknown

  try {
    body = await request.json()
  } catch (error) {
    console.error('Failed to parse sale product body as JSON', error)
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

  const parsed = createSaleProductSchema.safeParse(body)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => issue.message).join('; ')
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid request body',
        detail: detail || undefined,
        type: '/invalid-body',
      }),
      { status: 400 }
    )
  }

  const auth = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while creating sale product',
  })

  if (!auth.ok) {
    return auth.response
  }

  const data = parsed.data

  try {
    const saleProductId = await db.transaction().execute(async (trx) => {
      const sale = await trx
        .selectFrom('sale')
        .select(['id', 'client_id'])
        .where('id', '=', data.saleId)
        .where('trainer_id', '=', auth.trainerId)
        .executeTakeFirst()

      if (!sale) {
        throw new SaleNotFoundError()
      }

      const inserted = await trx
        .insertInto('sale_product')
        .values({
          trainer_id: auth.trainerId,
          client_id: sale.client_id,
          sale_id: data.saleId,
          price: data.price,
          name: data.name,
          product_id: toNullableTrimmedString(data.productId),
          is_credit_pack: data.type === 'creditPack',
          is_item: data.type === 'item',
          is_service: data.type === 'service',
          is_membership: null,
        })
        .returning('id')
        .executeTakeFirst()
        .catch((error: unknown) => {
          if (isPgError(error) && error.code === '23505' && error.constraint === 'unique_sale_id') {
            throw new SaleAlreadyHasProductError()
          }
          throw error
        })

      if (!inserted) {
        throw new Error('Failed to insert sale product')
      }

      switch (data.type) {
        case 'creditPack': {
          await trx
            .insertInto('sale_credit_pack')
            .values({
              id: inserted.id,
              trainer_id: auth.trainerId,
              total_credits: data.totalCredits,
              is_credit_pack: true,
            })
            .execute()
          break
        }
        case 'item': {
          await trx
            .insertInto('sale_item')
            .values({
              id: inserted.id,
              trainer_id: auth.trainerId,
              quantity: data.quantity ?? 1,
              is_item: true,
            })
            .execute()
          break
        }
        case 'service': {
          await trx
            .insertInto('sale_service')
            .values({
              id: inserted.id,
              trainer_id: auth.trainerId,
              duration: sql`make_interval(mins := ${data.durationMinutes})`,
              location: toNullableTrimmedString(data.location),
              address: toNullableTrimmedString(data.address),
              google_place_id: toNullableTrimmedString(data.googlePlaceId),
              geo: data.geo ? sql`point(${data.geo.lat}, ${data.geo.lng})` : null,
              is_service: true,
            })
            .execute()
          break
        }
      }

      return inserted.id
    })

    const rows = await fetchSaleProducts(auth.trainerId, { saleProductId })
    if (!rows.length) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Sale product not found after creation',
          type: '/sale-product-not-found',
        }),
        { status: 404 }
      )
    }

    const [firstRow] = rows
    if (!firstRow) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Sale product lookup failed after creation',
          type: '/sale-product-not-found',
        }),
        { status: 500 }
      )
    }

    const responseBody = saleProductSchema.parse(adaptSaleProductRow(firstRow))
    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof SaleNotFoundError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 400,
          title: 'Sale not found',
          type: '/parameter-resource-not-found',
        }),
        { status: 400 }
      )
    }

    if (error instanceof SaleAlreadyHasProductError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'The sale already has a product attached.',
          type: '/sale-already-has-product',
        }),
        { status: 409 }
      )
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse sale product data after creation',
          detail: 'Sale product data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to create sale product', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to create sale product',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
