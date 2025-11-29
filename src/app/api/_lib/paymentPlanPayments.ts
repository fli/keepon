import { z } from 'zod'

export const paymentPlanPaymentStatusSchema = z.enum([
  'paid',
  'cancelled',
  'refunded',
  'paused',
  'pending',
  'rejected',
])

export const isoDateTimeString = z.string().datetime({ offset: true })

export const paymentPlanPaymentSchema = z.object({
  createdAt: isoDateTimeString,
  updatedAt: isoDateTimeString,
  id: z.string(),
  paymentPlanId: z.string(),
  dueAt: isoDateTimeString,
  status: paymentPlanPaymentStatusSchema,
  amount: z.string(),
  amountOutstanding: z.string(),
  retryCount: z.number(),
  lastRetriedAt: isoDateTimeString.nullable(),
  currency: z.string(),
})

export const paymentPlanPaymentListSchema = z.array(paymentPlanPaymentSchema)

export type PaymentPlanPaymentStatus = z.infer<
  typeof paymentPlanPaymentStatusSchema
>

export type PaymentPlanPaymentRow = {
  createdAt: Date | string | null
  updatedAt: Date | string | null
  id: string | null
  paymentPlanId: string | null
  dueAt: Date | string | null
  status: string | null
  amount: string | number | null
  amountOutstanding: string | number | null
  retryCount: number | string | null
  lastRetriedAt: Date | string | null
  currency: string | null
}

type PaymentPlanPayment = z.infer<typeof paymentPlanPaymentSchema>

const toIsoDateTime = (value: Date | string | null, label: string): string => {
  if (value === null) {
    throw new Error(`Missing ${label} value in payment plan payment record`)
  }

  const date =
    value instanceof Date
      ? value
      : typeof value === 'string'
        ? new Date(value)
        : null

  if (!date || Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${label} value in payment plan payment record`)
  }

  return date.toISOString()
}

const toOptionalIsoDateTime = (
  value: Date | string | null,
  label: string
): string | null => {
  if (value === null) {
    return null
  }

  const date =
    value instanceof Date
      ? value
      : typeof value === 'string'
        ? new Date(value)
        : null

  if (!date || Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${label} value in payment plan payment record`)
  }

  return date.toISOString()
}

const toAmountString = (
  value: string | number | null,
  label: string
): string => {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${label} value in payment plan payment record`)
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid ${label} value in payment plan payment record`)
    }
    return value.toFixed(2)
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new Error(`Empty ${label} value in payment plan payment record`)
  }

  return trimmed
}

const toRetryCount = (value: number | string | null): number => {
  if (value === null || value === undefined) {
    throw new Error('Missing retry count value in payment plan payment record')
  }

  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new Error('Invalid retry count value in payment plan payment record')
    }
    return value
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new Error('Empty retry count value in payment plan payment record')
  }

  const parsed = Number.parseInt(trimmed, 10)
  if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
    throw new Error('Invalid retry count value in payment plan payment record')
  }

  return parsed
}

const normalizeStatus = (
  status: string | null
): PaymentPlanPayment['status'] => {
  if (!status) {
    throw new Error('Missing status value in payment plan payment record')
  }
  const trimmed = status.trim().toLowerCase()
  const parsed = paymentPlanPaymentStatusSchema.safeParse(trimmed)
  if (!parsed.success) {
    throw new Error(
      `Unexpected status value in payment plan payment record: ${status}`
    )
  }
  return parsed.data
}

export const adaptPaymentPlanPaymentRow = (
  row: PaymentPlanPaymentRow
): z.input<typeof paymentPlanPaymentSchema> => {
  if (!row.id || !row.paymentPlanId || !row.currency) {
    throw new Error('Payment plan payment row is missing required fields')
  }

  return {
    id: row.id,
    paymentPlanId: row.paymentPlanId,
    currency: row.currency,
    createdAt: toIsoDateTime(row.createdAt, 'createdAt'),
    updatedAt: toIsoDateTime(row.updatedAt, 'updatedAt'),
    dueAt: toIsoDateTime(row.dueAt, 'dueAt'),
    status: normalizeStatus(row.status),
    amount: toAmountString(row.amount, 'amount'),
    amountOutstanding: toAmountString(row.amountOutstanding, 'amount outstanding'),
    retryCount: toRetryCount(row.retryCount),
    lastRetriedAt: toOptionalIsoDateTime(row.lastRetriedAt, 'last retried at'),
  }
}
