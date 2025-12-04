import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../../../_lib/accessToken'
import {
  adaptFinanceItemRow,
  financeItemListSchema,
  type FinanceItemRow,
} from '../../../financeItems/shared'

const paramsSchema = z.object({
  trainerId: z.string().min(1, 'Trainer id is required'),
})

const querySchema = z.object({
  updatedAtGt: z
    .string()
    .trim()
    .transform(value => {
      const parsed = new Date(value)
      if (Number.isNaN(parsed.getTime())) {
        throw new Error('Invalid updatedAt.gt value')
      }
      return parsed
    })
    .optional(),
})

type HandlerContext = RouteContext<'/api/trainers/[trainerId]/financeItems'>

export async function GET(
  request: NextRequest,
  context: HandlerContext
) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues
      .map(issue => issue.message)
      .join('; ')
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid path parameters',
        detail: detail || 'Trainer id parameter is invalid.',
        type: '/invalid-path-parameters',
      }),
      { status: 400 }
    )
  }

  const { trainerId } = paramsResult.data

  const url = new URL(request.url)
  const updatedAtGtParam = url.searchParams.get('filter[where][updatedAt][gt]')

  const queryResult = querySchema.safeParse({
    updatedAtGt:
      updatedAtGtParam && updatedAtGtParam.trim().length > 0
        ? updatedAtGtParam
        : undefined,
  })

  if (!queryResult.success) {
    const detail = queryResult.error.issues
      .map(issue => issue.message)
      .join('; ')
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid query parameters',
        detail:
          detail ||
          'Request query parameters did not match the expected schema.',
        type: '/invalid-query',
      }),
      { status: 400 }
    )
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while fetching finance items',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  if (authorization.trainerId !== trainerId) {
    return NextResponse.json(
      buildErrorResponse({
        status: 403,
        title: 'Forbidden',
        detail: 'You are not permitted to access finance items for this trainer.',
        type: '/forbidden',
      }),
      { status: 403 }
    )
  }

  try {
    let query = db
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

    const updatedAtGt = queryResult.data.updatedAtGt
    if (updatedAtGt) {
      query = query.where('v.updatedAt', '>=', updatedAtGt)
    }

    const rows = (await query
      .orderBy('v.updatedAt', 'desc')
      .orderBy('v.createdAt', 'desc')
      .execute()) as FinanceItemRow[]

    const financeItems = financeItemListSchema.parse(
      rows.map(row => adaptFinanceItemRow(row))
    )

    return NextResponse.json(financeItems)
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

    console.error('Failed to fetch finance items', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch finance items',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
