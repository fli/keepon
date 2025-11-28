import { NextResponse } from 'next/server'
import { db } from '@keepon/db'
import { z } from 'zod'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../_lib/accessToken'
import {
  adaptClientNoteRow,
  clientNoteListSchema,
  clientNoteSchema,
  type ClientNoteRow,
} from './shared'

export const runtime = 'nodejs'

const requestBodySchema = z
  .object({
    clientId: z
      .string()
      .min(1, 'clientId must not be empty')
      .transform(value => value.trim()),
    title: z
      .union([z.string(), z.null(), z.undefined()])
      .transform(value => {
        if (value === null || value === undefined) {
          return null
        }
        return value
      }),
    body: z
      .union([z.string(), z.null(), z.undefined()])
      .transform(value => {
        if (value === null || value === undefined) {
          return null
        }
        return value
      }),
  })
  .refine(data => data.clientId.length > 0, {
    message: 'clientId must not be empty',
    path: ['clientId'],
  })

const querySchema = z.object({
  clientId: z.string().min(1, 'clientId must not be empty').optional(),
})

export async function GET(request: Request) {
  const url = new URL(request.url)
  const rawClientId = url.searchParams.get('clientId')
  const trimmedClientId = rawClientId?.trim()

  const queryParse = querySchema.safeParse({
    clientId:
      trimmedClientId && trimmedClientId.length > 0 ? trimmedClientId : undefined,
  })

  if (!queryParse.success) {
    const detail = queryParse.error.issues.map(issue => issue.message).join('; ')
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
    extensionFailureLogMessage:
      'Failed to extend access token expiry while fetching client notes',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    let query = db
      .selectFrom('client_note')
      .selectAll('client_note')
      .where('client_note.trainer_id', '=', authorization.trainerId)

    const { clientId } = queryParse.data

    if (clientId) {
      query = query.where('client_note.client_id', '=', clientId)
    }

    const rows = (await query.execute()) as ClientNoteRow[]

    const notes = clientNoteListSchema.parse(
      rows.map(row => adaptClientNoteRow(row))
    )

    return NextResponse.json(notes)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse client note data from database',
          detail: 'Client note data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch client notes', error)

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch client notes',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  let parsedBody: z.infer<typeof requestBodySchema>

  try {
    const rawBody = (await request.json()) as unknown
    const result = requestBodySchema.safeParse(rawBody)
    if (!result.success) {
      const detail = result.error.issues
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
    parsedBody = result.data
  } catch (error) {
    console.error('Failed to parse client note request body', error)
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
      'Failed to extend access token expiry while creating client notes',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const inserted = await db
      .insertInto('client_note')
      .values({
        trainer_id: authorization.trainerId,
        client_id: parsedBody.clientId,
        title: parsedBody.title,
        body: parsedBody.body,
      })
      .returningAll()
      .executeTakeFirst()

    if (!inserted) {
      console.error('Insert client note returned no rows')
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to create client note',
          type: '/internal-server-error',
        }),
        { status: 500 }
      )
    }

    const responseBody = clientNoteSchema.parse(
      adaptClientNoteRow(inserted as ClientNoteRow)
    )

    return NextResponse.json(responseBody, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse created client note',
          detail:
            'Client note data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to create client note', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to create client note',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
