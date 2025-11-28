import { db, sql } from '@keepon/db'
import { z } from 'zod'

export const moneyString = z
  .string()
  .regex(
    /^-?\d+(?:\.\d{2})$/,
    'Money values must be formatted with two decimal places'
  )

export const isoDateTimeString = z.string().datetime({ offset: true })

export const saleSchema = z.object({
  createdAt: isoDateTimeString,
  updatedAt: isoDateTimeString,
  id: z.string(),
  clientId: z.string(),
  dueAt: isoDateTimeString,
  paymentRequested: z.boolean(),
  paymentRequestPassOnTransactionFee: z.boolean(),
  total: moneyString,
  amountPaid: moneyString,
  amountRefunded: moneyString,
  currency: z.string(),
  note: z.string(),
  clientSessionId: z.string().nullable(),
})

export const saleListSchema = z.array(saleSchema)

export const salesQuerySchema = z.object({
  updatedAfter: z
    .string()
    .trim()
    .min(1, 'updatedAfter must not be empty')
    .pipe(
      z
        .string()
        .datetime({
          message: 'updatedAfter must be a valid ISO date-time string',
        })
    )
    .transform(value => new Date(value))
    .optional(),
  clientId: z
    .string()
    .trim()
    .min(1, 'clientId must not be empty')
    .uuid({ message: 'clientId must be a valid UUID' })
    .optional(),
})

export type SalesQuery = z.infer<typeof salesQuerySchema>

export type RawSaleRow = {
  id: string | null
  clientId: string | null
  dueAt: Date | string | null
  createdAt: Date | string | null
  combinedUpdatedAt: Date | string | null
  paymentRequestTime: Date | string | null
  paymentRequestPassOnTransactionFee: boolean | null
  totalAmount: string | number | null
  amountPaid: string | number | null
  amountRefunded: string | number | null
  currency: string | null
  note: string | null
  clientSessionId: string | null
}

const ensureDate = (
  value: Date | string | null | undefined,
  label: string
): Date => {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`Invalid ${label} value encountered in sale record`)
    }
    return value
  }

  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Invalid ${label} value encountered in sale record`)
    }
    return parsed
  }

  if (value === null || value === undefined) {
    throw new Error(`Missing ${label} value encountered in sale record`)
  }

  throw new Error(`Unsupported ${label} value encountered in sale record`)
}

const toIsoDateTime = (
  value: Date | string | null | undefined,
  label: string
) => ensureDate(value, label).toISOString()

const formatMoney = (
  value: string | number | null | undefined,
  label: string
): string => {
  if (value === null || value === undefined) {
    return '0.00'
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid ${label} value encountered in sale record`)
    }
    return value.toFixed(2)
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return '0.00'
  }

  const numeric = Number.parseFloat(trimmed)
  if (!Number.isFinite(numeric)) {
    throw new Error(`Invalid ${label} value encountered in sale record`)
  }

  return numeric.toFixed(2)
}

export const adaptSaleRow = (row: RawSaleRow) => {
  if (!row.id) {
    throw new Error('Sale row is missing id')
  }

  if (!row.clientId) {
    throw new Error('Sale row is missing clientId')
  }

  if (!row.currency) {
    throw new Error('Sale row is missing currency')
  }

  const createdAtIso = toIsoDateTime(row.createdAt, 'createdAt')
  const updatedAtIso = toIsoDateTime(
    row.combinedUpdatedAt ?? row.createdAt,
    'updatedAt'
  )
  const dueAtIso = toIsoDateTime(row.dueAt, 'dueAt')

  return {
    id: row.id,
    clientId: row.clientId,
    createdAt: createdAtIso,
    updatedAt: updatedAtIso,
    dueAt: dueAtIso,
    paymentRequested:
      row.paymentRequestTime !== null &&
      row.paymentRequestTime !== undefined,
    paymentRequestPassOnTransactionFee:
      row.paymentRequestPassOnTransactionFee ?? false,
    total: formatMoney(row.totalAmount, 'total amount'),
    amountPaid: formatMoney(row.amountPaid, 'amount paid'),
    amountRefunded: formatMoney(row.amountRefunded, 'amount refunded'),
    currency: row.currency,
    note: row.note ?? '',
    clientSessionId: row.clientSessionId ?? null,
  }
}

