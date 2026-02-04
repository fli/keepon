import type { NextRequest } from 'next/server'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { enqueueWorkflowTask } from '@/server/workflow/outbox'
import { authenticateClientRequest, buildErrorResponse } from '../../../_lib/accessToken'
import { parseStrictJsonBody } from '../../../_lib/strictJson'
import { normalizePlanRow, type RawPlanRow } from '../../shared'

const paramsSchema = z.object({
  planId: z.string().trim().min(1, 'planId must not be empty'),
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
  return realIp?.trim() ?? undefined
}

const joinName = (...parts: (string | null | undefined)[]) =>
  parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part && part.length > 0))
    .join(' ')

const isCancelled = (status: string | null) => status?.trim().toLowerCase() === 'cancelled'

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

  const parsedBody = await parseStrictJsonBody(request)
  if (!parsedBody.ok) {
    return parsedBody.response
  }

  const authorization = await authenticateClientRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while accepting subscription',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { planId } = paramsResult.data

  try {
    const plan = await db.transaction().execute(async (trx) => {
      const details = (await trx
        .selectFrom('payment_plan as plan')
        .innerJoin('client', 'client.id', 'plan.client_id')
        .innerJoin('trainer', 'trainer.id', 'plan.trainer_id')
        .select((eb) => [
          eb.ref('plan.status').as('status'),
          eb.ref('plan.name').as('name'),
          eb.ref('plan.amount').as('amount'),
          eb.ref('plan.end_').as('endDate'),
          eb.ref('client.stripe_customer_id').as('stripeCustomerId'),
          eb.ref('trainer.user_id').as('trainerUserId'),
          eb.ref('trainer.id').as('trainerId'),
          eb.ref('client.first_name').as('clientFirstName'),
          eb.ref('client.last_name').as('clientLastName'),
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

      const now = new Date()

      const missionResultPromise = trx
        .updateTable('mission')
        .set({ completed_at: now })
        .where('trainer_id', '=', details.trainerId)
        .where('completed_at', 'is', null)
        .where('id', '=', 'createActiveSubscription')
        .returning('id')
        .execute()

      const planRowPromise = trx
        .selectFrom('payment_plan')
        .select(['trainer_id', 'id', 'amount', 'end_', 'status'])
        .where('id', '=', planId)
        .where('client_id', '=', authorization.clientId)
        .where('trainer_id', '=', authorization.trainerId)
        .executeTakeFirst()

      const updatePlanPromise = trx
        .updateTable('payment_plan')
        .set((eb) => ({
          status: details.status === 'pending' ? 'active' : details.status,
          accepted_amount: eb.ref('amount'),
          accepted_end: eb.ref('end_'),
        }))
        .where('id', '=', planId)
        .where('client_id', '=', authorization.clientId)
        .where('trainer_id', '=', authorization.trainerId)
        .execute()

      const primaryNotification = {
        paymentPlanId: planId,
        title: clientName,
        body: `Terms Accepted\nAccepted the terms for Subscription: ${planName}`,
        messageType: 'success' as const,
        notificationType: 'general' as const,
        userId: details.trainerUserId,
      }

      const notifyPromise = enqueueWorkflowTask(trx, 'user.notify', primaryNotification, {
        dedupeKey: `user.notify:planAccept:${planId}:termsAccepted`,
      })

      const [missionResult, planRowSnapshot] = await Promise.all([
        missionResultPromise,
        planRowPromise,
        updatePlanPromise,
        notifyPromise,
      ])

      if (!planRowSnapshot) {
        throw new SubscriptionNotFoundError()
      }

      await trx
        .insertInto('payment_plan_acceptance')
        .values({
          trainer_id: planRowSnapshot.trainer_id,
          payment_plan_id: planRowSnapshot.id,
          date: now,
          ip_address: ipAddress ?? null,
          amount: planRowSnapshot.amount,
          end_: planRowSnapshot.end_,
        })
        .execute()

      const missionRow = missionResult.rows[0] ?? null

      if (missionRow) {
        const trainerStatusRow = await trx
          .selectFrom('vw_legacy_trainer')
          .select((eb) => eb.fn('json_extract_path_text', [eb.ref('subscription'), 'status']).as('status'))
          .where('id', '=', details.trainerId)
          .executeTakeFirst()

        const isSubscribed = trainerStatusRow?.status === 'subscribed'
        const rewardRow = !isSubscribed
          ? await trx
              .insertInto('reward')
              .values({ trainer_id: details.trainerId, type: '3TextCredits' })
              .returning('id')
              .executeTakeFirst()
          : null

        await Promise.all([
          rewardRow
            ? trx
                .updateTable('mission')
                .set({ reward_id: rewardRow.id })
                .where('trainer_id', '=', details.trainerId)
                .where('id', '=', missionRow.id)
                .execute()
            : Promise.resolve(),
          enqueueWorkflowTask(
            trx,
            'user.notify',
            {
              title: "You've sold your first subscription! 🎉",
              body: rewardRow
                ? 'Yay for recurring income! Claim your reward for completing a mission! 🎁'
                : "Yay, you've completed a mission!",
              userId: details.trainerUserId,
              messageType: 'success',
              notificationType: 'general',
            },
            {
              dedupeKey: `user.notify:planAccept:${planId}:firstSubscription`,
            }
          ),
        ])
      }

      try {
        await enqueueWorkflowTask(
          trx,
          'payment-plan.charge-outstanding',
          {
            paymentPlanId: planId,
            forScheduledTask: false,
          },
          {
            dedupeKey: `payment-plan.charge-outstanding:${planId}`,
          }
        )
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
          detail: 'A saved payment method is required before accepting this subscription.',
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

    console.error('Failed to accept subscription', {
      planId,
      clientId: authorization.clientId,
      trainerId: authorization.trainerId,
      error,
    })

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
