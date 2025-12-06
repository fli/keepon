import { NextRequest, NextResponse } from 'next/server'
import { db, sql } from '@/lib/db'
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

const nullableUrl = z.preprocess(
  (value) => {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      return trimmed.length === 0 ? null : trimmed
    }

    return value
  },
  z.union([z.string().url(), z.null()])
)

const nullableTrimmedString = z.preprocess(
  (value) => {
    if (value === undefined) return undefined
    if (value === null) return null
    if (typeof value === 'string') {
      const trimmed = value.trim()
      return trimmed.length === 0 ? null : trimmed
    }

    return value
  },
  z.union([z.string(), z.null()])
)

const trimmedStringToNull = z.preprocess(
  (value) => {
    if (value === undefined) return undefined
    if (typeof value === 'string') {
      const trimmed = value.trim()
      return trimmed.length === 0 ? null : trimmed
    }

    return value
  },
  z.union([z.string(), z.null()])
)

const requestBodySchema = z
  .object({
    imageURL: nullableUrl.optional(),
    location: nullableTrimmedString.optional(),
    reminderHours: z.union([z.literal(-1), z.number().positive()]).optional(),
    sessionColor: trimmedStringToNull.optional(),
    avatarName: trimmedStringToNull.optional(),
    sessionName: nullableTrimmedString.optional(),
    price: z.union([z.number().nonnegative(), z.null()]).optional(),
  })
  .strict()

class SessionSeriesNotFoundError extends Error {
  constructor() {
    super('Session series not found')
    this.name = 'SessionSeriesNotFoundError'
  }
}

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

export async function PUT(request: NextRequest, context: HandlerContext) {
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

  const { sessionSeriesId } = paramsResult.data

  let parsedBody: z.infer<typeof requestBodySchema>

  try {
    const rawText = await request.text()
    const rawBody: unknown = rawText.trim().length === 0 ? {} : (JSON.parse(rawText) as unknown)
    const validation = requestBodySchema.safeParse(rawBody)

    if (!validation.success) {
      const detail = validation.error.issues.map((issue) => issue.message).join('; ')

      return NextResponse.json(
        buildErrorResponse({
          status: 400,
          title: 'Invalid request body',
          detail: detail || 'Request body did not match the expected schema.',
          type: '/invalid-body',
        }),
        { status: 400 }
      )
    }

    parsedBody = validation.data
  } catch (error) {
    console.error('Failed to parse session series update request body', {
      sessionSeriesId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid JSON payload',
        detail: 'Request body must be valid JSON.',
        type: '/invalid-json',
      }),
      { status: 400 }
    )
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while updating session series',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const row = await db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom('session_series')
        .select('id')
        .where('id', '=', sessionSeriesId)
        .where('trainer_id', '=', authorization.trainerId)
        .executeTakeFirst()

      if (!existing) {
        throw new SessionSeriesNotFoundError()
      }

      const updateData: Record<string, unknown> = {}

      if (parsedBody.imageURL !== undefined) {
        updateData.icon_url = parsedBody.imageURL
      }

      if (parsedBody.location !== undefined) {
        updateData.location = parsedBody.location
      }

      if (parsedBody.sessionColor !== undefined) {
        updateData.color = parsedBody.sessionColor
      }

      if (parsedBody.avatarName !== undefined) {
        updateData.session_icon_id = parsedBody.avatarName
      }

      if (parsedBody.sessionName !== undefined) {
        updateData.name = parsedBody.sessionName
      }

      if (parsedBody.price !== undefined) {
        updateData.price = parsedBody.price
      }

      if (Object.keys(updateData).length > 0) {
        await trx
          .updateTable('session_series')
          .set(updateData)
          .where('id', '=', sessionSeriesId)
          .where('trainer_id', '=', authorization.trainerId)
          .executeTakeFirst()
      }

      if (parsedBody.reminderHours !== undefined) {
        const reminderInterval =
          parsedBody.reminderHours === -1
            ? sql`NULL`
            : sql`${Math.round(parsedBody.reminderHours * 60)} * '1 minute'::interval`

        await sql`
          UPDATE session
             SET service_provider_reminder_1 = ${reminderInterval},
                 service_provider_reminder_1_type = 'notification'
           WHERE session_series_id = ${sessionSeriesId}
             AND trainer_id = ${authorization.trainerId}
        `.execute(trx)
      }

      const updatedRow = await trx
        .selectFrom('vw_legacy_session_series_2 as series')
        .selectAll('series')
        .where('series.trainerId', '=', authorization.trainerId)
        .where('series.id', '=', sessionSeriesId)
        .executeTakeFirst()

      if (!updatedRow) {
        throw new SessionSeriesNotFoundError()
      }

      return updatedRow
    })

    const sessionSeries = normalizeSessionSeriesRow(row as RawSessionSeriesRow, 0)

    return NextResponse.json(sessionSeries)
  } catch (error) {
    if (error instanceof SessionSeriesNotFoundError) {
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

    console.error('Failed to update session series', {
      trainerId: authorization.trainerId,
      sessionSeriesId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to update session series',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
