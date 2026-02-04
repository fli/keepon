import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { authenticateClientRequest, buildErrorResponse } from '../_lib/accessToken'

const paymentPlanPaymentStatusSchema = z.enum(['paid', 'cancelled', 'refunded', 'paused', 'pending', 'rejected'])

const isoDateTimeString = z.string().datetime({ offset: true })

const paymentPlanPaymentSchema = z.object({
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

const paymentPlanPaymentListSchema = z.array(paymentPlanPaymentSchema)

type PaymentPlanPaymentRow = {
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

  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null

  if (!date || Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${label} value in payment plan payment record`)
  }

  return date.toISOString()
}

const toOptionalIsoDateTime = (value: Date | string | null, label: string): string | null => {
  if (value === null) {
    return null
  }

  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null

  if (!date || Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${label} value in payment plan payment record`)
  }

  return date.toISOString()
}

const toAmountString = (value: string | number | null, label: string): string => {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${label} value in payment plan payment record`)
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Invalid ${label} value in payment plan payment record`)
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
      throw new TypeError('Invalid retry count value in payment plan payment record')
    }
    return value
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new Error('Empty retry count value in payment plan payment record')
  }

  const parsed = Number.parseInt(trimmed, 10)
  if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
    throw new TypeError('Invalid retry count value in payment plan payment record')
  }

  return parsed
}

const normalizeStatus = (status: string | null): PaymentPlanPayment['status'] => {
  if (!status) {
    throw new Error('Missing status value in payment plan payment record')
  }
  const trimmed = status.trim().toLowerCase()
  const parsed = paymentPlanPaymentStatusSchema.safeParse(trimmed)
  if (!parsed.success) {
    throw new Error(`Unexpected status value in payment plan payment record: ${status}`)
  }
  return parsed.data
}

const adaptRowToPaymentPlanPayment = (row: PaymentPlanPaymentRow): z.input<typeof paymentPlanPaymentSchema> => {
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

export async function GET(request: Request) {
  const url = new URL(request.url)
  const rawStatus = url.searchParams.get('status')
  const rawPaymentPlanId = url.searchParams.get('paymentPlanId')

  const normalizedStatus = rawStatus && rawStatus.trim().length > 0 ? rawStatus.trim().toLowerCase() : undefined
  const normalizedPaymentPlanId =
    rawPaymentPlanId && rawPaymentPlanId.trim().length > 0 ? rawPaymentPlanId.trim() : undefined

  const authorization = await authenticateClientRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while fetching payment plan payments',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    let query = db
      .selectFrom('payment_plan_payment')
      .innerJoin('payment_plan', 'payment_plan.id', 'payment_plan_payment.payment_plan_id')
      .innerJoin('trainer', 'trainer.id', 'payment_plan.trainer_id')
      .innerJoin('supported_country_currency', 'supported_country_currency.country_id', 'trainer.country_id')
      .innerJoin('currency', 'currency.id', 'supported_country_currency.currency_id')
      .select((eb) => [
        eb.ref('payment_plan_payment.created_at').as('createdAt'),
        eb.ref('payment_plan_payment.updated_at').as('updatedAt'),
        eb.ref('payment_plan_payment.id').as('id'),
        eb.ref('payment_plan_payment.payment_plan_id').as('paymentPlanId'),
        eb.ref('payment_plan_payment.date').as('dueAt'),
        eb.ref('payment_plan_payment.status').as('status'),
        eb.ref('payment_plan_payment.amount').as('amount'),
        eb.ref('payment_plan_payment.amount_outstanding').as('amountOutstanding'),
        eb.ref('payment_plan_payment.retry_count').as('retryCount'),
        eb.ref('payment_plan_payment.last_retry_time').as('lastRetriedAt'),
        eb.ref('currency.alpha_code').as('currency'),
      ])
      .where('payment_plan.client_id', '=', authorization.clientId)
      .where('payment_plan.trainer_id', '=', authorization.trainerId)

    if (normalizedStatus) {
      query = query.where('payment_plan_payment.status', '=', normalizedStatus)
    }

    if (normalizedPaymentPlanId) {
      query = query.where('payment_plan_payment.payment_plan_id', '=', normalizedPaymentPlanId)
    }

    const rows = (await query.orderBy('payment_plan_payment.created_at', 'desc').execute()) as PaymentPlanPaymentRow[]

    const payments = paymentPlanPaymentListSchema.parse(rows.map((row) => adaptRowToPaymentPlanPayment(row)))

    return NextResponse.json(payments)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse payment plan payment data from database',
          detail: 'Payment plan payment data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch payment plan payments', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Something on our end went wrong.',
      }),
      { status: 500 }
    )
  }
}
