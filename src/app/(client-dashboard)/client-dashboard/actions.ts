'use server'

/* eslint-disable max-lines */

import BigNumber from 'bignumber.js'
import { cookies, headers } from 'next/headers'
import crypto from 'node:crypto'
import Stripe from 'stripe'
import { z } from 'zod'

import { APP_EMAIL, APP_NAME, KEEPON_LOGO_COLOR_URL } from '@/app/api/_lib/constants'
import { getStripeClient, STRIPE_API_VERSION } from '@/app/api/_lib/stripeClient'
import {
  currencyChargeLimits,
  getTransactionFee,
  CurrencyNotSupportedError,
  CountryNotSupportedError,
} from '@/app/api/_lib/transactionFees'
import { normalizePlanRow, type RawPlanRow } from '@/app/api/plans/shared'
import { db } from '@/lib/db'
import { getClientDashboardSession, CLIENT_DASHBOARD_COOKIE } from '@/server/client-dashboard/auth'
import { enqueueWorkflowTask } from '@/server/workflow/outbox'
import { joinIgnoreEmpty } from '@/server/workflow/utils'

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7
const stripeApiVersionDate = STRIPE_API_VERSION.split('.')[0]
const LEGACY_INVALID_JSON_MESSAGE = 'Unexpected token \'"\', "#" is not valid JSON'

const buildLoginEmailHtml = (code: string) => `
<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#f7f9fb;font-family:Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px;">
            <tr>
              <td align="center" style="padding-bottom:24px;">
                <img src="${KEEPON_LOGO_COLOR_URL}" alt="${APP_NAME}" style="max-width:160px;height:auto;" />
              </td>
            </tr>
            <tr>
              <td style="font-size:24px;font-weight:700;color:#111827;text-align:center;padding-bottom:16px;">
                ${code} is your client dashboard login code
              </td>
            </tr>
            <tr>
              <td style="font-size:16px;line-height:1.5;color:#1f2937;text-align:center;">
                Enter <strong>${code}</strong> to log in to your client dashboard.
              </td>
            </tr>
            <tr>
              <td style="font-size:14px;line-height:1.5;color:#6b7280;text-align:center;padding-top:24px;">
                If you did not request this code, you can safely ignore this email.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`

const generateRandomSixDigitCode = () => crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')

const safeRedirect = (value?: string | null) => {
  if (value && value.startsWith('/client-dashboard')) {
    return value
  }
  return '/client-dashboard'
}

const persistClientDashboardCookie = async (token: string) => {
  const jar = await cookies()
  jar.set(CLIENT_DASHBOARD_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  })
}

const clearClientDashboardCookie = async () => {
  const jar = await cookies()
  jar.delete(CLIENT_DASHBOARD_COOKIE)
}

const loginRequestSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Email must be a valid email address.'),
})

export type ClientLoginChoice = {
  id: string
  firstName: string
  lastName: string | null
  serviceProviderFirstName: string
  serviceProviderLastName: string | null
}

export async function requestClientLoginCode(input: { email: string }) {
  const validation = loginRequestSchema.safeParse(input)
  if (!validation.success) {
    return { ok: false as const, message: validation.error.issues.map((issue) => issue.message).join('; ') }
  }

  const { email } = validation.data

  class SilentRollbackError extends Error {}

  try {
    await db.transaction().execute(async (trx) => {
      const clientRow = await trx
        .selectFrom('client')
        .select('client.email')
        .distinct()
        .where('client.email', '=', email)
        .executeTakeFirst()

      const code = generateRandomSixDigitCode()

      await trx
        .insertInto('client_login_request')
        .values({
          code,
          email,
        })
        .execute()

      if (!clientRow) {
        throw new SilentRollbackError()
      }

      const subject = `${code} is your client dashboard login code`
      const html = buildLoginEmailHtml(code)
      const recipientEmail = clientRow.email

      if (!recipientEmail) {
        throw new SilentRollbackError()
      }

      await trx
        .insertInto('mail')
        .values({
          trainer_id: null,
          client_id: null,
          from_email: APP_EMAIL,
          from_name: `${APP_NAME} Team`,
          to_email: recipientEmail,
          to_name: null,
          subject,
          html,
          reply_to: null,
        })
        .execute()
    })
  } catch (error) {
    if (error instanceof SilentRollbackError) {
      return { ok: true as const }
    }

    console.error('client-dashboard: failed to create login request', error)
    return { ok: false as const, message: 'Unable to send a login code. Please try again.' }
  }

  return { ok: true as const }
}

