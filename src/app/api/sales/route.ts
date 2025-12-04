import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateTrainerOrClientRequest, authenticateTrainerRequest, buildErrorResponse } from '../_lib/accessToken'
import { adaptSaleRow, fetchSales, saleListSchema, salesQuerySchema } from './shared'
import { db } from '@/lib/db'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const normalize = (value: string | null) => (value && value.trim().length > 0 ? value.trim() : undefined)

  const queryResult = salesQuerySchema.safeParse({
    updatedAfter: normalize(url.searchParams.get('updatedAfter')),
    clientId: normalize(url.searchParams.get('clientId')),
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

  const authorization = await authenticateTrainerOrClientRequest(request, {
    trainerExtensionFailureLogMessage: 'Failed to extend access token expiry while fetching sales for trainer request',
    clientExtensionFailureLogMessage: 'Failed to extend access token expiry while fetching sales for client request',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const filters = queryResult.data

    if (authorization.actor === 'client') {
      if (filters.clientId && filters.clientId !== authorization.clientId) {
        return NextResponse.json(
          buildErrorResponse({
            status: 403,
            title: 'You are not authorized to view sales for other clients',
            type: '/forbidden',
          }),
          { status: 403 }
        )
      }

      filters.clientId = authorization.clientId
    }

    const rows = await fetchSales({
      trainerId: authorization.trainerId,
      clientId: filters.clientId,
      updatedAfter: filters.updatedAfter,
    })

    const sales = saleListSchema.parse(rows.map(adaptSaleRow))

    return NextResponse.json(sales)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse sale data from database',
          detail: 'Sale data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch sales', error)

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch sales',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}

const createSaleSchema = z.object({
  clientId: z.string().min(1, 'clientId is required'),
  note: z.string().trim().nullable().optional(),
  dueAfter: z.string().trim().nullable().optional(),
  paymentRequestPassOnTransactionFee: z.boolean().optional(),
  clientSessionId: z.string().trim().nullable().optional(),
})

const parseDueAfter = (value: string | null | undefined) => {
  if (!value) return new Date()

  const match = /^P(?:(\d+)W)?(?:(\d+)D)?$/i.exec(value.trim())
  if (!match) return new Date()

  const weeks = match[1] ? Number.parseInt(match[1], 10) : 0
  const days = match[2] ? Number.parseInt(match[2], 10) : 0
  const totalDays = weeks * 7 + days
  if (!Number.isFinite(totalDays) || totalDays <= 0) return new Date()

  return new Date(Date.now() + totalDays * 24 * 60 * 60 * 1000)
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch (error) {
    console.error('Failed to parse sale create body as JSON', error)
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

  const parsed = createSaleSchema.safeParse(body)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => issue.message).join('; ')
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid request body',
        detail: detail || undefined,
        type: '/invalid-body',
      }),
      { status: 400 }
    )
  }

  const auth = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while creating sale',
  })

  if (!auth.ok) {
    return auth.response
  }

  const { clientId, note, dueAfter, paymentRequestPassOnTransactionFee, clientSessionId } = parsed.data

  try {
    const created = await db.transaction().execute(async (trx) => {
      const sale = await trx
        .insertInto('sale')
        .values({
          trainer_id: auth.trainerId,
          client_id: clientId,
          note: note ?? '',
          due_time: parseDueAfter(dueAfter),
          payment_request_pass_on_transaction_fee: paymentRequestPassOnTransactionFee ?? false,
        })
        .returning('id')
        .executeTakeFirst()

      if (!sale) {
        throw new Error('Failed to create sale')
      }

      await trx.insertInto('sale_payment_status').values({ sale_id: sale.id, payment_status: 'none' }).execute()

      if (clientSessionId) {
        const updated = await trx
          .updateTable('client_session')
          .set({ sale_id: sale.id })
          .where('id', '=', clientSessionId)
          .where('trainer_id', '=', auth.trainerId)
          .returning('id')
          .executeTakeFirst()

        if (!updated) {
          throw new Error('Client session not found for trainer')
        }
      }

      return sale
    })

    return NextResponse.json({ id: created.id })
  } catch (error) {
    console.error('Failed to create sale', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to create sale',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
