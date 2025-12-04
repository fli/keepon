import { NextResponse } from 'next/server'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import { authenticateTrainerOrClientRequest, authenticateTrainerRequest, buildErrorResponse } from '../_lib/accessToken'
import { adaptSalePaymentRow, salePaymentSchema, type SalePaymentRow } from '../_lib/salePayments'

const querySchema = z.object({
  saleId: z.string().uuid({ message: 'saleId must be a valid UUID' }).optional(),
  updatedAfter: z
    .string()
    .transform((value) => {
      const parsed = new Date(value)
      if (Number.isNaN(parsed.getTime())) {
        throw new Error('updatedAfter must be a valid ISO 8601 datetime string')
      }
      return parsed
    })
    .optional(),
  paymentPlanId: z.string().uuid({ message: 'paymentPlanId must be a valid UUID' }).optional(),
  clientId: z.string().uuid({ message: 'clientId must be a valid UUID' }).optional(),
})

export async function GET(request: Request) {
  const url = new URL(request.url)
  const normalize = (value: string | null) => (value && value.trim().length > 0 ? value.trim() : undefined)

  const queryResult = querySchema.safeParse({
    saleId: normalize(url.searchParams.get('saleId')),
    updatedAfter: normalize(url.searchParams.get('updatedAfter')),
    paymentPlanId: normalize(url.searchParams.get('paymentPlanId')),
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
    trainerExtensionFailureLogMessage:
      'Failed to extend access token expiry while fetching sale payments for trainer request',
    clientExtensionFailureLogMessage:
      'Failed to extend access token expiry while fetching sale payments for client request',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const filters = { ...queryResult.data }

  if (authorization.actor === 'client') {
    if (filters.clientId && filters.clientId !== authorization.clientId) {
      return NextResponse.json(
        buildErrorResponse({
          status: 403,
          title: 'You are not authorized to view sale payments for other clients',
          type: '/forbidden',
        }),
        { status: 403 }
      )
    }
    filters.clientId = authorization.clientId
  }

  try {
    const combinedUpdatedAt = sql<Date>`
      GREATEST(
        ${sql.ref('payment.updated_at')},
        COALESCE(${sql.ref('paymentCreditPack.updated_at')}, ${sql.ref('payment.updated_at')}),
        COALESCE(${sql.ref('paymentManual.updated_at')}, ${sql.ref('payment.updated_at')}),
        COALESCE(${sql.ref('paymentStripe.updated_at')}, ${sql.ref('payment.updated_at')}),
        COALESCE(${sql.ref('paymentSubscription.updated_at')}, ${sql.ref('payment.updated_at')})
      )
    `

    let query = db
      .selectFrom('payment as payment')
      .innerJoin('trainer', 'trainer.id', 'payment.trainer_id')
      .innerJoin(
        'supported_country_currency as supportedCountryCurrency',
        'supportedCountryCurrency.country_id',
        'trainer.country_id'
      )
      .innerJoin('currency', 'currency.id', 'supportedCountryCurrency.currency_id')
      .leftJoin('payment_manual as paymentManual', 'paymentManual.id', 'payment.id')
      .leftJoin('payment_credit_pack as paymentCreditPack', 'paymentCreditPack.id', 'payment.id')
      .leftJoin('payment_stripe as paymentStripe', 'paymentStripe.id', 'payment.id')
      .leftJoin('payment_subscription as paymentSubscription', 'paymentSubscription.id', 'payment.id')
      .leftJoin(
        'stripe_payment_intent as stripePaymentIntent',
        'stripePaymentIntent.id',
        'paymentStripe.stripe_payment_intent_id'
      )
      .leftJoin('stripe_charge as stripeCharge', 'stripeCharge.id', 'paymentStripe.stripe_charge_id')
      .select((eb) => [
        eb.ref('payment.id').as('id'),
        eb.ref('payment.client_id').as('clientId'),
        eb.ref('payment.sale_id').as('saleId'),
        eb.ref('payment.amount').as('amount'),
        eb.ref('payment.created_at').as('createdAt'),
        eb.ref('payment.updated_at').as('paymentUpdatedAt'),
        eb.ref('paymentManual.updated_at').as('paymentManualUpdatedAt'),
        eb.ref('paymentStripe.updated_at').as('paymentStripeUpdatedAt'),
        eb.ref('paymentCreditPack.updated_at').as('paymentCreditPackUpdatedAt'),
        eb.ref('paymentSubscription.updated_at').as('paymentSubscriptionUpdatedAt'),
        eb.ref('payment.refunded_time').as('refundedTime'),
        eb.ref('payment.is_manual').as('isManual'),
        eb.ref('payment.is_stripe').as('isStripe'),
        eb.ref('payment.is_credit_pack').as('isCreditPack'),
        eb.ref('payment.is_subscription').as('isSubscription'),
        eb.ref('paymentManual.transaction_time').as('manualTransactionTime'),
        eb.ref('paymentManual.method').as('manualMethod'),
        eb.ref('paymentManual.specific_method_name').as('manualSpecificMethodName'),
        eb.ref('paymentCreditPack.transaction_time').as('creditPackTransactionTime'),
        eb.ref('paymentCreditPack.credits_used').as('creditPackCreditsUsed'),
        eb.ref('paymentCreditPack.sale_credit_pack_id').as('creditPackSaleCreditPackId'),
        eb.ref('paymentStripe.fee').as('stripeFee'),
        eb.ref('stripePaymentIntent.object').as('stripePaymentIntentObject'),
        eb.ref('stripeCharge.object').as('stripeChargeObject'),
        eb.ref('paymentSubscription.subscription_id').as('subscriptionId'),
        eb.ref('paymentSubscription.created_at').as('subscriptionCreatedAt'),
        eb.ref('currency.alpha_code').as('currency'),
      ])
      .where('payment.trainer_id', '=', authorization.trainerId)

    if (filters.clientId) {
      query = query.where('payment.client_id', '=', filters.clientId)
    }

    if (filters.saleId) {
      query = query.where('payment.sale_id', '=', filters.saleId)
    }

    if (filters.paymentPlanId) {
      query = query.where('paymentSubscription.subscription_id', '=', filters.paymentPlanId)
    }

    if (filters.updatedAfter) {
      query = query.where(combinedUpdatedAt, '>', filters.updatedAfter)
    }

    const rows = (await query.orderBy('payment.created_at', 'desc').execute()) as SalePaymentRow[]

    const salePayments = rows.map((row) => adaptSalePaymentRow(row))
    const responseBody = z.array(salePaymentSchema).parse(salePayments)

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse sale payment data from database',
          detail: 'Sale payment data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch sale payments', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch sale payments',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}

const requestSchema = z.object({
  saleId: z.string().uuid({ message: 'saleId must be a valid UUID' }),
  amount: z.union([z.string(), z.number()]).transform((value) => value.toString()),
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
    extensionFailureLogMessage: 'Failed to extend access token expiry while creating sale payment',
  })

  if (!auth.ok) {
    return auth.response
  }

  const { saleId, amount, method, specificMethodName } = parsed.data

  try {
    const paymentResult = await db.transaction().execute(async (trx) => {
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
