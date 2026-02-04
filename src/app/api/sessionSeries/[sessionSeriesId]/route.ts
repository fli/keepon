import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { intervalFromMinutes } from '@/lib/db/values'
import { authenticateTrainerRequest, buildErrorResponse } from '../../_lib/accessToken'
import { normalizeSessionSeriesRow, type RawSessionSeriesRow } from '../shared'

type HandlerContext = RouteContext<'/api/sessionSeries/[sessionSeriesId]'>

const LEGACY_INVALID_JSON_MESSAGE = 'Unexpected token \'"\', "#" is not valid JSON'

const createLegacyInvalidJsonResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: LEGACY_INVALID_JSON_MESSAGE,
    }),
    { status: 400 }
  )

const createLegacyGenericErrorResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Something on our end went wrong.',
    }),
    { status: 500 }
  )

const createLegacyNotFoundResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 404,
      title: 'Appointment Series not found',
      type: '/resource-not-found',
    }),
    { status: 404 }
  )

const createLegacyInvalidParametersResponse = (detail: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Your parameters were invalid.',
      detail,
      type: '/invalid-parameters',
    }),
    { status: 400 }
  )

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
    if (value === undefined) {
      return undefined
    }
    if (value === null) {
      return null
    }
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
    if (value === undefined) {
      return undefined
    }
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
  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while fetching session series',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { sessionSeriesId } = await context.params

  try {
    const row = await db
      .selectFrom('vw_legacy_session_series_2 as series')
      .selectAll('series')
      .where('series.trainerId', '=', authorization.trainerId)
      .where('series.id', '=', sessionSeriesId)
      .executeTakeFirst()

    if (!row) {
      return createLegacyNotFoundResponse()
    }

    const sessionSeries = normalizeSessionSeriesRow(row as RawSessionSeriesRow, 0)

    return NextResponse.json(sessionSeries)
  } catch (error) {
    console.error('Failed to fetch session series', {
      trainerId: authorization.trainerId,
      sessionSeriesId,
      error,
    })
    return createLegacyGenericErrorResponse()
  }
}

export async function PUT(request: NextRequest, context: HandlerContext) {
  const { sessionSeriesId } = await context.params

  let parsedBody: z.infer<typeof requestBodySchema>

  try {
    const rawText = await request.text()
    const rawBody: unknown = rawText.trim().length === 0 ? {} : (JSON.parse(rawText) as unknown)

    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      return createLegacyInvalidJsonResponse()
    }
    const validation = requestBodySchema.safeParse(rawBody)

    if (!validation.success) {
      const detail = validation.error.issues.map((issue) => issue.message).join('; ')
      return createLegacyInvalidParametersResponse(detail || 'Your parameters were invalid.')
    }

    parsedBody = validation.data
  } catch (error) {
    console.error('Failed to parse session series update request body', {
      sessionSeriesId,
      error,
    })
    return createLegacyInvalidJsonResponse()
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
          parsedBody.reminderHours === -1 ? null : intervalFromMinutes(Math.round(parsedBody.reminderHours * 60))

        await trx
          .updateTable('session')
          .set({
            service_provider_reminder_1: reminderInterval,
            service_provider_reminder_1_type: 'notification',
          })
          .where('session_series_id', '=', sessionSeriesId)
          .where('trainer_id', '=', authorization.trainerId)
          .execute()
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
      return createLegacyNotFoundResponse()
    }

    console.error('Failed to update session series', {
      trainerId: authorization.trainerId,
      sessionSeriesId,
      error,
    })
    return createLegacyGenericErrorResponse()
  }
}
