import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { enqueueWorkflowTask } from '@/server/workflow/outbox'
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
      await trx
        .insertInto('installation')
        .values({
          user_id: authorization.userId,
          user_type: 'trainer',
          device_token: parsedBody.deviceToken,
          device_type: parsedBody.deviceType,
        })
        .onConflict((oc) => oc.columns(['user_id', 'device_token']).doNothing())
        .execute()

      const missionRow = await trx
        .updateTable('mission')
        .set({ completed_at: new Date() })
        .where('trainer_id', '=', authorization.trainerId)
        .where('completed_at', 'is', null)
        .where('id', '=', 'enableNotifications')
        .returning('id')
        .executeTakeFirst()

      if (!missionRow) {
        return
      }

      const trainerRow = await trx
        .selectFrom('vw_legacy_trainer')
        .select(['id', 'subscription'])
        .where('id', '=', authorization.trainerId)
        .executeTakeFirst()

      const subscriptionValue = trainerRow?.subscription
      const subscriptionStatus =
        subscriptionValue && typeof subscriptionValue === 'object' && 'status' in subscriptionValue
          ? typeof (subscriptionValue as { status?: unknown }).status === 'string'
            ? (subscriptionValue as { status?: unknown }).status
            : null
          : null

      const rewardRow =
        subscriptionStatus === 'subscribed'
          ? null
          : await trx
              .insertInto('reward')
              .values({ trainer_id: authorization.trainerId, type: '1DayTrial' })
              .returning('id')
              .executeTakeFirst()

      const notificationPayload = {
        title: "You've enabled notifications! 🎉",
        body: rewardRow ? 'Claim your reward for completing a mission! 🎁' : "Nice, you've completed a mission!",
        userId: authorization.userId,
        messageType: 'success',
        notificationType: 'general',
      } as const

      await Promise.all([
        rewardRow
          ? trx
              .updateTable('mission')
              .set({ reward_id: rewardRow.id })
              .where('trainer_id', '=', authorization.trainerId)
              .where('id', '=', missionRow.id)
              .execute()
          : Promise.resolve(),
        enqueueWorkflowTask(trx, 'user.notify', notificationPayload, {
          dedupeKey: `user.notify:mission:${missionRow.id}:enableNotifications`,
        }),
      ])
    })
  } catch (error) {
    console.error('Failed to register device for member', {
      userId: authorization.userId,
      trainerId: authorization.trainerId,
      error,
    })
    return createInternalErrorResponse()
  }

  return new Response(null, { status: 204 })
}
