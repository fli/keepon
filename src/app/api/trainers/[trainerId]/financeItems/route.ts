import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { authenticateTrainerRequest, buildErrorResponse } from '../../../_lib/accessToken'
import { adaptFinanceItemRow, financeItemListSchema, type FinanceItemRow } from '../../../financeItems/shared'

const LEGACY_INVALID_JSON_MESSAGE = 'Unexpected token \'"\', "#" is not valid JSON'

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

type HandlerContext = RouteContext<'/api/trainers/[trainerId]/financeItems'>

const invalidJsonResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: LEGACY_INVALID_JSON_MESSAGE,
    }),
    { status: 400 }
  )

const invalidBodyResponse = (detail?: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Your parameters were invalid.',
      detail: detail || 'Your parameters were invalid.',
      type: '/invalid-parameters',
    }),
    { status: 400 }
  )

export async function GET(request: NextRequest, context: HandlerContext) {
  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while fetching finance items',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const url = new URL(request.url)
  let updatedAtGt: Date | null = null
  const filterParam = url.searchParams.get('filter')
  if (filterParam !== null) {
    let parsedFilter: unknown
    try {
      parsedFilter = JSON.parse(filterParam)
    } catch {
      return invalidBodyResponse('filter  should be Record<string, unknown>')
    }
    if (!parsedFilter || typeof parsedFilter !== 'object' || Array.isArray(parsedFilter)) {
      return invalidBodyResponse('filter  should be Record<string, unknown>')
    }
    const gtValue = (parsedFilter as any)?.where?.updatedAt?.gt
    if (gtValue !== undefined && gtValue !== null) {
      if (typeof gtValue !== 'string') {
        return invalidBodyResponse('filter.where.updatedAt.gt  should be DateTimeString')
      }
      const parsedDate = new Date(gtValue)
      if (Number.isNaN(parsedDate.getTime())) {
        return invalidBodyResponse('filter.where.updatedAt.gt  should be DateTimeString')
      }
      updatedAtGt = parsedDate
    }
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

    if (updatedAtGt) {
      query = query.where('v.updatedAt', '>=', updatedAtGt)
    }

    const rows = (await query.execute()) as FinanceItemRow[]

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
  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while creating finance items',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  let parsedBody: z.infer<typeof requestBodySchema>

  try {
    const rawText = await request.text()
    const rawBody: unknown = rawText.trim().length === 0 ? {} : (JSON.parse(rawText) as unknown)

    if (rawBody === null || typeof rawBody !== 'object') {
      return invalidJsonResponse()
    }
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
