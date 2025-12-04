import { NextRequest, NextResponse } from 'next/server'
import BigNumber from 'bignumber.js'
import Stripe from 'stripe'
import { z, ZodError } from 'zod'
import { db, sql, type Selectable, type VwLegacyPlanPayment } from '@/lib/db'
import { authenticateTrainerRequest, buildErrorResponse } from '../../../_lib/accessToken'
import { getStripeClient, STRIPE_API_VERSION } from '../../../_lib/stripeClient'
import { planPaymentSchema, planPaymentStatusSchema } from '../../../plans/shared'

const paramsSchema = z.object({
  paymentPlanPaymentId: z
    .string()
    .trim()
    .min(1, 'Payment plan payment id is required')
    .uuid({ message: 'Payment plan payment id must be a valid UUID' }),
})

type HandlerContext = { params: Promise<Record<string, string>> }

class PlanPaymentNotFoundError extends Error {
  constructor() {
    super('Plan payment not found')
    this.name = 'PlanPaymentNotFoundError'
  }
}

class PaymentAlreadyRefundedError extends Error {
  constructor() {
    super('Payment has already been refunded')
    this.name = 'PaymentAlreadyRefundedError'
  }
}

class CantRefundNonPaidError extends Error {
  constructor() {
    super('Cannot refund a non-paid plan payment')
    this.name = 'CantRefundNonPaidError'
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

const stripeDetailsSchema = z
  .object({
    status: planPaymentStatusSchema,
    amount: z.union([z.string(), z.number()]),
    stripeChargeId: z.string().nullable(),
    stripePaymentIntentId: z.string().nullable(),
    stripeAccountId: z.string().nullable(),
    stripeAccountType: z.enum(['standard', 'custom', 'express']).nullable(),
    applicationFeeAmount: z.union([z.string(), z.number()]).nullable(),
    minimumBalance: z.union([z.string(), z.number()]),
  })
  .superRefine((value, ctx) => {
    const hasCharge = value.stripeChargeId !== null && value.stripeChargeId !== undefined
    const hasPaymentIntent = value.stripePaymentIntentId !== null && value.stripePaymentIntentId !== undefined

    if (hasCharge === hasPaymentIntent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Plan payment must have either a Stripe charge id or payment intent id',
        path: ['stripeChargeId'],
      })
    }
  })

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

const toBigNumberOrZero = (value: string | number | null | undefined, label: string) => {
  if (value === null || value === undefined) {
    return new BigNumber(0)
  }

  return toBigNumber(value, label)
}

const sumStripeBalanceEntries = (entries: Array<{ amount: number; currency: string }>) =>
  entries.reduce((total, entry) => total.plus(new BigNumber(entry.amount).shiftedBy(-2)), new BigNumber(0))

type RawPlanPayment = Selectable<VwLegacyPlanPayment>

