import { NextResponse } from 'next/server'
import { db } from '@keepon/db'
import { z } from 'zod'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../_lib/accessToken'
import { salePaymentSchema } from '../_lib/salePayments'

export const runtime = 'nodejs'

const requestSchema = z.object({
  saleId: z.string().uuid({ message: 'saleId must be a valid UUID' }),
  amount: z.union([z.string(), z.number()]).transform(value => value.toString()),
  currency: z.string().min(1),
  type: z.literal('manual'),
  method: z.enum(['cash', 'electronic']),
  specificMethodName: z.string().nullable().optional(),
})

export async function POST(request: Request) {
  let body: unknown

  try {
    body = await request.json()
  } catch (error) {
    console.error('Failed to parse sale payment body as JSON', error)
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

  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    const detail = parsed.error.issues.map(issue => issue.message).join('; ')
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
    extensionFailureLogMessage:
      'Failed to extend access token expiry while creating sale payment',
  })

  if (!auth.ok) {
    return auth.response
  }

  const { saleId, amount, method, specificMethodName } = parsed.data

  try {
    const paymentResult = await db.transaction().execute(async trx => {
      const saleRow = await trx
        .selectFrom('sale')
        .select(['id', 'client_id'])
        .where('id', '=', saleId)
        .where('trainer_id', '=', auth.trainerId)
        .executeTakeFirst()

      if (!saleRow) {
        throw new Error('Sale not found for trainer')
      }

      const payment = await trx
        .insertInto('payment')
        .values({
          trainer_id: auth.trainerId,
          client_id: saleRow.client_id,
          sale_id: saleId,
          amount,
          is_manual: true,
          is_credit_pack: null,
          is_subscription: null,
          is_stripe: null,
          is_scheduled_stripe: null,
        })
        .returning('id')
        .executeTakeFirst()

      if (!payment) {
        throw new Error('Failed to insert payment')
      }

      await trx
        .insertInto('payment_manual')
        .values({
          id: payment.id,
          trainer_id: auth.trainerId,
          method,
          specific_method_name: specificMethodName ?? null,
          transaction_time: new Date(),
          is_manual: true,
        })
        .execute()

      await trx
        .updateTable('sale_payment_status')
        .set({ payment_status: 'paid' })
        .where('sale_id', '=', saleId)
        .execute()

      return { id: payment.id, clientId: saleRow.client_id }
    })

    const currencyRow = await db
      .selectFrom('trainer')
      .innerJoin(
        'supported_country_currency as supportedCountryCurrency',
        'supportedCountryCurrency.country_id',
        'trainer.country_id'
      )
      .innerJoin('currency', 'currency.id', 'supportedCountryCurrency.currency_id')
      .select('currency.alpha_code as currency')
      .where('trainer.id', '=', auth.trainerId)
      .executeTakeFirst()

    const currency = currencyRow?.currency ?? parsed.data.currency

    const responseBody = salePaymentSchema.parse({
      id: paymentResult.id,
      saleId,
      clientId: paymentResult.clientId,
      type: 'manual',
      amount,
      amountRefunded: 0,
      currency,
      method,
      specificMethodName: specificMethodName ?? null,
      saleCreditPackId: null,
      creditsUsed: null,
      paymentPlanId: null,
      transactionFee: null,
      transactedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    return NextResponse.json(responseBody)
  } catch (error) {
    console.error('Failed to create sale payment', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to create sale payment',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
