import { NextResponse } from 'next/server'
import { db, sql, type Point } from '@/lib/db'
import { z } from 'zod'
import { buildErrorResponse } from '../app/api/_lib/accessToken'

export const moneyString = z
  .string()
  .regex(/^-?\d+(?:\.\d{2})$/, 'Money values must be formatted with two decimal places')

const isoDateTimeString = z.string().datetime({ offset: true })

const geoSchema = z.object({
  lat: z.number(),
  lng: z.number(),
})

const baseProductSchema = z.object({
  id: z.string(),
  createdAt: isoDateTimeString,
  updatedAt: isoDateTimeString,
  price: moneyString,
  currency: z.string(),
  name: z.string(),
  description: z.string(),
  displayOrder: z.number().int().nullable().optional(),
})

const creditPackProductSchema = baseProductSchema.extend({
  type: z.literal('creditPack'),
  totalCredits: z.number().int().min(0),
})

const itemProductSchema = baseProductSchema.extend({
  type: z.literal('item'),
})

const serviceProductSchema = baseProductSchema.extend({
  type: z.literal('service'),
  durationMinutes: z.number().int().min(1),
  bookableOnline: z.boolean(),
  showPriceOnline: z.boolean(),
  bookingPaymentType: z.enum(['hidePrice', 'noPrepayment', 'fullPrepayment']),
  bufferMinutesBefore: z.number().int(),
  bufferMinutesAfter: z.number().int(),
  timeSlotFrequencyMinutes: z.number().int(),
  requestClientAddressOnline: z.union([z.literal('optional'), z.literal('required'), z.null()]),
  bookingQuestion: z.string().nullable(),
  bookingQuestionState: z.union([z.literal('optional'), z.literal('required'), z.null()]),
  location: z.string().nullable(),
  address: z.string().nullable(),
  geo: geoSchema.nullable(),
  googlePlaceId: z.string().nullable(),
  coverImageUrl: z.string().nullable(),
  iconUrl: z.string().nullable(),
  image0Url: z.string().nullable(),
  image1Url: z.string().nullable(),
  image2Url: z.string().nullable(),
  image3Url: z.string().nullable(),
  image4Url: z.string().nullable(),
  image5Url: z.string().nullable(),
})

export const productSchema = z.union([creditPackProductSchema, itemProductSchema, serviceProductSchema])

export const productListSchema = z.array(productSchema)
export type ProductList = z.infer<typeof productListSchema>
export type Product = z.infer<typeof productSchema>

const productTypeSchema = z.enum(['creditPack', 'service', 'item'])

export const querySchema = z.object({
  type: productTypeSchema.optional(),
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
})

export type QueryParams = z.infer<typeof querySchema>
export type ProductFilters = QueryParams & { productId?: string }

export type RawProductRow = {
  id: string
  name: string
  description: string
  price: string
  currency: string
  createdAt: Date | string
  combinedUpdatedAt: Date | string
  displayOrder: number | null
  isCreditPack: boolean | null
  isItem: boolean | null
  isService: boolean | null
  isMembership: boolean | null
  totalCredits: number | null
  durationMinutes: number | string | null
  location: string | null
  address: string | null
  googlePlaceId: string | null
  geo: Point | null
  bookableOnline: boolean | null
  bookingPaymentType: string | null
  coverImageUrl: string | null
  iconUrl: string | null
  image0Url: string | null
  image1Url: string | null
  image2Url: string | null
  image3Url: string | null
  image4Url: string | null
  image5Url: string | null
  bufferMinutesBefore: number | null
  bufferMinutesAfter: number | null
  timeSlotFrequencyMinutes: number | null
  requestClientAddressOnline: string | null
  bookingQuestion: string | null
  bookingQuestionState: string | null
}

type ProductType = z.infer<typeof productTypeSchema>

const ensureDate = (value: Date | string, label: string) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${label} value encountered in product record`)
  }
  return date
}

const formatIso = (value: Date | string, label: string) => ensureDate(value, label).toISOString()

const formatMoney = (value: string, label: string) => {
  const numeric = Number.parseFloat(value)
  if (!Number.isFinite(numeric)) {
    throw new Error(`Invalid ${label} value encountered in product record`)
  }
  return numeric.toFixed(2)
}

const parseInteger = (value: number | string | null, label: string, options: { minimum?: number } = {}) => {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${label} in product record`)
  }
  const numeric = typeof value === 'number' ? value : Number.parseFloat(String(value))
  if (!Number.isFinite(numeric)) {
    throw new Error(`Invalid ${label} value encountered in product record`)
  }
  const rounded = Math.round(numeric)
  if (!Number.isInteger(rounded)) {
    throw new Error(`Invalid ${label} value encountered in product record`)
  }
  if (options.minimum !== undefined && rounded < options.minimum) {
    throw new Error(`${label} must be at least ${options.minimum} but was ${rounded}`)
  }
  return rounded
}

