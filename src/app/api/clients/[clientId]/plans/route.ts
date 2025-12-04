import { NextRequest, NextResponse } from 'next/server'
import BigNumber from 'bignumber.js'
import { z } from 'zod'
import { db, sql } from '@/lib/db'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../../../_lib/accessToken'
import { APP_NAME, NO_REPLY_EMAIL } from '../../../_lib/constants'
import { currencyChargeLimits } from '../../../_lib/transactionFees'
import {
  normalizePlanRow,
  planFrequencyValues,
  type RawPlanRow,
} from '../../../plans/shared'

const paramsSchema = z.object({
  clientId: z
    .string()
    .trim()
    .min(1, 'Client id is required')
    .uuid({ message: 'Client id must be a valid UUID.' }),
})

const requestBodySchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  amount: z
    .number()
    .positive('Amount must be greater than zero'),
  frequency: z.union([
    z.literal(planFrequencyValues[0]),
    z.literal(planFrequencyValues[1]),
    z.literal(planFrequencyValues[2]),
    z.literal(planFrequencyValues[3]),
  ]),
  startDate: z
    .string()
    .datetime({
      message: 'startDate must be an ISO 8601 date-time string',
    }),
  endDate: z
    .string()
    .datetime({
      message: 'endDate must be an ISO 8601 date-time string',
    })
    .nullable()
    .optional(),
})

const clientDetailsSchema = z.object({
  clientId: z.string().uuid(),
  clientEmail: z.string().email().nullable(),
  clientUserId: z.string().uuid(),
  serviceProviderName: z.string(),
  brandColor: z.string().nullable(),
  businessLogoUrl: z.string().nullable(),
  currency: z.string(),
  country: z.string(),
})

type HandlerContext = { params: Promise<Record<string, string>> }

const MAX_TIME = new Date(8640000000000000)
const DAY_IN_MS = 24 * 60 * 60 * 1000

class ClientNotFoundError extends Error {
  constructor() {
    super('Client not found')
    this.name = 'ClientNotFoundError'
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

class InvalidDateRangeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidDateRangeError'
  }
}

