import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { authenticateTrainerRequest, buildErrorResponse } from '../_lib/accessToken'

const missionIdSchema = z.enum([
  'createInitialData',
  'createOnlineBooking',
  'completeStripeVerification',
  'createActiveSubscription',
  'enableNotifications',
])

const missionSchema = z.object({
  id: missionIdSchema,
  completed: z.boolean(),
  displayOrder: z.number(),
  rewardId: z.string().nullable(),
  rewardClaimed: z.boolean(),
  title: z.string(),
  description: z.string(),
  actionUrl: z.string().nullable(),
})

const missionListSchema = z.array(missionSchema)

type Mission = z.infer<typeof missionSchema>

type MissionRow = {
  id: string
  displayOrder: number
  rewardId: string | null
  completedAt: Date | null
  title: string
  description: string
  actionUrl: string | null
  rewardClaimedAt: Date | null
}

const adaptRowToMission = (row: MissionRow): Mission => ({
  id: missionIdSchema.parse(row.id),
  completed: row.completedAt !== null,
  displayOrder: Number(row.displayOrder),
  rewardId: row.rewardId,
  rewardClaimed: row.rewardClaimedAt !== null,
  title: row.title,
  description: row.description,
  actionUrl: row.actionUrl,
})

export async function GET(request: Request) {
  try {
    const authorization = await authenticateTrainerRequest(request, {
      extensionFailureLogMessage: 'Failed to extend access token expiry while fetching missions',
    })
    if (!authorization.ok) {
      return authorization.response
    }
    const { trainerId } = authorization

    const rows = await db
      .selectFrom('mission')
      .innerJoin('mission_type', 'mission_type.id', 'mission.id')
      .leftJoin('reward', 'reward.id', 'mission.reward_id')
      .select((eb) => [
        eb.ref('mission.id').as('id'),
        eb.ref('mission.display_order').as('displayOrder'),
        eb.ref('mission.reward_id').as('rewardId'),
        eb.ref('mission.completed_at').as('completedAt'),
        eb.ref('mission_type.title').as('title'),
        eb.ref('mission_type.description').as('description'),
        eb.ref('mission_type.action_url').as('actionUrl'),
        eb.ref('reward.claimed_at').as('rewardClaimedAt'),
      ])
      .where('mission.trainer_id', '=', trainerId)
      .orderBy('mission.display_order')
      .execute()

    const missionRows: MissionRow[] = rows.map((row) => ({
      id: row.id,
      displayOrder: row.displayOrder,
      rewardId: row.rewardId,
      completedAt: row.completedAt,
      title: row.title,
      description: row.description,
      actionUrl: row.actionUrl,
      rewardClaimedAt: row.rewardClaimedAt,
    }))

    const missions = missionListSchema.parse(missionRows.map((missionRow) => adaptRowToMission(missionRow)))

    return NextResponse.json(missions)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse mission data from database',
          detail: 'Mission data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }
    console.error('Failed to fetch missions', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch missions',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
