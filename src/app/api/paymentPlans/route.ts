import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { authenticateClientRequest, buildErrorResponse } from '../_lib/accessToken'
import {
  paymentPlanListSchema,
  paymentPlanStatusSchema,
  parseAmount,
  parseNumberValue,
  parseRequiredAmount,
  parseStatus,
  toIsoString,
  toOptionalIsoString,
  type PaymentPlanRow,
  type PaymentPlanStatus,
} from './shared'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const rawStatus = url.searchParams.get('status')
  const trimmedStatus = rawStatus?.trim() ?? ''

  let statusFilter: PaymentPlanStatus | undefined

  if (trimmedStatus.length > 0) {
    const statusParse = paymentPlanStatusSchema.safeParse(trimmedStatus.toLowerCase())
    if (!statusParse.success) {
      const allowedStatuses = paymentPlanStatusSchema.options.join(', ')
      return NextResponse.json(
        buildErrorResponse({
          status: 400,
          title: 'Invalid status parameter',
          detail: `Status must be one of: ${allowedStatuses}.`,
          type: '/invalid-query',
        }),
        { status: 400 }
      )
    }
    statusFilter = statusParse.data
  }

  const authorization = await authenticateClientRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while fetching payment plans',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    let query = db
      .selectFrom('payment_plan')
      .innerJoin('trainer', 'trainer.id', 'payment_plan.trainer_id')
      .innerJoin('supported_country_currency', 'supported_country_currency.country_id', 'trainer.country_id')
      .innerJoin('currency', 'currency.id', 'supported_country_currency.currency_id')
      .select((eb) => [
        eb.ref('payment_plan.id').as('id'),
        eb.ref('payment_plan.status').as('status'),
        eb.ref('payment_plan.created_at').as('createdAt'),
        eb.ref('payment_plan.updated_at').as('updatedAt'),
        eb.ref('payment_plan.start').as('startAt'),
        eb.ref('payment_plan.end_').as('requestedEndAt'),
        eb.ref('payment_plan.accepted_end').as('endAt'),
        eb.ref('payment_plan.frequency_weekly_interval').as('weeklyRecurrenceInterval'),
        eb.ref('payment_plan.name').as('name'),
        eb.ref('payment_plan.amount').as('requestedAmount'),
        eb.ref('payment_plan.accepted_amount').as('amount'),
        eb.ref('payment_plan.acceptance_request_time').as('requestSentAt'),
        eb.ref('currency.alpha_code').as('currency'),
      ])
      .where('payment_plan.client_id', '=', authorization.clientId)
      .where('payment_plan.trainer_id', '=', authorization.trainerId)

    if (statusFilter) {
      query = query.where('payment_plan.status', '=', statusFilter)
    }

    const rows = (await query.orderBy('payment_plan.created_at', 'desc').execute()) as PaymentPlanRow[]

    const paymentPlans = paymentPlanListSchema.parse(
      rows.map((row) => ({
        id: row.id,
        status: parseStatus(row.status),
        createdAt: toIsoString(row.createdAt),
        updatedAt: toIsoString(row.updatedAt),
        startAt: toIsoString(row.startAt),
        requestedEndAt: toIsoString(row.requestedEndAt),
        endAt: toOptionalIsoString(row.endAt),
        weeklyRecurrenceInterval: parseNumberValue(row.weeklyRecurrenceInterval, 'weekly recurrence interval'),
        name: row.name,
        requestedAmount: parseRequiredAmount(row.requestedAmount, 'requested amount'),
        amount: parseAmount(row.amount, 'accepted amount'),
        requestSentAt: toOptionalIsoString(row.requestSentAt),
        currency: row.currency,
      }))
    )

    return NextResponse.json(paymentPlans)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse payment plan data from database',
          detail: 'Payment plan data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch payment plans', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch payment plans',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
