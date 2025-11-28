import { NextResponse } from 'next/server'
import { db } from '@keepon/db'
import { z, ZodError } from 'zod'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../_lib/accessToken'

export const runtime = 'nodejs'

const rewardSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  description: z.string(),
  claimed: z.boolean(),
})

const rewardListSchema = z.array(rewardSchema)

type RewardRow = {
  id: string
  type: string
  title: string
  description: string
  claimedAt: Date | null
}

const adaptRewardRow = (row: RewardRow) => ({
  id: row.id,
  type: row.type,
  title: row.title,
  description: row.description,
  claimed: row.claimedAt !== null,
})

export async function GET(request: Request) {
  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while fetching rewards',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
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
      .where('reward.trainer_id', '=', authorization.trainerId)
      .orderBy('reward.created_at', 'desc')
      .execute()

    const rewards = rewardListSchema.parse(
      rows.map(row =>
        adaptRewardRow({
          id: row.id,
          type: row.type,
          title: row.title,
          description: row.description,
          claimedAt: row.claimedAt,
        })
      )
    )

    return NextResponse.json(rewards)
  } catch (error) {
    if (error instanceof ZodError) {
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

    console.error('Failed to fetch rewards', error, {
      trainerId: authorization.trainerId,
    })

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

