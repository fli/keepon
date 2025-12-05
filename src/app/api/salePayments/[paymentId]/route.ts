import { NextRequest, NextResponse } from 'next/server'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import { authenticateTrainerOrClientRequest, authenticateTrainerRequest, buildErrorResponse } from '../../_lib/accessToken'
import { adaptSalePaymentRow, manualMethodSchema, salePaymentSchema, type SalePaymentRow } from '../../_lib/salePayments'

const paramsSchema = z.object({
  paymentId: z.string().trim().min(1, 'Payment id is required').uuid({ message: 'Payment id must be a valid UUID' }),
})

type HandlerContext = RouteContext<'/api/salePayments/[paymentId]'>

class SalePaymentNotFoundError extends Error {
  constructor() {
    super('Sale payment not found')
    this.name = 'SalePaymentNotFoundError'
  }
}

class StripePaymentDeletionNotAllowedError extends Error {
  constructor() {
    super("You can't delete a Stripe payment")
    this.name = 'StripePaymentDeletionNotAllowedError'
  }
}

const normalizeDeletedCount = (value: unknown) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }

  if (typeof value === 'bigint') {
    return Number(value)
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

const patchRequestBodySchema = z
  .object({
    method: manualMethodSchema.optional(),
    specificMethodName: z
      .union([z.string(), z.null()])
      .optional()
      .transform((value) => {
        if (value === undefined) return undefined
        if (value === null) return null
        const trimmed = value.trim()
        return trimmed.length > 0 ? trimmed : null
      }),
    saleCreditPackId: z.string().trim().min(1, 'saleCreditPackId is required').optional(),
    creditsUsed: z.number().int().min(0, 'creditsUsed must be zero or greater').optional(),
    transactedAt: z.string().datetime({ offset: true }).optional(),
    paymentPlanId: z.string().trim().min(1, 'paymentPlanId is required').optional(),
  })
  .strict()

type PaymentTypeFlags = {
  isManual: boolean | null
  isCreditPack: boolean | null
  isSubscription: boolean | null
  isStripe: boolean | null
}

type SalePaymentType = 'manual' | 'creditPack' | 'subscription' | 'stripe'

const detectPaymentType = (flags: PaymentTypeFlags): SalePaymentType => {
  const candidates: Array<{ type: SalePaymentType; value: boolean }> = [
    { type: 'manual', value: flags.isManual === true },
    { type: 'creditPack', value: flags.isCreditPack === true },
    { type: 'subscription', value: flags.isSubscription === true },
    { type: 'stripe', value: flags.isStripe === true },
  ]

  const active = candidates.filter((candidate) => candidate.value)

  if (active.length !== 1) {
    throw new Error('Sale payment row has unsupported type flags')
  }

  return active[0].type
}

const fetchSalePayment = async (paymentId: string, trainerId: string) => {
  const salePaymentRow = (await db
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
    .where('payment.id', '=', paymentId)
    .where('payment.trainer_id', '=', trainerId)
    .executeTakeFirst()) as SalePaymentRow | undefined

  if (!salePaymentRow) {
    throw new SalePaymentNotFoundError()
  }

  return salePaymentSchema.parse(adaptSalePaymentRow(salePaymentRow))
}

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

export async function DELETE(request: NextRequest, context: HandlerContext) {
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

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while deleting sale payment',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { paymentId } = paramsResult.data

  try {
    await db.transaction().execute(async (trx) => {
      const paymentRow = await trx
        .selectFrom('payment')
        .select(['is_stripe'])
        .where('payment.id', '=', paymentId)
        .where('payment.trainer_id', '=', authorization.trainerId)
        .executeTakeFirst()

      if (!paymentRow) {
        throw new SalePaymentNotFoundError()
      }

      if (paymentRow.is_stripe) {
        throw new StripePaymentDeletionNotAllowedError()
      }

      const deleteResult = await trx
        .deleteFrom('payment')
        .where('payment.id', '=', paymentId)
        .where('payment.trainer_id', '=', authorization.trainerId)
        .executeTakeFirst()

      const deletedCount = normalizeDeletedCount(deleteResult?.numDeletedRows ?? 0)

      if (deletedCount === 0) {
        throw new SalePaymentNotFoundError()
      }
    })

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    if (error instanceof SalePaymentNotFoundError) {
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

    if (error instanceof StripePaymentDeletionNotAllowedError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: "You can't delete a Stripe payment.",
          type: '/cant-delete-stripe-payment',
        }),
        { status: 409 }
      )
    }

    console.error('Failed to delete sale payment', {
      trainerId: authorization.trainerId,
      paymentId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to delete sale payment',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest, context: HandlerContext) {
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

  let parsedBody: z.infer<typeof patchRequestBodySchema>
  try {
    const rawText = await request.text()
    const rawBody: unknown = rawText.trim().length === 0 ? {} : (JSON.parse(rawText) as unknown)

    const bodyResult = patchRequestBodySchema.safeParse(rawBody)

    if (!bodyResult.success) {
      const detail = bodyResult.error.issues.map((issue) => issue.message).join('; ')

      return NextResponse.json(
        buildErrorResponse({
          status: 400,
          title: 'Invalid request body',
          detail: detail || 'Request body did not match the expected schema.',
          type: '/invalid-body',
        }),
        { status: 400 }
      )
    }

    parsedBody = bodyResult.data
  } catch (error) {
    console.error('Failed to parse sale payment update request body', error)
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

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while updating sale payment',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { paymentId } = paramsResult.data
  const hasUpdates = Object.values(parsedBody).some((value) => value !== undefined)

  try {
    if (hasUpdates) {
      await db.transaction().execute(async (trx) => {
        const paymentFlags = await trx
          .selectFrom('payment as payment')
          .select((eb) => [
            eb.ref('payment.is_manual').as('isManual'),
            eb.ref('payment.is_credit_pack').as('isCreditPack'),
            eb.ref('payment.is_subscription').as('isSubscription'),
            eb.ref('payment.is_stripe').as('isStripe'),
          ])
          .where('payment.id', '=', paymentId)
          .where('payment.trainer_id', '=', authorization.trainerId)
          .executeTakeFirst()

        if (!paymentFlags) {
          throw new SalePaymentNotFoundError()
        }

        const paymentType = detectPaymentType(paymentFlags)

        if (paymentType === 'manual') {
          const updatePayload: Record<string, unknown> = {}

          if (Object.prototype.hasOwnProperty.call(parsedBody, 'method')) {
            updatePayload.method = parsedBody.method
          }

          if (Object.prototype.hasOwnProperty.call(parsedBody, 'specificMethodName')) {
            updatePayload.specific_method_name = parsedBody.specificMethodName ?? null
          }

          if (Object.prototype.hasOwnProperty.call(parsedBody, 'transactedAt')) {
            updatePayload.transaction_time = new Date(parsedBody.transactedAt as string)
          }

          if (Object.keys(updatePayload).length > 0) {
            updatePayload.updated_at = sql<Date>`NOW()`

            await trx
              .updateTable('payment_manual')
              .set(updatePayload)
              .where('payment_manual.id', '=', paymentId)
              .where('payment_manual.trainer_id', '=', authorization.trainerId)
              .executeTakeFirst()
          }
        }

        if (paymentType === 'creditPack') {
          const updatePayload: Record<string, unknown> = {}

          if (Object.prototype.hasOwnProperty.call(parsedBody, 'saleCreditPackId')) {
            updatePayload.sale_credit_pack_id = parsedBody.saleCreditPackId
          }

          if (Object.prototype.hasOwnProperty.call(parsedBody, 'creditsUsed')) {
            updatePayload.credits_used = parsedBody.creditsUsed
          }

          if (Object.prototype.hasOwnProperty.call(parsedBody, 'transactedAt')) {
            updatePayload.transaction_time = new Date(parsedBody.transactedAt as string)
          }

          if (Object.keys(updatePayload).length > 0) {
            updatePayload.updated_at = sql<Date>`NOW()`

            await trx
              .updateTable('payment_credit_pack')
              .set(updatePayload)
              .where('payment_credit_pack.id', '=', paymentId)
              .where('payment_credit_pack.trainer_id', '=', authorization.trainerId)
              .executeTakeFirst()
          }
        }

        if (paymentType === 'subscription') {
          if (Object.prototype.hasOwnProperty.call(parsedBody, 'paymentPlanId')) {
            await trx
              .updateTable('payment_subscription')
              .set({
                subscription_id: parsedBody.paymentPlanId,
                updated_at: sql<Date>`NOW()`,
              })
              .where('payment_subscription.id', '=', paymentId)
              .where('payment_subscription.trainer_id', '=', authorization.trainerId)
              .executeTakeFirst()
          }
        }

        // Stripe payments do not support updates via this endpoint
      })
    }

    const salePayment = await fetchSalePayment(paymentId, authorization.trainerId)

    return NextResponse.json(salePayment)
  } catch (error) {
    if (error instanceof SalePaymentNotFoundError) {
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

    console.error('Failed to update sale payment', {
      trainerId: authorization.trainerId,
      paymentId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to update sale payment',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