export async function listClientLogins(input: { email: string; code: string }) {
  const validation = z
    .object({
      email: z.string().trim().min(1),
      code: z.string().trim().min(1),
    })
    .safeParse(input)

  if (!validation.success) {
    return { ok: false as const, message: 'Please enter the code from your email.' }
  }

  const { email, code } = validation.data

  try {
    const result = await db.transaction().execute(async (trx) => {
      const now = new Date()
      const loginRequest = await trx
        .selectFrom('client_login_request')
        .select('id')
        .where('email', '=', email)
        .where('code', '=', code)
        .where('expires_at', '>', now)
        .where('authenticated', '=', false)
        .where('failed_authentication_count', '<', 3)
        .forUpdate()
        .executeTakeFirst()

      if (!loginRequest) {
        await trx
          .updateTable('client_login_request')
          .set((eb) => ({
            failed_authentication_count: eb('failed_authentication_count', '+', 1),
          }))
          .where('email', '=', email)
          .where('expires_at', '>', now)
          .where('authenticated', '=', false)
          .execute()

        return { ok: false as const }
      }

      const clients = await trx
        .selectFrom('client')
        .innerJoin('trainer', 'trainer.id', 'client.trainer_id')
        .select([
          'client.id as id',
          'client.first_name as first_name',
          'client.last_name as last_name',
          'trainer.first_name as service_provider_first_name',
          'trainer.last_name as service_provider_last_name',
        ])
        .where('client.email', '=', email)
        .execute()

      if (clients.length === 0) {
        return { ok: false as const }
      }

      const mappedClients: ClientLoginChoice[] = clients.map((row) => ({
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        serviceProviderFirstName: row.service_provider_first_name,
        serviceProviderLastName: row.service_provider_last_name,
      }))

      return { ok: true as const, clients: mappedClients }
    })

    if (!result.ok) {
      return { ok: false as const, message: 'Code was invalid, expired, or already used.' }
    }

    return { ok: true as const, clients: result.clients }
  } catch (error) {
    console.error('client-dashboard: failed to list client logins', { email, error })
    return { ok: false as const, message: 'Unable to validate your code. Please try again.' }
  }
}

export async function createClientDashboardSession(input: {
  email: string
  code: string
  clientId: string
  redirectTo?: string | null
}) {
  const validation = z
    .object({
      email: z.string().trim().min(1),
      code: z.string().trim().min(1),
      clientId: z.string().trim().min(1),
      redirectTo: z.string().optional().nullable(),
    })
    .safeParse(input)

  if (!validation.success) {
    return { ok: false as const, message: 'Please pick a client to continue.' }
  }

  const { email, code, clientId, redirectTo } = validation.data

  try {
    const now = new Date()
    const updateResult = await db
      .updateTable('client_login_request')
      .set({ authenticated: true })
      .where('email', '=', email)
      .where('code', '=', code)
      .where('expires_at', '>', now)
      .where('authenticated', '=', false)
      .where('failed_authentication_count', '<', 3)
      .returning('id')
      .execute()

    if (updateResult.length === 0) {
      await db
        .updateTable('client_login_request')
        .set((eb) => ({
          failed_authentication_count: eb('failed_authentication_count', '+', 1),
        }))
        .where('email', '=', email)
        .where('expires_at', '>', now)
        .where('authenticated', '=', false)
        .execute()

      return { ok: false as const, message: 'Code was invalid, expired, or already used.' }
    }

    const tokenRow = await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('client_login_request')
        .set({ expires_at: now })
        .where('expires_at', '>', now)
        .where('email', '=', email)
        .where('authenticated', '=', false)
        .execute()

      const clientRow = await trx
        .selectFrom('client')
        .select('user_id')
        .where('id', '=', clientId)
        .where('email', '=', email)
        .executeTakeFirst()

      if (!clientRow) {
        throw new Error('No client record for dashboard login request')
      }

      const inserted = await trx
        .insertInto('access_token')
        .values({
          user_id: clientRow.user_id,
          user_type: 'client',
          expires_at: new Date(Date.now() + COOKIE_MAX_AGE_SECONDS * 1000),
          type: 'client_dashboard',
        })
        .returning('id')
        .executeTakeFirst()

      if (!inserted) {
        throw new Error('No access token created for client dashboard login request')
      }

      return inserted
    })

    await persistClientDashboardCookie(tokenRow.id)

    return { ok: true as const, redirectTo: safeRedirect(redirectTo) }
  } catch (error) {
    console.error('client-dashboard: failed to create dashboard session', error)
    return {
      ok: false as const,
      message: 'Unable to create a dashboard session. Please request a new code.',
    }
  }
}

