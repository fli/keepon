import { NextResponse } from 'next/server'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import { authenticateTrainerRequest, buildErrorResponse } from '../_lib/accessToken'
import { sanitizeProductQuery, listProducts, moneyString } from '@/server/products'
import type { Insertable } from 'kysely'
import type { Service } from '@/lib/db/generated'

const nonNegativeMoneyString = moneyString.refine(
  (value) => Number.parseFloat(value) >= 0,
  'Price must be non-negative'
)

const priceSchema = z
  .union([z.string(), z.number()])
  .transform((value) => {
    const raw = typeof value === 'number' ? value.toString() : typeof value === 'string' ? value.trim() : value

    if (typeof raw !== 'string') return raw

    const numeric = Number.parseFloat(raw)
    if (Number.isNaN(numeric)) return raw

    return numeric.toFixed(2)
  })
  .pipe(nonNegativeMoneyString)

const nullableTrimmedToNull = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined
    if (value === null) return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  })

const descriptionSchema = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined || value === null) return ''
    return value.trim()
  })

const geoSchema = z
  .object({
    lat: z.number(),
    lng: z.number(),
  })
  .nullable()
  .optional()

const baseProductSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  description: descriptionSchema,
  price: priceSchema,
  currency: z.string().trim().min(1).optional(),
  displayOrder: z.number().int().nullable().optional(),
})

const creditPackProductSchema = baseProductSchema.extend({
  type: z.literal('creditPack'),
  totalCredits: z.number().int().min(0, 'totalCredits must be at least 0'),
})

const itemProductSchema = baseProductSchema.extend({
  type: z.literal('item'),
})

const serviceProductSchema = baseProductSchema.extend({
  type: z.literal('service'),
  durationMinutes: z.number().int().min(1, 'durationMinutes must be at least 1'),
  bookableOnline: z.boolean().optional(),
  showPriceOnline: z.boolean().nullable().optional(),
  bookingPaymentType: z.enum(['hidePrice', 'noPrepayment', 'fullPrepayment']).nullable().optional(),
  location: nullableTrimmedToNull,
  address: nullableTrimmedToNull,
  geo: geoSchema,
  googlePlaceId: nullableTrimmedToNull,
  bufferMinutesBefore: z.number().int().min(0).optional(),
  bufferMinutesAfter: z.number().int().min(0).optional(),
  timeSlotFrequencyMinutes: z.number().int().min(1).optional(),
  requestClientAddressOnline: z.union([z.literal('optional'), z.literal('required'), z.null()]).optional(),
  bookingQuestion: nullableTrimmedToNull,
  bookingQuestionState: z.union([z.literal('optional'), z.literal('required'), z.null()]).optional(),
})

const createProductSchema = z.discriminatedUnion('type', [
  creditPackProductSchema,
  itemProductSchema,
  serviceProductSchema,
])

export async function GET(request: Request) {
  const paramsOrResponse = sanitizeProductQuery(request)
  if (paramsOrResponse instanceof NextResponse) {
    return paramsOrResponse
  }
  const params = paramsOrResponse

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while fetching products',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const products = await listProducts(authorization.trainerId, params)

    return NextResponse.json(products)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse product data from database',
          detail: 'Product data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch products', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch products',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch (error) {
    console.error('Failed to parse product body as JSON', error)
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

  const parsed = createProductSchema.safeParse(body)
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

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while creating product',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const data = parsed.data

    const currencyRow = await db
      .selectFrom('trainer')
      .innerJoin(
        'supported_country_currency as supportedCountryCurrency',
        'supportedCountryCurrency.country_id',
        'trainer.country_id'
      )
      .innerJoin('currency', 'currency.id', 'supportedCountryCurrency.currency_id')
      .select(['currency.id as currencyId', 'currency.alpha_code as currency'])
      .where('trainer.id', '=', authorization.trainerId)
      .executeTakeFirst()

    if (!currencyRow) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Could not resolve trainer currency',
          type: '/missing-currency',
        }),
        { status: 500 }
      )
    }

    const resolveBookingPaymentType = (service: z.infer<typeof serviceProductSchema>) => {
      if (service.bookingPaymentType) {
        return service.bookingPaymentType
      }

      const showPrice = service.showPriceOnline === true || service.showPriceOnline === null

      return showPrice ? 'noPrepayment' : 'hidePrice'
    }

    const productId = await db.transaction().execute(async (trx) => {
      const productRow = await trx
        .insertInto('product')
        .values({
          trainer_id: authorization.trainerId,
          name: data.name,
          description: data.description,
          price: data.price,
          currency_id: currencyRow.currencyId,
          is_credit_pack: data.type === 'creditPack' ? true : null,
          is_item: data.type === 'item' ? true : null,
          is_service: data.type === 'service' ? true : null,
          is_membership: null,
          display_order: data.displayOrder ?? null,
        })
        .returning('id')
        .executeTakeFirst()

      if (!productRow) {
        throw new Error('Failed to insert product')
      }

      if (data.type === 'creditPack') {
        await trx
          .insertInto('credit_pack')
          .values({
            id: productRow.id,
            trainer_id: authorization.trainerId,
            total_credits: data.totalCredits,
            is_credit_pack: true,
          })
          .execute()
      } else if (data.type === 'service') {
        const bookingPaymentType = resolveBookingPaymentType(data)

        const serviceValues: Record<string, unknown> = {
          id: productRow.id,
          trainer_id: authorization.trainerId,
          duration: sql`make_interval(mins := ${data.durationMinutes})`,
          location: data.location ?? null,
          address: data.address ?? null,
          google_place_id: data.googlePlaceId ?? null,
          geo: data.geo ? sql`point(${data.geo.lat}, ${data.geo.lng})` : null,
          bookable_online: data.bookableOnline ?? false,
          booking_payment_type: bookingPaymentType,
          is_service: true,
        }

        if (data.bufferMinutesBefore !== undefined) {
          serviceValues.buffer_minutes_before = data.bufferMinutesBefore
        }

        if (data.bufferMinutesAfter !== undefined) {
          serviceValues.buffer_minutes_after = data.bufferMinutesAfter
        }

        if (data.timeSlotFrequencyMinutes !== undefined) {
          serviceValues.time_slot_frequency_minutes = data.timeSlotFrequencyMinutes
        }

        if (data.requestClientAddressOnline !== undefined) {
          serviceValues.request_client_address_online = data.requestClientAddressOnline
        }

        if (data.bookingQuestion !== undefined) {
          serviceValues.booking_question = data.bookingQuestion
        }

        if (data.bookingQuestionState !== undefined) {
          serviceValues.booking_question_state = data.bookingQuestionState
        }

        await trx
          .insertInto('service')
          .values(serviceValues as Insertable<Service>)
          .execute()
      }

      return productRow.id
    })

    const products = await listProducts(authorization.trainerId, {
      type: data.type,
    })

    const product = products.find((product) => product.id === productId)

    if (!product) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to fetch product after creation',
          type: '/product-not-found',
        }),
        { status: 500 }
      )
    }

    return NextResponse.json(product, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse product data after creation',
          detail: 'Product data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to create product', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to create product',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
