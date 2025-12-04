import { NextRequest, NextResponse } from 'next/server'
import BigNumber from 'bignumber.js'
import { z } from 'zod'
import { db, sql } from '@/lib/db'
import { authenticateTrainerRequest, buildErrorResponse } from '../../../../_lib/accessToken'
import { APP_NAME, NO_REPLY_EMAIL } from '../../../../_lib/constants'
import { currencyChargeLimits } from '../../../../_lib/transactionFees'
import { normalizePlanRow, type RawPlanRow } from '../../../../plans/shared'

const MAX_TIME = new Date(8640000000000000)

const paramsSchema = z.object({
  clientId: z.string().trim().min(1, 'Client id is required').uuid({ message: 'Client id must be a valid UUID.' }),
  planId: z.string().trim().min(1, 'Plan id is required').uuid({ message: 'Plan id must be a valid UUID.' }),
})

const requestBodySchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  amount: z.number().positive('Amount must be greater than zero'),
  endDate: z
    .string()
    .datetime({
      message: 'endDate must be an ISO 8601 date-time string',
    })
    .nullable()
    .optional(),
})

const planDetailsSchema = z.object({
  name: z.string(),
  status: z.enum(['cancelled', 'paused', 'pending', 'active', 'ended']),
  frequencyWeeklyInterval: z.number(),
  locale: z.string(),
  start: z.union([z.date(), z.string(), z.number()]),
  end: z.union([z.date(), z.string(), z.number()]),
  amount: z.union([z.string(), z.number()]),
  serviceProviderName: z.string(),
  brandColor: z.string().nullable(),
  businessLogoUrl: z.string().nullable(),
  clientEmail: z.string().email().nullable(),
  clientUserId: z.string(),
  clientId: z.string(),
  currency: z.string(),
})

type HandlerContext = { params: Promise<Record<string, string>> }

class SubscriptionNotFoundError extends Error {
  constructor() {
    super('Subscription not found')
    this.name = 'SubscriptionNotFoundError'
  }
}

class ClientHasNoEmailError extends Error {
  constructor() {
    super('Client has no email')
    this.name = 'ClientHasNoEmailError'
  }
}

class InvalidAmountError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidAmountError'
  }
}

class InvalidEndDateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidEndDateError'
  }
}

class UnsupportedCurrencyError extends Error {
  constructor() {
    super('Currency not supported')
    this.name = 'UnsupportedCurrencyError'
  }
}

class CantUpdatePausedSubscriptionError extends Error {
  constructor() {
    super('Subscription is paused')
    this.name = 'CantUpdatePausedSubscriptionError'
  }
}

class PaidAppointmentsAfterSubscriptionEndDateError extends Error {
  constructor() {
    super('Paid appointments exist after new end date')
    this.name = 'PaidAppointmentsAfterSubscriptionEndDateError'
  }
}

const tailwind600: Record<string, string> = {
  amber: '#d97706',
  blue: '#2563eb',
  cyan: '#0ea5e9',
  emerald: '#059669',
  fuchsia: '#c026d3',
  green: '#16a34a',
  indigo: '#4f46e5',
  lightBlue: '#0284c7',
  lime: '#65a30d',
  orange: '#ea580c',
  pink: '#db2777',
  purple: '#7c3aed',
  red: '#dc2626',
  rose: '#e11d48',
  sky: '#0284c7',
  teal: '#0d9488',
  violet: '#7c3aed',
  yellow: '#ca8a04',
}

const resolveBrandColor = (value?: string | null) => (value && tailwind600[value]) ?? tailwind600.blue

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const buildPlanUpdateEmail = (options: {
  serviceProviderName: string
  brandColor?: string | null
  businessLogoUrl?: string | null
  link: URL
  planName: string
  messages: string[]
  requiresClientAcceptance: boolean
}) => {
  const provider = options.serviceProviderName.trim() || `${APP_NAME} Team`
  const buttonColor = resolveBrandColor(options.brandColor)
  const logo = options.businessLogoUrl
    ? `<img src="${options.businessLogoUrl}" alt="${escapeHtml(
        provider
      )}" style="max-width:160px;height:auto;border-radius:12px;" />`
    : ''

  const changeList = options.messages.map((message) => `<li>${escapeHtml(message)}</li>`).join('')

  const bodyCopy = options.requiresClientAcceptance
    ? `${escapeHtml(provider)} has updated your subscription. Please review and accept the updated terms.`
    : `${escapeHtml(
        provider
      )} has updated your subscription. No action is required, but you can review the changes anytime.`

  return `
<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#f7f9fb;font-family:Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px;">
            <tr>
              <td align="center" style="padding-bottom:24px;">
                ${logo}
              </td>
            </tr>
            <tr>
              <td style="font-size:22px;font-weight:700;color:#111827;text-align:center;padding-bottom:12px;">
                Subscription Updated
              </td>
            </tr>
            <tr>
              <td style="font-size:16px;line-height:1.6;color:#1f2937;padding-bottom:16px;text-align:center;">
                ${bodyCopy}
              </td>
            </tr>
            <tr>
              <td style="font-size:14px;line-height:1.6;color:#4b5563;padding-bottom:16px;">
                <strong>Plan:</strong> ${escapeHtml(options.planName)}
              </td>
            </tr>
            <tr>
              <td style="font-size:14px;line-height:1.6;color:#4b5563;padding-bottom:16px;">
                <strong>Changes:</strong>
                <ul style="padding-left:20px;margin:8px 0 0;">${changeList}</ul>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:24px;">
                <a href="${options.link.toString()}" style="display:inline-block;background-color:${buttonColor};color:#ffffff;padding:12px 20px;border-radius:10px;font-size:16px;font-weight:600;text-decoration:none;">
                  Go to Dashboard
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`
}