export async function setClientDashboardCookieFromToken(input: { token: string; clientId: string }) {
  const validation = z
    .object({
      token: z.string().trim().min(1),
      clientId: z.string().trim().min(1),
    })
    .safeParse(input)

  if (!validation.success) {
    return { ok: false as const, message: LEGACY_INVALID_JSON_MESSAGE }
  }

  const { token, clientId } = validation.data

  const row = await db
    .selectFrom('access_token')
    .innerJoin('client', 'client.user_id', 'access_token.user_id')
    .select((eb) => [eb.ref('access_token.id').as('accessToken'), eb.ref('access_token.expires_at').as('expiresAt')])
    .where('access_token.id', '=', token)
    .where('access_token.type', '=', 'client_dashboard')
    .where('client.id', '=', clientId)
    .executeTakeFirst()

  if (!row?.accessToken || !row.expiresAt) {
    return { ok: false as const, message: 'This login link is no longer valid.' }
  }

  const expiresAt = row.expiresAt instanceof Date ? row.expiresAt : new Date(row.expiresAt)
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
    return { ok: false as const, message: 'This login link has expired.' }
  }

  await persistClientDashboardCookie(row.accessToken)
  return { ok: true as const }
}

export async function logoutClientDashboard() {
  await clearClientDashboardCookie()
  return { ok: true as const }
}

const threeDsExceptions = new Set(['cus_LKaEWrm9vaFNsm'])

export async function createStripeSetupIntent() {
  const session = await getClientDashboardSession()
  if (!session) {
    return { ok: false as const, message: 'Please sign in again to update your payment method.' }
  }

  const stripeClient = getStripeClient()

  if (!stripeClient) {
    return {
      ok: false as const,
      message: 'Stripe configuration is missing. Please try again later.',
    }
  }

  const row = await db
    .selectFrom('client')
    .innerJoin('trainer', 'trainer.id', 'client.trainer_id')
    .leftJoin('stripe.account as stripeAccount', 'stripeAccount.id', 'trainer.stripe_account_id')
    .select((eb) => [
      eb.ref('client.stripe_customer_id').as('stripeCustomerId'),
      eb.ref('client.email').as('clientEmail'),
      eb.ref('trainer.email').as('serviceProviderEmail'),
      eb.ref('trainer.stripe_account_id').as('stripeAccountId'),
      eb.ref('stripeAccount.object').as('stripeAccountObject'),
    ])
    .where('client.id', '=', session.clientId)
    .where('trainer.id', '=', session.trainerId)
    .executeTakeFirst()

  if (!row) {
    return { ok: false as const, message: 'Client not found.' }
  }

  const stripeAccountValue = row.stripeAccountObject
  const stripeAccountType =
    stripeAccountValue && typeof stripeAccountValue === 'object' && 'type' in stripeAccountValue
      ? ((stripeAccountValue as { type?: string }).type ?? null)
      : null

  if (!row.stripeAccountId || !stripeAccountType) {
    return {
      ok: false as const,
      message: 'Your service provider does not have payments enabled.',
    }
  }

  const stripeRequestOptions = stripeAccountType === 'standard' ? { stripeAccount: row.stripeAccountId } : undefined
  let customerId = row.stripeCustomerId ?? null

  try {
    if (!customerId) {
      const customer = await stripeClient.customers.create(
        {
          description: `Customer for ${row.serviceProviderEmail}`,
          email: row.clientEmail ?? undefined,
          metadata: {
            clientId: session.clientId,
          },
        },
        stripeRequestOptions
      )

      customerId = customer.id

      await db.transaction().execute(async (trx) => {
        await trx
          .insertInto('stripe.customer')
          .values({
            id: customer.id,
            api_version: stripeApiVersionDate,
            object: JSON.stringify(customer),
          })
          .onConflict((oc) =>
            oc.column('id').doUpdateSet({
              api_version: stripeApiVersionDate,
              object: JSON.stringify(customer),
            })
          )
          .execute()

        await trx
          .updateTable('client')
          .set({ stripe_customer_id: customer.id })
          .where('id', '=', session.clientId)
          .execute()
      })
    }
  } catch (error) {
    if (error instanceof Stripe.errors.StripeError) {
      return { ok: false as const, message: error.message }
    }

    console.error('client-dashboard: failed to create stripe customer', error)
    return { ok: false as const, message: 'Unable to create a card setup. Please try again.' }
  }

  if (!customerId) {
    return { ok: false as const, message: 'Unable to create a card setup. Please try again.' }
  }

  const requestThreeDS = threeDsExceptions.has(customerId) || stripeAccountType === 'standard' ? 'automatic' : 'any'

  try {
    const setupIntent = await stripeClient.setupIntents.create(
      {
        customer: customerId,
        on_behalf_of: stripeAccountType === 'standard' ? undefined : row.stripeAccountId,
        payment_method_options: {
          card: {
            request_three_d_secure: requestThreeDS,
          },
        },
      },
      stripeRequestOptions
    )

    const clientSecret = setupIntent.client_secret

    if (!clientSecret) {
      return { ok: false as const, message: 'Stripe did not return a client secret.' }
    }

    return { ok: true as const, clientSecret }
  } catch (error) {
    if (error instanceof Stripe.errors.StripeError) {
      return { ok: false as const, message: error.message }
    }

    console.error('client-dashboard: failed to create setup intent', error)
    return { ok: false as const, message: 'Unable to create a card setup. Please try again.' }
  }
}

