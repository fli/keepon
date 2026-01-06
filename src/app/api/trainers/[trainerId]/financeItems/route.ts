import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { authenticateTrainerRequest, buildErrorResponse } from '../../../_lib/accessToken'
import { adaptFinanceItemRow, financeItemListSchema, type FinanceItemRow } from '../../../financeItems/shared'

const paramsSchema = z.object({
  trainerId: z.string().min(1, 'Trainer id is required'),
})

const requestBodySchema = z.array(
  z
    .object({
      name: z.string({ message: 'name must be a string.' }).trim().min(1, 'name must not be empty.'),
      amount: z
        .number({ message: 'amount must be a number.' })
        .refine(Number.isFinite, { message: 'amount must be a finite number.' }),
      startDate: z.union([z.string(), z.date()]).transform((value) => {
        const date = value instanceof Date ? value : new Date(value)
        if (Number.isNaN(date.getTime())) {
          throw new Error('startDate must be a valid date-time value.')
        }
        return date
      }),
    })
    .strict()
)

const querySchema = z.object({
  updatedAtGt: z
    .string()
    .trim()
    .transform((value) => {
      const parsed = new Date(value)
      if (Number.isNaN(parsed.getTime())) {
        throw new Error('Invalid updatedAt.gt value')
      }
      return parsed
    })
    .optional(),
})

type HandlerContext = RouteContext<'/api/trainers/[trainerId]/financeItems'>

const invalidJsonResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid JSON payload',
      detail: 'Request body must be valid JSON.',
      type: '/invalid-json',
    }),
    { status: 400 }
  )

const invalidBodyResponse = (detail?: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid request body',
      detail: detail || 'Request body did not match the expected schema.',
      type: '/invalid-body',
    }),
    { status: 400 }
  )

export async function GET(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map((issue) => issue.message).join('; ')
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
    updatedAtGt: updatedAtGtParam && updatedAtGtParam.trim().length > 0 ? updatedAtGtParam : undefined,
  })

  if (!queryResult.success) {
    const detail = queryResult.error.issues.map((issue) => issue.message).join('; ')
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
    extensionFailureLogMessage: 'Failed to extend access token expiry while fetching finance items',
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
      .select((eb) => [
        eb.ref('v.id').as('id'),
        eb.ref('v.trainerId').as('trainerId'),
        eb.ref('v.amount').as('amount'),
        eb.ref('v.imageUrl').as('imageUrl'),
        eb.ref('v.name').as('name'),
        eb.ref('v.status').as('status'),
        eb.ref('v.paymentType').as('paymentType'),
        eb.ref('v.stripeApplicationFeeId').as('stripeApplicationFeeId'),
        eb.ref('v.startDate').as('startDate'),
        eb.ref('v.createdAt').as('createdAt'),
        eb.ref('v.updatedAt').as('updatedAt'),
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

    const financeItems = financeItemListSchema.parse(rows.map((row) => adaptFinanceItemRow(row)))

    return NextResponse.json(financeItems)
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

export async function POST(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map((issue) => issue.message).join('; ')
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

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while creating finance items',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  if (authorization.trainerId !== trainerId) {
    return NextResponse.json(
      buildErrorResponse({
        status: 403,
        title: 'Forbidden',
        detail: 'You are not permitted to create finance items for this trainer.',
        type: '/forbidden',
      }),
      { status: 403 }
    )
  }

  let parsedBody: z.infer<typeof requestBodySchema>

  try {
    const rawBody = (await request.json()) as unknown
    const bodyResult = requestBodySchema.safeParse(rawBody)

    if (!bodyResult.success) {
      const detail = bodyResult.error.issues
        .map((issue) => {
          const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
          return `${path}${issue.message}`
        })
        .join('; ')

      return invalidBodyResponse(detail)
    }

    parsedBody = bodyResult.data
  } catch (error) {
    console.error('Failed to parse finance item create request body', error)
    return invalidJsonResponse()
  }

  if (parsedBody.length === 0) {
    return NextResponse.json([])
  }

  try {
    const financeItemRows = await db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('finance_item')
        .values(
          parsedBody.map((item) => ({
            trainer_id: authorization.trainerId,
            name: item.name,
            amount: item.amount,
            start_date: item.startDate,
          }))
        )
        .returning((eb) => [eb.ref('finance_item.id').as('id')])
        .execute()

      const ids = inserted.map((row) => row.id).filter((id): id is string => Boolean(id))

      if (ids.length === 0) {
        return [] as FinanceItemRow[]
      }

      const rows = (await trx
        .selectFrom('vw_legacy_finance_item as v')
        .select((eb) => [
          eb.ref('v.id').as('id'),
          eb.ref('v.trainerId').as('trainerId'),
          eb.ref('v.amount').as('amount'),
          eb.ref('v.imageUrl').as('imageUrl'),
          eb.ref('v.name').as('name'),
          eb.ref('v.status').as('status'),
          eb.ref('v.paymentType').as('paymentType'),
          eb.ref('v.stripeApplicationFeeId').as('stripeApplicationFeeId'),
          eb.ref('v.startDate').as('startDate'),
          eb.ref('v.createdAt').as('createdAt'),
          eb.ref('v.updatedAt').as('updatedAt'),
        ])
        .where('v.trainerId', '=', authorization.trainerId)
        .where('v.id', 'in', ids)
        .execute()) as FinanceItemRow[]

      const rowsById = new Map(rows.map((row) => [row.id, row]))

      return ids.map((id) => {
        const row = rowsById.get(id)
        if (!row) {
          throw new Error(`Inserted finance item ${id} was not found when fetching response data`)
        }
        return row
      })
    })

    const financeItems = financeItemListSchema.parse(financeItemRows.map((row) => adaptFinanceItemRow(row)))

    return NextResponse.json(financeItems)
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

    console.error('Failed to create finance items', { trainerId: authorization.trainerId, error })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to create finance items',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
