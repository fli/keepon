import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import type { RawSessionRow } from './shared'
import { authenticateTrainerRequest, buildErrorResponse } from '../_lib/accessToken'
import { sessionListSchema, adaptSessionRow } from './shared'

const querySchema = z.object({
  sessionSeriesId: z.string().trim().min(1, 'sessionSeriesId must not be empty').optional(),
  updatedAfter: z
    .string()
    .trim()
    .min(1, 'updatedAfter must not be empty')
    .pipe(
      z.string().datetime({
        message: 'updatedAfter must be a valid ISO date-time string',
      })
    )
    .transform((value) => new Date(value))
    .optional(),
})

export async function GET(request: Request) {
  const url = new URL(request.url)
  const queryParams = {
    sessionSeriesId: url.searchParams.get('sessionSeriesId') ?? undefined,
    updatedAfter: url.searchParams.get('updatedAfter') ?? undefined,
  }

  const parsedQuery = querySchema.safeParse(queryParams)

  if (!parsedQuery.success) {
    const detail = parsedQuery.error.issues.map((issue) => issue.message).join('; ')
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid query parameters',
        detail: detail || 'Request query parameters did not match the expected schema.',
        type: '/invalid-query',
      }),
      { status: 400 }
    )
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while fetching sessions',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const { sessionSeriesId, updatedAfter } = parsedQuery.data

    let query = db
      .selectFrom('vw_legacy_session_2 as v')
      .innerJoin('session as s', 's.id', 'v.id')
      .selectAll('v')
      .where('s.trainer_id', '=', authorization.trainerId)

    if (sessionSeriesId) {
      query = query.where('s.session_series_id', '=', sessionSeriesId)
    }

    if (updatedAfter) {
      query = query.where('s.updated_at', '>', updatedAfter)
    }

    const rows = (await query.orderBy('s.start', 'asc').execute()) as RawSessionRow[]

    const sessions = sessionListSchema.parse(rows.map(adaptSessionRow))

    return NextResponse.json(sessions)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse session data from database',
          detail: 'Session data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch sessions', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch sessions',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