const extractClientIp = async () => {
  const headerStore = await headers()
  const forwardedFor = headerStore.get('x-forwarded-for')
  if (forwardedFor) {
    const [first] = forwardedFor.split(',')
    const ip = first?.trim()
    if (ip) {
      return ip
    }
  }

  const realIp = headerStore.get('x-real-ip')
  return realIp?.trim() ?? undefined
}

const joinName = (...parts: (string | null | undefined)[]) =>
  parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part && part.length > 0))
    .join(' ')

const isCancelled = (status: string | null) => status?.trim().toLowerCase() === 'cancelled'

class SubscriptionNotFoundError extends Error {
  constructor() {
    super('Subscription not found')
    this.name = 'SubscriptionNotFoundError'
  }
}

class SubscriptionIsCancelledError extends Error {
  constructor() {
    super('Subscription is cancelled')
    this.name = 'SubscriptionIsCancelledError'
  }
}

class NoPaymentMethodOnFileError extends Error {
  constructor() {
    super('No payment method on file')
    this.name = 'NoPaymentMethodOnFileError'
  }
}

type PlanDetails = {
  status: string | null
  name: string | null
  amount: string | number | null
  endDate: Date | string | null
  stripeCustomerId: string | null
  trainerUserId: string | null
  trainerId: string | null
  clientFirstName: string | null
  clientLastName: string | null
}

