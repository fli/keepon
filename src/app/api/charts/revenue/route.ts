import { NextResponse } from 'next/server'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import { authenticateTrainerRequest, buildErrorResponse } from '../../_lib/accessToken'

const isValidTimeZone = (value: string) => {
  try {
    // Throws if the time zone identifier is invalid.
    Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

const formatZodIssues = (issues: z.ZodIssue[]) =>
  issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
      return `${path}${issue.message}`
    })
    .join('; ')

const querySchema = z
  .object({
    unit: z.enum(['month', 'day', 'week']),
    startTime: z.string().datetime({ offset: true }),
    timezone: z
      .string()
      .trim()
      .min(1, 'timezone must not be empty.')
      .refine(isValidTimeZone, 'timezone must be a valid IANA time zone.'),
    endTime: z.string().datetime({ offset: true }).optional(),
  })
  .superRefine((value, ctx) => {
    const start = Date.parse(value.startTime)
    if (!Number.isFinite(start)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['startTime'],
        message: 'startTime must be a valid ISO 8601 timestamp.',
      })
    }

    if (value.endTime) {
      const end = Date.parse(value.endTime)
      if (!Number.isFinite(end)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['endTime'],
          message: 'endTime must be a valid ISO 8601 timestamp.',
        })
      } else if (Number.isFinite(start) && end <= start) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['endTime'],
          message: 'endTime must be after startTime.',
        })
      }
    }
  })

const revenuePointSchema = z.object({
  startTime: z.string(),
  endTime: z.string(),
  value: z.number(),
})

const revenueResponseSchema = z.object({
  data: z.array(revenuePointSchema),
  unit: z.enum(['month', 'day', 'week']),
  timezone: z.string(),
  currency: z.string(),
})

const ensureIsoString = (value: unknown, label: string) => {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`Invalid ${label} value encountered in revenue record`)
    }
    return value.toISOString()
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      throw new Error(`Missing ${label} in revenue record`)
    }
    return trimmed
  }

  throw new Error(`Invalid ${label} value encountered in revenue record`)
}

const parseNumeric = (value: unknown, label: string) => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid ${label} value encountered in revenue record`)
    }
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (!Number.isFinite(parsed)) {
      throw new Error(`Invalid ${label} value encountered in revenue record`)
    }
    return parsed
  }

  throw new Error(`Invalid ${label} value encountered in revenue record`)
}

type RawRevenueRow = {
  startTime: string | Date | null
  endTime: string | Date | null
  value: string | number | null
}

export async function GET(request: Request) {
  const url = new URL(request.url)

  const queryResult = querySchema.safeParse({
    unit: url.searchParams.get('unit'),
    startTime: url.searchParams.get('startTime'),
    timezone: url.searchParams.get('timezone'),
    endTime: url.searchParams.get('endTime') ?? undefined,
  })

  if (!queryResult.success) {
    const detail = formatZodIssues(queryResult.error.issues)
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid query parameters',
        detail: detail || 'Query parameters did not match the expected schema.',
        type: '/invalid-query-parameters',
      }),
      { status: 400 }
    )
  }

  const { unit, startTime, timezone, endTime } = queryResult.data

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while fetching revenue chart data',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const currencyRow = await db
      .selectFrom('trainer')
      .innerJoin('supported_country_currency', 'supported_country_currency.country_id', 'trainer.country_id')
      .innerJoin('currency', 'currency.id', 'supported_country_currency.currency_id')
      .select((eb) => [eb.ref('currency.alpha_code').as('currency')])
      .where('trainer.id', '=', authorization.trainerId)
      .executeTakeFirst()

    if (!currencyRow || !currencyRow.currency) {
      console.error('Failed to resolve currency for trainer', {
        trainerId: authorization.trainerId,
      })

      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to fetch revenue chart data',
          detail: 'Unable to determine the trainer currency.',
          type: '/internal-server-error',
        }),
        { status: 500 }
      )
    }

    const intervalLiteral = `1 ${unit}`
    const buildEndTimeExpression = () => (endTime ? sql`${endTime}::timestamptz` : sql`NOW()`)

    const revenueResult = await sql<RawRevenueRow>`
      WITH periods AS (
        SELECT
          tsrange(
            generate_series,
            generate_series + ${intervalLiteral}::interval
          ) AS r
        FROM generate_series(
          timezone(${timezone}, ${startTime}::timestamptz),
          timezone(${timezone}, ${buildEndTimeExpression()}) - '1 microsecond'::interval,
          ${intervalLiteral}::interval
        )
      )
      SELECT
        to_json(timezone(${timezone}, lower(periods.r))) AS "startTime",
        to_json(timezone(${timezone}, upper(periods.r))) AS "endTime",
        COALESCE(results.value, 0)::numeric AS "value"
      FROM periods
      LEFT JOIN (
        SELECT
          periods.r,
          SUM(payments.amount)::numeric AS value
        FROM (
          SELECT
            timezone(${timezone}, date) AS date,
            amount
          FROM payment_plan_payment
          WHERE status = 'paid'
            AND trainer_id = ${authorization.trainerId}
            AND date <@ tstzrange(${startTime}::timestamptz, ${buildEndTimeExpression()})
          UNION ALL
          SELECT
            timezone(
              ${timezone},
              COALESCE(
                payment_manual.transaction_time,
                to_timestamp((stripe_charge.object ->> 'created')::int),
                to_timestamp((stripe_payment_intent.object ->> 'created')::int),
                payment.created_at
              )
            ) AS date,
            amount
          FROM payment
          LEFT JOIN payment_stripe ON payment_stripe.id = payment.id
          LEFT JOIN payment_manual ON payment_manual.id = payment.id
          LEFT JOIN stripe_charge ON stripe_charge.id = payment_stripe.stripe_charge_id
          LEFT JOIN stripe_payment_intent ON stripe_payment_intent.id = payment_stripe.stripe_payment_intent_id
          WHERE refunded_time IS NULL
            AND payment.trainer_id = ${authorization.trainerId}
            AND (payment.is_manual OR payment.is_stripe)
            AND COALESCE(
              payment_manual.transaction_time,
              to_timestamp((stripe_charge.object ->> 'created')::int),
              to_timestamp((stripe_payment_intent.object ->> 'created')::int),
              payment.created_at
            ) <@ tstzrange(${startTime}::timestamptz, ${buildEndTimeExpression()})
          UNION ALL
          SELECT
            timezone(${timezone}, start_date) AS date,
            amount
          FROM finance_item
          WHERE amount > 0
            AND trainer_id = ${authorization.trainerId}
            AND start_date <@ tstzrange(${startTime}::timestamptz, ${buildEndTimeExpression()})
        ) payments
        JOIN periods ON payments.date <@ periods.r
        GROUP BY periods.r
      ) results ON results.r = periods.r
      ORDER BY "startTime"
    `.execute(db)

    const data = revenueResult.rows.map((row) => ({
      startTime: ensureIsoString(row.startTime, 'startTime'),
      endTime: ensureIsoString(row.endTime, 'endTime'),
      value: parseNumeric(row.value ?? 0, 'value'),
    }))

    const responseBody = revenueResponseSchema.parse({
      data,
      unit,
      timezone,
      currency: currencyRow.currency,
    })

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof z.ZodError) {
      const detail = formatZodIssues(error.issues)
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse revenue chart data',
          detail: detail || 'Revenue chart data did not match the expected schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch revenue chart data', error, {
      trainerId: authorization.trainerId,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch revenue chart data',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
