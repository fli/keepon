import { NextRequest, NextResponse } from 'next/server'
import { db, sql, type Selectable, type VwLegacyPayment } from '@/lib/db'
import { z, ZodError } from 'zod'
import { authenticateTrainerRequest, buildErrorResponse } from '../../../../../_lib/accessToken'
import { normalizePlanRow, type RawPlanRow } from '../../../../../plans/shared'
import { paymentSchema } from '../../../../../_lib/clientSessionsSchema'

const paramsSchema = z.object({
  clientId: z.string().trim().min(1, 'Client id is required.').uuid({ message: 'Client id must be a valid UUID.' }),
  planId: z.string().trim().min(1, 'Plan id is required.').uuid({ message: 'Plan id must be a valid UUID.' }),
})

type HandlerContext = RouteContext<'/api/clients/[clientId]/plans/[planId]/cancel'>

class SubscriptionNotFoundError extends Error {
  constructor() {
    super('Subscription not found')
    this.name = 'SubscriptionNotFoundError'
  }
}

class SubscriptionAlreadyEndedError extends Error {
  constructor() {
    super('Subscription already ended')
    this.name = 'SubscriptionAlreadyEndedError'
  }
}

class PaymentDataMismatchError extends Error {
  constructor(message = 'Payment data mismatch') {
    super(message)
    this.name = 'PaymentDataMismatchError'
  }
}

const toDateOrThrow = (value: unknown, label: string): Date => {
  if (value === 'infinity' || value === Infinity) {
    return new Date(8640000000000000)
  }

  if (value === '-infinity' || value === -Infinity) {
    return new Date(-8640000000000000)
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`${label} is invalid`)
    }
    return value
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }
  }

  throw new Error(`${label} is invalid`)
}

type RawPaymentRow = Selectable<VwLegacyPayment>
type Payment = z.infer<typeof paymentSchema>

const adaptPaymentRow = (row: RawPaymentRow) => {
  if (!row.id) {
    throw new Error('Payment row is missing id')
  }

  if (!row.trainerId) {
    throw new Error('Payment row is missing trainer id')
  }

  if (!row.paymentType) {
    throw new Error('Payment row is missing payment type')
  }

  if (!row.status) {
    throw new Error('Payment row is missing status')
  }

  if (!row.clientSessionId) {
    throw new Error('Payment row is missing client session id')
  }

  if (!row.createdAt) {
    throw new Error('Payment row is missing createdAt')
  }

  if (!row.updatedAt) {
    throw new Error('Payment row is missing updatedAt')
  }

  const paidAmount = row.paidAmount === null || row.paidAmount === undefined ? 0 : row.paidAmount

  return paymentSchema.parse({
    trainerId: row.trainerId,
    id: row.id,
    paymentType: row.paymentType,
    contributionAmount: row.contributionAmount === null ? null : row.contributionAmount,
    paidAmount,
    paymentMethod: row.paymentMethod === null ? null : String(row.paymentMethod),
    paidDate: row.paidDate === null || row.paidDate === undefined ? null : (row.paidDate as Date | string),
    status: row.status,
    stripeCharge: row.stripeCharge ?? null,
    stripeRefund: row.stripeRefund ?? null,
    clientSessionId: row.clientSessionId,
    sessionPackId: row.sessionPackId ?? null,
    planId: row.planId ?? null,
    createdAt: row.createdAt as Date | string,
    updatedAt: row.updatedAt as Date | string,
  })
}

