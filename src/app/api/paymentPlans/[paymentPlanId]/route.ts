import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { authenticateClientRequest, buildErrorResponse } from '../../_lib/accessToken'
import {
  parseAmount,
  parseNumberValue,
  parseRequiredAmount,
  parseStatus,
  paymentPlanSchema,
  toIsoString,
  toOptionalIsoString,
  type PaymentPlanRow,
} from '../shared'

const paramsSchema = z.object({
  paymentPlanId: z.string().min(1),
})

type HandlerContext = RouteContext<'/api/paymentPlans/[paymentPlanId]'>

export async function GET(request: NextRequest, context: HandlerContext) {
  const parsedParams = paramsSchema.safeParse(await context.params)

  if (!parsedParams.success) {
    const detail = parsedParams.error.issues.map((issue) => issue.message).join('; ')
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid payment plan identifier',
        detail: detail || 'Request parameters did not match the expected payment plan schema.',
        type: '/invalid-parameter',
      }),
      { status: 400 }
    )
  }

  const { paymentPlanId } = parsedParams.data

  const authorization = await authenticateClientRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while fetching payment plan',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const row = (await db
      .selectFrom('payment_plan')
      .innerJoin('trainer', 'trainer.id', 'payment_plan.trainer_id')
      .innerJoin('supported_country_currency', 'supported_country_currency.country_id', 'trainer.country_id')
      .innerJoin('currency', 'currency.id', 'supported_country_currency.currency_id')
      .select(({ ref }) => [
        ref('payment_plan.id').as('id'),
        ref('payment_plan.status').as('status'),
        ref('payment_plan.created_at').as('createdAt'),
        ref('payment_plan.updated_at').as('updatedAt'),
        ref('payment_plan.start').as('startAt'),
        ref('payment_plan.end_').as('requestedEndAt'),
        ref('payment_plan.accepted_end').as('endAt'),
        ref('payment_plan.frequency_weekly_interval').as('weeklyRecurrenceInterval'),
        ref('payment_plan.name').as('name'),
        ref('payment_plan.amount').as('requestedAmount'),
        ref('payment_plan.accepted_amount').as('amount'),
        ref('payment_plan.acceptance_request_time').as('requestSentAt'),
        ref('currency.alpha_code').as('currency'),
      ])
      .where('payment_plan.id', '=', paymentPlanId)
      .where('payment_plan.client_id', '=', authorization.clientId)
      .where('payment_plan.trainer_id', '=', authorization.trainerId)
      .executeTakeFirst()) as PaymentPlanRow | undefined

    if (!row) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Subscription not found',
          detail: 'We could not find a subscription matching that identifier.',
          type: '/not-found',
        }),
        { status: 404 }
      )
    }

    const paymentPlan = paymentPlanSchema.parse({
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
    })

    return NextResponse.json(paymentPlan)
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

    console.error('Failed to fetch payment plan', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch payment plan',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
