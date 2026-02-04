import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { authenticateTrainerRequest, buildErrorResponse } from '../_lib/accessToken'

const isoDateTimeString = z.union([z.string(), z.date()]).transform((value) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('Invalid date-time value')
  }
  return date.toISOString()
})

const isoDateString = z.union([z.string(), z.date()]).transform((value) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('Invalid date value')
  }
  return date.toISOString().slice(0, 10)
})

const payoutStatusSchema = z.enum(['paid', 'pending', 'inTransit', 'canceled', 'failed'])

const rawPayoutStatusSchema = z.union([payoutStatusSchema, z.literal('in_transit')])

const payoutSchema = z.object({
  createdAt: isoDateTimeString,
  updatedAt: isoDateTimeString,
  id: z.string(),
  amount: z.string(),
  arrivalDate: isoDateString,
  currency: z.string(),
  status: payoutStatusSchema,
  failureMessage: z.string().nullable(),
  statementDescriptor: z.string().nullable(),
})

const payoutListSchema = z.array(payoutSchema)

const payoutObjectSchema = z.object({
  id: z.string(),
  amount: z.union([z.string(), z.number()]),
  arrival_date: z.union([z.string(), z.number()]),
  currency: z.string(),
  status: rawPayoutStatusSchema,
  failure_message: z.string().nullable().optional(),
  statement_descriptor: z.string().nullable().optional(),
  created: z.union([z.string(), z.number()]),
})

const payoutRowSchema = z.object({
  stripeObject: z.unknown(),
  updatedAt: z.union([z.string(), z.date(), z.number()]),
})

type PayoutStatus = z.infer<typeof payoutStatusSchema>

type RawPayoutStatus = z.infer<typeof rawPayoutStatusSchema>

const normalizeStatus = (status: RawPayoutStatus): PayoutStatus => (status === 'in_transit' ? 'inTransit' : status)

const parseUnixTimestampSeconds = (value: string | number, label: string) => {
  const numeric = typeof value === 'number' ? value : Number.parseFloat(value.trim())

  if (!Number.isFinite(numeric)) {
    throw new TypeError(`Invalid ${label} value encountered in payout record`)
  }

  return new Date(numeric * 1000)
}

const toIsoDateTime = (value: Date | string | number, label: string) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Invalid ${label} value encountered in payout record`)
  }
  return date.toISOString()
}

const toIsoDate = (date: Date, label: string) => {
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Invalid ${label} value encountered in payout record`)
  }
  return date.toISOString().slice(0, 10)
}

const parseAmount = (value: string | number) => {
  const numeric = typeof value === 'number' ? value : Number.parseFloat(value.trim())

  if (!Number.isFinite(numeric)) {
    throw new TypeError('Invalid amount value encountered in payout record')
  }

  const dollars = numeric / 100
  return dollars.toFixed(2)
}

export async function GET(request: Request) {
  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while fetching payouts',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const rows = await db
      .selectFrom('stripe.payout as payout')
      .innerJoin('trainer', 'trainer.stripe_account_id', 'payout.account')
      .select((eb) => [eb.ref('payout.object').as('stripeObject'), eb.ref('payout.updated_at').as('updatedAt')])
      .where('trainer.id', '=', authorization.trainerId)
      .execute()

    const payouts = payoutListSchema.parse(
      rows
        .map((row) => {
          const parsedRow = payoutRowSchema.parse(row)
          const stripeObject = payoutObjectSchema.parse(parsedRow.stripeObject)

          const createdAtDate = parseUnixTimestampSeconds(stripeObject.created, 'createdAt')

          const arrivalDateDate = parseUnixTimestampSeconds(stripeObject.arrival_date, 'arrivalDate')

          const updatedAtIso = toIsoDateTime(parsedRow.updatedAt, 'updatedAt')

          return {
            id: stripeObject.id,
            amount: parseAmount(stripeObject.amount),
            arrivalDate: toIsoDate(arrivalDateDate, 'arrivalDate'),
            currency: stripeObject.currency,
            status: normalizeStatus(stripeObject.status),
            createdAt: createdAtDate.toISOString(),
            updatedAt: updatedAtIso,
            failureMessage: stripeObject.failure_message ?? null,
            statementDescriptor: stripeObject.statement_descriptor ?? null,
          }
        })
        .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
    )

    return NextResponse.json(payouts)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse payout data from database',
          detail: 'Payout data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch payouts', error)

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch payouts',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