export async function POST(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map((issue) => issue.message).join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid path parameters',
        detail: detail || 'Request parameters did not match the expected schema.',
        type: '/invalid-path-parameters',
      }),
      { status: 400 }
    )
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while cancelling subscription',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { clientId, planId } = paramsResult.data

  try {
    const result = await db.transaction().execute(async (trx) => {
      const planDetails = await trx
        .selectFrom('payment_plan as plan')
        .select(({ ref }) => [ref('plan.status').as('status'), ref('plan.end_').as('end')])
        .where('plan.id', '=', planId)
        .where('plan.client_id', '=', clientId)
        .where('plan.trainer_id', '=', authorization.trainerId)
        .executeTakeFirst()

      if (!planDetails) {
        throw new SubscriptionNotFoundError()
      }

      const endDate = toDateOrThrow(planDetails.end, 'Subscription end date')

      if (planDetails.status === 'ended' || endDate.getTime() < Date.now()) {
        throw new SubscriptionAlreadyEndedError()
      }

      const updatedPlanRow = await trx
        .updateTable('payment_plan')
        .set({
          status: 'cancelled',
          end_: sql<Date>`NOW()`,
        })
        .where('id', '=', planId)
        .where('client_id', '=', clientId)
        .where('trainer_id', '=', authorization.trainerId)
        .returning(({ ref }) => [ref('payment_plan.id').as('id')])
        .executeTakeFirst()

      if (!updatedPlanRow) {
        throw new SubscriptionNotFoundError()
      }

      await Promise.all([
        sql`
          UPDATE payment_plan_pause
             SET end_ = NOW()
           WHERE payment_plan_id = ${planId}
        `.execute(trx),
        sql`
          UPDATE payment_plan_payment
             SET status = 'cancelled'
           WHERE payment_plan_id = ${planId}
             AND status IN ('rejected', 'pending', 'paused')
        `.execute(trx),
      ])

      const clientSessionUpdate = await sql<{ id: string }>`
        UPDATE client_session
           SET sale_id = NULL
          FROM session
          JOIN sale ON sale.id = client_session.sale_id
          JOIN payment ON payment.sale_id = sale.id
          JOIN payment_subscription ON payment_subscription.id = payment.id
         WHERE payment_subscription.subscription_id = ${planId}
           AND session.id = client_session.session_id
           AND session.start >= NOW()
           AND client_session.trainer_id = ${authorization.trainerId}
           AND client_session.client_id = ${clientId}
         RETURNING client_session.id
      `.execute(trx)

      const clientSessionIds = Array.from(
        new Set(
          clientSessionUpdate.rows.map((row) => row.id).filter((value): value is string => typeof value === 'string')
        )
      )

      const rawPlanRow = (await trx
        .selectFrom('vw_legacy_plan as v')
        .selectAll('v')
        .where('v.id', '=', planId)
        .where('v.trainerId', '=', authorization.trainerId)
        .executeTakeFirst()) as RawPlanRow | undefined

      if (!rawPlanRow) {
        throw new SubscriptionNotFoundError()
      }

      const plan = normalizePlanRow(rawPlanRow)

      if (clientSessionIds.length === 0) {
        return {
          plan,
          payments: [] as Payment[],
        }
      }

      const paymentRows = (await trx
        .selectFrom('vw_legacy_payment as p')
        .selectAll('p')
        .where('p.trainerId', '=', authorization.trainerId)
        .where('p.id', 'in', clientSessionIds)
        .execute()) as RawPaymentRow[]

      if (paymentRows.length !== clientSessionIds.length) {
        throw new PaymentDataMismatchError(
          `Expected ${clientSessionIds.length} payments, received ${paymentRows.length}`
        )
      }

      const payments = paymentRows.map((row) => adaptPaymentRow(row))

      return { plan, payments }
    })

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof SubscriptionNotFoundError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Subscription not found',
          detail: 'We could not find a subscription with the specified identifier for the authenticated trainer.',
          type: '/resource-not-found',
        }),
        { status: 404 }
      )
    }

    if (error instanceof SubscriptionAlreadyEndedError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'Subscription already ended',
          detail: 'Ended subscriptions cannot be cancelled.',
          type: '/subscription-already-ended',
        }),
        { status: 409 }
      )
    }

    if (error instanceof PaymentDataMismatchError) {
      console.error('Payment data mismatch while cancelling subscription', {
        trainerId: authorization.trainerId,
        clientId,
        planId,
        error: error.message,
      })

      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to retrieve subscription payments',
          detail: 'Updated client sessions did not match the expected payment records.',
          type: '/payment-data-mismatch',
        }),
        { status: 500 }
      )
    }

    if (error instanceof ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse subscription data from database',
          detail: 'Subscription or payment data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to cancel subscription', {
      trainerId: authorization.trainerId,
      clientId,
      planId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to cancel subscription',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
