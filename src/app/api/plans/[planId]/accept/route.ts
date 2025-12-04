import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { db, sql } from '@/lib/db'
import {
  authenticateClientRequest,
  buildErrorResponse,
} from '../../../_lib/accessToken'
import { normalizePlanRow, type RawPlanRow } from '../../shared'

const paramsSchema = z.object({
  planId: z
    .string()
    .trim()
    .min(1, 'planId must not be empty')
    .uuid({ message: 'planId must be a valid UUID' }),
})

type HandlerContext = { params: Promise<Record<string, string>> }

class SubscriptionNotFoundError extends Error {
  constructor() {
    super('Subscription not found')
    this.name = 'SubscriptionNotFoundError'
  }
}

class SubscriptionIsCancelledError extends Error {
  constructor() {
    super('Subscription is cancelled')
    this.name = 'SubscriptionIsCancelledError'
  }
}

class NoPaymentMethodOnFileError extends Error {
  constructor() {
    super('No payment method on file')
    this.name = 'NoPaymentMethodOnFileError'
  }
}

type PlanDetails = {
  status: string | null
  name: string | null
  amount: string | number | null
  endDate: Date | string | null
  stripeCustomerId: string | null
  trainerUserId: string | null
  trainerId: string | null
  clientFirstName: string | null
  clientLastName: string | null
}

const extractClientIp = async () => {
  const headerStore = await headers()
  const forwardedFor = headerStore.get('x-forwarded-for')
  if (forwardedFor) {
    const [first] = forwardedFor.split(',')
    const ip = first?.trim()
    if (ip) {
      return ip
    }
  }

  const realIp = headerStore.get('x-real-ip')
  return realIp?.trim() || undefined
}

const joinName = (...parts: Array<string | null | undefined>) =>
  parts
    .map(part => part?.trim())
    .filter((part): part is string => Boolean(part && part.length > 0))
    .join(' ')

const isCancelled = (status: string | null) =>
  status?.trim().toLowerCase() === 'cancelled'