const normalizeGeo = (value: Point | null): z.infer<typeof geoSchema> | null => {
  if (!value) {
    return null
  }
  const { x, y } = value
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('Invalid geo coordinates encountered in product record')
  }
  return { lat: x, lng: y }
}

const determineType = (row: RawProductRow): ProductType => {
  if (row.isService) {
    return 'service'
  }
  if (row.isCreditPack) {
    return 'creditPack'
  }
  if (row.isItem) {
    return 'item'
  }
  if (row.isMembership) {
    throw new Error('Membership products are not supported by this endpoint')
  }
  throw new Error('Product has no supported type')
}

export const sanitizeProductQuery = (request: Request): QueryParams | NextResponse => {
  const url = new URL(request.url)
  const rawType = url.searchParams.get('type')
  const rawUpdatedAfter = url.searchParams.get('updatedAfter')

  const queryParse = querySchema.safeParse({
    type: rawType && rawType.trim().length > 0 ? (rawType.trim() as ProductType) : undefined,
    updatedAfter: rawUpdatedAfter && rawUpdatedAfter.trim().length > 0 ? rawUpdatedAfter.trim() : undefined,
  })

  if (!queryParse.success) {
    const detail = queryParse.error.issues.map((issue) => issue.message).join('; ')
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

  return queryParse.data
}

const mapRowToProduct = (row: RawProductRow) => {
  const type = determineType(row)
  const base = {
    id: row.id,
    createdAt: formatIso(row.createdAt, 'createdAt'),
    updatedAt: formatIso(row.combinedUpdatedAt, 'updatedAt'),
    price: formatMoney(row.price, 'price'),
    currency: row.currency,
    name: row.name,
    description: row.description,
    displayOrder: row.displayOrder ?? null,
  }

  if (type === 'creditPack') {
    return {
      ...base,
      type: 'creditPack' as const,
      totalCredits: parseInteger(row.totalCredits, 'totalCredits', {
        minimum: 0,
      }),
    }
  }

  if (type === 'item') {
    return {
      ...base,
      type: 'item' as const,
    }
  }

  const bookingPaymentType = row.bookingPaymentType
  if (!bookingPaymentType) {
    throw new Error('Missing booking payment type for service product')
  }

  const bookableOnline = row.bookableOnline
  if (typeof bookableOnline !== 'boolean') {
    throw new Error('Missing bookableOnline flag for service product')
  }

  return {
    ...base,
    type: 'service' as const,
    durationMinutes: parseInteger(row.durationMinutes, 'durationMinutes', {
      minimum: 1,
    }),
    bookableOnline,
    showPriceOnline: bookingPaymentType !== 'hidePrice',
    bookingPaymentType,
    bufferMinutesBefore: parseInteger(row.bufferMinutesBefore, 'bufferMinutesBefore', {
      minimum: 0,
    }),
    bufferMinutesAfter: parseInteger(row.bufferMinutesAfter, 'bufferMinutesAfter', { minimum: 0 }),
    timeSlotFrequencyMinutes: parseInteger(row.timeSlotFrequencyMinutes, 'timeSlotFrequencyMinutes', { minimum: 0 }),
    requestClientAddressOnline: row.requestClientAddressOnline ?? null,
    bookingQuestion: row.bookingQuestion ?? null,
    bookingQuestionState: row.bookingQuestionState ?? null,
    location: row.location ?? null,
    address: row.address ?? null,
    geo: normalizeGeo(row.geo),
    googlePlaceId: row.googlePlaceId ?? null,
    coverImageUrl: row.coverImageUrl ?? null,
    iconUrl: row.iconUrl ?? null,
    image0Url: row.image0Url ?? null,
    image1Url: row.image1Url ?? null,
    image2Url: row.image2Url ?? null,
    image3Url: row.image3Url ?? null,
    image4Url: row.image4Url ?? null,
    image5Url: row.image5Url ?? null,
  }
}

export const fetchProductsForTrainer = async (trainerId: string, filters: ProductFilters): Promise<RawProductRow[]> => {
  const greatestUpdatedAt = sql<Date>`
    GREATEST(
      ${sql.ref('product.updated_at')},
      COALESCE(${sql.ref('service.updated_at')}, ${sql.ref('product.updated_at')}),
      COALESCE(${sql.ref('creditPack.updated_at')}, ${sql.ref('product.updated_at')})
    )
  `

  let query = db
    .selectFrom('product as product')
    .innerJoin('currency as currency', 'currency.id', 'product.currency_id')
    .leftJoin('credit_pack as creditPack', 'creditPack.id', 'product.id')
    .leftJoin('service as service', 'service.id', 'product.id')
    .select(({ ref }) => [
      ref('product.id').as('id'),
      ref('product.name').as('name'),
      ref('product.description').as('description'),
      ref('product.price').as('price'),
      ref('currency.alpha_code').as('currency'),
      ref('product.created_at').as('createdAt'),
      greatestUpdatedAt.as('combinedUpdatedAt'),
      ref('product.display_order').as('displayOrder'),
      ref('product.is_credit_pack').as('isCreditPack'),
      ref('product.is_item').as('isItem'),
      ref('product.is_service').as('isService'),
      ref('product.is_membership').as('isMembership'),
      ref('creditPack.total_credits').as('totalCredits'),
      sql<number | null>`
        CASE
          WHEN service.duration IS NULL THEN NULL
          ELSE EXTRACT(EPOCH FROM service.duration) / 60
        END
      `.as('durationMinutes'),
      ref('service.location').as('location'),
      ref('service.address').as('address'),
      ref('service.google_place_id').as('googlePlaceId'),
      ref('service.geo').as('geo'),
      ref('service.bookable_online').as('bookableOnline'),
      ref('service.booking_payment_type').as('bookingPaymentType'),
      ref('service.cover_image_url').as('coverImageUrl'),
      ref('service.icon_url').as('iconUrl'),
      ref('service.image_0_url').as('image0Url'),
      ref('service.image_1_url').as('image1Url'),
      ref('service.image_2_url').as('image2Url'),
      ref('service.image_3_url').as('image3Url'),
      ref('service.image_4_url').as('image4Url'),
      ref('service.image_5_url').as('image5Url'),
      ref('service.buffer_minutes_before').as('bufferMinutesBefore'),
      ref('service.buffer_minutes_after').as('bufferMinutesAfter'),
      ref('service.time_slot_frequency_minutes').as('timeSlotFrequencyMinutes'),
      ref('service.request_client_address_online').as('requestClientAddressOnline'),
      ref('service.booking_question').as('bookingQuestion'),
      ref('service.booking_question_state').as('bookingQuestionState'),
    ])
    .where('product.trainer_id', '=', trainerId)

  if (filters.productId) {
    query = query.where('product.id', '=', filters.productId)
  }

  if (filters.type) {
    if (filters.type === 'creditPack') {
      query = query.where('product.is_credit_pack', '=', true)
    } else if (filters.type === 'service') {
      query = query.where('product.is_service', '=', true)
    } else if (filters.type === 'item') {
      query = query.where('product.is_item', '=', true)
    }
  }

  if (filters.updatedAfter) {
    const updatedAfterDate = filters.updatedAfter
    query = query.where(({ eb }) =>
      eb(
        sql<Date>`
          GREATEST(
            ${sql.ref('product.updated_at')},
            COALESCE(${sql.ref('service.updated_at')}, ${sql.ref('product.updated_at')}),
            COALESCE(${sql.ref('creditPack.updated_at')}, ${sql.ref('product.updated_at')})
          )
        `,
        '>',
        updatedAfterDate
      )
    )
  }

  return query.orderBy('product.created_at', 'desc').execute() as Promise<RawProductRow[]>
}

export async function listProducts(trainerId: string, filters: QueryParams): Promise<ProductList> {
  const rows = await fetchProductsForTrainer(trainerId, filters)
  return productListSchema.parse(rows.map(mapRowToProduct))
}

export async function getProductById(trainerId: string, productId: string): Promise<Product | null> {
  const rows = await fetchProductsForTrainer(trainerId, { productId })
  const row = rows[0]

  if (!row) {
    return null
  }

  return productSchema.parse(mapRowToProduct(row))
}
