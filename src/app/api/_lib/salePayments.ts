import { z } from 'zod'

const moneyString = z.string().regex(/^-?\d+(?:\.\d{2})$/, 'Money values must be formatted with two decimal places')

const isoDateTimeString = z.string().datetime({ offset: true })

export const manualMethodSchema = z.enum(['cash', 'electronic'])

const baseSalePaymentSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  saleId: z.string(),
  amount: moneyString,
  amountRefunded: moneyString,
  currency: z.string(),
  createdAt: isoDateTimeString,
  updatedAt: isoDateTimeString,
  transactedAt: isoDateTimeString,
})

const stripeSalePaymentSchema = baseSalePaymentSchema.extend({
  type: z.literal('stripe'),
  transactionFee: moneyString,
})

const manualSalePaymentSchema = baseSalePaymentSchema.extend({
  type: z.literal('manual'),
  method: manualMethodSchema,
  specificMethodName: z.string().nullable(),
})

const creditPackSalePaymentSchema = baseSalePaymentSchema.extend({
  type: z.literal('creditPack'),
  creditsUsed: z.number().int().min(0),
  saleCreditPackId: z.string(),
})

const subscriptionSalePaymentSchema = baseSalePaymentSchema.extend({
  type: z.literal('subscription'),
  paymentPlanId: z.string(),
})

export const salePaymentSchema = z.union([
  stripeSalePaymentSchema,
  manualSalePaymentSchema,
  creditPackSalePaymentSchema,
  subscriptionSalePaymentSchema,
])

export type SalePayment = z.infer<typeof salePaymentSchema>
export type SalePaymentType = SalePayment['type']

export type SalePaymentRow = {
  id: string | null
  clientId: string | null
  saleId: string | null
  amount: string | number | null
  currency: string | null
  createdAt: Date | string | null
  paymentUpdatedAt: Date | string | null
  paymentManualUpdatedAt: Date | string | null
  paymentStripeUpdatedAt: Date | string | null
  paymentCreditPackUpdatedAt: Date | string | null
  paymentSubscriptionUpdatedAt: Date | string | null
  refundedTime: Date | string | null
  isManual: boolean | null
  isStripe: boolean | null
  isCreditPack: boolean | null
  isSubscription: boolean | null
  manualTransactionTime: Date | string | null
  manualMethod: string | null
  manualSpecificMethodName: string | null
  creditPackTransactionTime: Date | string | null
  creditPackCreditsUsed: number | string | null
  creditPackSaleCreditPackId: string | null
  stripeFee: string | number | null
  stripePaymentIntentObject: unknown
  stripeChargeObject: unknown
  subscriptionId: string | null
  subscriptionCreatedAt: Date | string | null
}

const ensureDate = (value: Date | string | null | undefined, label: string): Date => {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError(`Invalid ${label} value in sale payment record`)
    }
    return value
  }

  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) {
      throw new TypeError(`Invalid ${label} value in sale payment record`)
    }
    return parsed
  }

  if (value === null || value === undefined) {
    throw new Error(`Missing ${label} value in sale payment record`)
  }

  throw new Error(`Unsupported ${label} value type in sale payment record`)
}

const toIsoDateTime = (value: Date | string | null | undefined, label: string) => ensureDate(value, label).toISOString()

const formatMoney = (value: string | number | null | undefined, label: string): string => {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${label} value in sale payment record`)
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Invalid ${label} value in sale payment record`)
    }
    return value.toFixed(2)
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new Error(`Empty ${label} value in sale payment record`)
  }

  const numeric = Number.parseFloat(trimmed)
  if (!Number.isFinite(numeric)) {
    throw new TypeError(`Invalid ${label} value in sale payment record`)
  }

  return numeric.toFixed(2)
}

