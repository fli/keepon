import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../../_lib/accessToken'
import {
  adaptFinanceItemRow,
  financeItemSchema,
  type FinanceItemRow,
} from '../shared'

export const runtime = 'nodejs'

const paramsSchema = z.object({
  financeItemId: z
    .string()
    .trim()
    .min(1, 'Finance item id is required'),
})

const deleteResponseSchema = z.object({
  count: z.number().int().nonnegative(),
})

type RouteContext = {
  params?: {
    financeItemId?: string
  }
}

export async function GET(request: Request, context: RouteContext) {
  const paramsResult = paramsSchema.safeParse(context?.params ?? {})

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
          'Finance item identifier parameter did not match the expected schema.',
        type: '/invalid-path-parameters',
      }),
      { status: 400 }
    )
  }

  const { financeItemId } = paramsResult.data

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while fetching finance item',
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
          detail:
            'We could not find a finance item with the specified identifier for the authenticated trainer.',
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
          detail:
            'Finance item data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error(
      'Failed to fetch finance item',
      authorization.trainerId,
      financeItemId,
      error
    )

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

export async function DELETE(request: Request, context: RouteContext) {
  const paramsResult = paramsSchema.safeParse(context?.params ?? {})

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
          'Finance item identifier parameter did not match the expected schema.',
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
    extensionFailureLogMessage:
      'Failed to extend access token expiry while deleting finance item',
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
          detail:
            'We could not find a finance item with the specified identifier for the authenticated trainer.',
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
          detail:
            'Finance item deletion response did not match the expected schema.',
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
