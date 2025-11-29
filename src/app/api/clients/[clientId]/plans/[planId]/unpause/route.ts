import { NextRequest, NextResponse } from 'next/server'
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

type HandlerContext = RouteContext<'/api/clients/[clientId]/plans/[planId]/unpause'>

class SubscriptionNotFoundError extends Error {
  constructor() {
    super('Subscription not found')
    this.name = 'SubscriptionNotFoundError'
  }
}

class SubscriptionNotPausedError extends Error {
  constructor() {
    super('Subscription is not paused.')
    this.name = 'SubscriptionNotPausedError'
  }
}

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
          'Request parameters did not match the expected schema.',
        type: '/invalid-path-parameters',
      }),
      { status: 400 }
    )
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while unpausing subscription',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { clientId, planId } = paramsResult.data

  try {
    const plan = await db.transaction().execute(async trx => {
      const planDetails = await trx
        .selectFrom('payment_plan as plan')
        .select(({ ref }) => [ref('plan.status').as('status')])
        .where('plan.id', '=', planId)
        .where('plan.client_id', '=', clientId)
        .where('plan.trainer_id', '=', authorization.trainerId)
        .executeTakeFirst()

      if (!planDetails) {
        throw new SubscriptionNotFoundError()
      }

      if (planDetails.status !== 'paused') {
        throw new SubscriptionNotPausedError()
      }

      await trx
        .updateTable('payment_plan_pause')
        .set({
          end_: sql<Date>`NOW()`,
        })
        .where('payment_plan_id', '=', planId)
        .where('trainer_id', '=', authorization.trainerId)
        .where('end_', '=', sql<Date>`'infinity'::timestamp with time zone`)
        .execute()

      const updatedPlan = await trx
        .updateTable('payment_plan')
        .set({
          status: 'active',
        })
        .where('id', '=', planId)
        .where('client_id', '=', clientId)
        .where('trainer_id', '=', authorization.trainerId)
        .returning(({ ref }) => [ref('payment_plan.id').as('id')])
        .executeTakeFirst()

      if (!updatedPlan) {
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

    if (error instanceof SubscriptionNotPausedError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'Subscription is not paused.',
          detail: 'Only paused subscriptions can be unpaused.',
          type: '/subscription-not-paused',
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

    console.error(
      'Failed to unpause subscription',
      authorization.trainerId,
      clientId,
      planId,
      error
    )

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to unpause subscription',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
