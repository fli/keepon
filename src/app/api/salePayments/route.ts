import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import BigNumber from 'bignumber.js'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import { authenticateTrainerOrClientRequest, buildErrorResponse } from '../_lib/accessToken'
import { adaptSalePaymentRow, salePaymentSchema, type SalePaymentRow } from '../_lib/salePayments'
import { getStripeClient, STRIPE_API_VERSION } from '../_lib/stripeClient'
import {
  currencyChargeLimits,
  getTransactionFee,
  CurrencyNotSupportedError,
  CountryNotSupportedError,
} from '../_lib/transactionFees'
import { APP_NAME } from '../_lib/constants'

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

const stripeApiVersionDate = STRIPE_API_VERSION.split('.')[0]

class SaleNotFoundError extends Error {
  constructor() {
    super('Sale not found')
    this.name = 'SaleNotFoundError'
  }
}

class SaleAlreadyPaidError extends Error {
  constructor() {
    super('Sale already has a payment')
    this.name = 'SaleAlreadyPaidError'
  }
}

class PaymentAmountMismatchError extends Error {
  constructor() {
    super('Payment amount must match sale total')
    this.name = 'PaymentAmountMismatchError'
  }
}

class ClientStripeOnlyError extends Error {
  constructor() {
    super('Clients may only pay using Stripe')
    this.name = 'ClientStripeOnlyError'
  }
}

class SaleCreditPackNotFoundError extends Error {
  constructor() {
    super('Sale credit pack not found')
    this.name = 'SaleCreditPackNotFoundError'
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

class StripeCardRequiredError extends Error {
  constructor() {
    super('Only card payments are supported')
    this.name = 'StripeCardRequiredError'
  }
}

class StripePaymentIntentMismatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StripePaymentIntentMismatchError'
  }
}

class StripeActionRequiredError extends Error {
  constructor(public clientSecret: string) {
    super('Additional Stripe authentication required')
    this.name = 'StripeActionRequiredError'
  }
}

class InvalidFeeConfigurationError extends Error {
  constructor() {
    super('Invalid fee configuration')
    this.name = 'InvalidFeeConfigurationError'
  }
}

class AmountOutOfRangeError extends Error {
  constructor() {
    super('Amount is outside supported limits for this currency')
    this.name = 'AmountOutOfRangeError'
  }
}

class StripePaymentFailedError extends Error {
  constructor() {
    super('Stripe payment did not succeed')
    this.name = 'StripePaymentFailedError'
  }
}

const saleDetailsSchema = z.object({
  paymentStatus: z.string().nullable(),
  saleProductPrice: z.union([z.string(), z.number()]),
  currency: z.string(),
  clientId: z.string(),
  trainerId: z.string(),
  locale: z.string(),
  trainerUserId: z.string(),
  paymentRequestPassOnTransactionFee: z.boolean(),
  country: z.string(),
  stripeAccountId: z.string().nullable(),
  stripePaymentsBlocked: z.boolean().nullable(),
  stripeAccountType: z.enum(['standard', 'custom', 'express']).nullable(),
  clientEmail: z.string().nullable(),
  clientFirstName: z.string(),
  clientLastName: z.string().nullable(),
  trainerEmail: z.string(),
  stripeCustomerId: z.string().nullable(),
  productName: z.string(),
  saleProductId: z.string(),
  saleCreditPackId: z.string().nullable(),
})

const amountSchema = z
  .union([z.string(), z.number()])
  .transform((value) => value.toString())
  .refine((value) => {
    const amount = new BigNumber(value)
    return amount.isFinite() && amount.gte(0)
  }, 'amount must be a non-negative number')

const isoDateTimeSchema = z.string().datetime({ offset: true }).nullable().optional()

const baseRequestSchema = z.object({
  saleId: z.string().uuid({ message: 'saleId must be a valid UUID' }),
  amount: amountSchema,
  currency: z.string().trim().min(1),
})

const manualRequestSchema = baseRequestSchema.extend({
  type: z.literal('manual'),
  method: z.enum(['cash', 'electronic']),
  specificMethodName: z.string().nullable().optional(),
  transactedAt: isoDateTimeSchema,
})

