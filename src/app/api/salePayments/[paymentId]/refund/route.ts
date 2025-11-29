import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import BigNumber from 'bignumber.js'
import { db, sql } from '@/lib/db'
import { z, ZodError } from 'zod'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../../../_lib/accessToken'
import {
  adaptSalePaymentRow,
  salePaymentSchema,
  type SalePaymentRow,
} from '../../../_lib/salePayments'
import { getStripeClient, STRIPE_API_VERSION } from '../../../_lib/stripeClient'

export const runtime = 'nodejs'

const paramsSchema = z.object({
  paymentId: z
    .string()
    .trim()
    .min(1, 'Payment id is required')
    .uuid({ message: 'Payment id must be a valid UUID' }),
})

const stripeDetailsSchema = z.object({
  stripeChargeId: z.string().nullable(),
  stripePaymentIntentId: z.string().nullable(),
  minimumBalance: z.union([z.string(), z.number()]).nullable(),
  stripeAccountId: z.string().nullable(),
  stripeAccountType: z.enum(['standard', 'custom', 'express']).nullable(),
  fee: z.union([z.string(), z.number()]).nullable(),
  amount: z.union([z.string(), z.number()]),
})

type RouteContext = {
  params?: {
    paymentId?: string
  }
}

class SalePaymentNotFoundError extends Error {
  constructor() {
    super('Sale payment not found')
    this.name = 'SalePaymentNotFoundError'
  }
}

class StripeConfigurationMissingError extends Error {
  constructor() {
    super('Stripe configuration missing')
    this.name = 'StripeConfigurationMissingError'
  }
}

class StripePaymentsDisabledError extends Error {
  constructor() {
    super('Stripe payments not enabled')
    this.name = 'StripePaymentsDisabledError'
  }
}

class StripeBalanceTooLowError extends Error {
  constructor() {
    super('Stripe balance too low for refund')
    this.name = 'StripeBalanceTooLowError'
  }
}

const toBigNumber = (value: string | number | null | undefined, label: string) => {
  if (value === null || value === undefined) {
    throw new Error(`${label} is required`)
  }

  const big = new BigNumber(value)

  if (!big.isFinite()) {
    throw new Error(`Invalid ${label} value`)
  }

  return big
}

const toBigNumberOrZero = (
  value: string | number | null | undefined,
  label: string
) => {
  if (value === null || value === undefined) {
    return new BigNumber(0)
  }

  return toBigNumber(value, label)
}

const sumStripeBalanceEntries = (
  entries: Array<{ amount: number; currency: string }>
) =>
  entries.reduce(
    (total, entry) => total.plus(new BigNumber(entry.amount).shiftedBy(-2)),
    new BigNumber(0)
  )

