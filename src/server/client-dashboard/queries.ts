import { cache } from 'react'
import { z } from 'zod'

import { adaptSalePaymentRow, type SalePaymentRow } from '@/app/api/_lib/salePayments'
import {
  parseAmount,
  parseNumberValue,
  parseRequiredAmount,
  parseStatus,
  type PaymentPlanRow,
} from '@/app/api/paymentPlans/shared'
import { adaptSaleProductRow, fetchSaleProducts } from '@/app/api/saleProducts/shared'
import { adaptSaleRow, fetchSales } from '@/app/api/sales/shared'
import { db } from '@/lib/db'

import { getClientDashboardSession } from './auth'

const isoDateTimeString = z.string().datetime({ offset: true })

const paymentPlanPaymentStatusSchema = z.enum(['paid', 'cancelled', 'refunded', 'paused', 'pending', 'rejected'])

const paymentPlanPaymentSchema = z.object({
  id: z.string(),
  paymentPlanId: z.string(),
  createdAt: isoDateTimeString,
  updatedAt: isoDateTimeString,
  dueAt: isoDateTimeString,
  status: paymentPlanPaymentStatusSchema,
  amount: z.string(),
  amountOutstanding: z.string(),
  retryCount: z.number(),
  lastRetriedAt: isoDateTimeString.nullable(),
  currency: z.string(),
})

export type PaymentPlanPayment = z.infer<typeof paymentPlanPaymentSchema>

type PaymentPlanPaymentRow = {
  createdAt: Date | string | null
  updatedAt: Date | string | null
  id: string | null
  paymentPlanId: string | null
  dueAt: Date | string | null
  status: string | null
  amount: string | number | null
  amountOutstanding: string | number | null
  retryCount: number | string | null
  lastRetriedAt: Date | string | null
  currency: string | null
}

type StripeAccountSummary = { id: string; type: 'custom' | 'standard' }

export type ClientPaymentPlan = {
  id: string
  status: ReturnType<typeof parseStatus>
  createdAt: Date
  updatedAt: Date
  startAt: Date
  requestedEndAt: Date
  endAt: Date | null
  weeklyRecurrenceInterval: number
  name: string
  requestedAmount: string
  amount: string | null
  requestSentAt: Date | null
  currency: string
}

const ensureDate = (value: Date | string | null, label: string) => {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${label} value`)
  }
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${label} value`)
  }
  return date
}

const toIsoDateTime = (value: Date | string | null, label: string) => ensureDate(value, label).toISOString()

const toOptionalIsoDateTime = (value: Date | string | null, label: string) => {
  if (value === null || value === undefined) {
    return null
  }
  return toIsoDateTime(value, label)
}

const toAmountString = (value: string | number | null, label: string) => {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${label} value`)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid ${label} value`)
    }
    return value.toFixed(2)
  }
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`Empty ${label} value`)
  }
  return trimmed
}

const toRetryCount = (value: number | string | null) => {
  if (value === null || value === undefined) {
    throw new Error('Missing retry count value')
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new Error('Invalid retry count value')
    }
    return value
  }
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error('Empty retry count value')
  }
  const parsed = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(parsed)) {
    throw new Error('Invalid retry count value')
  }
  return parsed
}

const normalizePaymentPlanStatus = (value: string | null) => {
  if (!value) {
    throw new Error('Missing payment plan payment status')
  }
  const trimmed = value.trim().toLowerCase()
  const parsed = paymentPlanPaymentStatusSchema.safeParse(trimmed)
  if (!parsed.success) {
    throw new Error(`Unexpected payment plan payment status: ${value}`)
  }
  return parsed.data
}

const adaptPaymentPlanPaymentRow = (row: PaymentPlanPaymentRow): PaymentPlanPayment => {
  if (!row.id || !row.paymentPlanId || !row.currency) {
    throw new Error('Payment plan payment row missing identifiers')
  }

  return paymentPlanPaymentSchema.parse({
    id: row.id,
    paymentPlanId: row.paymentPlanId,
    currency: row.currency,
    createdAt: toIsoDateTime(row.createdAt, 'createdAt'),
    updatedAt: toIsoDateTime(row.updatedAt, 'updatedAt'),
    dueAt: toIsoDateTime(row.dueAt, 'dueAt'),
    status: normalizePaymentPlanStatus(row.status),
    amount: toAmountString(row.amount, 'amount'),
    amountOutstanding: toAmountString(row.amountOutstanding, 'amountOutstanding'),
    retryCount: toRetryCount(row.retryCount),
    lastRetriedAt: toOptionalIsoDateTime(row.lastRetriedAt, 'lastRetriedAt'),
  })
}

