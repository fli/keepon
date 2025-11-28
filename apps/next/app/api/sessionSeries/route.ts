import { NextResponse } from 'next/server'
import { db } from '@keepon/db'
import { z } from 'zod'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../_lib/accessToken'
import {
  normalizeSessionSeriesRow,
  type RawSessionSeriesRow,
} from './shared'

export const runtime = 'nodejs'

const querySchema = z.object({
  createdAfter: z
    .string()
    .trim()
    .min(1, 'createdAfter must not be empty')
    .pipe(
      z
        .string()
        .datetime({
          message: 'createdAfter must be a valid ISO 8601 date-time string',
        })
    )
    .transform(value => new Date(value))
    .optional(),
})

export async function GET(request: Request) {
  const url = new URL(request.url)
  const rawCreatedAfter = url.searchParams.get('createdAfter')
  const trimmedCreatedAfter = rawCreatedAfter?.trim()
  const parsedQuery = querySchema.safeParse({
    createdAfter:
      trimmedCreatedAfter && trimmedCreatedAfter.length > 0
        ? trimmedCreatedAfter
        : undefined,
  })

  if (!parsedQuery.success) {
    const detail = parsedQuery.error.issues
      .map(issue => issue.message)
      .join('; ')
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid query parameters',
        detail:
          detail || 'Request query parameters did not match the expected schema.',
        type: '/invalid-query',
      }),
      { status: 400 }
    )
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while fetching session series',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    let query = db
      .selectFrom('vw_legacy_session_series_2 as series')
      .selectAll('series')
      .where('series.trainerId', '=', authorization.trainerId)

    if (parsedQuery.data.createdAfter) {
      query = query.where(
        'series.createdAt',
        '>',
        parsedQuery.data.createdAfter
      )
    }

    const rows = (await query.execute()) as RawSessionSeriesRow[]

    const series = rows.map((row, index) =>
      normalizeSessionSeriesRow(row, index)
    )

    return NextResponse.json(series)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse session series data from database',
          detail: 'Session series data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch session series', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch session series',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
