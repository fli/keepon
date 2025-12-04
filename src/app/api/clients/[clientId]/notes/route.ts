import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { authenticateTrainerRequest, buildErrorResponse } from '../../../_lib/accessToken'

const paramsSchema = z.object({
  clientId: z
    .string({ message: 'Client id is required.' })
    .trim()
    .min(1, 'Client id must not be empty.')
    .uuid({ message: 'Client id must be a valid UUID.' }),
})

const classificationSchema = z.enum(['notes', 'goals', 'medication', 'currentInjuries', 'pastInjuries'])

const contentSchema = z
  .union([
    z.string({ message: 'content must be a string or null.' }),
    z.null({ message: 'content must be a string or null.' }),
  ])
  .transform((value) => {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : null
    }
    return null
  })

const requestBodySchema = z.object({
  content: contentSchema,
  classification: classificationSchema,
})

const legacyClientNoteSchema = z.object({
  id: z.string(),
  content: z.string(),
  classification: classificationSchema,
  clientId: z.string(),
})

type HandlerContext = RouteContext<'/api/clients/[clientId]/notes'>

const toNumber = (value: unknown) => {
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

export async function POST(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map((issue) => issue.message).join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid client identifier',
        detail: detail || 'Request parameters did not match the expected client identifier schema.',
        type: '/invalid-parameter',
      }),
      { status: 400 }
    )
  }

  const { clientId } = paramsResult.data

  let parsedBody: z.infer<typeof requestBodySchema>

  try {
    const rawBody = (await request.json()) as unknown
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
  } catch (error) {
    console.error('Failed to parse client note update request body', {
      clientId,
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
    extensionFailureLogMessage: 'Failed to extend access token expiry while updating client notes',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const updateBase = db
      .updateTable('client')
      .where('id', '=', clientId)
      .where('trainer_id', '=', authorization.trainerId)

    const updateResult = await (() => {
      switch (parsedBody.classification) {
        case 'notes':
          return updateBase.set({ notes: parsedBody.content }).executeTakeFirst()
        case 'goals':
          return updateBase.set({ goals: parsedBody.content }).executeTakeFirst()
        case 'medication':
          return updateBase.set({ medication: parsedBody.content }).executeTakeFirst()
        case 'currentInjuries':
          return updateBase.set({ current_injuries: parsedBody.content }).executeTakeFirst()
        case 'pastInjuries':
          return updateBase.set({ past_injuries: parsedBody.content }).executeTakeFirst()
        default:
          return Promise.resolve({ numUpdatedRows: 0 })
      }
    })()

    const updatedCount = toNumber(updateResult?.numUpdatedRows ?? 0)

    if (updatedCount === 0) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Client not found',
          detail: 'We could not find a client with the specified identifier for the authenticated trainer.',
          type: '/client-not-found',
        }),
        { status: 404 }
      )
    }

    const responseBody = legacyClientNoteSchema.parse({
      id: `${clientId}${parsedBody.classification}`,
      content: parsedBody.content ?? '',
      classification: parsedBody.classification,
      clientId,
    })

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to validate client note response',
          detail: 'Client note response did not match the expected schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to update client note', {
      trainerId: authorization.trainerId,
      clientId,
      classification: parsedBody.classification,
      error,
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
