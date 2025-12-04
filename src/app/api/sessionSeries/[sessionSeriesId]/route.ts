import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { authenticateTrainerRequest, buildErrorResponse } from '../../_lib/accessToken'
import { normalizeSessionSeriesRow, type RawSessionSeriesRow } from '../shared'

const paramsSchema = z.object({
  sessionSeriesId: z
    .string()
    .trim()
    .min(1, 'Session series id is required')
    .uuid({ message: 'Session series id must be a valid UUID' }),
})

type HandlerContext = RouteContext<'/api/sessionSeries/[sessionSeriesId]'>

export async function GET(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map((issue) => issue.message).join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid session series identifier',
        detail: detail || 'Request parameters did not match the expected session series identifier schema.',
        type: '/invalid-parameter',
      }),
      { status: 400 }
    )
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while fetching session series',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { sessionSeriesId } = paramsResult.data

  try {
    const row = await db
      .selectFrom('vw_legacy_session_series_2 as series')
      .selectAll('series')
      .where('series.trainerId', '=', authorization.trainerId)
      .where('series.id', '=', sessionSeriesId)
      .executeTakeFirst()

    if (!row) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Session series not found',
          detail: 'We could not find a session series with the specified identifier for the authenticated trainer.',
          type: '/session-series-not-found',
        }),
        { status: 404 }
      )
    }

    const sessionSeries = normalizeSessionSeriesRow(row as RawSessionSeriesRow, 0)

    return NextResponse.json(sessionSeries)
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

    console.error('Failed to fetch session series', {
      trainerId: authorization.trainerId,
      sessionSeriesId,
      error,
    })

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