const toDateOrThrow = (value: unknown, label: string): Date => {
  if (value === 'infinity' || value === Infinity) {
    return MAX_TIME
  }

  if (value === '-infinity' || value === -Infinity) {
    return new Date(-8640000000000000)
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new InvalidEndDateError(`${label} is invalid`)
    }
    return value
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }
  }

  throw new InvalidEndDateError(`${label} is invalid`)
}

const withinMilliseconds = (left: Date, right: Date, toleranceMs: number) =>
  Math.abs(left.getTime() - right.getTime()) <= toleranceMs

export async function PUT(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map((issue) => issue.message).join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid path parameters',
        detail: detail || 'Request parameters did not match the expected schema.',
        type: '/invalid-path-parameters',
      }),
      { status: 400 }
    )
  }

  let parsedBody: z.infer<typeof requestBodySchema>

  try {
    const rawBody = (await request.json()) as unknown
    const validation = requestBodySchema.safeParse(rawBody)

    if (!validation.success) {
      const detail = validation.error.issues.map((issue) => issue.message).join('; ')

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

    parsedBody = validation.data
  } catch (error) {
    console.error('Failed to parse subscription update body', error)
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
    extensionFailureLogMessage: 'Failed to extend access token expiry while updating subscription',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { clientId, planId } = paramsResult.data

  try {
    const plan = await db.transaction().execute(async (trx) => {
      const planRow = await trx
        .selectFrom('payment_plan as plan')
        .innerJoin('client', 'client.id', 'plan.client_id')
        .innerJoin('trainer', 'trainer.id', 'plan.trainer_id')
        .innerJoin('country', 'country.id', 'trainer.country_id')
        .innerJoin('supported_country_currency as scc', 'scc.country_id', 'trainer.country_id')
        .innerJoin('currency', 'currency.id', 'scc.currency_id')
        .select((eb) => [
          eb.ref('plan.name').as('name'),
          eb.ref('plan.status').as('status'),
          eb.ref('plan.frequency_weekly_interval').as('frequencyWeeklyInterval'),
          eb.ref('plan.start').as('start'),
          eb.ref('plan.end_').as('end'),
          eb.ref('plan.amount').as('amount'),
          eb.ref('trainer.locale').as('locale'),
          sql<string>`
            COALESCE(
              trainer.online_bookings_business_name,
              trainer.business_name,
              trainer.first_name || COALESCE(' ' || trainer.last_name, '')
            )
          `.as('serviceProviderName'),
          eb.ref('trainer.brand_color').as('brandColor'),
          eb.ref('trainer.business_logo_url').as('businessLogoUrl'),
          eb.ref('client.email').as('clientEmail'),
          eb.ref('client.user_id').as('clientUserId'),
          eb.ref('client.id').as('clientId'),
          eb.ref('currency.alpha_code').as('currency'),
        ])
        .where('plan.id', '=', planId)
        .where('plan.client_id', '=', clientId)
        .where('plan.trainer_id', '=', authorization.trainerId)
        .executeTakeFirst()

      if (!planRow) {
        throw new SubscriptionNotFoundError()
      }

      const detailsResult = planDetailsSchema.safeParse(planRow)

      if (!detailsResult.success) {
        throw new InvalidEndDateError('Subscription data is invalid')
      }

      const details = detailsResult.data

      if (!details.clientEmail) {
        throw new ClientHasNoEmailError()
      }

      if (details.status === 'paused') {
        throw new CantUpdatePausedSubscriptionError()
      }

      const currency = details.currency.toUpperCase()
      const limits = currencyChargeLimits[currency as keyof typeof currencyChargeLimits]

      if (!limits) {
        throw new UnsupportedCurrencyError()
      }

      const updatedAmount = new BigNumber(parsedBody.amount).decimalPlaces(2)
      if (!updatedAmount.isFinite() || updatedAmount.lte(0)) {
        throw new InvalidAmountError('Amount must be a positive numeric value.')
      }

      const unitAmount = updatedAmount.shiftedBy(limits.smallestUnitDecimals)
      if (!unitAmount.isInteger()) {
        throw new InvalidAmountError('Amount must be representable in the smallest currency unit.')
      }

      if (unitAmount.lt(limits.minimumInSmallestUnit) || unitAmount.gt(limits.maximumInSmallestUnit)) {
        const minDisplay = new BigNumber(limits.minimumInSmallestUnit).shiftedBy(-limits.smallestUnitDecimals)
        const maxDisplay = new BigNumber(limits.maximumInSmallestUnit).shiftedBy(-limits.smallestUnitDecimals)

        throw new InvalidAmountError(
          `Amount must be between ${minDisplay.toFixed()} and ${maxDisplay.toFixed()} ${currency}.`
        )
      }

      const updatedEndDate =
        parsedBody.endDate === undefined || parsedBody.endDate === null
          ? null
          : (() => {
              const parsed = new Date(parsedBody.endDate)
              if (Number.isNaN(parsed.getTime())) {
                throw new InvalidEndDateError('endDate must be an ISO 8601 date-time string')
              }
              return parsed
            })()

      if (updatedEndDate && updatedEndDate.getTime() < Date.now()) {
        throw new InvalidEndDateError('Subscription must not end in the past')
      }

      const startDate = toDateOrThrow(details.start, 'Subscription start')

      if (updatedEndDate && updatedEndDate.getTime() < startDate.getTime()) {
        throw new InvalidEndDateError('End date must be after the subscription start date')
      }

      const nextPaymentDate = new Date()
      if (updatedEndDate && updatedEndDate.getTime() < nextPaymentDate.getTime()) {
        throw new InvalidEndDateError('End date must be after the next payment date')
      }

      if (updatedEndDate) {
        const finalPaymentDate = new Date(
          updatedEndDate.getTime() + details.frequencyWeeklyInterval * 7 * 24 * 60 * 60 * 1000
        )

        const paidSessionsAfterEndDate = await sql<{
          exists: boolean
        }>`
          SELECT TRUE as exists
            FROM client_session
            JOIN session ON session.id = client_session.session_id
            JOIN sale ON sale.id = client_session.sale_id
            JOIN payment ON payment.sale_id = sale.id
            JOIN payment_subscription ON payment_subscription.id = payment.id
           WHERE payment_subscription.subscription_id = ${planId}
             AND client_session.client_id = ${clientId}
             AND session.start > ${finalPaymentDate.toISOString()}
        `.execute(trx)

        if (paidSessionsAfterEndDate.rows.length > 0) {
          throw new PaidAppointmentsAfterSubscriptionEndDateError()
        }
      }

      const existingEndDate = toDateOrThrow(details.end, 'Subscription end date')
      const newEndDate = updatedEndDate === null ? MAX_TIME : updatedEndDate

      let requiresClientAcceptance = false
      const messages: string[] = []

      if (!withinMilliseconds(newEndDate, existingEndDate, 1)) {
        if (newEndDate.getTime() > existingEndDate.getTime()) {
          requiresClientAcceptance = true
          messages.push(
            newEndDate.getTime() === MAX_TIME.getTime()
              ? 'The subscription end date was removed'
              : 'The subscription end date was extended'
          )
        } else {
          messages.push('The subscription end date was reduced')
        }
      }

      const currentAmount = new BigNumber(details.amount)
      const formattedAmount = new Intl.NumberFormat(details.locale || 'en-US', {
        style: 'currency',
        currency,
      }).format(Number(updatedAmount.toString()))

      if (updatedAmount.gt(currentAmount)) {
        requiresClientAcceptance = true
        messages.push(`Increased the payment amount to ${formattedAmount}`)
      } else if (!updatedAmount.eq(currentAmount)) {
        messages.push(`Decreased the payment amount to ${formattedAmount}`)
      }

      const nameChanged = parsedBody.name !== details.name
      const shouldUpdatePlan = messages.length > 0 || requiresClientAcceptance || nameChanged

      if (shouldUpdatePlan) {
        const planUpdate: Record<string, unknown> = {
          end_:
            newEndDate.getTime() === MAX_TIME.getTime() ? sql<Date>`'infinity'::timestamp with time zone` : newEndDate,
          amount: updatedAmount.toString(),
        }

        if (requiresClientAcceptance) {
          planUpdate.status = 'pending'
          planUpdate.accepted_end = null
          planUpdate.accepted_amount = null
          planUpdate.acceptance_request_time = sql<Date>`NOW()`
        } else {
          planUpdate.accepted_end =
            newEndDate.getTime() === MAX_TIME.getTime() ? sql<Date>`'infinity'::timestamp with time zone` : newEndDate
          planUpdate.accepted_amount = updatedAmount.toString()
        }

        if (nameChanged) {
          planUpdate.name = parsedBody.name
        }

        const updatedPlanRow = await trx
          .updateTable('payment_plan')
          .set(planUpdate)
          .where('id', '=', planId)
          .where('client_id', '=', clientId)
          .where('trainer_id', '=', authorization.trainerId)
          .returning((eb) => [eb.ref('payment_plan.id').as('id')])
          .executeTakeFirst()

        if (!updatedPlanRow) {
          throw new SubscriptionNotFoundError()
        }
      }

      if (messages.length > 0 || requiresClientAcceptance) {
        const tokenRow = await trx
          .insertInto('access_token')
          .values({
            user_id: details.clientUserId,
            user_type: 'client',
            type: 'client_dashboard',
            expires_at: sql<Date>`NOW() + INTERVAL '7 days'`,
          })
          .returning('id')
          .executeTakeFirst()

        if (!tokenRow) {
          throw new Error('Failed to create client dashboard access token')
        }

        const baseUrl = process.env.BASE_URL ?? 'http://localhost:3001'
        const link = new URL(baseUrl)
        link.hash = `/client/${details.clientId}/${tokenRow.id}?email=${encodeURIComponent(details.clientEmail)}`
        link.searchParams.set('next', `/client-dashboard/payment-plans/${planId}`)

        const senderName = details.serviceProviderName.trim() || `${APP_NAME} Team`
        const html = buildPlanUpdateEmail({
          serviceProviderName: details.serviceProviderName,
          brandColor: details.brandColor,
          businessLogoUrl: details.businessLogoUrl,
          link,
          planName: parsedBody.name,
          messages,
          requiresClientAcceptance,
        })

        await trx
          .insertInto('mail')
          .values({
            trainer_id: authorization.trainerId,
            client_id: details.clientId,
            from_email: NO_REPLY_EMAIL,
            from_name: `${senderName} via ${APP_NAME}`,
            to_email: details.clientEmail,
            to_name: null,
            subject: `${senderName} has updated your subscription`,
            html,
            reply_to: null,
          })
          .execute()
      }

      const rawPlanRow = (await trx
        .selectFrom('vw_legacy_plan as v')
        .selectAll('v')
        .where('v.id', '=', planId)
        .where('v.trainerId', '=', authorization.trainerId)
        .executeTakeFirst()) as RawPlanRow | undefined

      if (!rawPlanRow) {
        throw new SubscriptionNotFoundError()
      }

      return normalizePlanRow(rawPlanRow)
    })

    return NextResponse.json(plan)
  } catch (error) {
    if (error instanceof SubscriptionNotFoundError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Subscription not found',
          detail: 'We could not find a subscription with the specified identifier for the authenticated trainer.',
          type: '/resource-not-found',
        }),
        { status: 404 }
      )
    }

    if (error instanceof ClientHasNoEmailError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'Client has no email',
          detail: 'A client email address is required to send subscription updates.',
          type: '/client-has-no-email',
        }),
        { status: 409 }
      )
    }

    if (error instanceof UnsupportedCurrencyError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'That currency is not supported.',
          type: '/currency-not-supported',
        }),
        { status: 409 }
      )
    }

    if (error instanceof InvalidAmountError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 400,
          title: 'Invalid subscription amount',
          detail: error.message,
          type: '/invalid-amount',
        }),
        { status: 400 }
      )
    }

    if (error instanceof InvalidEndDateError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 400,
          title: 'Invalid subscription dates',
          detail: error.message,
          type: '/invalid-date-range',
        }),
        { status: 400 }
      )
    }

    if (error instanceof CantUpdatePausedSubscriptionError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'Subscription is paused',
          detail: 'Paused subscriptions must be unpaused before updating.',
          type: '/subscription-is-paused',
        }),
        { status: 409 }
      )
    }

    if (error instanceof PaidAppointmentsAfterSubscriptionEndDateError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'Subscription end date too early',
          detail: 'There are paid appointments scheduled after the proposed end date.',
          type: '/paid-appointments-after-end-date',
        }),
        { status: 409 }
      )
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse subscription data from database',
          detail: 'Subscription data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to update subscription', authorization.trainerId, clientId, planId, error)

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to update subscription',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