export async function acceptPaymentPlan(input: { planId: string }) {
  const validation = z.object({ planId: z.string().trim().min(1) }).safeParse(input)
  if (!validation.success) {
    return { ok: false as const, message: 'Invalid subscription.' }
  }

  const session = await getClientDashboardSession()
  if (!session) {
    return { ok: false as const, message: 'Please sign in again to accept this subscription.' }
  }

  const { planId } = validation.data

  try {
    await db.transaction().execute(async (trx) => {
      const details = (await trx
        .selectFrom('payment_plan as plan')
        .innerJoin('client', 'client.id', 'plan.client_id')
        .innerJoin('trainer', 'trainer.id', 'plan.trainer_id')
        .select((eb) => [
          eb.ref('plan.status').as('status'),
          eb.ref('plan.name').as('name'),
          eb.ref('plan.amount').as('amount'),
          eb.ref('plan.end_').as('endDate'),
          eb.ref('client.stripe_customer_id').as('stripeCustomerId'),
          eb.ref('trainer.user_id').as('trainerUserId'),
          eb.ref('trainer.id').as('trainerId'),
          eb.ref('client.first_name').as('clientFirstName'),
          eb.ref('client.last_name').as('clientLastName'),
        ])
        .where('plan.id', '=', planId)
        .where('plan.client_id', '=', session.clientId)
        .where('plan.trainer_id', '=', session.trainerId)
        .executeTakeFirst()) as PlanDetails | undefined

      if (!details || !details.trainerId || !details.trainerUserId) {
        throw new SubscriptionNotFoundError()
      }

      if (isCancelled(details.status)) {
        throw new SubscriptionIsCancelledError()
      }

      if (!details.stripeCustomerId) {
        throw new NoPaymentMethodOnFileError()
      }

      const ipAddress = await extractClientIp()
      const clientName = joinName(details.clientFirstName, details.clientLastName)
      const planName = details.name ?? 'Subscription'

      const now = new Date()

      const missionResultPromise = trx
        .updateTable('mission')
        .set({ completed_at: now })
        .where('trainer_id', '=', details.trainerId)
        .where('completed_at', 'is', null)
        .where('id', '=', 'createActiveSubscription')
        .returning('id')
        .execute()

      const planRowPromise = trx
        .selectFrom('payment_plan')
        .select(['trainer_id', 'id', 'amount', 'end_', 'status'])
        .where('id', '=', planId)
        .where('client_id', '=', session.clientId)
        .where('trainer_id', '=', session.trainerId)
        .executeTakeFirst()

      const updatePlanPromise = trx
        .updateTable('payment_plan')
        .set((eb) => ({
          status: details.status === 'pending' || !details.status ? 'active' : details.status,
          accepted_amount: eb.ref('amount'),
          accepted_end: eb.ref('end_'),
        }))
        .where('id', '=', planId)
        .where('client_id', '=', session.clientId)
        .where('trainer_id', '=', session.trainerId)
        .execute()

      const primaryNotification = {
        paymentPlanId: planId,
        title: clientName,
        body: `Terms Accepted\nAccepted the terms for Subscription: ${planName}`,
        messageType: 'success' as const,
        notificationType: 'general' as const,
        userId: details.trainerUserId,
      }

      const notifyPromise = enqueueWorkflowTask(trx, 'user.notify', primaryNotification, {
        dedupeKey: `user.notify:planAccept:${planId}:termsAccepted`,
      })

      const [missionResult, planRowSnapshot] = await Promise.all([
        missionResultPromise,
        planRowPromise,
        updatePlanPromise,
        notifyPromise,
      ])

      if (!planRowSnapshot) {
        throw new SubscriptionNotFoundError()
      }

      if (planRowSnapshot.amount === null || planRowSnapshot.end_ === null) {
        throw new Error('Plan snapshot missing amount or end date')
      }

      await trx
        .insertInto('payment_plan_acceptance')
        .values({
          trainer_id: planRowSnapshot.trainer_id,
          payment_plan_id: planRowSnapshot.id,
          date: now,
          ip_address: ipAddress ?? '',
          amount: planRowSnapshot.amount,
          end_: planRowSnapshot.end_,
        })
        .execute()

      const missionRow = missionResult[0] ?? null

      if (missionRow) {
        const trainerStatusRow = await trx
          .selectFrom('vw_legacy_trainer')
          .select((eb) =>
            eb
              .fn('jsonb_extract_path_text', [eb.cast<unknown>(eb.ref('subscription'), 'jsonb'), eb.val('status')])
              .as('status')
          )
          .where('id', '=', details.trainerId)
          .executeTakeFirst()

        const isSubscribed = trainerStatusRow?.status === 'subscribed'
        const rewardRow = !isSubscribed
          ? await trx
              .insertInto('reward')
              .values({ trainer_id: details.trainerId, type: '3TextCredits' })
              .returning('id')
              .executeTakeFirst()
          : null

        await Promise.all([
          rewardRow
            ? trx
                .updateTable('mission')
                .set({ reward_id: rewardRow.id })
                .where('trainer_id', '=', details.trainerId)
                .where('id', '=', missionRow.id)
                .execute()
            : Promise.resolve(),
          enqueueWorkflowTask(
            trx,
            'user.notify',
            {
              title: "You've sold your first subscription! 🎉",
              body: rewardRow
                ? 'Yay for recurring income! Claim your reward for completing a mission! 🎁'
                : "Yay, you've completed a mission!",
              userId: details.trainerUserId,
              messageType: 'success',
              notificationType: 'general',
            },
            {
              dedupeKey: `user.notify:planAccept:${planId}:firstSubscription`,
            }
          ),
        ])
      }

      try {
        await enqueueWorkflowTask(
          trx,
          'payment-plan.charge-outstanding',
          {
            paymentPlanId: planId,
            forScheduledTask: false,
          },
          {
            dedupeKey: `payment-plan.charge-outstanding:${planId}`,
          }
        )
      } catch (chargeError) {
        console.warn('Failed to enqueue outstanding charge for subscription acceptance', {
          planId,
          error: chargeError,
        })
      }

      const planRow = (await trx
        .selectFrom('vw_legacy_plan as v')
        .selectAll('v')
        .where('v.id', '=', planId)
        .where('v.trainerId', '=', session.trainerId)
        .executeTakeFirst()) as RawPlanRow | undefined

      if (!planRow) {
        throw new SubscriptionNotFoundError()
      }

      normalizePlanRow(planRow)
    })

    return { ok: true as const }
  } catch (error) {
    if (error instanceof SubscriptionNotFoundError) {
      return { ok: false as const, message: 'Subscription not found.' }
    }
    if (error instanceof SubscriptionIsCancelledError) {
      return { ok: false as const, message: 'Cancelled subscriptions cannot be accepted.' }
    }
    if (error instanceof NoPaymentMethodOnFileError) {
      return {
        ok: false as const,
        message: 'A saved payment method is required before accepting this subscription.',
      }
    }

    console.error('client-dashboard: failed to accept subscription', {
      planId,
      clientId: session.clientId,
      trainerId: session.trainerId,
      error,
    })

    return { ok: false as const, message: 'Failed to accept subscription. Please try again.' }
  }
}

class SubscriptionRetryNotFoundError extends Error {
  constructor() {
    super('Subscription not found')
    this.name = 'SubscriptionRetryNotFoundError'
  }
}