class AccessTokenCreationError extends Error {
  constructor() {
    super('Failed to create client dashboard access token')
    this.name = 'AccessTokenCreationError'
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

const resolveBrandColor = (value?: string | null) =>
  (value && tailwind600[value]) ?? tailwind600.blue

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const buildPlanRequestEmail = (options: {
  serviceProviderName: string
  brandColor?: string | null
  businessLogoUrl?: string | null
  link: URL
  planName: string
  amountText: string
  frequencyWeeks: number
  startDateLabel: string
  endDateLabel: string
}) => {
  const serviceProvider =
    options.serviceProviderName.trim() || `${APP_NAME} Team`
  const buttonColor = resolveBrandColor(options.brandColor)
  const logo = options.businessLogoUrl
    ? `<img src="${options.businessLogoUrl}" alt="${escapeHtml(
        serviceProvider
      )}" style="max-width:160px;height:auto;border-radius:12px;" />`
    : ''

  const cadence =
    options.frequencyWeeks === 1
      ? 'every week'
      : `every ${options.frequencyWeeks} weeks`

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
                Subscription Request
              </td>
            </tr>
            <tr>
              <td style="font-size:16px;line-height:1.6;color:#1f2937;padding-bottom:16px;text-align:center;">
                ${escapeHtml(
                  serviceProvider
                )} created a subscription for you: <strong>${escapeHtml(
                  options.planName
                )}</strong>.
                You'll be billed ${escapeHtml(options.amountText)} ${escapeHtml(
                  cadence
                )}.
              </td>
            </tr>
            <tr>
              <td style="font-size:14px;line-height:1.5;color:#4b5563;text-align:center;padding-bottom:16px;">
                Start date: ${escapeHtml(options.startDateLabel)}${
                  options.endDateLabel
                    ? `<br/>End date: ${escapeHtml(options.endDateLabel)}`
                    : ''
                }
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:24px;">
                <a href="${options.link.toString()}" style="display:inline-block;background-color:${buttonColor};color:#ffffff;padding:12px 20px;border-radius:10px;font-size:16px;font-weight:600;text-decoration:none;">
                  Go to Dashboard
                </a>
              </td>
            </tr>
            <tr>
              <td style="font-size:13px;line-height:1.5;color:#6b7280;text-align:center;">
                Review and accept the subscription in your dashboard to activate it.
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

const parseDateOnly = (value: string, label: string) => {
  const datePortion = value.slice(0, 10)
  const candidate = `${datePortion}T00:00:00.000Z`
  const parsed = new Date(candidate)

  if (Number.isNaN(parsed.getTime())) {
    throw new InvalidDateRangeError(`${label} must be an ISO date`)
  }

  return parsed
}

const formatIsoDateLabel = (value: Date | null | undefined) => {
  if (!value) return ''
  return value.toISOString().slice(0, 10)
}

export async function POST(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)
  if (!paramsResult.success) {
    const detail = paramsResult.error.issues
      .map(issue => issue.message)
      .join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid path parameters',
        detail:
          detail ||
          'Request parameters did not match the expected schema.',
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
      const detail = validation.error.issues
        .map(issue => issue.message)
        .join('; ')

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
    console.error('Failed to parse subscription request body', error)
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
    extensionFailureLogMessage:
      'Failed to extend access token expiry while creating subscription',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { clientId } = paramsResult.data

  try {
    const startDate = parseDateOnly(parsedBody.startDate, 'startDate')
    const endDate =
      parsedBody.endDate === undefined || parsedBody.endDate === null
        ? MAX_TIME
        : parseDateOnly(parsedBody.endDate, 'endDate')

    if (Date.now() - startDate.getTime() >= DAY_IN_MS) {
      throw new InvalidDateRangeError(
        'startDate must be within the last 24 hours'
      )
    }

    if (startDate.getTime() > endDate.getTime()) {
      throw new InvalidDateRangeError(
        'startDate must be before endDate'
      )
    }

    const detailsRow = await db
      .selectFrom('client')
      .innerJoin('trainer', 'trainer.id', 'client.trainer_id')
      .innerJoin('country', 'country.id', 'trainer.country_id')
      .innerJoin(
        'supported_country_currency as scc',
        'scc.country_id',
        'trainer.country_id'
      )
      .innerJoin('currency', 'currency.id', 'scc.currency_id')
      .select(({ ref }) => [
        ref('client.id').as('clientId'),
        ref('client.email').as('clientEmail'),
        ref('client.user_id').as('clientUserId'),
        sql<string>`
          COALESCE(
            trainer.online_bookings_business_name,
            trainer.business_name,
            trainer.first_name || COALESCE(' ' || trainer.last_name, '')
          )
        `.as('serviceProviderName'),
        ref('trainer.brand_color').as('brandColor'),
        ref('trainer.business_logo_url').as('businessLogoUrl'),
        ref('currency.alpha_code').as('currency'),
        ref('country.alpha_2_code').as('country'),
      ])
      .where('client.id', '=', clientId)
      .where('trainer.id', '=', authorization.trainerId)
      .executeTakeFirst()

    if (!detailsRow) {
      throw new ClientNotFoundError()
    }

    const details = clientDetailsSchema.parse(detailsRow)

    if (!details.clientEmail) {
      throw new ClientHasNoEmailError()
    }

    const currency = details.currency.toUpperCase()
    const limits =
      currencyChargeLimits[currency as keyof typeof currencyChargeLimits]

    if (!limits) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'That currency is not supported.',
          type: '/currency-not-supported',
        }),
        { status: 409 }
      )
    }

    const amount = new BigNumber(parsedBody.amount).decimalPlaces(2)
    if (!amount.isFinite() || amount.lte(0)) {
      throw new InvalidAmountError(
        'Amount must be a positive numeric value.'
      )
    }

    const unitAmount = amount.shiftedBy(limits.smallestUnitDecimals)
    if (!unitAmount.isInteger()) {
      throw new InvalidAmountError(
        'Amount must be representable in the smallest currency unit.'
      )
    }

    if (
      unitAmount.lt(limits.minimumInSmallestUnit) ||
      unitAmount.gt(limits.maximumInSmallestUnit)
    ) {
      const minDisplay = new BigNumber(limits.minimumInSmallestUnit).shiftedBy(
        -limits.smallestUnitDecimals
      )
      const maxDisplay = new BigNumber(limits.maximumInSmallestUnit).shiftedBy(
        -limits.smallestUnitDecimals
      )

      throw new InvalidAmountError(
        `Amount must be between ${minDisplay.toFixed()} and ${maxDisplay.toFixed()} ${currency}.`
      )
    }

    const frequencyWeeks = parsedBody.frequency / 7
    const amountStr = amount.toString()
    const baseUrl = process.env.BASE_URL ?? 'http://localhost:3001'

    const plan = await db.transaction().execute(async trx => {
      const insertedPlan = await trx
        .insertInto('payment_plan')
        .values({
          trainer_id: authorization.trainerId,
          client_id: clientId,
          status: 'pending',
          start: startDate.toISOString(),
          end_:
            endDate === MAX_TIME
              ? sql<Date>`'infinity'::timestamp with time zone`
              : endDate.toISOString(),
          frequency_weekly_interval: frequencyWeeks,
          name: parsedBody.name,
          amount: amountStr,
          acceptance_request_time: sql<Date>`NOW()`,
        })
        .returning('id')
        .executeTakeFirst()

      if (!insertedPlan) {
        throw new Error('Failed to insert subscription')
      }

      const planId = insertedPlan.id

      const rawPlanRow = (await trx
        .selectFrom('vw_legacy_plan as v')
        .selectAll('v')
        .where('v.id', '=', planId)
        .where('v.trainerId', '=', authorization.trainerId)
        .executeTakeFirst()) as RawPlanRow | undefined

      if (!rawPlanRow) {
        throw new Error('Failed to load inserted subscription')
      }

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
        throw new AccessTokenCreationError()
      }

      const recipientEmail = details.clientEmail ?? ''

      const link = new URL(baseUrl)
      link.hash = `/client/${details.clientId}/${tokenRow.id}?email=${encodeURIComponent(
        recipientEmail
      )}`
      link.searchParams.set(
        'next',
        `/client-dashboard/payment-plans/${planId}`
      )

      const amountText = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
      }).format(Number(amountStr))

      const html = buildPlanRequestEmail({
        serviceProviderName: details.serviceProviderName,
        brandColor: details.brandColor,
        businessLogoUrl: details.businessLogoUrl,
        link,
        planName: parsedBody.name,
        amountText,
        frequencyWeeks,
        startDateLabel: formatIsoDateLabel(startDate),
        endDateLabel:
          endDate === MAX_TIME ? '' : formatIsoDateLabel(endDate),
      })

      const senderName =
        details.serviceProviderName.trim() || `${APP_NAME} Team`
      const subject = `Subscription Request from ${senderName}`

      await trx
        .insertInto('mail')
        .values({
          trainer_id: authorization.trainerId,
          client_id: details.clientId,
          from_email: NO_REPLY_EMAIL,
          from_name: `${senderName} via ${APP_NAME}`,
          to_email: recipientEmail,
          to_name: null,
          subject,
          html,
          reply_to: null,
        })
        .execute()

      return normalizePlanRow(rawPlanRow)
    })

    return NextResponse.json(plan, { status: 201 })
  } catch (error) {
    if (error instanceof ClientNotFoundError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Client not found',
          detail:
            'We could not find a client with the specified identifier for the authenticated trainer.',
          type: '/client-not-found',
        }),
        { status: 404 }
      )
    }

    if (error instanceof ClientHasNoEmailError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'Client has no email',
          detail:
            'A client email address is required to send a subscription request.',
          type: '/client-has-no-email',
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

    if (error instanceof InvalidDateRangeError) {
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

    if (error instanceof AccessTokenCreationError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to create client dashboard access token',
          type: '/internal-server-error',
        }),
        { status: 500 }
      )
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to validate subscription data',
          detail:
            'Subscription data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to create subscription', {
      trainerId: authorization.trainerId,
      clientId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to create subscription',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
