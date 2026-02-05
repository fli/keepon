import type { NextRequest } from 'next/server'
import { addDays } from 'date-fns'
import { sql } from 'kysely'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { intervalFromDays } from '@/lib/db/values'
import { authenticateTrainerRequest, buildErrorResponse } from '../../_lib/accessToken'
import { parseStrictJsonBody } from '../../_lib/strictJson'
import { adaptRewardRow, rewardRowSchema, rewardSchema, rewardTypeSchema } from '../shared'

const paramsSchema = z.object({
  rewardId: z.string().trim().min(1, 'Reward id is required'),
})

const patchRequestBodySchema = z
  .object({
    claimed: z.boolean().optional(),
  })
  .strict()

const rewardStatusSchema = z.object({
  type: rewardTypeSchema,
  claimed: z.boolean(),
  subscriptionStatus: z.string().nullable(),
})

const REWARD_ALREADY_CLAIMED = 'REWARD_ALREADY_CLAIMED'
const INVALID_REWARD_STATE = 'INVALID_REWARD_STATE'
const UNSUPPORTED_REWARD_TYPE = 'UNSUPPORTED_REWARD_TYPE'

type HandlerContext = { params: Promise<{ rewardId: string }> }

export async function PATCH(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map((issue) => issue.message).join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid reward identifier',
        detail: detail || 'Request parameters did not match the expected reward identifier schema.',
        type: '/invalid-parameter',
      }),
      { status: 400 }
    )
  }

  let parsedBody: z.infer<typeof patchRequestBodySchema>
  const parsed = await parseStrictJsonBody(request)
  if (!parsed.ok) {
    return parsed.response
  }

  const bodyResult = patchRequestBodySchema.safeParse(parsed.data)

  if (!bodyResult.success) {
    const detail = bodyResult.error.issues.map((issue) => issue.message).join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid request body',
        detail: detail || 'Request body did not match the expected schema.',
        type: '/invalid-body',
      }),
      { status: 400 }
    )
  }

  parsedBody = bodyResult.data

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while updating reward',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { rewardId } = paramsResult.data

  try {
    const rewardRow = await db.transaction().execute(async (trx) => {
      const statusRow = await trx
        .selectFrom('reward')
        .innerJoin('vw_legacy_trainer', 'vw_legacy_trainer.id', 'reward.trainer_id')
        .select(['reward.type', 'reward.claimed_at', 'vw_legacy_trainer.subscription'])
        .where('reward.id', '=', rewardId)
        .where('reward.trainer_id', '=', authorization.trainerId)
        .executeTakeFirst()

      if (!statusRow) {
        return null
      }

      const subscriptionValue = statusRow.subscription
      const subscriptionRecord =
        subscriptionValue && typeof subscriptionValue === 'object' && !Array.isArray(subscriptionValue)
          ? (subscriptionValue as Record<string, unknown>)
          : null
      const subscriptionStatusValue = typeof subscriptionRecord?.status === 'string' ? subscriptionRecord.status : null

      const parsedStatus = rewardStatusSchema.safeParse({
        type: statusRow.type,
        claimed: statusRow.claimed_at !== null,
        subscriptionStatus:
          subscriptionStatusValue && subscriptionStatusValue.length > 0 ? subscriptionStatusValue : null,
      })

      if (!parsedStatus.success) {
        throw new Error(INVALID_REWARD_STATE)
      }

      const { type: currentType, claimed, subscriptionStatus } = parsedStatus.data

      const hasUpdates = Object.keys(parsedBody).length > 0

      if (!hasUpdates || (parsedBody.claimed === false && !claimed)) {
        // No state changes required
      } else if (parsedBody.claimed !== undefined && claimed) {
        throw new Error(REWARD_ALREADY_CLAIMED)
      } else if (parsedBody.claimed && !claimed) {
        let effectiveType = currentType

        if (subscriptionStatus === 'subscribed') {
          if (currentType === '1DayTrial') {
            effectiveType = '2TextCredits'
          } else if (currentType === '2DayTrial') {
            effectiveType = '3TextCredits'
          }

          if (effectiveType !== currentType) {
            await trx
              .updateTable('reward')
              .set({ type: effectiveType })
              .where('id', '=', rewardId)
              .where('trainer_id', '=', authorization.trainerId)
              .execute()
          }
        }

        if (effectiveType === '1DayTrial' || effectiveType === '2DayTrial') {
          const now = new Date()
          const trialRow = await trx
            .selectFrom('trial')
            .select(['id'])
            .where('end_time', '>', now)
            .where('trainer_id', '=', authorization.trainerId)
            .orderBy('end_time', 'desc')
            .executeTakeFirst()

          if (trialRow) {
            await trx
              .updateTable('trial')
              .set({
                end_time: sql<Date>`end_time + ${intervalFromDays(effectiveType === '1DayTrial' ? 1 : 2)}`,
              })
              .where('trial.id', '=', trialRow.id)
              .execute()
          } else {
            const startTime = now
            const endTime = addDays(now, effectiveType === '1DayTrial' ? 1 : 2)

            await trx
              .insertInto('trial')
              .values({
                trainer_id: authorization.trainerId,
                start_time: startTime,
                end_time: endTime,
              })
              .execute()
          }
        } else if (effectiveType === '2TextCredits' || effectiveType === '3TextCredits') {
          await trx
            .insertInto('sms_credit')
            .values({
              trainer_id: authorization.trainerId,
              amount: effectiveType === '2TextCredits' ? 2 : 3,
              source: 'reward',
            })
            .execute()
        } else {
          throw new Error(UNSUPPORTED_REWARD_TYPE)
        }

        await trx
          .updateTable('reward')
          .set({ claimed_at: new Date() })
          .where('id', '=', rewardId)
          .where('trainer_id', '=', authorization.trainerId)
          .execute()
      }

      const rewardResult = await trx
        .selectFrom('reward')
        .innerJoin('reward_type', 'reward.type', 'reward_type.type')
        .select((eb) => [
          eb.ref('reward.id').as('id'),
          eb.ref('reward.type').as('type'),
          eb.ref('reward_type.title').as('title'),
          eb.ref('reward_type.description').as('description'),
          eb.ref('reward.claimed_at').as('claimedAt'),
        ])
        .where('reward.id', '=', rewardId)
        .where('reward.trainer_id', '=', authorization.trainerId)
        .executeTakeFirst()

      return rewardResult ?? null
    })

    if (!rewardRow) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Reward not found',
          type: '/resource-not-found',
        }),
        { status: 404 }
      )
    }

    const parsedRewardRow = rewardRowSchema.parse(rewardRow)
    const responseBody = rewardSchema.parse(adaptRewardRow(parsedRewardRow))

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse reward data from database',
          detail: 'Reward data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    if (error instanceof Error) {
      if (error.message === REWARD_ALREADY_CLAIMED) {
        return NextResponse.json(
          buildErrorResponse({
            status: 409,
            title: 'Reward already claimed',
            detail: 'This reward has already been claimed.',
            type: '/reward-already-claimed',
          }),
          { status: 409 }
        )
      }

      if (error.message === INVALID_REWARD_STATE) {
        return NextResponse.json(
          buildErrorResponse({
            status: 500,
            title: 'Reward is in an invalid state',
            detail: 'Reward data did not match the expected schema for processing.',
            type: '/invalid-reward-state',
          }),
          { status: 500 }
        )
      }

      if (error.message === UNSUPPORTED_REWARD_TYPE) {
        return NextResponse.json(
          buildErrorResponse({
            status: 500,
            title: 'Unsupported reward type',
            detail: 'The reward type is not supported for claiming in this environment.',
            type: '/unsupported-reward-type',
          }),
          { status: 500 }
        )
      }
    }

    console.error('Failed to update reward', {
      trainerId: authorization.trainerId,
      rewardId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to update reward',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
