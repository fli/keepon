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
import { uuidOrNil } from '@/lib/uuid'

type PgError = { code?: string; constraint?: string }

const isPgError = (error: unknown): error is PgError =>
  typeof error === 'object' && error !== null && 'code' in error && typeof (error as PgError).code === 'string'

class SaleNotFoundError extends Error {}
class SaleAlreadyHasProductError extends Error {}

const LEGACY_INVALID_JSON_MESSAGE = 'Unexpected token \'"\', "#" is not valid JSON'
const moneyReg = /^(?:-\d)?\d*?(?:\.\d+)?$/

const createLegacyInvalidJsonResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: LEGACY_INVALID_JSON_MESSAGE,
    }),
    { status: 400 }
  )

const createLegacyInvalidParametersResponse = (detail: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Your parameters were invalid.',
      detail,
      type: '/invalid-parameters',
    }),
    { status: 400 }
  )

const querySchema = z.object({
  type: saleProductTypeSchema.optional(),
  saleId: z.string().min(1).optional(),
  updatedAfter: z
    .string()
    .refine((value) => {
      const parsed = new Date(value)
      return !Number.isNaN(parsed.getTime())
    }, 'updatedAfter must be a valid ISO 8601 datetime string')
    .transform((value) => new Date(value))
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

    if (filters.saleId) {
      filters.saleId = uuidOrNil(filters.saleId)
    }

    if (filters.clientId) {
      filters.clientId = uuidOrNil(filters.clientId)
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

const toNullableTrimmedString = (value?: string | null) => {
  if (value === null || value === undefined) {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

type ValidSaleProductBody =
  | {
      type: 'creditPack'
      saleId: string
      price: string
      currency: string
      name: string
      productId: string | null
      totalCredits: number
    }
  | {
      type: 'item'
      saleId: string
      price: string
      currency: string
      name: string
      productId: string | null
      quantity: number
    }
  | {
      type: 'service'
      saleId: string
      price: string
      currency: string
      name: string
      productId: string | null
      durationMinutes: number
      location: string | null
      address: string | null
      geo: { lat: number; lng: number } | null
      googlePlaceId: string | null
    }

const validateSaleProductBody = (body: Record<string, unknown>) => {
  const errors: string[] = []

  const typeRaw = body.type
  if (typeRaw === undefined) {
    return { ok: false as const, detail: 'type  not provided' }
  }
  if (typeof typeRaw !== 'string') {
    return { ok: false as const, detail: 'type  should be string' }
  }

  const saleIdRaw = body.saleId
  if (saleIdRaw === undefined) {
    errors.push('saleId  not provided')
  } else if (typeof saleIdRaw !== 'string') {
    errors.push('saleId  should be string')
  }

  const priceRaw = body.price
  if (priceRaw === undefined) {
    errors.push('price  not provided')
  } else if (typeof priceRaw !== 'string') {
    errors.push('price  should be string')
  } else if (!moneyReg.test(priceRaw)) {
    errors.push('price  should be Money')
  } else if (Number.parseFloat(priceRaw) < 0) {
    errors.push('price  should be greater than or equal to 0')
  }

  const currencyRaw = body.currency
  if (currencyRaw === undefined) {
    errors.push('currency  not provided')
  } else if (typeof currencyRaw !== 'string') {
    errors.push('currency  should be string')
  }

  const nameRaw = body.name
  if (nameRaw === undefined) {
    errors.push('name  not provided')
  } else if (typeof nameRaw !== 'string') {
    errors.push('name  should be string')
  } else if (nameRaw.trim().length === 0) {
    errors.push('name  should be string')
  }

  const productIdRaw = body.productId
  if (productIdRaw !== undefined && productIdRaw !== null && typeof productIdRaw !== 'string') {
    errors.push('productId  should be string')
  }

  if (typeRaw === 'creditPack') {
    const totalCreditsRaw = body.totalCredits
    if (totalCreditsRaw === undefined) {
      errors.push('totalCredits  not provided')
    } else if (typeof totalCreditsRaw !== 'number' || Number.isNaN(totalCreditsRaw)) {
      errors.push('totalCredits  should be number')
    } else if (totalCreditsRaw < 0) {
      errors.push('totalCredits  should be greater than or equal to 0')
    }
  } else if (typeRaw === 'item') {
    const quantityRaw = body.quantity
    if (quantityRaw !== undefined) {
      if (typeof quantityRaw !== 'number' || Number.isNaN(quantityRaw)) {
        errors.push('quantity  should be number')
      } else if (quantityRaw < 1) {
        errors.push('quantity  should be greater than or equal to 1')
      }
    }
  } else if (typeRaw === 'service') {
    const durationRaw = body.durationMinutes
    if (durationRaw === undefined) {
      errors.push('durationMinutes  not provided')
    } else if (typeof durationRaw !== 'number' || Number.isNaN(durationRaw)) {
      errors.push('durationMinutes  should be number')
    } else if (durationRaw < 1) {
      errors.push('durationMinutes  should be greater than or equal to 1')
    }
  }

  if (errors.length > 0) {
    return { ok: false as const, detail: errors.join('\n') }
  }

  const saleId = saleIdRaw as string
  const price = priceRaw as string
  const currency = currencyRaw as string
  const name = nameRaw as string
  const productId = toNullableTrimmedString(
    typeof productIdRaw === 'string' ? productIdRaw : null
  )

  if (typeRaw === 'creditPack') {
    return {
      ok: true as const,
      data: {
        type: 'creditPack' as const,
        saleId,
        price,
        currency,
        name,
        productId,
        totalCredits: body.totalCredits as number,
      },
    }
  }

  if (typeRaw === 'item') {
    return {
      ok: true as const,
      data: {
        type: 'item' as const,
        saleId,
        price,
        currency,
        name,
        productId,
        quantity:
          typeof body.quantity === 'number' && !Number.isNaN(body.quantity)
            ? (body.quantity as number)
            : 1,
      },
    }
  }

  const locationRaw = body.location
  const addressRaw = body.address
  const googlePlaceIdRaw = body.googlePlaceId
  const geoRaw = body.geo

  return {
    ok: true as const,
    data: {
      type: 'service' as const,
      saleId,
      price,
      currency,
      name,
      productId,
      durationMinutes: body.durationMinutes as number,
      location: toNullableTrimmedString(typeof locationRaw === 'string' ? locationRaw : null),
      address: toNullableTrimmedString(typeof addressRaw === 'string' ? addressRaw : null),
      googlePlaceId: toNullableTrimmedString(
        typeof googlePlaceIdRaw === 'string' ? googlePlaceIdRaw : null
      ),
      geo:
        geoRaw && typeof geoRaw === 'object' && !Array.isArray(geoRaw)
          ? (geoSchema.safeParse(geoRaw).success ? (geoRaw as { lat: number; lng: number }) : null)
          : null,
    },
  }
}

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

export async function POST(request: Request) {
  const auth = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while creating sale product',
  })

  if (!auth.ok) {
    return auth.response
  }

  let body: unknown
  try {
    const rawText = await request.text()
    body = rawText.trim().length === 0 ? {} : (JSON.parse(rawText) as unknown)
  } catch (error) {
    console.error('Failed to parse sale product body as JSON', error)
    return createLegacyInvalidJsonResponse()
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return createLegacyInvalidJsonResponse()
  }

  const validation = validateSaleProductBody(body as Record<string, unknown>)
  if (!validation.ok) {
    return createLegacyInvalidParametersResponse(validation.detail)
  }

  const data = validation.data

  if (data.productId && !isUuid(data.productId)) {
    throw new Error('Invalid product id')
  }

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
        title: 'Something on our end went wrong.',
      }),
      { status: 500 }
    )
  }
}
