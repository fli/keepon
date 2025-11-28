import { NextResponse } from 'next/server'
import { db } from '@keepon/db'
import { z, ZodError } from 'zod'
import {
  authenticateClientRequest,
  buildErrorResponse,
} from '../_lib/accessToken'
import {
  adaptPaymentPlanPaymentRow,
  paymentPlanPaymentListSchema,
  paymentPlanPaymentStatusSchema,
  type PaymentPlanPaymentRow,
} from '../_lib/paymentPlanPayments'

export const runtime = 'nodejs'

const querySchema = z.object({
  status: paymentPlanPaymentStatusSchema.optional(),
  paymentPlanId: z
    .string()
    .trim()
    .min(1, 'paymentPlanId must not be empty')
    .optional(),
})

export async function GET(request: Request) {
  const url = new URL(request.url)
  const rawStatus = url.searchParams.get('status')
  const rawPaymentPlanId = url.searchParams.get('paymentPlanId')

  const normalizedStatus =
    rawStatus && rawStatus.trim().length > 0
      ? rawStatus.trim().toLowerCase()
      : undefined
  const normalizedPaymentPlanId =
    rawPaymentPlanId && rawPaymentPlanId.trim().length > 0
      ? rawPaymentPlanId.trim()
      : undefined

  const queryParse = querySchema.safeParse({
    status: normalizedStatus,
    paymentPlanId: normalizedPaymentPlanId,
  })

  if (!queryParse.success) {
    const detail = queryParse.error.issues
      .map(issue => issue.message)
      .join('; ')
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid query parameters',
        detail:
          detail ||
          'Request query parameters did not match the expected schema.',
        type: '/invalid-query',
      }),
      { status: 400 }
    )
  }

  const authorization = await authenticateClientRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while fetching payment plan payments',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    let query = db
      .selectFrom('payment_plan_payment')
      .innerJoin(
        'payment_plan',
        'payment_plan.id',
        'payment_plan_payment.payment_plan_id'
      )
      .innerJoin('trainer', 'trainer.id', 'payment_plan.trainer_id')
      .innerJoin(
        'supported_country_currency',
        'supported_country_currency.country_id',
        'trainer.country_id'
      )
      .innerJoin(
        'currency',
        'currency.id',
        'supported_country_currency.currency_id'
      )
      .select(({ ref }) => [
        ref('payment_plan_payment.created_at').as('createdAt'),
        ref('payment_plan_payment.updated_at').as('updatedAt'),
        ref('payment_plan_payment.id').as('id'),
        ref('payment_plan_payment.payment_plan_id').as('paymentPlanId'),
        ref('payment_plan_payment.date').as('dueAt'),
        ref('payment_plan_payment.status').as('status'),
        ref('payment_plan_payment.amount').as('amount'),
        ref('payment_plan_payment.amount_outstanding').as('amountOutstanding'),
        ref('payment_plan_payment.retry_count').as('retryCount'),
        ref('payment_plan_payment.last_retry_time').as('lastRetriedAt'),
        ref('currency.alpha_code').as('currency'),
      ])
      .where('payment_plan.trainer_id', '=', authorization.trainerId)
      .where('payment_plan.client_id', '=', authorization.clientId)

    const { status, paymentPlanId } = queryParse.data

    if (status) {
      query = query.where('payment_plan_payment.status', '=', status)
    }

    if (paymentPlanId) {
      query = query.where(
        'payment_plan_payment.payment_plan_id',
        '=',
        paymentPlanId
      )
    }

    const rows = (await query
      .orderBy('payment_plan_payment.created_at', 'desc')
      .execute()) as PaymentPlanPaymentRow[]

    const payments = paymentPlanPaymentListSchema.parse(
      rows.map(row => adaptPaymentPlanPaymentRow(row))
    )

    return NextResponse.json(payments)
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse payment plan payment data from database',
          detail:
            'Payment plan payment data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch payment plan payments', error, {
      trainerId: authorization.trainerId,
      clientId: authorization.clientId,
      status: queryParse.data.status ?? null,
      paymentPlanId: queryParse.data.paymentPlanId ?? null,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch payment plan payments',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
