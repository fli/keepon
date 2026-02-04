import { add } from 'date-fns'
import { NextResponse } from 'next/server'
import parseInterval from 'postgres-interval'
import { z } from 'zod'
import { db } from '@/lib/db'
import { authenticateTrainerRequest, buildErrorResponse } from '../_lib/accessToken'

const FALLBACK_TRIAL_DURATION = '14 days'
const LEGACY_INVALID_JSON_MESSAGE = 'Unexpected token \'"\', "#" is not valid JSON'

const intervalLiteralSchema = z
  .string()
  .trim()
  .regex(
    /^(?:[0-9]+\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?))(?:\s+[0-9]+\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?))*$/i,
    'DEFAULT_TRIAL_DURATION must be a valid PostgreSQL interval literal, e.g. "14 days".'
  )

const defaultTrialDuration = (() => {
  const raw = process.env.DEFAULT_TRIAL_DURATION
  if (!raw) {
    return FALLBACK_TRIAL_DURATION
  }

  const result = intervalLiteralSchema.safeParse(raw)
  if (!result.success) {
    console.warn(
      'DEFAULT_TRIAL_DURATION is invalid, falling back to "14 days". Issues:',
      result.error.issues.map((issue) => issue.message).join('; ')
    )
    return FALLBACK_TRIAL_DURATION
  }

  return result.data
})()

const trialResponseSchema = z.object({
  id: z.string().uuid(),
  trainerId: z.string().uuid(),
  startTime: z.string().datetime({ offset: true }),
  endTime: z.string().datetime({ offset: true }),
})

type TrialRow = z.infer<typeof trialResponseSchema>

const TRIAL_NOT_FOUND_ERROR = 'TRIAL_NOT_FOUND'

export async function POST(request: Request) {
  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const rawBody = await request.text()
    if (rawBody.trim().length > 0) {
      try {
        const parsed = JSON.parse(rawBody)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return NextResponse.json(
            buildErrorResponse({
              status: 400,
              title: LEGACY_INVALID_JSON_MESSAGE,
            }),
            { status: 400 }
          )
        }
      } catch {
        return NextResponse.json(
          buildErrorResponse({
            status: 400,
            title: LEGACY_INVALID_JSON_MESSAGE,
          }),
          { status: 400 }
        )
      }
    }
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while creating trial',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const trialRow = await db.transaction().execute(async (trx) => {
      const existingTrial = await trx
        .selectFrom('trial')
        .select(['id', 'trainer_id', 'start_time', 'end_time'])
        .where('trainer_id', '=', authorization.trainerId)
        .orderBy('end_time', 'desc')
        .executeTakeFirst()

      if (existingTrial) {
        return {
          id: existingTrial.id,
          trainerId: existingTrial.trainer_id,
          startTime: new Date(existingTrial.start_time).toISOString(),
          endTime: new Date(existingTrial.end_time).toISOString(),
        }
      }

      const interval = parseInterval(defaultTrialDuration)
      const now = new Date()
      const endTime = add(now, {
        years: interval.years,
        months: interval.months,
        days: interval.days,
        hours: interval.hours,
        minutes: interval.minutes,
        seconds: interval.seconds,
        milliseconds: interval.milliseconds,
      })

      const insertedTrial = await trx
        .insertInto('trial')
        .values({ trainer_id: authorization.trainerId, start_time: now, end_time: endTime })
        .returning(['id', 'trainer_id', 'start_time', 'end_time'])
        .executeTakeFirst()

      const trial = insertedTrial
        ? {
            id: insertedTrial.id,
            trainerId: insertedTrial.trainer_id,
            startTime: new Date(insertedTrial.start_time).toISOString(),
            endTime: new Date(insertedTrial.end_time).toISOString(),
          }
        : null

      if (!trial) {
        throw new Error(TRIAL_NOT_FOUND_ERROR)
      }

      return trial
    })

    const responseBody = trialResponseSchema.parse(trialRow)

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse trial data from database',
          detail: 'Trial data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    if (error instanceof Error && error.message === TRIAL_NOT_FOUND_ERROR) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Trial not found',
          detail: 'No trial information is available for the authenticated trainer.',
          type: '/trial-not-found',
        }),
        { status: 404 }
      )
    }

    console.error('Failed to create or fetch trial', {
      trainerId: authorization.ok ? authorization.trainerId : undefined,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to create or fetch trial',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
