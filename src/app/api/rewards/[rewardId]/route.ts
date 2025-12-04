import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db, sql } from '@/lib/db'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../../_lib/accessToken'
import {
  adaptRewardRow,
  rewardRowSchema,
  rewardSchema,
  rewardTypeSchema,
} from '../shared'

const paramsSchema = z.object({
  rewardId: z
    .string()
    .trim()
    .min(1, 'Reward id is required')
    .uuid({ message: 'Reward id must be a valid UUID' }),
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
    const detail = paramsResult.error.issues
      .map(issue => issue.message)
      .join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid reward identifier',
        detail:
          detail ||
          'Request parameters did not match the expected reward identifier schema.',
        type: '/invalid-parameter',
      }),
      { status: 400 }
    )
  }

  let parsedBody: z.infer<typeof patchRequestBodySchema>
  try {
    const rawBody = (await request.json()) as unknown
    const bodyResult = patchRequestBodySchema.safeParse(rawBody)

    if (!bodyResult.success) {
      const detail = bodyResult.error.issues
        .map(issue => issue.message)
        .join('; ')

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
  } catch (error) {
    console.error('Failed to parse reward update request body', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid JSON payload',
        detail: 'Request body must be valid JSON.',
        type: '/invalid-json',
      }),
      { status: 400 }
    )
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while updating reward',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { rewardId } = paramsResult.data

  try {
    const rewardRow = await db.transaction().execute(async trx => {
      const rewardStatusResult = await sql<{
        type: string
        claimed: boolean
        subscriptionStatus: string | null
      }>`
        SELECT
          reward.type,
          reward.claimed_at IS NOT NULL AS "claimed",
          vw_legacy_trainer.subscription->>'status' AS "subscriptionStatus"
        FROM reward
        JOIN vw_legacy_trainer ON vw_legacy_trainer.id = reward.trainer_id
        WHERE reward.id = ${rewardId}
          AND reward.trainer_id = ${authorization.trainerId}
      `.execute(trx)

      const statusRow = rewardStatusResult.rows[0] ?? null

      if (!statusRow) {
        return null
      }

      const parsedStatus = rewardStatusSchema.safeParse(statusRow)

      if (!parsedStatus.success) {
        throw new Error(INVALID_REWARD_STATE)
      }

      const { type: currentType, claimed, subscriptionStatus } =
        parsedStatus.data

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
            await sql`
              UPDATE reward
                 SET type = ${effectiveType}
               WHERE id = ${rewardId}
                 AND trainer_id = ${authorization.trainerId}
            `.execute(trx)
          }
        }

        if (effectiveType === '1DayTrial' || effectiveType === '2DayTrial') {
          const activeTrial = await sql<{ id: string }>`
            SELECT id
              FROM trial
             WHERE end_time > NOW()
               AND trainer_id = ${authorization.trainerId}
             ORDER BY end_time DESC
             LIMIT 1
          `.execute(trx)

          const trialRow = activeTrial.rows[0] ?? null

          if (trialRow) {
            await sql`
              UPDATE trial
                 SET end_time = end_time + ${
                   effectiveType === '1DayTrial' ? 1 : 2
                 } * '1 day'::interval
               WHERE trial.id = ${trialRow.id}
            `.execute(trx)
          } else {
            await sql`
              INSERT INTO trial (trainer_id, start_time, end_time)
              VALUES (
                ${authorization.trainerId},
                NOW(),
                NOW() + ${
                  effectiveType === '1DayTrial' ? 1 : 2
                } * '1 day'::interval
              )
            `.execute(trx)
          }
        } else if (
          effectiveType === '2TextCredits' ||
          effectiveType === '3TextCredits'
        ) {
          await sql`
            INSERT INTO sms_credit (trainer_id, amount, source)
            VALUES (
              ${authorization.trainerId},
              ${effectiveType === '2TextCredits' ? 2 : 3},
              'reward'
            )
          `.execute(trx)
        } else {
          throw new Error(UNSUPPORTED_REWARD_TYPE)
        }

        await sql`
          UPDATE reward
             SET claimed_at = NOW()
           WHERE id = ${rewardId}
             AND trainer_id = ${authorization.trainerId}
        `.execute(trx)
      }

      const rewardResult = await sql`
        SELECT
          reward.id,
          reward.type,
          reward_type.title,
          reward_type.description,
          reward.claimed_at AS "claimedAt"
        FROM reward
        JOIN reward_type ON reward.type = reward_type.type
        WHERE reward.id = ${rewardId}
          AND reward.trainer_id = ${authorization.trainerId}
      `.execute(trx)

      return rewardResult.rows[0] ?? null
    })

    if (!rewardRow) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Reward not found',
          detail:
            'We could not find a reward with the specified identifier for the authenticated trainer.',
          type: '/reward-not-found',
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
            detail:
              'Reward data did not match the expected schema for processing.',
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
            detail:
              'The reward type is not supported for claiming in this environment.',
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
