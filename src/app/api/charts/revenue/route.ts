import type { ExpressionBuilder } from 'kysely'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { Database } from '@/lib/db'
import {
  addDaysToLocalDateTime,
  compareLocalDateTimes,
  localDateTimeToUtc,
  type LocalDateTime,
} from '@/lib/dates/timezone'
import { db } from '@/lib/db'
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

const parseNumeric = (value: unknown, label: string) => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Invalid ${label} value encountered in revenue record`)
    }
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (!Number.isFinite(parsed)) {
      throw new TypeError(`Invalid ${label} value encountered in revenue record`)
    }
    return parsed
  }

  throw new Error(`Invalid ${label} value encountered in revenue record`)
}

const toLocalDateTime = (date: Date, timeZone: string): LocalDateTime => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  const parts = formatter.formatToParts(date)
  const values: Record<string, string> = {}
  for (const part of parts) {
    if (part.type !== 'literal') {
      values[part.type] = part.value
    }
  }

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    millisecond: date.getUTCMilliseconds(),
  }
}

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()

const addMonthsToLocalDateTime = (parts: LocalDateTime, months: number): LocalDateTime => {
  const monthIndex = parts.month - 1 + months
  const year = parts.year + Math.floor(monthIndex / 12)
  const normalizedMonth = ((monthIndex % 12) + 12) % 12
  const month = normalizedMonth + 1
  const day = Math.min(parts.day, daysInMonth(year, month))

  return {
    year,
    month,
    day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
    millisecond: parts.millisecond,
  }
}

const addUnitToLocalDateTime = (parts: LocalDateTime, unit: 'day' | 'week' | 'month'): LocalDateTime => {
  if (unit === 'month') {
    return addMonthsToLocalDateTime(parts, 1)
  }
  return addDaysToLocalDateTime(parts, unit === 'week' ? 7 : 1)
}

export async function GET(request: Request) {
  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while fetching revenue chart data',
  })

  if (!authorization.ok) {
    return authorization.response
  }

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
  const parsedStart = Date.parse(startTime)
  const parsedEnd = endTime ? Date.parse(endTime) : null
  if (Number.isFinite(parsedStart) && parsedEnd !== null && Number.isFinite(parsedEnd) && parsedEnd < parsedStart) {
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Something on our end went wrong.',
      }),
      { status: 500 }
    )
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

    const startDate = new Date(startTime)
    const endDate = endTime ? new Date(endTime) : new Date()

    const startLocal = toLocalDateTime(startDate, timezone)
    const endLocal = toLocalDateTime(endDate, timezone)

    const buckets: { start: Date; end: Date; value: number }[] = []
    let cursor = startLocal
    while (compareLocalDateTimes(cursor, endLocal) < 0) {
      const next = addUnitToLocalDateTime(cursor, unit)
      const bucketStart = localDateTimeToUtc(cursor, timezone)
      const bucketEnd = localDateTimeToUtc(next, timezone)
      buckets.push({ start: bucketStart, end: bucketEnd, value: 0 })
      cursor = next
    }

    const paymentDateExpr = (
      eb: ExpressionBuilder<
        Database,
        'payment' | 'payment_stripe' | 'payment_manual' | 'stripe_charge' | 'stripe_payment_intent'
      >
    ) =>
      eb.fn('coalesce', [
        eb.ref('payment_manual.transaction_time'),
        eb.fn('to_timestamp', [
          eb.cast<number>(
            eb.fn('json_extract_path_text', [eb.ref('stripe_charge.object'), eb.val('created')]),
            'bigint'
          ),
        ]),
        eb.fn('to_timestamp', [
          eb.cast<number>(
            eb.fn('json_extract_path_text', [eb.ref('stripe_payment_intent.object'), eb.val('created')]),
            'bigint'
          ),
        ]),
        eb.ref('payment.created_at'),
      ])

    const paymentRows = await db
      .selectFrom('payment')
      .leftJoin('payment_stripe', 'payment_stripe.id', 'payment.id')
      .leftJoin('payment_manual', 'payment_manual.id', 'payment.id')
      .leftJoin('stripe_charge', 'stripe_charge.id', 'payment_stripe.stripe_charge_id')
      .leftJoin('stripe_payment_intent', 'stripe_payment_intent.id', 'payment_stripe.stripe_payment_intent_id')
      .select((eb) => [paymentDateExpr(eb).as('date'), eb.ref('payment.amount').as('amount')])
      .where('payment.refunded_time', 'is', null)
      .where('payment.trainer_id', '=', authorization.trainerId)
      .where((eb) => eb.or([eb(eb.ref('payment.is_manual'), '=', true), eb(eb.ref('payment.is_stripe'), '=', true)]))
      .where((eb) => eb(paymentDateExpr(eb), '>=', startDate))
      .where((eb) => eb(paymentDateExpr(eb), '<', endDate))
      .execute()

    const planPaymentRows = await db
      .selectFrom('payment_plan_payment as ppp')
      .innerJoin('payment_plan as pp', 'pp.id', 'ppp.payment_plan_id')
      .select((eb) => [eb.ref('ppp.date').as('date'), eb.ref('ppp.amount').as('amount')])
      .where('pp.trainer_id', '=', authorization.trainerId)
      .where('ppp.status', '=', 'paid')
      .where('ppp.date', '>=', startDate)
      .where('ppp.date', '<', endDate)
      .execute()

    const financeRows = await db
      .selectFrom('finance_item')
      .select((eb) => [eb.ref('start_date').as('date'), eb.ref('amount').as('amount')])
      .where('trainer_id', '=', authorization.trainerId)
      .where('amount', '>', '0')
      .where('start_date', '>=', startDate)
      .where('start_date', '<', endDate)
      .execute()

    const events = [...paymentRows, ...planPaymentRows, ...financeRows]
      .map((row) => ({
        date: row.date instanceof Date ? row.date : new Date(row.date as string),
        amount: parseNumeric(row.amount ?? 0, 'amount'),
      }))
      .filter((entry) => !Number.isNaN(entry.date.getTime()))
      .toSorted((a, b) => a.date.getTime() - b.date.getTime())

    let bucketIndex = 0
    for (const event of events) {
      while (bucketIndex < buckets.length && event.date >= buckets[bucketIndex].end) {
        bucketIndex += 1
      }
      if (bucketIndex >= buckets.length) {
        break
      }
      if (event.date >= buckets[bucketIndex].start && event.date < buckets[bucketIndex].end) {
        buckets[bucketIndex].value += event.amount
      }
    }

    const data = buckets.map((bucket) => ({
      startTime: bucket.start.toISOString(),
      endTime: bucket.end.toISOString(),
      value: bucket.value,
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
