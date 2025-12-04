import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { authenticateTrainerRequest, buildErrorResponse } from '../_lib/accessToken'
import { adaptRewardRow, rewardListSchema, rewardRowSchema } from './shared'

export async function GET(request: Request) {
  try {
    const authorization = await authenticateTrainerRequest(request, {
      extensionFailureLogMessage: 'Failed to extend access token expiry while fetching rewards',
    })
    if (!authorization.ok) {
      return authorization.response
    }

    const { trainerId } = authorization

    const rows = await db
      .selectFrom('reward')
      .innerJoin('reward_type', 'reward_type.type', 'reward.type')
      .select(({ ref }) => [
        ref('reward.id').as('id'),
        ref('reward.type').as('type'),
        ref('reward_type.title').as('title'),
        ref('reward_type.description').as('description'),
        ref('reward.claimed_at').as('claimedAt'),
      ])
      .where('reward.trainer_id', '=', trainerId)
      .orderBy('reward.created_at', 'desc')
      .execute()

    const rewardRows = rows.map((row) =>
      rewardRowSchema.parse({
        id: row.id,
        type: row.type,
        title: row.title,
        description: row.description,
        claimedAt: row.claimedAt,
      })
    )

    const rewards = rewardListSchema.parse(rewardRows.map((rewardRow) => adaptRewardRow(rewardRow)))

    return NextResponse.json(rewards)
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

    console.error('Failed to fetch rewards', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch rewards',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
