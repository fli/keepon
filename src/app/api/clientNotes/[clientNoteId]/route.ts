import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../../_lib/accessToken'
import {
  adaptClientNoteRow,
  clientNoteSchema,
  type ClientNoteRow,
} from '../shared'

const paramsSchema = z.object({
  clientNoteId: z
    .string()
    .trim()
    .min(1, 'Client note id is required')
    .uuid({ message: 'Client note id must be a valid UUID' }),
})

const patchRequestBodySchema = z
  .object({
    title: z.union([z.string(), z.null()]).optional(),
    body: z.union([z.string(), z.null()]).optional(),
  })
  .strict()

type HandlerContext = RouteContext<'/api/clientNotes/[clientNoteId]'>

const normalizeDeletedCount = (value: unknown) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value === 'bigint') {
    return Number(value)
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export async function GET(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues
      .map(issue => issue.message)
      .join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid client note identifier',
        detail:
          detail ||
          'Request parameters did not match the expected client note identifier schema.',
        type: '/invalid-parameter',
      }),
      { status: 400 }
    )
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while fetching client note',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { clientNoteId } = paramsResult.data

  try {
    const noteRow = (await db
      .selectFrom('client_note')
      .selectAll('client_note')
      .where('client_note.trainer_id', '=', authorization.trainerId)
      .where('client_note.id', '=', clientNoteId)
      .executeTakeFirst()) as ClientNoteRow | undefined

    if (!noteRow) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Client note not found',
          detail:
            'We could not find a client note with the specified identifier for the authenticated trainer.',
          type: '/client-note-not-found',
        }),
        { status: 404 }
      )
    }

    const responseBody = clientNoteSchema.parse(adaptClientNoteRow(noteRow))

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse client note data from database',
          detail:
            'Client note data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error(
      'Failed to fetch client note',
      authorization.trainerId,
      clientNoteId,
      error
    )

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch client note',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues
      .map(issue => issue.message)
      .join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid client note identifier',
        detail:
          detail ||
          'Request parameters did not match the expected client note identifier schema.',
        type: '/invalid-parameter',
      }),
      { status: 400 }
    )
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while deleting client note',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { clientNoteId } = paramsResult.data

  try {
    const deleteResult = await db
      .deleteFrom('client_note')
      .where('client_note.trainer_id', '=', authorization.trainerId)
      .where('client_note.id', '=', clientNoteId)
      .executeTakeFirst()

    const deletedCount = normalizeDeletedCount(
      deleteResult?.numDeletedRows ?? 0
    )

    if (deletedCount === 0) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Client note not found',
          detail:
            'We could not find a client note with the specified identifier for the authenticated trainer.',
          type: '/client-note-not-found',
        }),
        { status: 404 }
      )
    }

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    console.error('Failed to delete client note', error, {
      trainerId: authorization.trainerId,
      clientNoteId,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to delete client note',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues
      .map(issue => issue.message)
      .join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid client note identifier',
        detail:
          detail ||
          'Request parameters did not match the expected client note identifier schema.',
        type: '/invalid-parameter',
      }),
      { status: 400 }
    )
  }

  let parsedBody: z.infer<typeof patchRequestBodySchema>
  try {
    const rawBody = (await request.json()) as unknown
    const bodyResult = patchRequestBodySchema.safeParse(rawBody)

    if (!bodyResult.success) {
      const detail = bodyResult.error.issues
        .map(issue => issue.message)
        .join('; ')

      return NextResponse.json(
        buildErrorResponse({
          status: 400,
          title: 'Invalid request body',
          detail:
            detail || 'Request body did not match the expected schema.',
          type: '/invalid-body',
        }),
        { status: 400 }
      )
    }

    parsedBody = bodyResult.data
  } catch (error) {
    console.error('Failed to parse client note update request body', error)
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
      'Failed to extend access token expiry while updating client note',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { clientNoteId } = paramsResult.data

  const updatePayload: Partial<Pick<ClientNoteRow, 'title' | 'body'>> = {}
  let hasUpdates = false

  if (Object.prototype.hasOwnProperty.call(parsedBody, 'title')) {
    updatePayload.title = parsedBody.title ?? null
    hasUpdates = true
  }

  if (Object.prototype.hasOwnProperty.call(parsedBody, 'body')) {
    updatePayload.body = parsedBody.body ?? null
    hasUpdates = true
  }

  try {
    let noteRow: ClientNoteRow | undefined

    if (hasUpdates) {
      const updatedRow = await db
        .updateTable('client_note')
        .set(updatePayload)
        .where('client_note.trainer_id', '=', authorization.trainerId)
        .where('client_note.id', '=', clientNoteId)
        .returningAll()
        .executeTakeFirst()

      noteRow = updatedRow as ClientNoteRow | undefined
    } else {
      const existingRow = await db
        .selectFrom('client_note')
        .selectAll('client_note')
        .where('client_note.trainer_id', '=', authorization.trainerId)
        .where('client_note.id', '=', clientNoteId)
        .executeTakeFirst()

      noteRow = existingRow as ClientNoteRow | undefined
    }

    if (!noteRow) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Client note not found',
          detail:
            'We could not find a client note with the specified identifier for the authenticated trainer.',
          type: '/client-note-not-found',
        }),
        { status: 404 }
      )
    }

    const responseBody = clientNoteSchema.parse(adaptClientNoteRow(noteRow))

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse updated client note',
          detail:
            'Client note data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to update client note', error, {
      trainerId: authorization.trainerId,
      clientNoteId,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to update client note',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