const creditPackRequestSchema = baseRequestSchema.extend({
  type: z.literal('creditPack'),
  saleCreditPackId: z.string().trim().min(1, 'saleCreditPackId is required'),
  creditsUsed: z.number().int().min(0, 'creditsUsed must be zero or greater'),
  transactedAt: isoDateTimeSchema,
})

const subscriptionRequestSchema = baseRequestSchema.extend({
  type: z.literal('subscription'),
  paymentPlanId: z.string().trim().min(1, 'paymentPlanId is required'),
  transactedAt: isoDateTimeSchema,
})

const stripeRequestSchema = baseRequestSchema
  .extend({
    type: z.literal('stripe'),
    stripePaymentMethodId: z.string().trim().optional(),
    stripePaymentIntentId: z.string().trim().optional(),
    usingMobileSdk: z.boolean().optional(),
    passOnFee: z.boolean().optional(),
    setupFutureUsage: z.boolean().optional(),
  })
  .refine(
    (value) => Boolean(value.stripePaymentMethodId) !== Boolean(value.stripePaymentIntentId),
    'Provide either stripePaymentMethodId or stripePaymentIntentId.'
  )

const requestSchema = z.discriminatedUnion('type', [
  manualRequestSchema,
  creditPackRequestSchema,
  subscriptionRequestSchema,
  stripeRequestSchema,
])

