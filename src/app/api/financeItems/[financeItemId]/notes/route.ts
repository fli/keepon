import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { authenticateTrainerRequest, buildErrorResponse } from '../../../_lib/accessToken'
import { parseStrictJsonBody } from '../../../_lib/strictJson'
import { financeItemNoteSchema } from '../../shared'

const paramsSchema = z.object({
  financeItemId: z
    .string({ message: 'Finance item id is required.' })
    .trim()
    .min(1, 'Finance item id must not be empty.')
    .uuid({ message: 'Finance item id must be a valid UUID.' }),
})

const requestBodySchema = z.object({
  content: z.string({ message: 'content must be a string.' }),
})

type HandlerContext = RouteContext<'/api/financeItems/[financeItemId]/notes'>

class FinanceItemNotFoundError extends Error {
  constructor() {
    super('Finance item not found')
    this.name = 'FinanceItemNotFoundError'
  }
}

export async function POST(request: NextRequest, context: HandlerContext) {
  const parsedJson = await parseStrictJsonBody(request)
  if (!parsedJson.ok) {
    return parsedJson.response
  }

  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map((issue) => issue.message).join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid finance item identifier',
        detail: detail || 'Request parameters did not match the expected finance item identifier schema.',
        type: '/invalid-parameter',
      }),
      { status: 400 }
    )
  }

  const { financeItemId } = paramsResult.data

  let parsedBody: z.infer<typeof requestBodySchema>

  const bodyResult = requestBodySchema.safeParse(parsedJson.data)
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
          type: '/resource-not-found',
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