export async function PUT(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues
      .map(issue => issue.message)
      .join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid path parameters',
        detail:
          detail ||
          'Request path parameters did not match the expected schema.',
        type: '/invalid-path',
      }),
      { status: 400 }
    )
  }

  const authorization = await authenticateClientRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while accepting subscription',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { planId } = paramsResult.data

  try {
    const plan = await db.transaction().execute(async trx => {
      const details = (await trx
        .selectFrom('payment_plan as plan')
        .innerJoin('client', 'client.id', 'plan.client_id')
        .innerJoin('trainer', 'trainer.id', 'plan.trainer_id')
        .select(({ ref }) => [
          ref('plan.status').as('status'),
          ref('plan.name').as('name'),
          ref('plan.amount').as('amount'),
          ref('plan.end_').as('endDate'),
          ref('client.stripe_customer_id').as('stripeCustomerId'),
          ref('trainer.user_id').as('trainerUserId'),
          ref('trainer.id').as('trainerId'),
          ref('client.first_name').as('clientFirstName'),
          ref('client.last_name').as('clientLastName'),
        ])
        .where('plan.id', '=', planId)
        .where('plan.client_id', '=', authorization.clientId)
        .where('plan.trainer_id', '=', authorization.trainerId)
        .executeTakeFirst()) as PlanDetails | undefined

      if (!details || !details.trainerId || !details.trainerUserId) {
        throw new SubscriptionNotFoundError()
      }

      if (isCancelled(details.status)) {
        throw new SubscriptionIsCancelledError()
      }

      if (!details.stripeCustomerId) {
        throw new NoPaymentMethodOnFileError()
      }

      const ipAddress = await extractClientIp()
      const clientName = joinName(details.clientFirstName, details.clientLastName)
      const planName = details.name ?? 'Subscription'

      const missionResultPromise = sql<{ id: string }>`
        UPDATE mission
           SET completed_at = NOW()
         WHERE trainer_id = ${details.trainerId}
           AND completed_at IS NULL
           AND id = 'createActiveSubscription'
        RETURNING id
      `.execute(trx)

      const acceptancePromise = sql`
        INSERT INTO payment_plan_acceptance (
          trainer_id,
          payment_plan_id,
          date,
          ip_address,
          amount,
          end_
        )
        SELECT
          trainer_id,
          id,
          NOW(),
          ${ipAddress ?? null},
          amount,
          end_
        FROM payment_plan
        WHERE id = ${planId}
          AND client_id = ${authorization.clientId}
          AND trainer_id = ${authorization.trainerId}
      `.execute(trx)

      const updatePlanPromise = sql`
        UPDATE payment_plan
           SET status = CASE status WHEN 'pending' THEN 'active' ELSE status END,
               accepted_amount = amount,
               accepted_end = end_
         WHERE id = ${planId}
           AND client_id = ${authorization.clientId}
           AND trainer_id = ${authorization.trainerId}
      `.execute(trx)

      const primaryNotification = {
        paymentPlanId: planId,
        title: clientName,
        body: `Terms Accepted\nAccepted the terms for Subscription: ${planName}`,
        messageType: 'success' as const,
        notificationType: 'general' as const,
        userId: details.trainerUserId,
      }

      const notifyPromise = sql`
        INSERT INTO task_queue (task_type, data)
        VALUES ('user.notify', ${JSON.stringify(primaryNotification)}::jsonb)
      `.execute(trx)

      const [missionResult] = await Promise.all([
        missionResultPromise,
        acceptancePromise,
        updatePlanPromise,
        notifyPromise,
      ])

      const missionRow = missionResult.rows[0] ?? null

      if (missionRow) {
        const rewardResult = await sql<{ id: string }>`
          INSERT INTO reward (trainer_id, type)
          SELECT id, '3TextCredits'
            FROM vw_legacy_trainer
           WHERE subscription->>'status' != 'subscribed'
             AND id = ${details.trainerId}
          RETURNING id
        `.execute(trx)

        const rewardRow = rewardResult.rows[0] ?? null

        await Promise.all([
          rewardRow
            ? sql`
                UPDATE mission
                   SET reward_id = ${rewardRow.id}
                 WHERE trainer_id = ${details.trainerId}
                   AND id = ${missionRow.id}
              `.execute(trx)
            : Promise.resolve(),
          sql`
            INSERT INTO task_queue (task_type, data)
            VALUES (
              'user.notify',
              ${JSON.stringify({
                title: "You've sold your first subscription! 🎉",
                body: rewardRow
                  ? 'Yay for recurring income! Claim your reward for completing a mission! 🎁'
                  : "Yay, you've completed a mission!",
                userId: details.trainerUserId,
                messageType: 'success',
                notificationType: 'general',
              })}::jsonb
            )
          `.execute(trx),
        ])
      }

      try {
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
      } catch (chargeError) {
        console.warn('Failed to enqueue outstanding charge for subscription acceptance', {
          planId,
          error: chargeError,
        })
      }

      const planRow = (await trx
        .selectFrom('vw_legacy_plan as v')
        .selectAll('v')
        .where('v.id', '=', planId)
        .where('v.trainerId', '=', authorization.trainerId)
        .executeTakeFirst()) as RawPlanRow | undefined

      if (!planRow) {
        throw new SubscriptionNotFoundError()
      }

      return normalizePlanRow(planRow)
    })

    return NextResponse.json(plan)
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

    if (error instanceof SubscriptionIsCancelledError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'Subscription is cancelled',
          detail: 'Cancelled subscriptions cannot be accepted.',
          type: '/subscription-is-cancelled',
        }),
        { status: 409 }
      )
    }

    if (error instanceof NoPaymentMethodOnFileError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'No payment method on file',
          detail:
            'A saved payment method is required before accepting this subscription.',
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
          detail:
            'Subscription data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error(
      'Failed to accept subscription',
      {
        planId,
        clientId: authorization.clientId,
        trainerId: authorization.trainerId,
        error,
      }
    )

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to accept subscription',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
