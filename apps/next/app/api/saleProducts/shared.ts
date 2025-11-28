import { db, sql, type Point } from '@keepon/db'
import { z } from 'zod'

const moneyString = z
  .string()
  .regex(
    /^-?\d+(?:\.\d{2})$/,
    'Money values must be formatted with two decimal places'
  )

const isoDateTimeString = z.string().datetime({ offset: true })

export const geoSchema = z.object({
  lat: z.number(),
  lng: z.number(),
})

export const saleProductTypeSchema = z.enum(['creditPack', 'item', 'service'])

const baseSaleProductSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  saleId: z.string(),
  name: z.string(),
  price: moneyString,
  currency: z.string(),
  createdAt: isoDateTimeString,
  updatedAt: isoDateTimeString,
  productId: z.string().nullable().optional(),
})

const creditPackSaleProductSchema = baseSaleProductSchema.extend({
  type: z.literal('creditPack'),
  totalCredits: z.number().int().min(0),
  creditsUsed: z.number().int().min(0),
})

const itemSaleProductSchema = baseSaleProductSchema.extend({
  type: z.literal('item'),
  quantity: z.number().int().min(1),
})

const serviceSaleProductSchema = baseSaleProductSchema.extend({
  type: z.literal('service'),
  durationMinutes: z.number().int().min(1),
  location: z.string().nullable(),
  address: z.string().nullable(),
  geo: geoSchema.nullable(),
  googlePlaceId: z.string().nullable(),
})

export const saleProductSchema = z.union([
  creditPackSaleProductSchema,
  itemSaleProductSchema,
  serviceSaleProductSchema,
])

export const saleProductListSchema = z.array(saleProductSchema)

export type RawSaleProductRow = {
  id: string
  clientId: string
  saleId: string
  productId: string | null
  name: string
  price: string
  currency: string
  createdAt: Date | string
  combinedUpdatedAt: Date | string
  isCreditPack: boolean | null
  isItem: boolean | null
  isService: boolean | null
  isMembership: boolean | null
  totalCredits: number | string | null
  durationMinutes: number | string | null
  location: string | null
  address: string | null
  googlePlaceId: string | null
  geo: Point | null
  quantity: number | string | null
  creditsUsed: number | string | null
}

const ensureDate = (value: Date | string, label: string) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${label} value encountered in sale product record`)
  }
  return date
}

const formatIso = (value: Date | string, label: string) =>
  ensureDate(value, label).toISOString()

const formatMoney = (value: string, label: string) => {
  const numeric = Number.parseFloat(value)
  if (!Number.isFinite(numeric)) {
    throw new Error(`Invalid ${label} value encountered in sale product record`)
  }
  return numeric.toFixed(2)
}

const parseInteger = (
  value: number | string | null | undefined,
  label: string,
  options: { minimum?: number } = {}
) => {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${label} in sale product record`)
  }
  const numeric =
    typeof value === 'number' ? value : Number.parseFloat(String(value))
  if (!Number.isFinite(numeric)) {
    throw new Error(`Invalid ${label} value encountered in sale product record`)
  }
  const rounded = Math.round(numeric)
  if (!Number.isInteger(rounded)) {
    throw new Error(`Invalid ${label} value encountered in sale product record`)
  }
  if (options.minimum !== undefined && rounded < options.minimum) {
    throw new Error(
      `${label} must be at least ${options.minimum} but was ${rounded}`
    )
  }
  return rounded
}

const normalizeGeo = (value: Point | null): z.infer<typeof geoSchema> | null => {
  if (!value) {
    return null
  }
  const { x, y } = value
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('Invalid geo coordinates encountered in sale product record')
  }
  return { lat: x, lng: y }
}

const determineType = (
  row: RawSaleProductRow
): z.infer<typeof saleProductTypeSchema> => {
  if (row.isService) {
    return 'service'
  }
  if (row.isCreditPack) {
    return 'creditPack'
  }
  if (row.isItem) {
    return 'item'
  }
  throw new Error('Sale product row has unsupported type flags')
}

export const adaptSaleProductRow = (row: RawSaleProductRow) => {
  const base = {
    id: row.id,
    clientId: row.clientId,
    saleId: row.saleId,
    name: row.name,
    price: formatMoney(row.price, 'price'),
    currency: row.currency,
    createdAt: formatIso(row.createdAt, 'createdAt'),
    updatedAt: formatIso(row.combinedUpdatedAt, 'updatedAt'),
    productId: row.productId ?? null,
  }

  const type = determineType(row)

  if (type === 'creditPack') {
    return {
      ...base,
      type,
      totalCredits: parseInteger(row.totalCredits, 'totalCredits', {
        minimum: 0,
      }),
      creditsUsed: parseInteger(row.creditsUsed, 'creditsUsed', {
        minimum: 0,
      }),
    } as const
  }

  if (type === 'item') {
    return {
      ...base,
      type,
      quantity: parseInteger(row.quantity, 'quantity', { minimum: 1 }),
    } as const
  }

  return {
    ...base,
    type,
    durationMinutes: parseInteger(row.durationMinutes, 'durationMinutes', {
      minimum: 1,
    }),
    location: row.location ?? null,
    address: row.address ?? null,
    geo: normalizeGeo(row.geo),
    googlePlaceId: row.googlePlaceId ?? null,
  } as const
}

