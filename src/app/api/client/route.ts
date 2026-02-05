import { NextResponse } from 'next/server'
import { z, ZodError } from 'zod'
import { db } from '@/lib/db'
import { authenticateClientRequest, buildErrorResponse } from '../_lib/accessToken'

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

const cardBrands = ['amex', 'diners', 'discover', 'jcb', 'mastercard', 'unionpay', 'visa', 'unknown'] as const

type CardBrand = (typeof cardBrands)[number]

const normalizeCardBrand = (brand: string): CardBrand => {
  const normalized = brand.toLowerCase()
  return cardBrands.includes(normalized as CardBrand) ? (normalized as CardBrand) : 'unknown'
}

export async function GET(request: Request) {
  const authorization = await authenticateClientRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while fetching client profile',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
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
      .where('c.id', '=', authorization.clientId)
      .where('c.trainer_id', '=', authorization.trainerId)
      .executeTakeFirst()

    if (!row) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Client not found',
          detail: 'We could not find a client for the authenticated access token.',
          type: '/client-not-found',
        }),
        { status: 404 }
      )
    }

    const stripeAccountValue = row.stripeAccountObject
    const stripeAccountType =
      stripeAccountValue && typeof stripeAccountValue === 'object' && 'type' in stripeAccountValue
        ? ((stripeAccountValue as { type?: string }).type ?? null)
        : null

    const clientRow = clientRowSchema.parse({
      email: row.email,
      stripeCustomerId: row.stripeCustomerId,
      stripeAccountId: row.stripeAccountId,
      stripeAccountType,
    })

    if (!clientRow.stripeCustomerId) {
      return NextResponse.json({ email: clientRow.email })
    }

    const paymentMethodRow = await db
      .selectFrom('stripe.payment_method')
      .select(['id', 'object'])
      .where((eb) =>
        eb(eb.fn('json_extract_path_text', [eb.ref('object'), eb.val('customer')]), '=', clientRow.stripeCustomerId)
      )
      .orderBy(
        (eb) => eb.cast<number>(eb.fn('json_extract_path_text', [eb.ref('object'), eb.val('created')]), 'bigint'),
        'desc'
      )
      .limit(1)
      .executeTakeFirst()
    if (!paymentMethodRow) {
      return NextResponse.json({ email: clientRow.email })
    }

    const parsedPaymentMethod = stripePaymentMethodRowSchema.parse(paymentMethodRow)
    const { card } = parsedPaymentMethod.object

    const country = typeof card.country === 'string' && card.country.trim().length > 0 ? card.country : null

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

    console.error('Failed to fetch client profile', authorization.trainerId, authorization.clientId, error)

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
