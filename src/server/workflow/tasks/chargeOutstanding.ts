import BigNumber from 'bignumber.js'
import { subHours } from 'date-fns'
import Stripe from 'stripe'
import type { WorkflowTaskPayloadMap } from '@/server/workflow/types'
import { APP_NAME } from '@/app/api/_lib/constants'
import { getStripeClient, STRIPE_API_VERSION } from '@/app/api/_lib/stripeClient'
import { currencyChargeLimits } from '@/app/api/_lib/transactionFees'
import { db } from '@/lib/db'
import { calculateFee, calculateStripeFee, getFee, fees } from '@/server/workflow/fees'
import { enqueueWorkflowTask } from '@/server/workflow/outbox'
import { currencyFormat, joinIgnoreEmpty } from '@/server/workflow/utils'

export class ChargeFailedBecauseNotVerified extends Error {
  constructor() {
    super('Stripe payouts not allowed')
    this.name = 'ChargeFailedBecauseNotVerified'
  }
}

export class NoPaymentMethodOnFile extends Error {
  constructor() {
    super('No payment method on file')
    this.name = 'NoPaymentMethodOnFile'
  }
}

export class StripePaymentsBlocked extends Error {
  constructor() {
    super('Stripe payments blocked')
    this.name = 'StripePaymentsBlocked'
  }
}

export class StripePaymentsNotEnabled extends Error {
  constructor() {
    super('Stripe payments not enabled')
    this.name = 'StripePaymentsNotEnabled'
  }
}

export class StripeCardError extends Error {
  constructor(public stripeError: Stripe.errors.StripeCardError) {
    super(stripeError.message)
    this.name = 'StripeCardError'
  }
}

const stripeApiVersionDate = STRIPE_API_VERSION.split('.')[0]

const getDefaultPaymentMethod = async (
  stripeClient: Stripe,
  stripeCustomerId: string,
  { stripeAccountId }: { stripeAccountId?: string }
) => {
  let paymentMethods: Stripe.PaymentMethod[]

  try {
    paymentMethods = await stripeClient.paymentMethods
      .list(
        {
          customer: stripeCustomerId,
          type: 'card',
          limit: 100,
        },
        stripeAccountId ? { stripeAccount: stripeAccountId } : undefined
      )
      .autoPagingToArray({ limit: 1000 })
  } catch (error) {
    if (error instanceof Stripe.errors.StripeInvalidRequestError && error.code === 'resource_missing') {
      await db.deleteFrom('stripe.customer').where('id', '=', stripeCustomerId).execute()
      return null
    }
    throw error
  }

  const [paymentMethod, ...rest] = paymentMethods
  if (!paymentMethod || !paymentMethod.card) {
    return null
  }

  await Promise.allSettled(
    rest.map((method) =>
      stripeClient.paymentMethods.detach(method.id, stripeAccountId ? { stripeAccount: stripeAccountId } : undefined)
    )
  )

  return paymentMethod
}