const buildSaleProductSummary = () =>
  db
    .selectFrom('sale_product as saleProduct')
    .select(({ ref }) => [
      ref('saleProduct.sale_id').as('saleId'),
      sql<string>`
        TO_CHAR(
          COALESCE(SUM(${sql.ref('saleProduct.price')}), 0.00),
          'FM999999999990.00'
        )
      `.as('totalAmount'),
      sql<Date | null>`MAX(${sql.ref('saleProduct.updated_at')})`.as(
        'latestUpdatedAt'
      ),
    ])
    .groupBy('saleProduct.sale_id')
    .as('saleProductSummary')

const buildPaymentSummary = () =>
  db
    .selectFrom('payment as payment')
    .select(({ ref }) => [
      ref('payment.sale_id').as('saleId'),
      sql<string>`
        TO_CHAR(
          COALESCE(SUM(${sql.ref('payment.amount')}), 0.00),
          'FM999999999990.00'
        )
      `.as('totalPaid'),
      sql<string>`
        TO_CHAR(
          COALESCE(
            SUM(
              CASE
                WHEN ${sql.ref('payment.refunded_time')} IS NOT NULL THEN ${sql.ref('payment.amount')}
                ELSE 0
              END
            ),
            0.00
          ),
          'FM999999999990.00'
        )
      `.as('totalRefunded'),
      sql<Date | null>`MAX(${sql.ref('payment.updated_at')})`.as(
        'latestUpdatedAt'
      ),
    ])
    .groupBy('payment.sale_id')
    .as('paymentSummary')

const buildClientSessionSummary = () =>
  db
    .selectFrom('client_session as clientSession')
    .select(({ ref }) => [
      ref('clientSession.sale_id').as('saleId'),
      sql<string | null>`MAX(${sql.ref('clientSession.id')})`.as(
        'clientSessionId'
      ),
    ])
    .groupBy('clientSession.sale_id')
    .as('clientSessionSummary')

export const fetchSales = async (options: {
  trainerId: string
  clientId?: string
  updatedAfter?: Date
}): Promise<RawSaleRow[]> => {
  const saleProductSummary = buildSaleProductSummary()
  const paymentSummary = buildPaymentSummary()
  const clientSessionSummary = buildClientSessionSummary()

  const combinedUpdatedAt = sql<Date>`
    GREATEST(
      ${sql.ref('sale.updated_at')},
      COALESCE(${sql.ref('saleProductSummary.latestUpdatedAt')}, ${sql.ref('sale.updated_at')}),
      COALESCE(${sql.ref('paymentSummary.latestUpdatedAt')}, ${sql.ref('sale.updated_at')})
    )
  `

  let query = db
    .selectFrom('sale as sale')
    .innerJoin('trainer as trainer', 'trainer.id', 'sale.trainer_id')
    .innerJoin(
      'supported_country_currency as supportedCountryCurrency',
      'supportedCountryCurrency.country_id',
      'trainer.country_id'
    )
    .innerJoin(
      'currency as currency',
      'currency.id',
      'supportedCountryCurrency.currency_id'
    )
    .leftJoin(saleProductSummary, 'saleProductSummary.saleId', 'sale.id')
    .leftJoin(paymentSummary, 'paymentSummary.saleId', 'sale.id')
    .leftJoin(clientSessionSummary, 'clientSessionSummary.saleId', 'sale.id')
    .select(({ ref }) => [
      ref('sale.id').as('id'),
      ref('sale.client_id').as('clientId'),
      ref('sale.due_time').as('dueAt'),
      ref('sale.created_at').as('createdAt'),
      combinedUpdatedAt.as('combinedUpdatedAt'),
      ref('sale.payment_request_time').as('paymentRequestTime'),
      ref('sale.payment_request_pass_on_transaction_fee').as(
        'paymentRequestPassOnTransactionFee'
      ),
      ref('sale.note').as('note'),
      ref('currency.alpha_code').as('currency'),
      ref('saleProductSummary.totalAmount').as('totalAmount'),
      ref('paymentSummary.totalPaid').as('amountPaid'),
      ref('paymentSummary.totalRefunded').as('amountRefunded'),
      ref('clientSessionSummary.clientSessionId').as('clientSessionId'),
    ])
    .where('sale.trainer_id', '=', options.trainerId)

  if (options.clientId) {
    query = query.where('sale.client_id', '=', options.clientId)
  }

  const updatedAfter = options.updatedAfter

  if (updatedAfter) {
    query = query.where(({ eb }) => eb(combinedUpdatedAt, '>', updatedAfter))
  }

  return query.orderBy('sale.created_at', 'desc').execute() as Promise<
    RawSaleRow[]
  >
}