const parseTransactedAt = (value: string | null | undefined) => {
  if (!value) {
    return new Date()
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid transaction timestamp')
  }
  return parsed
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
    throw new SaleNotFoundError()
  }

  return salePaymentSchema.parse(adaptSalePaymentRow(salePaymentRow))
}

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

  const authorization = await authenticateTrainerOrClientRequest(request, {
    trainerExtensionFailureLogMessage: 'Failed to extend access token expiry while creating sale payment for trainer',
    clientExtensionFailureLogMessage: 'Failed to extend access token expiry while creating sale payment for client',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const payload = parsed.data
  const amountValue = new BigNumber(payload.amount)

  try {
    const paymentMeta = await db.transaction().execute(async (trx) => {
      const saleDetailsRow = await trx
        .selectFrom('sale as sale')
        .innerJoin('sale_payment_status as salePaymentStatus', 'salePaymentStatus.sale_id', 'sale.id')
        .innerJoin('sale_product as saleProduct', 'saleProduct.sale_id', 'sale.id')
        .innerJoin('client as client', 'client.id', 'sale.client_id')
        .innerJoin('trainer as trainer', 'trainer.id', 'sale.trainer_id')
        .innerJoin(
          'supported_country_currency as supportedCountryCurrency',
          'supportedCountryCurrency.country_id',
          'trainer.country_id'
        )
        .innerJoin('country as country', 'country.id', 'supportedCountryCurrency.country_id')
        .innerJoin('currency as currency', 'currency.id', 'supportedCountryCurrency.currency_id')
        .leftJoin('stripe.account as stripeAccount', 'stripeAccount.id', 'trainer.stripe_account_id')
        .leftJoin('sale_credit_pack as saleCreditPack', 'saleCreditPack.id', 'saleProduct.id')
        .select((eb) => [
          eb.ref('salePaymentStatus.payment_status').as('paymentStatus'),
          eb.ref('saleProduct.price').as('saleProductPrice'),
          eb.ref('currency.alpha_code').as('currency'),
          eb.ref('sale.client_id').as('clientId'),
          eb.ref('sale.trainer_id').as('trainerId'),
          eb.ref('trainer.locale').as('locale'),
          eb.ref('trainer.user_id').as('trainerUserId'),
          eb.ref('sale.payment_request_pass_on_transaction_fee').as('paymentRequestPassOnTransactionFee'),
          eb.ref('country.alpha_2_code').as('country'),
          eb.ref('trainer.stripe_account_id').as('stripeAccountId'),
          eb.ref('trainer.stripe_payments_blocked').as('stripePaymentsBlocked'),
          sql<string | null>`stripeAccount.object ->> 'type'`.as('stripeAccountType'),
          eb.ref('client.email').as('clientEmail'),
          eb.ref('client.first_name').as('clientFirstName'),
          eb.ref('client.last_name').as('clientLastName'),
          eb.ref('client.stripe_customer_id').as('stripeCustomerId'),
          eb.ref('trainer.email').as('trainerEmail'),
          eb.ref('saleProduct.name').as('productName'),
          eb.ref('saleProduct.id').as('saleProductId'),
          eb.ref('saleCreditPack.id').as('saleCreditPackId'),
        ])
        .where('sale.id', '=', payload.saleId)
        .where((eb) =>
          authorization.actor === 'trainer'
            ? eb('sale.trainer_id', '=', authorization.trainerId)
            : eb('sale.client_id', '=', authorization.clientId)
        )
        .executeTakeFirst()

      if (!saleDetailsRow) {
        throw new SaleNotFoundError()
      }

      const saleDetails = saleDetailsSchema.parse(saleDetailsRow)

      if (saleDetails.paymentStatus && saleDetails.paymentStatus !== 'none' && saleDetails.paymentStatus !== 'requested') {
        throw new SaleAlreadyPaidError()
      }

      const salePrice = new BigNumber(saleDetails.saleProductPrice)
      if (!salePrice.isFinite() || !salePrice.eq(amountValue)) {
        throw new PaymentAmountMismatchError()
      }

      if (authorization.actor === 'client' && payload.type !== 'stripe') {
        throw new ClientStripeOnlyError()
      }

      if (payload.type === 'creditPack') {
        if (!saleDetails.saleCreditPackId || saleDetails.saleCreditPackId !== payload.saleCreditPackId) {
          throw new SaleCreditPackNotFoundError()
        }
      }

      const paymentRow = await trx
        .insertInto('payment')
        .values({
          trainer_id: saleDetails.trainerId,
          client_id: saleDetails.clientId,
          sale_id: payload.saleId,
          amount: amountValue.toString(),
          is_manual: payload.type === 'manual',
          is_credit_pack: payload.type === 'creditPack',
          is_subscription: payload.type === 'subscription',
          is_stripe: payload.type === 'stripe',
          is_scheduled_stripe: payload.type === 'stripe' ? false : null,
        })
        .returning('id')
        .executeTakeFirst()

      if (!paymentRow) {
        throw new Error('Failed to insert payment')
      }

      const paymentId = paymentRow.id

      const markSalePaid = async () => {
        await trx.updateTable('sale_payment_status').set({ payment_status: 'paid' }).where('sale_id', '=', payload.saleId).execute()
      }

      if (payload.type === 'manual') {
        const transactionTime = parseTransactedAt(payload.transactedAt)
        await trx
          .insertInto('payment_manual')
          .values({
            id: paymentId,
            trainer_id: saleDetails.trainerId,
            method: payload.method,
            specific_method_name: payload.specificMethodName ?? null,
            transaction_time: transactionTime,
            is_manual: true,
          })
          .execute()

        await markSalePaid()

        return { paymentId, trainerId: saleDetails.trainerId }
      }

      if (payload.type === 'creditPack') {
        const transactionTime = parseTransactedAt(payload.transactedAt)
        await trx
          .insertInto('payment_credit_pack')
          .values({
            id: paymentId,
            trainer_id: saleDetails.trainerId,
            sale_credit_pack_id: payload.saleCreditPackId,
            transaction_time: transactionTime,
            credits_used: payload.creditsUsed,
            is_credit_pack: true,
          })
          .execute()

        await markSalePaid()

        return { paymentId, trainerId: saleDetails.trainerId }
      }

      if (payload.type === 'subscription') {
        await trx
          .insertInto('payment_subscription')
          .values({
            id: paymentId,
            trainer_id: saleDetails.trainerId,
            subscription_id: payload.paymentPlanId,
            is_subscription: true,
          })
          .execute()

        await markSalePaid()

        return { paymentId, trainerId: saleDetails.trainerId }
      }

      // Stripe payments
      const stripeClient = getStripeClient()
      if (!stripeClient) {
        throw new StripeConfigurationMissingError()
      }

      if (saleDetails.stripePaymentsBlocked) {
        throw new StripePaymentsDisabledError()
      }

      const stripeAccountType = saleDetails.stripeAccountType ?? undefined
      const stripeAccountId = saleDetails.stripeAccountId ?? undefined

      if (!stripeAccountId || !stripeAccountType || (stripeAccountType !== 'standard' && stripeAccountType !== 'custom')) {
        throw new StripePaymentsDisabledError()
      }

      const currency = saleDetails.currency.trim().toUpperCase()
      const chargeCountry = saleDetails.country.trim().toUpperCase()
      const limits = currencyChargeLimits[currency as keyof typeof currencyChargeLimits]

      if (!limits) {
        throw new CurrencyNotSupportedError(currency)
      }

      const amountRounded = amountValue.decimalPlaces(limits.smallestUnitDecimals)
      const minAmount = new BigNumber(limits.minimumInSmallestUnit).shiftedBy(-limits.smallestUnitDecimals)
      const maxAmount = new BigNumber(limits.maximumInSmallestUnit).shiftedBy(-limits.smallestUnitDecimals)

      if (amountRounded.lt(minAmount) || amountRounded.gt(maxAmount)) {
        throw new AmountOutOfRangeError()
      }

      const stripeRequestOptions = stripeAccountType === 'standard' ? { stripeAccount: stripeAccountId } : undefined

      let customerId = saleDetails.stripeCustomerId ?? null

      if (!customerId) {
        const customer = await stripeClient.customers.create(
          {
            description: `Customer for ${saleDetails.trainerEmail}`,
            email: saleDetails.clientEmail ?? undefined,
            metadata: { clientId: saleDetails.clientId },
          },
          stripeRequestOptions
        )

        customerId = customer.id

        await trx
          .insertInto('stripe.customer')
          .values({
            id: customer.id,
            api_version: sql<Date>`cast(${stripeApiVersionDate} as date)`,
            object: JSON.stringify(customer),
          })
          .onConflict((oc) =>
            oc.column('id').doUpdateSet({
              api_version: sql<Date>`cast(${stripeApiVersionDate} as date)`,
              object: JSON.stringify(customer),
            })
          )
          .execute()

        await trx.updateTable('client').set({ stripe_customer_id: customer.id }).where('id', '=', saleDetails.clientId).execute()
      }

      let paymentMethod: Stripe.PaymentMethod

      if (payload.stripePaymentIntentId) {
        const paymentIntent = await stripeClient.paymentIntents.retrieve(
          payload.stripePaymentIntentId,
          { expand: ['payment_method'] },
          stripeRequestOptions
        )

        if (!paymentIntent.payment_method || typeof paymentIntent.payment_method === 'string') {
          throw new StripeCardRequiredError()
        }

        paymentMethod = paymentIntent.payment_method
      } else {
        if (!payload.stripePaymentMethodId) {
          throw new StripeCardRequiredError()
        }

        paymentMethod = await stripeClient.paymentMethods.retrieve(payload.stripePaymentMethodId, {}, stripeRequestOptions)
      }

      if (!paymentMethod.card) {
        throw new StripeCardRequiredError()
      }

      const cardCountry = (paymentMethod.card.country || chargeCountry).toUpperCase()

      const fee = getTransactionFee({
        cardCountry,
        chargeCountry,
        currency,
      })

      const denominator = new BigNumber(1).minus(fee.percentageFee)
      if (denominator.isZero()) {
        throw new InvalidFeeConfigurationError()
      }

      const passOnFee = authorization.actor === 'trainer'
        ? payload.passOnFee ?? false
        : saleDetails.paymentRequestPassOnTransactionFee

      const amountToUse = amountRounded.decimalPlaces(limits.smallestUnitDecimals)
      let transactionFee: BigNumber
      let chargeAmount: BigNumber

      if (passOnFee) {
        transactionFee = amountToUse
          .plus(fee.fixedFee)
          .dividedBy(denominator)
          .minus(amountToUse)
          .decimalPlaces(limits.smallestUnitDecimals)
        chargeAmount = amountToUse.plus(transactionFee)
      } else {
        transactionFee = amountToUse
          .multipliedBy(fee.percentageFee)
          .plus(fee.fixedFee)
          .decimalPlaces(limits.smallestUnitDecimals)
        chargeAmount = amountToUse
      }

      if (chargeAmount.lt(minAmount) || chargeAmount.gt(maxAmount)) {
        throw new AmountOutOfRangeError()
      }

      const chargeAmountInSmallestUnit = chargeAmount
        .shiftedBy(limits.smallestUnitDecimals)
        .integerValue(BigNumber.ROUND_HALF_UP)
        .toNumber()

      const applicationFeeAmount = transactionFee
        .shiftedBy(limits.smallestUnitDecimals)
        .integerValue(BigNumber.ROUND_HALF_UP)
        .toNumber()

      let paymentIntent: Stripe.Response<Stripe.PaymentIntent>

      if (payload.stripePaymentIntentId) {
        const existingIntent = await stripeClient.paymentIntents.retrieve(
          payload.stripePaymentIntentId,
          { expand: ['payment_method'] },
          stripeRequestOptions
        )

        if (existingIntent.amount !== chargeAmountInSmallestUnit) {
          throw new StripePaymentIntentMismatchError('Payment intent amount does not match sale total')
        }

        if (existingIntent.application_fee_amount !== applicationFeeAmount) {
          throw new StripePaymentIntentMismatchError('Payment intent application fee does not match expected fee')
        }

        paymentIntent = await stripeClient.paymentIntents.confirm(existingIntent.id, undefined, stripeRequestOptions)
      } else {
        paymentIntent = await stripeClient.paymentIntents.create(
          {
            amount: chargeAmountInSmallestUnit,
            currency: currency.toLowerCase(),
            payment_method_types: ['card'],
            customer: customerId,
            description: `Payment for ${saleDetails.productName}`,
            receipt_email: saleDetails.clientEmail ?? undefined,
            statement_descriptor_suffix: `VIA ${APP_NAME}`,
            payment_method: paymentMethod.id,
            application_fee_amount: applicationFeeAmount,
            on_behalf_of: stripeAccountType === 'standard' ? undefined : stripeAccountId,
            transfer_data: stripeAccountType === 'standard' ? undefined : { destination: stripeAccountId },
            confirmation_method: 'manual',
            confirm: true,
            setup_future_usage: authorization.actor === 'client' && payload.setupFutureUsage ? 'off_session' : undefined,
            use_stripe_sdk: true,
            payment_method_options: {
              card: {
                request_three_d_secure: stripeAccountType === 'standard' ? 'automatic' : 'any',
              },
            },
          },
          stripeRequestOptions
        )
      }

      if (paymentIntent.status === 'requires_action') {
        if (!paymentIntent.client_secret) {
          throw new StripeActionRequiredError('')
        }
        throw new StripeActionRequiredError(paymentIntent.client_secret)
      }

      if (paymentIntent.status !== 'succeeded') {
        throw new StripePaymentFailedError()
      }

      await trx
        .insertInto('stripe_payment_intent')
        .values({
          id: paymentIntent.id,
          api_version: sql<Date>`cast(${stripeApiVersionDate} as date)`,
          object: paymentIntent ? JSON.stringify(paymentIntent) : null,
        })
        .onConflict((oc) =>
          oc.column('id').doUpdateSet({
            api_version: sql<Date>`cast(${stripeApiVersionDate} as date)`,
            object: paymentIntent ? JSON.stringify(paymentIntent) : null,
          })
        )
        .execute()

      if (passOnFee) {
        await trx.updateTable('payment').set({ amount: chargeAmount.toString() }).where('id', '=', paymentId).execute()
        await trx.updateTable('sale_product').set({ price: chargeAmount.toString() }).where('id', '=', saleDetails.saleProductId).execute()
      }

      const latestChargeId =
        typeof paymentIntent.latest_charge === 'string' ? paymentIntent.latest_charge : null

      await trx
        .insertInto('payment_stripe')
        .values({
          id: paymentId,
          trainer_id: saleDetails.trainerId,
          fee: transactionFee.toFixed(limits.smallestUnitDecimals),
          stripe_payment_intent_id: paymentIntent.id,
          stripe_charge_id: latestChargeId,
          fee_passed_on: passOnFee,
          is_stripe: true,
        })
        .execute()

      await markSalePaid()

      return { paymentId, trainerId: saleDetails.trainerId }
    })

    const salePayment = await fetchSalePayment(paymentMeta.paymentId, paymentMeta.trainerId)

    return NextResponse.json(salePayment)
  } catch (error) {
    if (error instanceof StripeActionRequiredError) {
      return NextResponse.json({
        requiresAction: true,
        paymentIntentClientSecret: error.clientSecret,
      })
    }

    if (error instanceof SaleNotFoundError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Sale not found',
          detail: 'No sale was found for the provided identifier and authenticated user.',
          type: '/sale-not-found',
        }),
        { status: 404 }
      )
    }

    if (error instanceof SaleAlreadyPaidError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'Sale already paid',
          detail: 'A payment has already been recorded for this sale.',
          type: '/sale-already-paid',
        }),
        { status: 409 }
      )
    }

    if (error instanceof PaymentAmountMismatchError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'Payment must match outstanding balance',
          detail: 'The payment amount must exactly match the sale total.',
          type: '/payment-amount-mismatch',
        }),
        { status: 409 }
      )
    }

    if (error instanceof ClientStripeOnlyError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 403,
          title: 'Clients must pay with Stripe',
          detail: 'Clients can only pay using Stripe card payments.',
          type: '/forbidden',
        }),
        { status: 403 }
      )
    }

    if (error instanceof SaleCreditPackNotFoundError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Sale credit pack not found',
          detail: 'The specified sale credit pack does not exist for this sale.',
          type: '/sale-credit-pack-not-found',
        }),
        { status: 404 }
      )
    }

    if (error instanceof StripeConfigurationMissingError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Stripe configuration missing',
          detail: 'STRIPE_SECRET_KEY is not configured, so Stripe payments cannot be processed.',
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
          detail: 'Stripe payments are not enabled for this trainer.',
          type: '/stripe-payments-disabled',
        }),
        { status: 409 }
      )
    }

    if (error instanceof StripeCardRequiredError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 400,
          title: 'Only card payments are supported',
          detail: 'The provided payment method is not a card.',
          type: '/invalid-payment-method',
        }),
        { status: 400 }
      )
    }

    if (error instanceof StripePaymentIntentMismatchError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'Stripe payment intent mismatch',
          detail: error.message,
          type: '/stripe-payment-intent-mismatch',
        }),
        { status: 409 }
      )
    }

    if (error instanceof AmountOutOfRangeError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'Amount outside supported range',
          detail: 'The payment amount is outside the supported limits for this currency.',
          type: '/amount-out-of-range',
        }),
        { status: 409 }
      )
    }

    if (error instanceof InvalidFeeConfigurationError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Invalid fee configuration',
          detail: 'Fee configuration resulted in an invalid calculation.',
          type: '/invalid-fee-configuration',
        }),
        { status: 500 }
      )
    }

    if (error instanceof CurrencyNotSupportedError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'That currency is not supported.',
          type: '/currency-not-supported',
        }),
        { status: 409 }
      )
    }

    if (error instanceof CountryNotSupportedError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'That card country is not supported for payments.',
          type: '/country-not-supported',
        }),
        { status: 409 }
      )
    }

    if (error instanceof StripePaymentFailedError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 502,
          title: 'Stripe payment did not complete',
          type: '/stripe-payment-failed',
        }),
        { status: 502 }
      )
    }

    if (error instanceof Stripe.errors.StripeError) {
      console.error('Stripe API error while creating sale payment', error)
      return NextResponse.json(
        buildErrorResponse({
          status: 502,
          title: 'Stripe API error',
          detail: error.message,
          type: '/stripe-api-error',
        }),
        { status: 502 }
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