const cardBrands = ['amex', 'diners', 'discover', 'jcb', 'mastercard', 'unionpay', 'visa', 'unknown'] as const
type CardBrand = (typeof cardBrands)[number]

const normalizeCardBrand = (brand: string): CardBrand => {
  const normalized = brand.toLowerCase()
  return cardBrands.includes(normalized as CardBrand) ? (normalized as CardBrand) : 'unknown'
}

export type ClientCardDetails = {
  country: string | null
  paymentMethodId: string
  last4: string
  expYear: number
  expMonth: number
  brand: CardBrand
}

export type ClientProfile = {
  email: string
  card: ClientCardDetails | null
  stripeCustomerId: string | null
}

export type ServiceProviderSummary = {
  firstName: string
  lastName: string | null
  businessName: string | null
  brandColor: string
  businessLogoUrl: string | null
  country: string
  currency: string
}

export const getClientProfile = cache(async (): Promise<ClientProfile> => {
  const session = await getClientDashboardSession()
  if (!session) {
    throw new Error('Client dashboard session missing')
  }

  const row = await db
    .selectFrom('client as c')
    .innerJoin('trainer as t', 't.id', 'c.trainer_id')
    .leftJoin('stripe.account as stripeAccount', 'stripeAccount.id', 't.stripe_account_id')
    .select((eb) => [
      eb.ref('c.email').as('email'),
      eb.ref('c.stripe_customer_id').as('stripeCustomerId'),
      eb.ref('t.stripe_account_id').as('stripeAccountId'),
      eb.ref('stripeAccount.object').as('stripeAccountObject'),
    ])
    .where('c.id', '=', session.clientId)
    .where('c.trainer_id', '=', session.trainerId)
    .executeTakeFirst()

  if (!row?.email) {
    throw new Error('Client not found')
  }

  const stripeCustomerId = row.stripeCustomerId ?? null

  if (!stripeCustomerId) {
    return { email: row.email, stripeCustomerId, card: null }
  }

  const paymentMethodRow = await db
    .selectFrom('stripe.payment_method')
    .select(['id', 'object'])
    .where((eb) => eb(eb.fn('json_extract_path_text', [eb.ref('object'), eb.val('customer')]), '=', stripeCustomerId))
    .orderBy(
      (eb) => eb.cast<number>(eb.fn('json_extract_path_text', [eb.ref('object'), eb.val('created')]), 'bigint'),
      'desc'
    )
    .limit(1)
    .executeTakeFirst()

  if (!paymentMethodRow?.id || !paymentMethodRow.object || typeof paymentMethodRow.object !== 'object') {
    return { email: row.email, stripeCustomerId, card: null }
  }

  const parsed = z
    .object({
      id: z.string(),
      object: z.object({
        id: z.string(),
        type: z.literal('card'),
        card: z.object({
          brand: z.string(),
          country: z.string().nullable().optional(),
          exp_month: z.coerce.number(),
          exp_year: z.coerce.number(),
          last4: z.string(),
        }),
      }),
    })
    .safeParse(paymentMethodRow)

  if (!parsed.success) {
    return { email: row.email, stripeCustomerId, card: null }
  }

  const { card } = parsed.data.object
  const country = typeof card.country === 'string' && card.country.trim().length > 0 ? card.country : null

  return {
    email: row.email,
    stripeCustomerId,
    card: {
      country,
      paymentMethodId: parsed.data.id,
      last4: card.last4,
      expYear: card.exp_year,
      expMonth: card.exp_month,
      brand: normalizeCardBrand(card.brand),
    },
  }
})

