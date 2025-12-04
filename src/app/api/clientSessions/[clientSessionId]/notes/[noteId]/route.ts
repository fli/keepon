import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../../../../_lib/accessToken'
import { noteSchema } from '../../../../_lib/clientSessionsSchema'

export const runtime = 'nodejs'

const paramsSchema = z.object({
  clientSessionId: z
    .string({ message: 'Client session id is required.' })
    .trim()
    .min(1, 'Client session id must not be empty.')
    .uuid({ message: 'Client session id must be a valid UUID.' }),
  noteId: z
    .string({ message: 'Note id is required.' })
    .trim()
    .min(1, 'Note id must not be empty.'),
})

const requestBodySchema = z.object({
  content: z
    .union([
      z
        .string({ message: 'content must be a string or null.' })
        .transform(value => {
          const trimmed = value.trim()
          return trimmed.length > 0 ? trimmed : null
        }),
      z.null({ message: 'content must be a string or null.' }),
    ])
    .transform(value => {
      if (typeof value === 'string') {
        const trimmed = value.trim()
        return trimmed.length > 0 ? trimmed : null
      }
      return null
    }),
})

type HandlerContext = { params: Promise<Record<string, string>> }

class ClientSessionNotFoundError extends Error {
  constructor() {
    super('Client session not found')
    this.name = 'ClientSessionNotFoundError'
  }
}

export async function PUT(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues
      .map(issue => issue.message)
      .join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid path parameters',
        detail:
          detail ||
          'Client session note path parameters did not match the expected schema.',
        type: '/invalid-path-parameters',
      }),
      { status: 400 }
    )
  }

  const { clientSessionId } = paramsResult.data

  let parsedBody: z.infer<typeof requestBodySchema>

  try {
    const rawBody = (await request.json()) as unknown
    const bodyResult = requestBodySchema.safeParse(rawBody)

    if (!bodyResult.success) {
      const detail = bodyResult.error.issues
        .map(issue => issue.message)
        .join('; ')

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
  } catch (error) {
    console.error(
      'Failed to parse client session note update request body',
      clientSessionId,
      error
    )

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
    extensionFailureLogMessage:
      'Failed to extend access token expiry while updating client session note',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const noteRecord = await db.transaction().execute(async trx => {
      const updated = await trx
        .updateTable('client_session')
        .set({
          note: parsedBody.content,
        })
        .where('id', '=', clientSessionId)
        .where('trainer_id', '=', authorization.trainerId)
        .returning(({ ref }) => [ref('client_session.note').as('note')])
        .executeTakeFirst()

      if (!updated) {
        throw new ClientSessionNotFoundError()
      }

      return {
        id: clientSessionId,
        content: updated.note ?? '',
        classification: 'notes',
        clientId: null,
        clientSessionId,
        financeItemId: null,
        sessionId: null,
        sessionSeriesId: null,
      }
    })

    const responseBody = noteSchema.parse(noteRecord)

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof ClientSessionNotFoundError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Client session not found',
          detail:
            'We could not find a client session with the specified identifier for the authenticated trainer.',
          type: '/client-session-not-found',
        }),
        { status: 404 }
      )
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to validate client session note response',
          detail:
            'Client session note response did not match the expected schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to update client session note', {
      trainerId: authorization.trainerId,
      clientSessionId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to update client session note',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
