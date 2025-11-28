import { NextResponse } from 'next/server'
import { db, sql } from '@keepon/db'
import { z, ZodError } from 'zod'
import {
  authenticateClientRequest,
  buildErrorResponse,
} from '../_lib/accessToken'

export const runtime = 'nodejs'

const clientRowSchema = z.object({
  email: z.string(),
  stripeCustomerId: z.string().nullable(),
  stripeAccountId: z.string().nullable(),
  stripeAccountType: z.string().nullable().optional(),
})

const stripePaymentMethodRowSchema = z.object({
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

const cardBrands = [
  'amex',
  'diners',
  'discover',
  'jcb',
  'mastercard',
  'unionpay',
  'visa',
  'unknown',
] as const

type CardBrand = (typeof cardBrands)[number]

const normalizeCardBrand = (brand: string): CardBrand => {
  const normalized = brand.toLowerCase()
  return cardBrands.includes(normalized as CardBrand)
    ? (normalized as CardBrand)
    : 'unknown'
}

export async function GET(request: Request) {
  const authorization = await authenticateClientRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while fetching client profile',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const row = await db
      .selectFrom('client as c')
      .innerJoin('trainer as t', 't.id', 'c.trainer_id')
      .leftJoin('stripe.account as stripeAccount', 'stripeAccount.id', 't.stripe_account_id')
      .select(({ ref }) => [
        ref('c.email').as('email'),
        ref('c.stripe_customer_id').as('stripeCustomerId'),
        ref('t.stripe_account_id').as('stripeAccountId'),
        sql<string | null>`stripeAccount.object->>'type'`.as('stripeAccountType'),
      ])
      .where('c.id', '=', authorization.clientId)
      .where('c.trainer_id', '=', authorization.trainerId)
      .executeTakeFirst()

    if (!row) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Client not found',
          detail:
            'We could not find a client for the authenticated access token.',
          type: '/client-not-found',
        }),
        { status: 404 }
      )
    }

    const clientRow = clientRowSchema.parse(row)

    if (!clientRow.stripeCustomerId) {
      return NextResponse.json({ email: clientRow.email })
    }

    const paymentMethodResult = await sql<{
      id: string
      object: unknown
    }>`
      SELECT id, object
        FROM stripe.payment_method
       WHERE object->>'customer' = ${clientRow.stripeCustomerId}
    ORDER BY (object->>'created')::bigint DESC
       LIMIT 1
    `.execute(db)

    const paymentMethodRow = paymentMethodResult.rows[0]
    if (!paymentMethodRow) {
      return NextResponse.json({ email: clientRow.email })
    }

    const parsedPaymentMethod =
      stripePaymentMethodRowSchema.parse(paymentMethodRow)
    const { card } = parsedPaymentMethod.object

    const country =
      typeof card.country === 'string' && card.country.trim().length > 0
        ? card.country
        : null

    return NextResponse.json({
      email: clientRow.email,
      card: {
        country,
        paymentMethodId: parsedPaymentMethod.id,
        last4: card.last4,
        expYear: card.exp_year,
        expMonth: card.exp_month,
        brand: normalizeCardBrand(card.brand),
      },
    })
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse client data',
          detail: 'Database records did not match the expected schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error(
      'Failed to fetch client profile',
      authorization.trainerId,
      authorization.clientId,
      error
    )

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch client',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