export async function retryPaymentPlan(input: { planId: string }) {
  const validation = z.object({ planId: z.string().trim().min(1) }).safeParse(input)
  if (!validation.success) {
    return { ok: false as const, message: 'Invalid subscription.' }
  }

  const session = await getClientDashboardSession()
  if (!session) {
    return { ok: false as const, message: 'Please sign in again to retry this subscription.' }
  }

  const { planId } = validation.data

  try {
    const { attempted } = await db.transaction().execute(async (trx) => {
      const plan = await trx
        .selectFrom('payment_plan as plan')
        .select((eb) => [eb.ref('plan.status').as('status'), eb.ref('plan.end_').as('endDate')])
        .where('plan.id', '=', planId)
        .where('plan.client_id', '=', session.clientId)
        .executeTakeFirst()

      if (!plan) {
        throw new SubscriptionRetryNotFoundError()
      }

      const now = new Date()
      const outstandingPayments = await trx
        .selectFrom('payment_plan_payment as paymentPlanPayment')
        .innerJoin('payment_plan as planRecord', 'planRecord.id', 'paymentPlanPayment.payment_plan_id')
        .select((eb) => [eb.ref('paymentPlanPayment.id').as('id')])
        .where('paymentPlanPayment.payment_plan_id', '=', planId)
        .where('planRecord.client_id', '=', session.clientId)
        .where((eb) =>
          eb.or([
            eb.and([
              eb(eb.ref('paymentPlanPayment.status'), '=', 'pending'),
              eb(eb.ref('planRecord.status'), '=', 'active'),
              eb(eb.ref('planRecord.end_'), '>', now),
            ]),
            eb(eb.ref('paymentPlanPayment.status'), '=', 'rejected'),
          ])
        )
        .where('paymentPlanPayment.date', '<=', now)
        .where('paymentPlanPayment.amount_outstanding', '>', '0')
        .execute()

      await enqueueWorkflowTask(
        trx,
        'payment-plan.charge-outstanding',
        {
          paymentPlanId: planId,
          forScheduledTask: false,
        },
        {
          dedupeKey: `payment-plan.charge-outstanding:${planId}`,
        }
      )

      return { attempted: outstandingPayments.length }
    })

    return { ok: true as const, attempted }
  } catch (error) {
    if (error instanceof SubscriptionRetryNotFoundError) {
      return { ok: false as const, message: 'Subscription not found.' }
    }

    console.error('client-dashboard: failed to retry subscription', {
      planId,
      clientId: session.clientId,
      trainerId: session.trainerId,
      error,
    })

    return { ok: false as const, message: 'Failed to retry subscription payments.' }
  }
}

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

class ServiceProviderCantTakePaymentsError extends Error {
  constructor() {
    super('Service provider cannot take payments')
    this.name = 'ServiceProviderCantTakePaymentsError'
  }
}

class StripeCardRequiredError extends Error {
  constructor() {
    super('Stripe card required')
    this.name = 'StripeCardRequiredError'
  }
}

class StripePaymentIntentMismatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StripePaymentIntentMismatchError'
  }
}

class AmountOutOfRangeError extends Error {
  constructor() {
    super('Amount out of range')
    this.name = 'AmountOutOfRangeError'
  }
}

class InvalidFeeConfigurationError extends Error {
  constructor() {
    super('Invalid fee configuration')
    this.name = 'InvalidFeeConfigurationError'
  }
}

class StripeActionRequiredError extends Error {
  clientSecret: string

  constructor(clientSecret: string) {
    super('Stripe action required')
    this.name = 'StripeActionRequiredError'
    this.clientSecret = clientSecret
  }
}

class StripePaymentFailedError extends Error {
  constructor() {
    super('Stripe payment did not succeed')
    this.name = 'StripePaymentFailedError'
  }
}

type SaleDetails = {
  paymentStatus: string | null
  saleProductPrice: string | number
  currency: string
  clientId: string
  trainerId: string
  locale: string
  trainerUserId: string
  paymentRequestPassOnTransactionFee: boolean
  country: string
  stripeAccountId: string | null
  stripePaymentsBlocked: boolean | null
  stripeAccountType: 'standard' | 'custom' | 'express' | null
  clientEmail: string | null
  clientFirstName: string
  clientLastName: string | null
  trainerEmail: string
  stripeCustomerId: string | null
  productName: string
  saleProductId: string
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
})

const amountSchema = z.string().refine((value) => {
  const amount = new BigNumber(value)
  return amount.isFinite() && amount.gte(0)
}, 'amount must be a non-negative number')

const salePaymentRequestSchema = z
  .object({
    saleId: z.string().trim().min(1),
    amount: amountSchema,
    currency: z.string().trim().min(1),
    stripePaymentMethodId: z.string().trim().optional(),
    stripePaymentIntentId: z.string().trim().optional(),
    setupFutureUsage: z.boolean().optional(),
  })
  .refine(
    (value) => Boolean(value.stripePaymentMethodId) !== Boolean(value.stripePaymentIntentId),
    'Provide either stripePaymentMethodId or stripePaymentIntentId.'
  )

