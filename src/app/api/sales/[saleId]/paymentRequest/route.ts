import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { authenticateTrainerRequest, buildErrorResponse } from '../../../_lib/accessToken'
import { adaptSaleRow, fetchSales, saleSchema } from '../../shared'
import {
  AccessTokenCreationError,
  ClientHasNoEmailError,
  SaleNotFoundError,
  requestPaymentForSale,
} from '@/server/sales'

const paramsSchema = z.object({
  saleId: z.string().uuid({ message: 'saleId must be a valid UUID' }),
})

type HandlerContext = RouteContext<'/api/sales/[saleId]/paymentRequest'>

export async function POST(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map((issue) => issue.message).join('; ')
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid sale identifier',
        detail: detail || undefined,
        type: '/invalid-parameter',
      }),
      { status: 400 }
    )
  }

  const auth = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while requesting payment',
  })

  if (!auth.ok) {
    return auth.response
  }

  const { saleId } = paramsResult.data

  try {
    await requestPaymentForSale(auth.trainerId, saleId)

    const rows = await fetchSales({ trainerId: auth.trainerId, saleId })
    const saleRow = rows[0]

    if (!saleRow) {
      throw new SaleNotFoundError()
    }

    const sale = saleSchema.parse(adaptSaleRow(saleRow))

    return NextResponse.json(sale)
  } catch (error) {
    if (error instanceof SaleNotFoundError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Sale not found',
          detail: 'No sale exists for this trainer with that id.',
          type: '/sale-not-found',
        }),
        { status: 404 }
      )
    }

    if (error instanceof ClientHasNoEmailError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'Client has no email',
          detail: 'A client email address is required to send a payment request.',
          type: '/client-has-no-email',
        }),
        { status: 409 }
      )
    }

    if (error instanceof AccessTokenCreationError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to create client dashboard access token',
          type: '/internal-server-error',
        }),
        { status: 500 }
      )
    }

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

    console.error('Failed to request payment', { saleId, trainerId: auth.trainerId, error })
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to request payment',
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
        title: 'Invalid sale identifier',
        detail: detail || undefined,
        type: '/invalid-parameter',
      }),
      { status: 400 }
    )
  }

  const auth = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while cancelling payment request',
  })

  if (!auth.ok) {
    return auth.response
  }

  const { saleId } = paramsResult.data

  try {
    const updated = await db.transaction().execute(async (trx) => {
      const saleRow = await trx
        .updateTable('sale')
        .set({ payment_request_time: null, updated_at: new Date() })
        .where('id', '=', saleId)
        .where('trainer_id', '=', auth.trainerId)
        .returning('id')
        .executeTakeFirst()

      if (!saleRow) {
        return null
      }

      await trx
        .updateTable('sale_payment_status')
        .set({ payment_status: 'none' })
        .where('sale_id', '=', saleId)
        .execute()

      return saleRow
    })

    if (!updated) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Sale not found',
          detail: 'No sale exists for this trainer with that id.',
          type: '/sale-not-found',
        }),
        { status: 404 }
      )
    }

    return NextResponse.json({ status: 'cancelled' })
  } catch (error) {
    console.error('Failed to cancel payment request', { saleId, trainerId: auth.trainerId, error })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to cancel payment request',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