const ensureNumber = (value: number | string | null | undefined, label: string): number => {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${label}`)
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid ${label}`)
    }
    return value
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new Error(`Invalid ${label}`)
  }

  const parsed = Number.parseFloat(trimmed)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${label}`)
  }

  return parsed
}

const ensureDate = (value: Date | string | null | undefined, label: string): Date => {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`Invalid ${label}`)
    }
    return value
  }

  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }
  }

  throw new Error(`Invalid ${label}`)
}

const adaptPlanPaymentRow = (row: RawPlanPayment) => {
  if (!row.id || !row.planId || !row.currency) {
    throw new Error('Plan payment row is missing required identifiers')
  }

  if (!row.status) {
    throw new Error('Plan payment row is missing status')
  }

  const statusParse = planPaymentStatusSchema.safeParse(row.status)
  if (!statusParse.success) {
    throw new Error('Plan payment row has unsupported status')
  }

  return planPaymentSchema.parse({
    id: row.id,
    planId: row.planId,
    currency: row.currency,
    status: statusParse.data,
    amount: ensureNumber(row.amount, 'amount'),
    outstandingAmount: ensureNumber(row.outstandingAmount, 'outstanding amount'),
    date: ensureDate(row.date, 'date').toISOString(),
  })
}

export async function PUT(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map((issue) => issue.message).join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid path parameters',
        detail: detail || 'Request parameters did not match the expected schema.',
        type: '/invalid-path',
      }),
      { status: 400 }
    )
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while refunding plan payment',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { paymentPlanPaymentId } = paramsResult.data

  try {
    const planPayment = await db.transaction().execute(async (trx) => {
      const rawDetails = await trx
        .selectFrom('payment_plan_payment as paymentPlanPayment')
        .innerJoin('payment_plan', 'payment_plan.id', 'paymentPlanPayment.payment_plan_id')
        .innerJoin('trainer', 'trainer.id', 'payment_plan.trainer_id')
        .innerJoin(
          'payment_plan_charge as paymentPlanCharge',
          'paymentPlanCharge.payment_plan_payment_id',
          'paymentPlanPayment.id'
        )
        .leftJoin('stripe.account as stripeAccount', 'stripeAccount.id', 'trainer.stripe_account_id')
        .select((eb) => [
          eb.ref('paymentPlanPayment.status').as('status'),
          eb.ref('paymentPlanPayment.amount').as('amount'),
          eb.ref('paymentPlanPayment.fee').as('applicationFeeAmount'),
          eb.ref('paymentPlanCharge.stripe_charge_id').as('stripeChargeId'),
          eb.ref('paymentPlanCharge.stripe_payment_intent_id').as('stripePaymentIntentId'),
          eb.ref('trainer.stripe_account_id').as('stripeAccountId'),
          eb.ref('trainer.minimum_balance').as('minimumBalance'),
          sql<string | null>`stripeAccount.object ->> 'type'`.as('stripeAccountType'),
        ])
        .where('paymentPlanPayment.id', '=', paymentPlanPaymentId)
        .where('paymentPlanPayment.trainer_id', '=', authorization.trainerId)
        .executeTakeFirst()

      const detailsResult = stripeDetailsSchema.safeParse(rawDetails)
      if (!detailsResult.success) {
        throw new PlanPaymentNotFoundError()
      }

      const details = detailsResult.data

      if (details.status === 'refunded') {
        throw new PaymentAlreadyRefundedError()
      }

      if (details.status !== 'paid') {
        throw new CantRefundNonPaidError()
      }

      await trx
        .updateTable('payment_plan_payment')
        .set({
          status: 'refunded',
          amount_outstanding: details.amount,
        })
        .where('id', '=', paymentPlanPaymentId)
        .where('trainer_id', '=', authorization.trainerId)
        .execute()

      const stripeChargeId = details.stripeChargeId === null ? undefined : details.stripeChargeId
      const stripePaymentIntentId = details.stripePaymentIntentId === null ? undefined : details.stripePaymentIntentId

      const refundAmount = toBigNumber(details.amount, 'payment amount')
      const applicationFeeAmount = toBigNumberOrZero(details.applicationFeeAmount, 'application fee amount')
      const minimumBalanceAmount = toBigNumberOrZero(details.minimumBalance, 'minimum balance')

      if (stripeChargeId || stripePaymentIntentId) {
        const stripeClient = getStripeClient()

        if (!stripeClient) {
          throw new StripeConfigurationMissingError()
        }

        const stripeAccountId = details.stripeAccountId
        const stripeAccountType = details.stripeAccountType

        if (!stripeAccountId || !stripeAccountType || stripeAccountType === 'express') {
          throw new StripePaymentsDisabledError()
        }

        const stripeBalance = await stripeClient.balance.retrieve({
          stripeAccount: stripeAccountId,
        })

        const totalBalance = sumStripeBalanceEntries(stripeBalance.available).plus(
          sumStripeBalanceEntries(stripeBalance.pending)
        )

        const balanceAfterRefund = totalBalance.minus(refundAmount).plus(applicationFeeAmount)

        if (balanceAfterRefund.isLessThan(minimumBalanceAmount) && stripeAccountType === 'custom') {
          throw new StripeBalanceTooLowError()
        }

        const refundOptions: Stripe.RefundCreateParams = {
          charge: stripeChargeId,
          payment_intent: stripePaymentIntentId,
          amount: refundAmount.shiftedBy(2).toNumber(),
          reason: 'requested_by_customer',
          refund_application_fee: true,
          reverse_transfer: stripeAccountType !== 'standard',
        }

        const refund = await stripeClient.refunds.create(
          refundOptions,
          stripeAccountType === 'standard' ? { stripeAccount: stripeAccountId } : undefined
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
          console.error('Refund processed but failed to persist Stripe resource', {
            paymentPlanPaymentId,
            trainerId: authorization.trainerId,
            error: insertionError,
          })
        }
      }

      const planPaymentRow = (await trx
        .selectFrom('vw_legacy_plan_payment as planPayment')
        .selectAll('planPayment')
        .where('planPayment.id', '=', paymentPlanPaymentId)
        .executeTakeFirst()) as RawPlanPayment | undefined

      if (!planPaymentRow) {
        throw new PlanPaymentNotFoundError()
      }

      return adaptPlanPaymentRow(planPaymentRow)
    })

    return NextResponse.json(planPayment)
  } catch (error) {
    if (error instanceof PlanPaymentNotFoundError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Plan payment not found',
          detail: 'We could not find a plan payment with the specified identifier for the authenticated trainer.',
          type: '/plan-payment-not-found',
        }),
        { status: 404 }
      )
    }

    if (error instanceof PaymentAlreadyRefundedError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'Payment already refunded',
          detail: 'This plan payment has already been refunded.',
          type: '/cant-refund-refunded',
        }),
        { status: 409 }
      )
    }

    if (error instanceof CantRefundNonPaidError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'Cannot refund unpaid plan payment',
          detail: 'Only paid plan payments can be refunded.',
          type: '/cant-refund-non-paid',
        }),
        { status: 409 }
      )
    }

    if (error instanceof StripeConfigurationMissingError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Stripe configuration missing',
          detail: 'Stripe is not configured for this environment. Refunds cannot be processed.',
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
          detail: 'Stripe payments are not enabled for this trainer, so the refund cannot be processed.',
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
          detail: 'Your balance is too low to process this refund. Contact support for options.',
          type: '/balance-too-low-for-refund',
        }),
        { status: 503 }
      )
    }

    if (error instanceof Stripe.errors.StripeError) {
      console.error('Stripe API error while processing plan payment refund', {
        trainerId: authorization.trainerId,
        paymentPlanPaymentId,
        error,
      })

      return NextResponse.json(
        buildErrorResponse({
          status: 502,
          title: 'Stripe API error',
          detail: 'Stripe reported an error while processing the refund. Try again later.',
          type: '/stripe-api-error',
        }),
        { status: 502 }
      )
    }

    if (error instanceof ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse plan payment data from database',
          detail: 'Plan payment data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to refund plan payment', {
      trainerId: authorization.trainerId,
      paymentPlanPaymentId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to refund plan payment',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
