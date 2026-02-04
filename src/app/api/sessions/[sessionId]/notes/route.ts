import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { authenticateTrainerRequest, buildErrorResponse } from '../../../_lib/accessToken'
import { noteSchema } from '../../../_lib/clientSessionsSchema'

const paramsSchema = z.object({
  sessionId: z
    .string({ message: 'Session id is required.' })
    .trim()
    .min(1, 'Session id must not be empty.'),
})

const requestBodySchema = z.object({
  content: z
    .union([
      z.string({ message: 'content must be a string or null.' }).transform((value) => {
        const trimmed = value.trim()
        return trimmed.length > 0 ? trimmed : null
      }),
      z.null({ message: 'content must be a string or null.' }),
    ])
    .transform((value) => {
      if (typeof value === 'string') {
        const trimmed = value.trim()
        return trimmed.length > 0 ? trimmed : null
      }
      return null
    }),
})

type HandlerContext = RouteContext<'/api/sessions/[sessionId]/notes'>

class SessionNotFoundError extends Error {
  constructor() {
    super('Session not found')
    this.name = 'SessionNotFoundError'
  }
}

const LEGACY_INVALID_JSON_MESSAGE = 'Unexpected token \'"\\", "#" is not valid JSON'

const createLegacyInvalidJsonResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: LEGACY_INVALID_JSON_MESSAGE,
    }),
    { status: 400 }
  )

export async function POST(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map((issue) => issue.message).join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid path parameters',
        detail: detail || 'Session id parameter did not match the expected schema.',
        type: '/invalid-path-parameters',
      }),
      { status: 400 }
    )
  }

  const { sessionId } = paramsResult.data

  let parsedBody: z.infer<typeof requestBodySchema>
  let rawBody: unknown = {}
  const rawBodyText = await request.text()

  if (rawBodyText.trim().length > 0) {
    try {
      rawBody = JSON.parse(rawBodyText)
    } catch (error) {
      console.error('Failed to parse session note request body', sessionId, error)
      return createLegacyInvalidJsonResponse()
    }

    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      return createLegacyInvalidJsonResponse()
    }
  }

  const bodyResult = requestBodySchema.safeParse(rawBody)
  if (!bodyResult.success) {
    const detail = bodyResult.error.issues.map((issue) => issue.message).join('; ')

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

  parsedBody = bodyResult.data

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while updating session notes',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const noteRecord = await db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('session')
        .set({
          note: parsedBody.content,
        })
        .where('id', '=', sessionId)
        .where('trainer_id', '=', authorization.trainerId)
        .returning((eb) => [eb.ref('session.note').as('note')])
        .executeTakeFirst()

      if (!updated) {
        throw new SessionNotFoundError()
      }

      return {
        id: sessionId,
        content: updated.note ?? '',
        classification: 'notes',
        clientId: null,
        clientSessionId: null,
        financeItemId: null,
        sessionId,
        sessionSeriesId: null,
      }
    })

    const responseBody = noteSchema.parse(noteRecord)

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof SessionNotFoundError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Appointment not found',
          type: '/resource-not-found',
        }),
        { status: 404 }
      )
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to validate session note response',
          detail: 'Session note response did not match the expected schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to update session note', {
      trainerId: authorization.trainerId,
      sessionId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to update session note',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
