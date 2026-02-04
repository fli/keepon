import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db, sql } from '@/lib/db'
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
      const insertedTrial = await sql<TrialRow>`
        INSERT INTO trial (trainer_id, start_time, end_time)
        SELECT
          ${authorization.trainerId},
          NOW(),
          NOW() + ${defaultTrialDuration}::interval
        FROM unnest(
          CASE WHEN (
            SELECT
              TRUE
            FROM trial
            WHERE trainer_id = ${authorization.trainerId}
            LIMIT 1
          ) THEN
            NULL
          ELSE
            '{true}'::boolean[]
          END
        ) AS t(value)
        RETURNING
          id,
          trainer_id AS "trainerId",
          to_char(
            timezone('UTC', start_time),
            'YYYY-MM-DD"T"HH24:MI:SS"Z"'
          ) AS "startTime",
          to_char(
            timezone('UTC', end_time),
            'YYYY-MM-DD"T"HH24:MI:SS"Z"'
          ) AS "endTime"
      `.execute(trx)

      const createdTrial = insertedTrial.rows[0]
      if (createdTrial) {
        return createdTrial
      }

      const existingTrial = await sql<TrialRow>`
        SELECT
          id,
          trainer_id AS "trainerId",
          to_char(
            timezone('UTC', start_time),
            'YYYY-MM-DD"T"HH24:MI:SS"Z"'
          ) AS "startTime",
          to_char(
            timezone('UTC', end_time),
            'YYYY-MM-DD"T"HH24:MI:SS"Z"'
          ) AS "endTime"
        FROM trial
        WHERE trainer_id = ${authorization.trainerId}
        ORDER BY end_time DESC
        LIMIT 1
      `.execute(trx)

      const trial = existingTrial.rows[0]
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