export const getServiceProvider = cache(async (): Promise<ServiceProviderSummary> => {
  const session = await getClientDashboardSession()
  if (!session) {
    throw new Error('Client dashboard session missing')
  }

  const row = await db
    .selectFrom('client')
    .innerJoin('trainer', 'trainer.id', 'client.trainer_id')
    .innerJoin('vw_legacy_trainer', 'vw_legacy_trainer.id', 'trainer.id')
    .innerJoin('country', 'country.id', 'trainer.country_id')
    .select((eb) => [
      eb.ref('trainer.first_name').as('firstName'),
      eb.ref('trainer.last_name').as('lastName'),
      eb.fn
        .coalesce(eb.ref('trainer.business_name'), eb.ref('trainer.online_bookings_business_name'))
        .as('businessName'),
      eb.ref('trainer.brand_color').as('brandColor'),
      eb.ref('trainer.business_logo_url').as('businessLogoUrl'),
      eb.ref('country.alpha_2_code').as('country'),
      eb.ref('vw_legacy_trainer.default_currency').as('currency'),
    ])
    .where('client.id', '=', session.clientId)
    .limit(1)
    .executeTakeFirst()

  if (!row?.firstName || !row.brandColor || !row.country || !row.currency) {
    throw new Error('Service provider not found')
  }

  return {
    firstName: row.firstName,
    lastName: row.lastName ?? null,
    businessName: row.businessName ?? null,
    brandColor: row.brandColor,
    businessLogoUrl: row.businessLogoUrl ?? null,
    country: row.country,
    currency: row.currency.toUpperCase(),
  }
})

export const getStripeAccountSummary = cache(async (): Promise<StripeAccountSummary> => {
  const session = await getClientDashboardSession()
  if (!session) {
    throw new Error('Client dashboard session missing')
  }

  const row = await db
    .selectFrom('client')
    .innerJoin('trainer', 'trainer.id', 'client.trainer_id')
    .innerJoin('stripe.account as stripeAccount', 'stripeAccount.id', 'trainer.stripe_account_id')
    .select((eb) => [eb.ref('stripeAccount.id').as('id'), eb.ref('stripeAccount.object').as('stripeAccountObject')])
    .where('client.id', '=', session.clientId)
    .where('trainer.id', '=', session.trainerId)
    .executeTakeFirst()

  const stripeAccountValue = row?.stripeAccountObject
  const stripeAccountType =
    stripeAccountValue && typeof stripeAccountValue === 'object' && 'type' in stripeAccountValue
      ? ((stripeAccountValue as { type?: string }).type ?? null)
      : null

  const parsed = z
    .object({
      id: z.string(),
      type: z.union([z.literal('custom'), z.literal('standard')]),
    })
    .safeParse(
      row
        ? {
            id: row.id,
            type: stripeAccountType,
          }
        : null
    )

  if (!parsed.success) {
    throw new Error('Stripe account not found')
  }

  return parsed.data
})

export const listPaymentPlans = cache(async (status?: string): Promise<ClientPaymentPlan[]> => {
  const session = await getClientDashboardSession()
  if (!session) {
    throw new Error('Client dashboard session missing')
  }

  let query = db
    .selectFrom('payment_plan')
    .innerJoin('trainer', 'trainer.id', 'payment_plan.trainer_id')
    .innerJoin('supported_country_currency', 'supported_country_currency.country_id', 'trainer.country_id')
    .innerJoin('currency', 'currency.id', 'supported_country_currency.currency_id')
    .select((eb) => [
      eb.ref('payment_plan.id').as('id'),
      eb.ref('payment_plan.status').as('status'),
      eb.ref('payment_plan.created_at').as('createdAt'),
      eb.ref('payment_plan.updated_at').as('updatedAt'),
      eb.ref('payment_plan.start').as('startAt'),
      eb.ref('payment_plan.end_').as('requestedEndAt'),
      eb.ref('payment_plan.accepted_end').as('endAt'),
      eb.ref('payment_plan.frequency_weekly_interval').as('weeklyRecurrenceInterval'),
      eb.ref('payment_plan.name').as('name'),
      eb.ref('payment_plan.amount').as('requestedAmount'),
      eb.ref('payment_plan.accepted_amount').as('amount'),
      eb.ref('payment_plan.acceptance_request_time').as('requestSentAt'),
      eb.ref('currency.alpha_code').as('currency'),
    ])
    .where('payment_plan.client_id', '=', session.clientId)
    .where('payment_plan.trainer_id', '=', session.trainerId)

  if (status) {
    query = query.where('payment_plan.status', '=', status)
  }

  const rows = (await query.orderBy('payment_plan.created_at', 'desc').execute()) as PaymentPlanRow[]

  return rows.map((row) => ({
    id: row.id,
    status: parseStatus(row.status),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    startAt: new Date(row.startAt),
    requestedEndAt: new Date(row.requestedEndAt),
    endAt: row.endAt ? new Date(row.endAt) : null,
    weeklyRecurrenceInterval: parseNumberValue(row.weeklyRecurrenceInterval, 'weekly recurrence interval'),
    name: row.name,
    requestedAmount: parseRequiredAmount(row.requestedAmount, 'requested amount'),
    amount: parseAmount(row.amount, 'accepted amount'),
    requestSentAt: row.requestSentAt ? new Date(row.requestSentAt) : null,
    currency: row.currency,
  }))
})

