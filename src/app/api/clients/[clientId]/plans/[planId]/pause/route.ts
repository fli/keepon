import { NextResponse } from 'next/server'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../../../../../_lib/accessToken'
import {
  normalizePlanRow,
  type RawPlanRow,
} from '../../../../../plans/shared'

export const runtime = 'nodejs'

const paramsSchema = z.object({
  clientId: z
    .string()
    .trim()
    .min(1, 'Client id is required')
    .uuid({ message: 'Client id must be a valid UUID.' }),
  planId: z
    .string()
    .trim()
    .min(1, 'Plan id is required')
    .uuid({ message: 'Plan id must be a valid UUID.' }),
})

type RouteContext = {
  params?: {
    clientId?: string
    planId?: string
  }
}

class SubscriptionNotFoundError extends Error {
  constructor() {
    super('Subscription not found')
    this.name = 'SubscriptionNotFoundError'
  }
}

class SubscriptionAlreadyPausedError extends Error {
  constructor() {
    super('Subscription already paused')
    this.name = 'SubscriptionAlreadyPausedError'
  }
}

class SubscriptionIsCancelledError extends Error {
  constructor() {
    super('Subscription is cancelled')
    this.name = 'SubscriptionIsCancelledError'
  }
}

class SubscriptionAlreadyEndedError extends Error {
  constructor() {
    super('Subscription already ended')
    this.name = 'SubscriptionAlreadyEndedError'
  }
}

class SubscriptionPendingAcceptanceError extends Error {
  constructor() {
    super('Subscription pending acceptance')
    this.name = 'SubscriptionPendingAcceptanceError'
  }
}

type PlanStatusRow = {
  status: string
  isPastEnd: boolean
}

export async function PUT(request: Request, context: RouteContext) {
  const paramsResult = paramsSchema.safeParse(context?.params ?? {})

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
          'Request parameters did not match the expected schema.',
        type: '/invalid-path-parameters',
      }),
      { status: 400 }
    )
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while pausing subscription',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { clientId, planId } = paramsResult.data

  try {
    const plan = await db.transaction().execute(async trx => {
      const planDetails = (await trx
        .selectFrom('payment_plan as plan')
        .select(({ ref }) => [
          ref('plan.status').as('status'),
          sql<boolean>`plan.end_ < NOW()`.as('isPastEnd'),
        ])
        .where('plan.id', '=', planId)
        .where('plan.client_id', '=', clientId)
        .where('plan.trainer_id', '=', authorization.trainerId)
        .executeTakeFirst()) as PlanStatusRow | undefined

      if (!planDetails) {
        throw new SubscriptionNotFoundError()
      }

      const { status, isPastEnd } = planDetails

      if (status === 'paused') {
        throw new SubscriptionAlreadyPausedError()
      }

      if (status === 'cancelled') {
        throw new SubscriptionIsCancelledError()
      }

      if (status === 'ended' && isPastEnd) {
        throw new SubscriptionAlreadyEndedError()
      }

      if (status === 'pending') {
        throw new SubscriptionPendingAcceptanceError()
      }

      await trx
        .insertInto('payment_plan_pause')
        .values({
          trainer_id: authorization.trainerId,
          payment_plan_id: planId,
          start: sql<Date>`NOW()`,
          end_: sql<Date>`'infinity'::timestamp with time zone`,
        })
        .execute()

      const updateResult = await trx
        .updateTable('payment_plan')
        .set({
          status: 'paused',
        })
        .where('id', '=', planId)
        .where('client_id', '=', clientId)
        .where('trainer_id', '=', authorization.trainerId)
        .returning(({ ref }) => [ref('payment_plan.id').as('id')])
        .executeTakeFirst()

      if (!updateResult) {
        throw new SubscriptionNotFoundError()
      }

      const rawPlanRow = (await trx
        .selectFrom('vw_legacy_plan as v')
        .selectAll('v')
        .where('v.id', '=', planId)
        .where('v.trainerId', '=', authorization.trainerId)
        .executeTakeFirst()) as RawPlanRow | undefined

      if (!rawPlanRow) {
        throw new SubscriptionNotFoundError()
      }

      return normalizePlanRow(rawPlanRow)
    })

    return NextResponse.json(plan)
  } catch (error) {
    if (error instanceof SubscriptionNotFoundError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Subscription not found',
          detail:
            'We could not find a subscription with the specified identifier for the authenticated trainer.',
          type: '/resource-not-found',
        }),
        { status: 404 }
      )
    }

    if (error instanceof SubscriptionAlreadyPausedError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'Subscription already paused',
          detail: 'This subscription is already paused.',
          type: '/subscription-already-paused',
        }),
        { status: 409 }
      )
    }

    if (error instanceof SubscriptionIsCancelledError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'Subscription is cancelled',
          detail: 'Cancelled subscriptions cannot be paused.',
          type: '/subscription-is-cancelled',
        }),
        { status: 409 }
      )
    }

    if (error instanceof SubscriptionAlreadyEndedError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'Subscription already ended',
          detail: 'Ended subscriptions cannot be paused.',
          type: '/subscription-already-ended',
        }),
        { status: 409 }
      )
    }

    if (error instanceof SubscriptionPendingAcceptanceError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'Subscription pending acceptance',
          detail: 'Pending subscriptions must be accepted before pausing.',
          type: '/subscription-pending-acceptance',
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
      'Failed to pause subscription',
      authorization.trainerId,
      clientId,
      planId,
      error
    )

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to pause subscription',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
