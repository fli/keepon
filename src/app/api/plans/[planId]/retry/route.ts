import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db, sql } from '@/lib/db'
import { authenticateClientRequest, buildErrorResponse } from '../../../_lib/accessToken'

const paramsSchema = z.object({
  planId: z.string().trim().min(1, 'planId must not be empty').uuid({ message: 'planId must be a valid UUID' }),
})

type HandlerContext = { params: Promise<Record<string, string>> }

class SubscriptionNotFoundError extends Error {
  constructor() {
    super('Subscription not found')
    this.name = 'SubscriptionNotFoundError'
  }
}

class NoPaymentMethodOnFileError extends Error {
  constructor() {
    super('No payment method on file')
    this.name = 'NoPaymentMethodOnFileError'
  }
}

export async function PUT(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map((issue) => issue.message).join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid path parameters',
        detail: detail || 'Request path parameters did not match the expected schema.',
        type: '/invalid-path',
      }),
      { status: 400 }
    )
  }

  const authorization = await authenticateClientRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while retrying subscription payments',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { planId } = paramsResult.data

  try {
    const { attempted } = await db.transaction().execute(async (trx) => {
      const plan = await trx
        .selectFrom('payment_plan as plan')
        .innerJoin('client', 'client.id', 'plan.client_id')
        .select((eb) => [
          eb.ref('client.stripe_customer_id').as('stripeCustomerId'),
          eb.ref('plan.status').as('status'),
          eb.ref('plan.end_').as('endDate'),
        ])
        .where('plan.id', '=', planId)
        .where('plan.client_id', '=', authorization.clientId)
        .where('plan.trainer_id', '=', authorization.trainerId)
        .executeTakeFirst()

      if (!plan) {
        throw new SubscriptionNotFoundError()
      }

      if (!plan.stripeCustomerId) {
        throw new NoPaymentMethodOnFileError()
      }

      const outstandingPayments = await trx
        .selectFrom('payment_plan_payment as paymentPlanPayment')
        .innerJoin('payment_plan as planRecord', 'planRecord.id', 'paymentPlanPayment.payment_plan_id')
        .select((eb) => [eb.ref('paymentPlanPayment.id').as('id')])
        .where('paymentPlanPayment.payment_plan_id', '=', planId)
        .where('planRecord.client_id', '=', authorization.clientId)
        .where('planRecord.trainer_id', '=', authorization.trainerId)
        .where((eb) =>
          eb.or([
            eb.and([
              eb(eb.ref('paymentPlanPayment.status'), '=', 'pending'),
              eb(eb.ref('planRecord.status'), '=', 'active'),
              eb(eb.ref('planRecord.end_'), '>', sql<Date>`NOW()`),
            ]),
            eb(eb.ref('paymentPlanPayment.status'), '=', 'rejected'),
          ])
        )
        .where('paymentPlanPayment.date', '<=', sql<Date>`NOW()`)
        .where('paymentPlanPayment.amount_outstanding', '>', '0')
        .execute()

      await sql`
        INSERT INTO task_queue (task_type, data)
        VALUES (
          'payment-plan.charge-outstanding',
          ${JSON.stringify({
            paymentPlanId: planId,
            forScheduledTask: false,
          })}::jsonb
        )
      `.execute(trx)

      return { attempted: outstandingPayments.length }
    })

    return NextResponse.json({ attempted, succeeded: true })
  } catch (error) {
    if (error instanceof SubscriptionNotFoundError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Subscription not found',
          detail: 'We could not find a subscription matching that identifier.',
          type: '/resource-not-found',
        }),
        { status: 404 }
      )
    }

    if (error instanceof NoPaymentMethodOnFileError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'No payment method on file',
          detail: 'A saved payment method is required before retrying subscription charges.',
          type: '/no-payment-method-on-file',
        }),
        { status: 409 }
      )
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse subscription data from database',
          detail: 'Subscription data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to retry outstanding subscription payments', {
      planId,
      clientId: authorization.clientId,
      trainerId: authorization.trainerId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to retry subscription charges',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
