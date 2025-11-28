import { NextResponse } from 'next/server'
import { db } from '@keepon/db'
import { z } from 'zod'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../../../_lib/accessToken'

export const runtime = 'nodejs'

const paramsSchema = z.object({
  saleId: z.string().uuid({ message: 'saleId must be a valid UUID' }),
})

export async function POST(request: Request, context: { params?: { saleId?: string } }) {
  const paramsResult = paramsSchema.safeParse(context?.params ?? {})

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map(issue => issue.message).join('; ')
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
    extensionFailureLogMessage:
      'Failed to extend access token expiry while requesting payment',
  })

  if (!auth.ok) {
    return auth.response
  }

  const { saleId } = paramsResult.data

  try {
    const updated = await db
      .updateTable('sale')
      .set({ payment_request_time: new Date() })
      .where('id', '=', saleId)
      .where('trainer_id', '=', auth.trainerId)
      .returning('id')
      .executeTakeFirst()

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

    await db
      .updateTable('sale_payment_status')
      .set({ payment_status: 'requested' })
      .where('sale_id', '=', saleId)
      .execute()

    return NextResponse.json({ status: 'requested' })
  } catch (error) {
    console.error('Failed to request payment', { saleId, error })
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
