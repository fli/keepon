import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { authenticateTrainerRequest, buildErrorResponse } from '../../../../_lib/accessToken'
import { financeItemNoteSchema } from '../../../shared'

const paramsSchema = z.object({
  financeItemId: z
    .string({ message: 'Finance item id is required.' })
    .trim()
    .min(1, 'Finance item id must not be empty.')
    .uuid({ message: 'Finance item id must be a valid UUID.' }),
  noteId: z.string({ message: 'Note id is required.' }).trim().min(1, 'Note id must not be empty.'),
})

const requestBodySchema = z.object({
  content: z.string({ message: 'content must be a string.' }),
})

type HandlerContext = { params: Promise<Record<string, string>> }

class FinanceItemNotFoundError extends Error {
  constructor() {
    super('Finance item not found')
    this.name = 'FinanceItemNotFoundError'
  }
}

export async function PUT(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map((issue) => issue.message).join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid path parameters',
        detail: detail || 'Finance item note path parameters did not match the expected schema.',
        type: '/invalid-path-parameters',
      }),
      { status: 400 }
    )
  }

  const { financeItemId } = paramsResult.data

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
    console.error('Failed to parse finance item note update request body', financeItemId, error)

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
    extensionFailureLogMessage: 'Failed to extend access token expiry while updating finance item note',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const updatedRow = await db
      .updateTable('finance_item')
      .set({
        note: parsedBody.content,
      })
      .where('id', '=', financeItemId)
      .where('trainer_id', '=', authorization.trainerId)
      .returning((eb) => [eb.ref('finance_item.note').as('note')])
      .executeTakeFirst()

    if (!updatedRow) {
      throw new FinanceItemNotFoundError()
    }

    const parsedNote = financeItemNoteSchema.parse({
      id: financeItemId,
      content: updatedRow.note ?? '',
      classification: 'financeItem' as const,
      financeItemId,
    })

    return NextResponse.json({
      ...parsedNote,
      content: parsedNote.content ?? '',
    })
  } catch (error) {
    if (error instanceof FinanceItemNotFoundError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Finance item not found',
          detail: 'We could not find a finance item with the specified identifier for the authenticated trainer.',
          type: '/finance-item-not-found',
        }),
        { status: 404 }
      )
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to validate finance item note response',
          detail: 'Finance item note response did not match the expected schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to update finance item note', {
      trainerId: authorization.trainerId,
      financeItemId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to update finance item note',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