export async function POST(request: Request, context: RouteContext) {
  const paramsResult = paramsSchema.safeParse(context?.params ?? {})

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues
      .map(issue => issue.message)
      .join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid payment identifier',
        detail:
          detail ||
          'Request parameters did not match the expected payment identifier schema.',
        type: '/invalid-parameter',
      }),
      { status: 400 }
    )
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while refunding sale payment for trainer',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { paymentId } = paramsResult.data

  try {
    const salePayment = await db.transaction().execute(async trx => {
      const updateResult = await trx
        .updateTable('payment')
        .set({
          refunded_time: sql<Date>`NOW()`,
        })
        .where('id', '=', paymentId)
        .where('trainer_id', '=', authorization.trainerId)
        .returning(['is_stripe', 'amount'])
        .executeTakeFirst()

      if (!updateResult) {
        throw new SalePaymentNotFoundError()
      }

      const refundAmount = toBigNumber(updateResult.amount, 'payment amount')

      if (updateResult.is_stripe) {
        const stripeClient = getStripeClient()

        if (!stripeClient) {
          throw new StripeConfigurationMissingError()
        }

        const stripeDetailsRow = await trx
          .selectFrom('payment_stripe as paymentStripe')
          .innerJoin('payment', 'payment.id', 'paymentStripe.id')
          .innerJoin('trainer', 'trainer.id', 'paymentStripe.trainer_id')
          .leftJoin(
            'stripe.account as stripeAccount',
            'stripeAccount.id',
            'trainer.stripe_account_id'
          )
          .select(({ ref }) => [
            ref('paymentStripe.stripe_charge_id').as('stripeChargeId'),
            ref('paymentStripe.stripe_payment_intent_id').as(
              'stripePaymentIntentId'
            ),
            ref('trainer.minimum_balance').as('minimumBalance'),
            ref('trainer.stripe_account_id').as('stripeAccountId'),
            ref('paymentStripe.fee').as('fee'),
            ref('payment.amount').as('amount'),
            sql<string | null>`stripeAccount.object ->> 'type'`.as(
              'stripeAccountType'
            ),
          ])
          .where('paymentStripe.id', '=', paymentId)
          .where('paymentStripe.trainer_id', '=', authorization.trainerId)
          .executeTakeFirst()

        const stripeDetailsResult = stripeDetailsSchema.safeParse(
          stripeDetailsRow
        )

        if (!stripeDetailsResult.success) {
          throw new StripePaymentsDisabledError()
        }

        const {
          stripeAccountId,
          stripeAccountType,
          stripeChargeId,
          stripePaymentIntentId,
          fee,
          minimumBalance,
        } = stripeDetailsResult.data

        if (
          !stripeAccountId ||
          !stripeAccountType ||
          stripeAccountType === 'express'
        ) {
          throw new StripePaymentsDisabledError()
        }

        const applicationFeeAmount = toBigNumberOrZero(
          fee,
          'Stripe fee amount'
        )
        const minimumBalanceAmount = toBigNumberOrZero(
          minimumBalance,
          'minimum balance'
        )

        if (!stripeChargeId && !stripePaymentIntentId) {
          throw new StripePaymentsDisabledError()
        }

        const stripeBalance = await stripeClient.balance.retrieve({
          stripeAccount: stripeAccountId,
        })

        const totalBalance = sumStripeBalanceEntries(stripeBalance.available).plus(
          sumStripeBalanceEntries(stripeBalance.pending)
        )

        const balanceAfterRefund = totalBalance
          .minus(refundAmount)
          .plus(applicationFeeAmount)

        if (
          balanceAfterRefund.isLessThan(minimumBalanceAmount) &&
          stripeAccountType === 'custom'
        ) {
          throw new StripeBalanceTooLowError()
        }

        const refundOptions: Stripe.RefundCreateParams = {
          charge: stripeChargeId ?? undefined,
          payment_intent: stripePaymentIntentId ?? undefined,
          amount: refundAmount.shiftedBy(2).toNumber(),
          reason: 'requested_by_customer',
          refund_application_fee: true,
          reverse_transfer: stripeAccountType !== 'standard',
        }

        const refund = await stripeClient.refunds.create(
          refundOptions,
          stripeAccountType === 'standard'
            ? { stripeAccount: stripeAccountId }
            : undefined
        )

        try {
          await trx
            .insertInto('stripe_resource')
            .values({
              id: refund.id,
              api_version: sql<Date>`cast(${STRIPE_API_VERSION} as date)`,
              object: JSON.stringify(refund),
            })
            .execute()
        } catch (insertionError) {
          console.error(
            'Refund processed but failed to persist Stripe resource',
            {
              paymentId,
              trainerId: authorization.trainerId,
              error: insertionError,
            }
          )
        }
      }

      const salePaymentRow = (await trx
        .selectFrom('payment as payment')
        .innerJoin('trainer', 'trainer.id', 'payment.trainer_id')
        .innerJoin(
          'supported_country_currency as supportedCountryCurrency',
          'supportedCountryCurrency.country_id',
          'trainer.country_id'
        )
        .innerJoin(
          'currency',
          'currency.id',
          'supportedCountryCurrency.currency_id'
        )
        .leftJoin(
          'payment_manual as paymentManual',
          'paymentManual.id',
          'payment.id'
        )
        .leftJoin(
          'payment_credit_pack as paymentCreditPack',
          'paymentCreditPack.id',
          'payment.id'
        )
        .leftJoin(
          'payment_stripe as paymentStripe',
          'paymentStripe.id',
          'payment.id'
        )
        .leftJoin(
          'payment_subscription as paymentSubscription',
          'paymentSubscription.id',
          'payment.id'
        )
        .leftJoin(
          'stripe_payment_intent as stripePaymentIntent',
          'stripePaymentIntent.id',
          'paymentStripe.stripe_payment_intent_id'
        )
        .leftJoin(
          'stripe_charge as stripeCharge',
          'stripeCharge.id',
          'paymentStripe.stripe_charge_id'
        )
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
          ref('paymentSubscription.updated_at').as(
            'paymentSubscriptionUpdatedAt'
          ),
          ref('payment.refunded_time').as('refundedTime'),
          ref('payment.is_manual').as('isManual'),
          ref('payment.is_stripe').as('isStripe'),
          ref('payment.is_credit_pack').as('isCreditPack'),
          ref('payment.is_subscription').as('isSubscription'),
          ref('paymentManual.transaction_time').as('manualTransactionTime'),
          ref('paymentManual.method').as('manualMethod'),
          ref('paymentManual.specific_method_name').as(
            'manualSpecificMethodName'
          ),
          ref('paymentCreditPack.transaction_time').as(
            'creditPackTransactionTime'
          ),
          ref('paymentCreditPack.credits_used').as('creditPackCreditsUsed'),
          ref('paymentCreditPack.sale_credit_pack_id').as(
            'creditPackSaleCreditPackId'
          ),
          ref('paymentStripe.fee').as('stripeFee'),
          ref('stripePaymentIntent.object').as('stripePaymentIntentObject'),
          ref('stripeCharge.object').as('stripeChargeObject'),
          ref('paymentSubscription.subscription_id').as('subscriptionId'),
          ref('paymentSubscription.created_at').as('subscriptionCreatedAt'),
          ref('currency.alpha_code').as('currency'),
        ])
        .where('payment.id', '=', paymentId)
        .where('payment.trainer_id', '=', authorization.trainerId)
        .executeTakeFirst()) as SalePaymentRow | undefined

      if (!salePaymentRow) {
        throw new SalePaymentNotFoundError()
      }

      return salePaymentSchema.parse(adaptSalePaymentRow(salePaymentRow))
    })

    return NextResponse.json(salePayment)
  } catch (error) {
    if (error instanceof SalePaymentNotFoundError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Payment not found',
          detail:
            'We could not find a sale payment with the specified identifier for the authenticated trainer.',
          type: '/sale-payment-not-found',
        }),
        { status: 404 }
      )
    }

    if (error instanceof StripeConfigurationMissingError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Stripe configuration missing',
          detail:
            'Stripe is not configured for this environment. Refunds cannot be processed.',
          type: '/stripe-configuration-missing',
        }),
        { status: 500 }
      )
    }

    if (error instanceof StripePaymentsDisabledError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'Stripe payments not enabled',
          detail:
            'Stripe payments are not enabled for this trainer, so the refund cannot be processed.',
          type: '/stripe-account-pending-creation',
        }),
        { status: 409 }
      )
    }

    if (error instanceof StripeBalanceTooLowError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 503,
          title: 'Balance too low to process refund',
          detail:
            'Your balance is too low to process this refund. Contact support for options.',
          type: '/balance-too-low-for-refund',
        }),
        { status: 503 }
      )
    }

    if (error instanceof Stripe.errors.StripeError) {
      console.error('Stripe API error while processing refund', {
        trainerId: authorization.trainerId,
        paymentId,
        error,
      })

      return NextResponse.json(
        buildErrorResponse({
          status: 502,
          title: 'Stripe API error',
          detail:
            'Stripe reported an error while processing the refund. Try again later.',
          type: '/stripe-api-error',
        }),
        { status: 502 }
      )
    }

    if (error instanceof ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse sale payment data from database',
          detail:
            'Sale payment data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to refund sale payment', {
      trainerId: authorization.trainerId,
      paymentId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to refund sale payment',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
