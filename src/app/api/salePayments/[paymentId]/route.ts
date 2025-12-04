import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { authenticateTrainerOrClientRequest, buildErrorResponse } from '../../_lib/accessToken'
import { adaptSalePaymentRow, salePaymentSchema, type SalePaymentRow } from '../../_lib/salePayments'

const paramsSchema = z.object({
  paymentId: z.string().trim().min(1, 'Payment id is required').uuid({ message: 'Payment id must be a valid UUID' }),
})

type HandlerContext = RouteContext<'/api/salePayments/[paymentId]'>
export async function GET(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map((issue) => issue.message).join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid payment identifier',
        detail: detail || 'Request parameters did not match the expected payment identifier schema.',
        type: '/invalid-parameter',
      }),
      { status: 400 }
    )
  }

  const authorization = await authenticateTrainerOrClientRequest(request, {
    trainerExtensionFailureLogMessage: 'Failed to extend access token expiry while fetching sale payment for trainer',
    clientExtensionFailureLogMessage: 'Failed to extend access token expiry while fetching sale payment for client',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { paymentId } = paramsResult.data

  try {
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
      .select(({ ref }) => [
        ref('payment.id').as('id'),
        ref('payment.client_id').as('clientId'),
        ref('payment.sale_id').as('saleId'),
        ref('payment.amount').as('amount'),
        ref('payment.created_at').as('createdAt'),
        ref('payment.updated_at').as('paymentUpdatedAt'),
        ref('paymentManual.updated_at').as('paymentManualUpdatedAt'),
        ref('paymentStripe.updated_at').as('paymentStripeUpdatedAt'),
        ref('paymentCreditPack.updated_at').as('paymentCreditPackUpdatedAt'),
        ref('paymentSubscription.updated_at').as('paymentSubscriptionUpdatedAt'),
        ref('payment.refunded_time').as('refundedTime'),
        ref('payment.is_manual').as('isManual'),
        ref('payment.is_stripe').as('isStripe'),
        ref('payment.is_credit_pack').as('isCreditPack'),
        ref('payment.is_subscription').as('isSubscription'),
        ref('paymentManual.transaction_time').as('manualTransactionTime'),
        ref('paymentManual.method').as('manualMethod'),
        ref('paymentManual.specific_method_name').as('manualSpecificMethodName'),
        ref('paymentCreditPack.transaction_time').as('creditPackTransactionTime'),
        ref('paymentCreditPack.credits_used').as('creditPackCreditsUsed'),
        ref('paymentCreditPack.sale_credit_pack_id').as('creditPackSaleCreditPackId'),
        ref('paymentStripe.fee').as('stripeFee'),
        ref('stripePaymentIntent.object').as('stripePaymentIntentObject'),
        ref('stripeCharge.object').as('stripeChargeObject'),
        ref('paymentSubscription.subscription_id').as('subscriptionId'),
        ref('paymentSubscription.created_at').as('subscriptionCreatedAt'),
        ref('currency.alpha_code').as('currency'),
      ])
      .where('payment.id', '=', paymentId)
      .where('payment.trainer_id', '=', authorization.trainerId)

    if (authorization.actor === 'client') {
      query = query.where('payment.client_id', '=', authorization.clientId)
    }

    const salePaymentRow = (await query.executeTakeFirst()) as SalePaymentRow | undefined

    if (!salePaymentRow) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Payment not found',
          detail: 'We could not find a sale payment with the specified identifier for the authenticated account.',
          type: '/sale-payment-not-found',
        }),
        { status: 404 }
      )
    }

    const responseBody = salePaymentSchema.parse(adaptSalePaymentRow(salePaymentRow))

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

    console.error(
      'Failed to fetch sale payment',
      authorization.trainerId,
      authorization.actor === 'client' ? authorization.clientId : undefined,
      paymentId,
      error
    )

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch sale payment',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