const parseInteger = (
  value: number | string | null | undefined,
  label: string,
  options: { minimum?: number } = {}
): number => {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${label} value in sale payment record`)
  }

  const numeric = typeof value === 'number' ? value : Number.parseFloat(String(value))

  if (!Number.isFinite(numeric)) {
    throw new TypeError(`Invalid ${label} value in sale payment record`)
  }

  const integer = Math.trunc(numeric)
  if (!Number.isInteger(integer)) {
    throw new TypeError(`Invalid ${label} value in sale payment record`)
  }

  if (options.minimum !== undefined && integer < options.minimum) {
    throw new Error(`${label} must be at least ${options.minimum} but was ${integer}`)
  }

  return integer
}

const parseStripeCreatedTimestamp = (value: unknown, label: string): Date | null => {
  if (!value || typeof value !== 'object') {
    return null
  }

  const created = (value as Record<string, unknown>).created

  if (created === null || created === undefined) {
    return null
  }

  if (typeof created === 'number') {
    if (!Number.isFinite(created)) {
      throw new TypeError(`Invalid ${label} created value in sale payment record`)
    }
    return new Date(created * 1000)
  }

  if (typeof created === 'string') {
    const trimmed = created.trim()
    if (trimmed.length === 0) {
      return null
    }

    const numeric = Number.parseFloat(trimmed)
    if (!Number.isFinite(numeric)) {
      throw new TypeError(`Invalid ${label} created value in sale payment record`)
    }

    return new Date(numeric * 1000)
  }

  return null
}

const determineType = (row: SalePaymentRow): SalePaymentType => {
  const flags: { type: SalePaymentType; value: boolean }[] = [
    { type: 'manual', value: row.isManual === true },
    { type: 'stripe', value: row.isStripe === true },
    { type: 'creditPack', value: row.isCreditPack === true },
    { type: 'subscription', value: row.isSubscription === true },
  ]

  const active = flags.filter((flag) => flag.value)

  if (active.length !== 1) {
    throw new Error('Sale payment row has unsupported type flags')
  }

  const selected = active[0]

  if (!selected) {
    throw new Error('Sale payment row is missing a detected type')
  }

  return selected.type
}

const determineUpdatedAt = (row: SalePaymentRow): string => {
  const candidates: { value: Date | string | null; label: string }[] = [
    { value: row.paymentUpdatedAt, label: 'payment updatedAt' },
    { value: row.paymentManualUpdatedAt, label: 'manual updatedAt' },
    { value: row.paymentStripeUpdatedAt, label: 'stripe updatedAt' },
    { value: row.paymentCreditPackUpdatedAt, label: 'credit pack updatedAt' },
    { value: row.paymentSubscriptionUpdatedAt, label: 'subscription updatedAt' },
  ]

  const dates = candidates
    .filter((candidate) => candidate.value !== null && candidate.value !== undefined)
    .map((candidate) => ensureDate(candidate.value, candidate.label))

  if (dates.length === 0) {
    throw new Error('Sale payment row is missing updated timestamps')
  }

  const latest = dates.reduce((max, current) => (current.getTime() > max.getTime() ? current : max))

  return latest.toISOString()
}

const determineTransactedAt = (row: SalePaymentRow, type: SalePaymentType, createdAt: Date): string => {
  switch (type) {
    case 'manual':
      return toIsoDateTime(row.manualTransactionTime, 'manual transaction time')
    case 'creditPack':
      return toIsoDateTime(row.creditPackTransactionTime, 'credit pack transaction time')
    case 'subscription':
      return toIsoDateTime(row.subscriptionCreatedAt, 'subscription transaction time')
    case 'stripe': {
      const fromIntent = parseStripeCreatedTimestamp(row.stripePaymentIntentObject, 'stripe payment intent')
      const fromCharge = parseStripeCreatedTimestamp(row.stripeChargeObject, 'stripe charge')
      const timestamp = fromIntent ?? fromCharge ?? createdAt
      return timestamp.toISOString()
    }
    default:
      throw new Error('Unsupported sale payment type')
  }
}

export const adaptSalePaymentRow = (row: SalePaymentRow): SalePayment => {
  if (!row.id || !row.clientId || !row.saleId || !row.currency) {
    throw new Error('Sale payment row is missing required identifiers')
  }

  const type = determineType(row)
  const createdAt = ensureDate(row.createdAt, 'createdAt')
  const amount = formatMoney(row.amount, 'amount')
  const amountRefunded =
    row.refundedTime !== null && row.refundedTime !== undefined ? formatMoney(row.amount, 'amount refunded') : '0.00'

  const base = {
    id: row.id,
    clientId: row.clientId,
    saleId: row.saleId,
    currency: row.currency,
    amount,
    amountRefunded,
    createdAt: createdAt.toISOString(),
    updatedAt: determineUpdatedAt(row),
    transactedAt: determineTransactedAt(row, type, createdAt),
  }

  if (type === 'manual') {
    if (!row.manualMethod) {
      throw new Error('Manual payment row is missing method')
    }

    const methodParse = manualMethodSchema.safeParse(row.manualMethod)
    if (!methodParse.success) {
      throw new Error('Manual payment row has unsupported method')
    }

    return {
      ...base,
      type,
      method: methodParse.data,
      specificMethodName: row.manualSpecificMethodName ?? null,
    }
  }

  if (type === 'stripe') {
    return {
      ...base,
      type,
      transactionFee: formatMoney(row.stripeFee, 'stripe transaction fee'),
    }
  }

  if (type === 'creditPack') {
    if (!row.creditPackSaleCreditPackId) {
      throw new Error('Credit pack payment row is missing sale credit pack id')
    }

    return {
      ...base,
      type,
      creditsUsed: parseInteger(row.creditPackCreditsUsed, 'credits used', {
        minimum: 0,
      }),
      saleCreditPackId: row.creditPackSaleCreditPackId,
    }
  }

  if (type === 'subscription') {
    if (!row.subscriptionId) {
      throw new Error('Subscription payment row is missing payment plan id')
    }

    return {
      ...base,
      type,
      paymentPlanId: row.subscriptionId,
    }
  }

  throw new Error('Sale payment row uses unsupported payment type')
}