export type FetchSaleProductFilters = {
  type?: z.infer<typeof saleProductTypeSchema>
  saleId?: string
  updatedAfter?: Date
  clientId?: string
  saleProductId?: string
}

export const fetchSaleProducts = async (
  trainerId: string,
  filters: FetchSaleProductFilters = {}
): Promise<RawSaleProductRow[]> => {
  const combinedUpdatedAt = sql<Date>`
    GREATEST(
      ${sql.ref('saleProduct.updated_at')},
      COALESCE(${sql.ref('saleCreditPack.updated_at')}, ${sql.ref('saleProduct.updated_at')}),
      COALESCE(${sql.ref('saleService.updated_at')}, ${sql.ref('saleProduct.updated_at')}),
      COALESCE(${sql.ref('saleItem.updated_at')}, ${sql.ref('saleProduct.updated_at')})
    )
  `

  const creditUsage = db
    .selectFrom('payment_credit_pack as paymentCreditPack')
    .select(({ ref }) => [
      ref('paymentCreditPack.sale_credit_pack_id').as('saleCreditPackId'),
      sql<number>`
        COALESCE(SUM(${sql.ref('paymentCreditPack.credits_used')}), 0)::int4
      `.as('creditsUsed'),
    ])
    .groupBy('paymentCreditPack.sale_credit_pack_id')
    .as('creditUsage')

  let query = db
    .selectFrom('sale_product as saleProduct')
    .innerJoin('trainer as trainer', 'trainer.id', 'saleProduct.trainer_id')
    .innerJoin(
      'supported_country_currency as supportedCountryCurrency',
      'supportedCountryCurrency.country_id',
      'trainer.country_id'
    )
    .innerJoin('currency as currency', 'currency.id', 'supportedCountryCurrency.currency_id')
    .innerJoin('sale as sale', 'sale.id', 'saleProduct.sale_id')
    .leftJoin('sale_credit_pack as saleCreditPack', 'saleCreditPack.id', 'saleProduct.id')
    .leftJoin('sale_service as saleService', 'saleService.id', 'saleProduct.id')
    .leftJoin('sale_item as saleItem', 'saleItem.id', 'saleProduct.id')
    .leftJoin(creditUsage, 'creditUsage.saleCreditPackId', 'saleCreditPack.id')
    .select(({ ref }) => [
      ref('saleProduct.id').as('id'),
      ref('saleProduct.client_id').as('clientId'),
      ref('saleProduct.sale_id').as('saleId'),
      ref('saleProduct.product_id').as('productId'),
      ref('saleProduct.name').as('name'),
      ref('saleProduct.price').as('price'),
      ref('currency.alpha_code').as('currency'),
      ref('saleProduct.created_at').as('createdAt'),
      combinedUpdatedAt.as('combinedUpdatedAt'),
      ref('saleProduct.is_credit_pack').as('isCreditPack'),
      ref('saleProduct.is_item').as('isItem'),
      ref('saleProduct.is_service').as('isService'),
      ref('saleProduct.is_membership').as('isMembership'),
      ref('saleCreditPack.total_credits').as('totalCredits'),
      sql<number | null>`
        CASE
          WHEN ${sql.ref('saleService.duration')} IS NULL THEN NULL
          ELSE EXTRACT(EPOCH FROM ${sql.ref('saleService.duration')}) / 60
        END
      `.as('durationMinutes'),
      ref('saleService.location').as('location'),
      ref('saleService.address').as('address'),
      ref('saleService.google_place_id').as('googlePlaceId'),
      ref('saleService.geo').as('geo'),
      ref('saleItem.quantity').as('quantity'),
      ref('creditUsage.creditsUsed').as('creditsUsed'),
    ])
    .where('saleProduct.trainer_id', '=', trainerId)

  if (filters.saleProductId) {
    query = query.where('saleProduct.id', '=', filters.saleProductId)
  }

  if (filters.clientId) {
    query = query.where('saleProduct.client_id', '=', filters.clientId)
  }

  if (filters.saleId) {
    query = query.where('saleProduct.sale_id', '=', filters.saleId)
  }

  if (filters.type) {
    if (filters.type === 'creditPack') {
      query = query.where('saleProduct.is_credit_pack', '=', true)
    } else if (filters.type === 'service') {
      query = query.where('saleProduct.is_service', '=', true)
    } else if (filters.type === 'item') {
      query = query.where('saleProduct.is_item', '=', true)
    }
  }

  if (filters.updatedAfter) {
    const updatedAfterDate = filters.updatedAfter
    query = query.where(({ eb }) => eb(combinedUpdatedAt, '>', updatedAfterDate))
  }

  return query.orderBy('saleProduct.created_at', 'desc').execute() as Promise<
    RawSaleProductRow[]
  >
}
