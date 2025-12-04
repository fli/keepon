import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { authenticateTrainerRequest, buildErrorResponse } from '../../_lib/accessToken'
import { adaptFinanceItemRow, financeItemSchema, type FinanceItemRow } from '../shared'

const paramsSchema = z.object({
  financeItemId: z.string().trim().min(1, 'Finance item id is required'),
})

const deleteResponseSchema = z.object({
  count: z.number().int().nonnegative(),
})

const requestBodySchema = z
  .object({
    name: z.string({ message: 'name must be a string.' }).trim().min(1, 'name must not be empty.').optional(),
    amount: z
      .number({ message: 'amount must be a number.' })
      .refine(Number.isFinite, { message: 'amount must be a finite number.' })
      .optional(),
    startDate: z
      .union([z.string(), z.date()])
      .transform((value) => {
        const date = value instanceof Date ? value : new Date(value)
        if (Number.isNaN(date.getTime())) {
          throw new Error('startDate must be a valid date-time value.')
        }
        return date
      })
      .optional(),
    imageUrl: z.literal(null).optional(),
  })
  .strict()

type HandlerContext = RouteContext<'/api/financeItems/[financeItemId]'>

class FinanceItemNotFoundError extends Error {
  constructor() {
    super('Finance item not found')
    this.name = 'FinanceItemNotFoundError'
  }
}

export async function GET(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map((issue) => issue.message).join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid path parameters',
        detail: detail || 'Finance item identifier parameter did not match the expected schema.',
        type: '/invalid-path-parameters',
      }),
      { status: 400 }
    )
  }

  const { financeItemId } = paramsResult.data

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while fetching finance item',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const row = (await db
      .selectFrom('vw_legacy_finance_item as v')
      .select(({ ref }) => [
        ref('v.id').as('id'),
        ref('v.trainerId').as('trainerId'),
        ref('v.amount').as('amount'),
        ref('v.imageUrl').as('imageUrl'),
        ref('v.name').as('name'),
        ref('v.status').as('status'),
        ref('v.paymentType').as('paymentType'),
        ref('v.stripeApplicationFeeId').as('stripeApplicationFeeId'),
        ref('v.startDate').as('startDate'),
        ref('v.createdAt').as('createdAt'),
        ref('v.updatedAt').as('updatedAt'),
      ])
      .where('v.trainerId', '=', authorization.trainerId)
      .where('v.id', '=', financeItemId)
      .executeTakeFirst()) as FinanceItemRow | undefined

    if (!row) {
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

    const financeItem = financeItemSchema.parse(adaptFinanceItemRow(row))

    return NextResponse.json(financeItem)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse finance item data from database',
          detail: 'Finance item data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch finance item', authorization.trainerId, financeItemId, error)

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch finance item',
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
        title: 'Invalid path parameters',
        detail: detail || 'Finance item identifier parameter did not match the expected schema.',
        type: '/invalid-path-parameters',
      }),
      { status: 400 }
    )
  }

  const { financeItemId } = paramsResult.data

  if (financeItemId.startsWith('ch_')) {
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Finance item cannot be modified',
        detail: "Can't modify a commission.",
        type: '/invalid-parameter',
      }),
      { status: 400 }
    )
  }

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
    console.error('Failed to parse finance item update request body', {
      financeItemId,
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

  const hasUpdates = Object.values(parsedBody).some((value) => value !== undefined)

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while updating finance item',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const fetchFinanceItem = async () =>
    (await db
      .selectFrom('vw_legacy_finance_item as v')
      .select(({ ref }) => [
        ref('v.id').as('id'),
        ref('v.trainerId').as('trainerId'),
        ref('v.amount').as('amount'),
        ref('v.imageUrl').as('imageUrl'),
        ref('v.name').as('name'),
        ref('v.status').as('status'),
        ref('v.paymentType').as('paymentType'),
        ref('v.stripeApplicationFeeId').as('stripeApplicationFeeId'),
        ref('v.startDate').as('startDate'),
        ref('v.createdAt').as('createdAt'),
        ref('v.updatedAt').as('updatedAt'),
      ])
      .where('v.trainerId', '=', authorization.trainerId)
      .where('v.id', '=', financeItemId)
      .executeTakeFirst()) as FinanceItemRow | undefined

  if (!hasUpdates) {
    try {
      const financeItemRow = await fetchFinanceItem()

      if (!financeItemRow) {
        throw new FinanceItemNotFoundError()
      }

      const financeItem = financeItemSchema.parse(adaptFinanceItemRow(financeItemRow))

      return NextResponse.json(financeItem)
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
            title: 'Failed to parse finance item data from database',
            detail: 'Finance item data did not match the expected response schema.',
            type: '/invalid-response',
          }),
          { status: 500 }
        )
      }

      console.error('Failed to fetch finance item while handling empty update', {
        trainerId: authorization.trainerId,
        financeItemId,
        error,
      })

      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to fetch finance item',
          type: '/internal-server-error',
        }),
        { status: 500 }
      )
    }
  }

  try {
    const updates: Partial<{
      name: string
      amount: number
      start_date: Date
      image_url: null
    }> = {}

    if (parsedBody.name !== undefined) updates.name = parsedBody.name
    if (parsedBody.amount !== undefined) updates.amount = parsedBody.amount
    if (parsedBody.startDate !== undefined) updates.start_date = parsedBody.startDate
    if (parsedBody.imageUrl !== undefined) updates.image_url = parsedBody.imageUrl

    const updated = await db
      .updateTable('finance_item')
      .set(updates)
      .where('finance_item.trainer_id', '=', authorization.trainerId)
      .where('finance_item.id', '=', financeItemId)
      .returning(({ ref }) => [ref('finance_item.id').as('id')])
      .executeTakeFirst()

    if (!updated) {
      throw new FinanceItemNotFoundError()
    }

    const financeItemRow = await fetchFinanceItem()

    if (!financeItemRow) {
      throw new FinanceItemNotFoundError()
    }

    const financeItem = financeItemSchema.parse(adaptFinanceItemRow(financeItemRow))

    return NextResponse.json(financeItem)
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
          title: 'Failed to validate finance item update response',
          detail: 'Finance item update response did not match the expected schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to update finance item', {
      trainerId: authorization.trainerId,
      financeItemId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to update finance item',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map((issue) => issue.message).join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid path parameters',
        detail: detail || 'Finance item identifier parameter did not match the expected schema.',
        type: '/invalid-path-parameters',
      }),
      { status: 400 }
    )
  }

  const { financeItemId } = paramsResult.data

  if (financeItemId.startsWith('ch_')) {
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Finance item cannot be modified',
        detail: "Can't modify a commission.",
        type: '/invalid-parameter',
      }),
      { status: 400 }
    )
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while deleting finance item',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const deleted = await db
      .deleteFrom('finance_item')
      .where('finance_item.id', '=', financeItemId)
      .where('finance_item.trainer_id', '=', authorization.trainerId)
      .returning(({ ref }) => [ref('finance_item.id').as('id')])
      .executeTakeFirst()

    if (!deleted) {
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

    const responseBody = deleteResponseSchema.parse({ count: 1 })

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to validate finance item deletion response',
          detail: 'Finance item deletion response did not match the expected schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to delete finance item', {
      trainerId: authorization.trainerId,
      financeItemId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to delete finance item',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
