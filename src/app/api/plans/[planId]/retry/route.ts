import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db, sql } from '@/lib/db'
import { authenticateClientRequest, buildErrorResponse } from '../../../_lib/accessToken'
import { parseStrictJsonBody } from '../../../_lib/strictJson'

type HandlerContext = { params: Promise<Record<string, string>> }

class SubscriptionNotFoundError extends Error {
  constructor() {
    super('Subscription not found')
    this.name = 'SubscriptionNotFoundError'
  }
}

export async function PUT(request: NextRequest, context: HandlerContext) {
  const parsedBody = await parseStrictJsonBody(request)
  if (!parsedBody.ok) {
    return parsedBody.response
  }

  const authorization = await authenticateClientRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while retrying subscription payments',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { planId } = await context.params

  try {
    const { attempted } = await db.transaction().execute(async (trx) => {
      const plan = await trx
        .selectFrom('payment_plan as plan')
        .select((eb) => [eb.ref('plan.status').as('status'), eb.ref('plan.end_').as('endDate')])
        .where('plan.id', '=', planId)
        .where('plan.client_id', '=', authorization.clientId)
        .executeTakeFirst()

      if (!plan) {
        throw new SubscriptionNotFoundError()
      }

      const outstandingPayments = await trx
        .selectFrom('payment_plan_payment as paymentPlanPayment')
        .innerJoin('payment_plan as planRecord', 'planRecord.id', 'paymentPlanPayment.payment_plan_id')
        .select((eb) => [eb.ref('paymentPlanPayment.id').as('id')])
        .where('paymentPlanPayment.payment_plan_id', '=', planId)
        .where('planRecord.client_id', '=', authorization.clientId)
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
          type: '/resource-not-found',
        }),
        { status: 404 }
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
