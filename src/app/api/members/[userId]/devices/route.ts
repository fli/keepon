import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db, sql } from '@/lib/db'
import { authenticateTrainerRequest, buildErrorResponse } from '../../../_lib/accessToken'
import { parseStrictJsonBody } from '../../../_lib/strictJson'

const requestSchema = z.object({
  deviceToken: z.string().trim().min(1, 'Device token is required'),
  deviceType: z.literal('ios'),
})

const createInvalidParamsResponse = (detail?: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid member identifier',
      detail: detail ?? 'Request parameters did not match the expected member identifier schema.',
      type: '/invalid-parameter',
    }),
    { status: 400 }
  )

const createInvalidBodyResponse = (detail?: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid request body',
      detail: detail ?? 'Request body did not match the expected schema.',
      type: '/invalid-body',
    }),
    { status: 400 }
  )

const createInternalErrorResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Failed to register device',
      type: '/internal-server-error',
    }),
    { status: 500 }
  )

type HandlerContext = RouteContext<'/api/members/[userId]/devices'>

export async function POST(request: NextRequest, context: HandlerContext) {
  void context

  let parsedBody: z.infer<typeof requestSchema>
  const parsed = await parseStrictJsonBody(request)
  if (!parsed.ok) {
    return parsed.response
  }

  const validation = requestSchema.safeParse(parsed.data)
  if (!validation.success) {
    const detail = validation.error.issues.map((issue) => issue.message).join('; ')

    return createInvalidBodyResponse(detail || undefined)
  }

  parsedBody = validation.data

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while registering device',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    await db.transaction().execute(async (trx) => {
      await sql`
        INSERT INTO installation (user_id, user_type, device_token, device_type)
        VALUES (${authorization.userId}, 'trainer', ${parsedBody.deviceToken}, ${parsedBody.deviceType})
        ON CONFLICT (user_id, device_token) DO NOTHING
      `.execute(trx)

      const missionResult = await sql<{ id: string }>`
        UPDATE mission
           SET completed_at = NOW()
         WHERE trainer_id = ${authorization.trainerId}
           AND completed_at IS NULL
           AND id = 'enableNotifications'
        RETURNING id
      `.execute(trx)

      const missionRow = missionResult.rows[0]
      if (!missionRow) {
        return
      }

      const rewardResult = await sql<{ id: string }>`
        INSERT INTO reward (trainer_id, type)
        SELECT id, '1DayTrial'
          FROM vw_legacy_trainer
         WHERE subscription->>'status' != 'subscribed'
           AND id = ${authorization.trainerId}
        RETURNING id
      `.execute(trx)

      const rewardRow = rewardResult.rows[0] ?? null

      const notificationPayload = {
        title: "You've enabled notifications! 🎉",
        body: rewardRow ? 'Claim your reward for completing a mission! 🎁' : "Nice, you've completed a mission!",
        userId: authorization.userId,
        messageType: 'success',
        notificationType: 'general',
      } as const

      await Promise.all([
        rewardRow
          ? sql`
              UPDATE mission
                 SET reward_id = ${rewardRow.id}
               WHERE trainer_id = ${authorization.trainerId}
                 AND id = ${missionRow.id}
            `.execute(trx)
          : Promise.resolve(),
        sql`
          INSERT INTO task_queue (task_type, data)
          VALUES ('user.notify', ${JSON.stringify(notificationPayload)}::jsonb)
        `.execute(trx),
      ])
    })
  } catch (error) {
    console.error('Failed to register device for member', {
      memberId,
      userId: authorization.userId,
      trainerId: authorization.trainerId,
      error,
    })
    return createInternalErrorResponse()
  }

  return new Response(null, { status: 204 })
}