export const handleChargeOutstandingTask = async (
  payload: WorkflowTaskPayloadMap['payment-plan.charge-outstanding']
) => {
  const stripeClient = getStripeClient()
  if (!stripeClient) {
    throw new Error('Stripe is not configured')
  }

  await db.transaction().execute(async (trx) => {
    const now = new Date()
    const retryCutoff = subHours(now, 16)

    const detailsQuery = trx
      .selectFrom('payment_plan_payment as paymentPlanPayment')
      .innerJoin('payment_plan as paymentPlan', 'paymentPlanPayment.payment_plan_id', 'paymentPlan.id')
      .innerJoin('trainer', 'paymentPlan.trainer_id', 'trainer.id')
      .innerJoin('client', 'paymentPlan.client_id', 'client.id')
      .innerJoin('country', 'country.id', 'trainer.country_id')
      .innerJoin('stripe.account as stripeAccount', 'stripeAccount.id', 'trainer.stripe_account_id')
      .select((eb) => [
        eb.ref('client.id').as('clientId'),
        eb.ref('trainer.locale').as('locale'),
        eb.ref('trainer.stripe_account_id').as('trainerStripeAccountId'),
        eb.ref('stripeAccount.object').as('stripeAccountObject'),
        eb.ref('client.stripe_customer_id').as('clientStripeCustomerId'),
        eb.ref('paymentPlanPayment.id').as('id'),
        eb.ref('paymentPlanPayment.payment_plan_id').as('paymentPlanId'),
        eb.ref('paymentPlanPayment.date').as('date'),
        eb.ref('paymentPlanPayment.status').as('status'),
        eb.ref('paymentPlanPayment.amount_outstanding').as('amountOutstanding'),
        eb.ref('paymentPlan.end_').as('paymentPlanEndDate'),
        eb.ref('paymentPlan.name').as('paymentPlanName'),
        eb.ref('trainer.user_id').as('trainerUserId'),
        eb.ref('trainer.send_receipts').as('sendReceipts'),
        eb.ref('client.email').as('clientEmail'),
        eb.ref('client.first_name').as('clientFirstName'),
        eb.ref('client.last_name').as('clientLastName'),
        eb.ref('country.alpha_2_code').as('country'),
        eb.ref('trainer.stripe_payments_blocked').as('stripePaymentsBlocked'),
      ])
      .where('paymentPlanPayment.payment_plan_id', '=', payload.paymentPlanId)
      .where('paymentPlanPayment.date', '<=', now)
      .where('paymentPlanPayment.amount_outstanding', '>', '0')
      .where((eb) =>
        eb.or([
          eb.and([
            eb(eb.ref('paymentPlanPayment.status'), '=', 'pending'),
            eb(eb.ref('paymentPlan.status'), '=', 'active'),
            eb(eb.ref('paymentPlan.end_'), '>', now),
          ]),
          eb.and([
            eb(eb.ref('paymentPlanPayment.status'), '=', 'rejected'),
            ...(payload.forScheduledTask
              ? [
                  eb.and([
                    eb.or([
                      eb(eb.ref('paymentPlanPayment.last_retry_time'), '<=', retryCutoff),
                      eb(eb.ref('paymentPlanPayment.last_retry_time'), 'is', null),
                    ]),
                    eb(eb.ref('paymentPlanPayment.retry_count'), '<', 10),
                  ]),
                ]
              : []),
          ]),
        ])
      )
      .forUpdate()

    const details = await detailsQuery.execute()
    if (details.length === 0) {
      return
    }

    const normalizedDetails = details.map((row) => {
      const stripeAccount =
        typeof row.stripeAccountObject === 'string'
          ? (JSON.parse(row.stripeAccountObject) as Record<string, unknown>)
          : (row.stripeAccountObject as Record<string, unknown> | null)
      const stripeAccountType =
        stripeAccount && typeof stripeAccount.type === 'string' ? (stripeAccount.type as 'standard' | 'custom') : null

      return { ...row, stripeAccountType }
    })

    const first = normalizedDetails[0]

    if (!first.clientStripeCustomerId) {
      throw new NoPaymentMethodOnFile()
    }

    if (first.stripePaymentsBlocked) {
      throw new StripePaymentsBlocked()
    }

    if (!first.trainerStripeAccountId || !first.stripeAccountType) {
      throw new StripePaymentsNotEnabled()
    }

    const stripeAccountId = first.trainerStripeAccountId
    const stripeAccountType = first.stripeAccountType

    const clientPaymentMethod = await getDefaultPaymentMethod(stripeClient, first.clientStripeCustomerId, {
      stripeAccountId: stripeAccountType === 'standard' ? stripeAccountId : undefined,
    })

    if (!clientPaymentMethod || !clientPaymentMethod.card) {
      throw new NoPaymentMethodOnFile()
    }

    const cardCountry = clientPaymentMethod.card.country || first.country
    const currency = fees[first.country as keyof typeof fees].currency

    const applicationFees = normalizedDetails.map((planPayment) => ({
      id: planPayment.id,
      fee: calculateFee({
        amount: new BigNumber(planPayment.amountOutstanding),
        cardCountry,
        chargeCountry: first.country,
        currency,
      }),
    }))

    const updateTime = new Date()
    for (const { id, fee } of applicationFees) {
      await trx
        .updateTable('payment_plan_payment')
        .set((eb) => ({
          status: 'paid',
          amount_outstanding: 0,
          retry_count: eb(eb.ref('retry_count'), '+', 1),
          last_retry_time: updateTime,
          fee: fee.toString(),
        }))
        .where('id', '=', id)
        .execute()
    }

    const dateFormatter = new Intl.DateTimeFormat(first.locale, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })

    const paymentDates = normalizedDetails.map((planPayment) => dateFormatter.format(planPayment.date)).join(',')

    const totalAmount = normalizedDetails
      .map((planPayment) => new BigNumber(planPayment.amountOutstanding))
      .reduce((a, b) => a.plus(b), new BigNumber(0))

    const applicationFee = applicationFees.map((entry) => entry.fee).reduce((a, b) => a.plus(b), new BigNumber(0))

    await Promise.all([
      enqueueWorkflowTask(trx, 'user.notify', {
        userId: first.trainerUserId,
        title: joinIgnoreEmpty(first.clientFirstName, first.clientLastName),
        body: `Payment Processed!\nPayment of ${currencyFormat(totalAmount, { locale: first.locale, currency })} has gone through for subscription: ${first.paymentPlanName}`,
        messageType: 'success',
        notificationType: 'transaction',
        paymentPlanId: payload.paymentPlanId,
      }),
      trx.deleteFrom('stripe_balance').where('account_id', '=', stripeAccountId).execute(),
    ])

    const paymentsMetadata: Record<string, string> = {}
    let groupCount = 0
    let characterCount = 0
    let group: string[] = []

    for (const id of normalizedDetails.map((planPayment) => planPayment.id)) {
      const serialized = JSON.stringify(id)
      if (characterCount + serialized.length + group.length + 2 > 500) {
        paymentsMetadata[`paymentPlanPaymentIds_${groupCount}`] = JSON.stringify(group)
        characterCount = 0
        group = []
        groupCount += 1
      }
      group.push(id)
      characterCount += serialized.length
    }

    paymentsMetadata[`paymentPlanPaymentIds_${groupCount}`] = JSON.stringify(group)

    const fee = getFee({
      cardCountry,
      chargeCountry: first.country,
      currency,
    })

    const decimals =
      currencyChargeLimits[currency.toUpperCase() as keyof typeof currencyChargeLimits].smallestUnitDecimals

    let paymentIntent: Stripe.PaymentIntent

    try {
      paymentIntent = await stripeClient.paymentIntents.create(
        {
          amount: Number(totalAmount.shiftedBy(decimals)),
          currency: currency.toLowerCase(),
          confirm: true,
          customer: first.clientStripeCustomerId,
          description: `${first.paymentPlanName} Outstanding Payments for ${paymentDates}`,
          metadata: {
            ...paymentsMetadata,
            fixedFee: fee.fixedFee.toString(),
            percentageFee: fee.percentageFee.toString(),
          },
          off_session: true,
          payment_method: clientPaymentMethod.id,
          receipt_email: first.sendReceipts && first.clientEmail ? first.clientEmail : undefined,
          statement_descriptor_suffix: `VIA ${APP_NAME}`,
          application_fee_amount: Number(
            applicationFee
              .minus(
                stripeAccountType === 'standard'
                  ? calculateStripeFee({
                      cardCountry,
                      chargeCountry: first.country,
                      currency,
                      amount: totalAmount,
                    })
                  : 0
              )
              .shiftedBy(decimals)
          ),
          error_on_requires_action: true,
          on_behalf_of: stripeAccountType === 'standard' ? undefined : stripeAccountId,
          transfer_data:
            stripeAccountType === 'standard'
              ? undefined
              : {
                  destination: stripeAccountId,
                },
        },
        {
          stripeAccount: stripeAccountType === 'standard' ? stripeAccountId : undefined,
        }
      )
    } catch (error) {
      if (error instanceof Stripe.errors.StripeCardError) {
        throw new StripeCardError(error)
      }
      if (error instanceof Stripe.errors.StripeInvalidRequestError && error.code === 'resource_missing') {
        throw new NoPaymentMethodOnFile()
      }
      if (error instanceof Stripe.errors.StripeError && error.code === 'payouts_not_allowed') {
        await enqueueWorkflowTask(db, 'user.notify', {
          notificationType: 'general',
          messageType: 'failure',
          title: `Charge failed - Verification required`,
          body: `A card charge was attempted against one of your clients but failed because Stripe requires further verification.`,
          clientId: first.clientId,
          userId: first.trainerUserId,
        })
        throw new ChargeFailedBecauseNotVerified()
      }
      throw error
    }

    try {
      await db.transaction().execute(async (inner) => {
        await inner
          .insertInto('stripe_payment_intent')
          .values({
            id: paymentIntent.id,
            api_version: stripeApiVersionDate,
            object: JSON.stringify(paymentIntent),
          })
          .onConflict((oc) =>
            oc.column('id').doUpdateSet({
              api_version: stripeApiVersionDate,
              object: JSON.stringify(paymentIntent),
            })
          )
          .execute()

        await inner
          .insertInto('payment_plan_charge')
          .values(
            normalizedDetails.map((planPayment) => ({
              payment_plan_payment_id: planPayment.id,
              stripe_payment_intent_id: paymentIntent.id,
            }))
          )
          .execute()
      })
    } catch (error) {
      console.error('Failed to persist payment plan charge', {
        error,
        paymentPlanId: payload.paymentPlanId,
        paymentIntentId: paymentIntent.id,
      })
    }
  })
}