export const getPaymentPlan = cache(async (planId: string): Promise<ClientPaymentPlan | null> => {
  const plans = await listPaymentPlans()
  return plans.find((plan) => plan.id === planId) ?? null
})

export const listPaymentPlanPayments = cache(
  async (options: { status?: string; paymentPlanId?: string } = {}): Promise<PaymentPlanPayment[]> => {
    const session = await getClientDashboardSession()
    if (!session) {
      throw new Error('Client dashboard session missing')
    }

    let query = db
      .selectFrom('payment_plan_payment')
      .innerJoin('payment_plan', 'payment_plan.id', 'payment_plan_payment.payment_plan_id')
      .innerJoin('trainer', 'trainer.id', 'payment_plan.trainer_id')
      .innerJoin('supported_country_currency', 'supported_country_currency.country_id', 'trainer.country_id')
      .innerJoin('currency', 'currency.id', 'supported_country_currency.currency_id')
      .select((eb) => [
        eb.ref('payment_plan_payment.created_at').as('createdAt'),
        eb.ref('payment_plan_payment.updated_at').as('updatedAt'),
        eb.ref('payment_plan_payment.id').as('id'),
        eb.ref('payment_plan_payment.payment_plan_id').as('paymentPlanId'),
        eb.ref('payment_plan_payment.date').as('dueAt'),
        eb.ref('payment_plan_payment.status').as('status'),
        eb.ref('payment_plan_payment.amount').as('amount'),
        eb.ref('payment_plan_payment.amount_outstanding').as('amountOutstanding'),
        eb.ref('payment_plan_payment.retry_count').as('retryCount'),
        eb.ref('payment_plan_payment.last_retry_time').as('lastRetriedAt'),
        eb.ref('currency.alpha_code').as('currency'),
      ])
      .where('payment_plan.client_id', '=', session.clientId)
      .where('payment_plan.trainer_id', '=', session.trainerId)

    if (options.status) {
      query = query.where('payment_plan_payment.status', '=', options.status)
    }

    if (options.paymentPlanId) {
      query = query.where('payment_plan_payment.payment_plan_id', '=', options.paymentPlanId)
    }

    const rows = (await query.orderBy('payment_plan_payment.created_at', 'desc').execute()) as PaymentPlanPaymentRow[]
    return rows.map(adaptPaymentPlanPaymentRow)
  }
)

export const listSales = cache(async () => {
  const session = await getClientDashboardSession()
  if (!session) {
    throw new Error('Client dashboard session missing')
  }
  const rows = await fetchSales({ trainerId: session.trainerId, clientId: session.clientId })
  return rows.map(adaptSaleRow)
})

export const getSale = cache(async (saleId: string) => {
  const session = await getClientDashboardSession()
  if (!session) {
    throw new Error('Client dashboard session missing')
  }
  const rows = await fetchSales({ trainerId: session.trainerId, clientId: session.clientId, saleId })
  return rows.map(adaptSaleRow)[0] ?? null
})

export const listSaleProducts = cache(async (saleId: string) => {
  const session = await getClientDashboardSession()
  if (!session) {
    throw new Error('Client dashboard session missing')
  }
  const rows = await fetchSaleProducts(session.trainerId, { saleId, clientId: session.clientId })
  return rows.map(adaptSaleProductRow)
})

export const listSaleProductsForClient = cache(async () => {
  const session = await getClientDashboardSession()
  if (!session) {
    throw new Error('Client dashboard session missing')
  }

  const rows = await fetchSaleProducts(session.trainerId, { clientId: session.clientId })
  return rows.map(adaptSaleProductRow)
})

export const listSalePayments = cache(async (saleId?: string) => {
  const session = await getClientDashboardSession()
  if (!session) {
    throw new Error('Client dashboard session missing')
  }

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
    .where('payment.trainer_id', '=', session.trainerId)
    .where('payment.client_id', '=', session.clientId)
    .orderBy('payment.created_at', 'desc')

  if (saleId) {
    query = query.where('payment.sale_id', '=', saleId)
  }

  const rows = (await query.execute()) as SalePaymentRow[]

  return rows.map(adaptSalePaymentRow)
})