const formatCurrency = (amount: BigNumber, locale: string, currency: string) => {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount.toNumber())
}

export async function createSalePayment(input: {
  saleId: string
  amount: string
  currency: string
  stripePaymentMethodId?: string
  stripePaymentIntentId?: string
  setupFutureUsage?: boolean
}) {
  const validation = salePaymentRequestSchema.safeParse(input)

  if (!validation.success) {
    const detail = validation.error.issues.map((issue) => issue.message).join('; ')
    return { ok: false as const, message: detail || 'Invalid payment request.' }
  }

  const session = await getClientDashboardSession()
  if (!session) {
    return { ok: false as const, message: 'Please sign in again to make a payment.' }
  }

  const payload = validation.data
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
          eb.ref('stripeAccount.object').as('stripeAccountObject'),
          eb.ref('client.email').as('clientEmail'),
          eb.ref('client.first_name').as('clientFirstName'),
          eb.ref('client.last_name').as('clientLastName'),
          eb.ref('client.stripe_customer_id').as('stripeCustomerId'),
          eb.ref('trainer.email').as('trainerEmail'),
          eb.ref('saleProduct.name').as('productName'),
          eb.ref('saleProduct.id').as('saleProductId'),
        ])
        .where('sale.id', '=', payload.saleId)
        .where('sale.client_id', '=', session.clientId)
        .executeTakeFirst()

      if (!saleDetailsRow) {
        throw new SaleNotFoundError()
      }

      const stripeAccountValue = saleDetailsRow.stripeAccountObject
      const stripeAccountTypeValue =
        stripeAccountValue && typeof stripeAccountValue === 'object' && 'type' in stripeAccountValue
          ? ((stripeAccountValue as { type?: string }).type ?? null)
          : null

      const saleDetails = saleDetailsSchema.parse({
        ...saleDetailsRow,
        stripeAccountType: stripeAccountTypeValue,
      }) as SaleDetails

      if (
        saleDetails.paymentStatus &&
        saleDetails.paymentStatus !== 'none' &&
        saleDetails.paymentStatus !== 'requested'
      ) {
        throw new SaleAlreadyPaidError()
      }

      const salePrice = new BigNumber(saleDetails.saleProductPrice)
      if (!salePrice.isFinite() || !salePrice.eq(amountValue)) {
        throw new PaymentAmountMismatchError()
      }

      const paymentRow = await trx
        .insertInto('payment')
        .values({
          trainer_id: saleDetails.trainerId,
          client_id: saleDetails.clientId,
          sale_id: payload.saleId,
          amount: amountValue.toString(),
          is_manual: false,
          is_credit_pack: false,
          is_subscription: false,
          is_stripe: true,
          is_scheduled_stripe: false,
        })
        .returning('id')
        .executeTakeFirst()

      if (!paymentRow) {
        throw new Error('Failed to insert payment')
      }

      const paymentId = paymentRow.id

      const markSalePaid = async () => {
        await trx
          .updateTable('sale_payment_status')
          .set({ payment_status: 'paid' })
          .where('sale_id', '=', payload.saleId)
          .execute()
      }

      const stripeClient = getStripeClient()
      if (!stripeClient) {
        throw new StripeConfigurationMissingError()
      }

      if (saleDetails.stripePaymentsBlocked) {
        throw new StripePaymentsDisabledError()
      }

      const stripeAccountType = saleDetails.stripeAccountType ?? undefined
      const stripeAccountId = saleDetails.stripeAccountId ?? undefined

      if (
        !stripeAccountId ||
        !stripeAccountType ||
        (stripeAccountType !== 'standard' && stripeAccountType !== 'custom')
      ) {
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
            api_version: stripeApiVersionDate,
            object: JSON.stringify(customer),
          })
          .onConflict((oc) =>
            oc.column('id').doUpdateSet({
              api_version: stripeApiVersionDate,
              object: JSON.stringify(customer),
            })
          )
          .execute()

        await trx
          .updateTable('client')
          .set({ stripe_customer_id: customer.id })
          .where('id', '=', saleDetails.clientId)
          .execute()
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

        paymentMethod = await stripeClient.paymentMethods.retrieve(
          payload.stripePaymentMethodId,
          {},
          stripeRequestOptions
        )
      }

      if (!paymentMethod.card) {
        throw new StripeCardRequiredError()
      }

      const cardCountry = (paymentMethod.card.country ?? chargeCountry).toUpperCase()

      const fee = getTransactionFee({
        cardCountry,
        chargeCountry,
        currency,
      })

      const denominator = new BigNumber(1).minus(fee.percentageFee)
      if (denominator.isZero()) {
        throw new InvalidFeeConfigurationError()
      }

      const passOnFee = saleDetails.paymentRequestPassOnTransactionFee

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

      const formattedAmount = formatCurrency(chargeAmount, saleDetails.locale, currency)
      const notificationPayload = {
        title: joinIgnoreEmpty(saleDetails.clientFirstName, saleDetails.clientLastName),
        userId: saleDetails.trainerUserId,
        messageType: 'success' as const,
        notificationType: 'transaction' as const,
        body: `Payment Processed!\nPayment of ${formattedAmount} has gone through for ${saleDetails.productName}`,
      }

      await enqueueWorkflowTask(trx, 'user.notify', notificationPayload, {
        dedupeKey: `user.notify:salePayment:${paymentId}`,
      })

      let paymentIntent: Stripe.Response<Stripe.PaymentIntent>

      try {
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
              setup_future_usage: payload.setupFutureUsage ? 'off_session' : undefined,
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
      } catch (error) {
        if (
          error instanceof Stripe.errors.StripeInvalidRequestError &&
          error.message.startsWith(
            'Your destination account needs to have at least one of the following capabilities enabled'
          ) &&
          error.message.includes('transfers')
        ) {
          const failurePayload = {
            title: 'Attempted payment failed!',
            userId: saleDetails.trainerUserId,
            messageType: 'failure' as const,
            notificationType: 'transaction' as const,
            body: `${joinIgnoreEmpty(
              saleDetails.clientFirstName,
              saleDetails.clientLastName
            )} attempted to pay ${formattedAmount} for ${saleDetails.productName} but it failed as you aren't verified.`,
          }

          await enqueueWorkflowTask(db, 'user.notify', failurePayload, {
            dedupeKey: `user.notify:salePaymentFailed:${paymentId}`,
          })

          throw new ServiceProviderCantTakePaymentsError()
        }

        throw error
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
          api_version: stripeApiVersionDate,
          object: paymentIntent ? JSON.stringify(paymentIntent) : null,
        })
        .onConflict((oc) =>
          oc.column('id').doUpdateSet({
            api_version: stripeApiVersionDate,
            object: paymentIntent ? JSON.stringify(paymentIntent) : null,
          })
        )
        .execute()

      if (passOnFee) {
        await trx.updateTable('payment').set({ amount: chargeAmount.toString() }).where('id', '=', paymentId).execute()
        await trx
          .updateTable('sale_product')
          .set({ price: chargeAmount.toString() })
          .where('id', '=', saleDetails.saleProductId)
          .execute()
      }

      const latestChargeId = typeof paymentIntent.latest_charge === 'string' ? paymentIntent.latest_charge : null

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

    return { ok: true as const, paymentId: paymentMeta.paymentId }
  } catch (error) {
    if (error instanceof StripeActionRequiredError) {
      return { ok: false as const, requiresAction: true as const, clientSecret: error.clientSecret }
    }

    if (error instanceof SaleNotFoundError) {
      return { ok: false as const, message: 'Sale not found.' }
    }

    if (error instanceof SaleAlreadyPaidError) {
      return { ok: false as const, message: 'This payment request has already been paid.' }
    }

    if (error instanceof PaymentAmountMismatchError) {
      return { ok: false as const, message: 'Payment amount must match the total due.' }
    }

    if (error instanceof StripeConfigurationMissingError) {
      return { ok: false as const, message: 'Stripe configuration is missing. Please try again later.' }
    }

    if (error instanceof StripePaymentsDisabledError) {
      return { ok: false as const, message: 'Stripe payments are not enabled for this trainer.' }
    }

    if (error instanceof ServiceProviderCantTakePaymentsError) {
      return {
        ok: false as const,
        message: "Your service provider does not have payments enabled. We've notified them.",
      }
    }

    if (error instanceof StripeCardRequiredError) {
      return { ok: false as const, message: 'Only card payments are supported.' }
    }

    if (error instanceof StripePaymentIntentMismatchError) {
      return { ok: false as const, message: error.message }
    }

    if (error instanceof AmountOutOfRangeError) {
      return { ok: false as const, message: 'The payment amount is outside supported limits.' }
    }

    if (error instanceof InvalidFeeConfigurationError) {
      return { ok: false as const, message: 'Fee configuration resulted in an invalid calculation.' }
    }

    if (error instanceof CurrencyNotSupportedError) {
      return { ok: false as const, message: 'That currency is not supported.' }
    }

    if (error instanceof CountryNotSupportedError) {
      return { ok: false as const, message: 'That card country is not supported for payments.' }
    }

    if (error instanceof StripePaymentFailedError) {
      return { ok: false as const, message: 'Stripe payment did not complete.' }
    }

    if (error instanceof Stripe.errors.StripeError) {
      return { ok: false as const, message: error.message }
    }

    console.error('client-dashboard: failed to create sale payment', error)
    return { ok: false as const, message: 'Failed to create sale payment.' }
  }
}
