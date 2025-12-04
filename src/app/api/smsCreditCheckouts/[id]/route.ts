import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { buildErrorResponse } from '../../_lib/accessToken'
import { getSmsCreditPricingForCountry } from '../../_lib/smsCreditPricing'

const paramsSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1, 'SMS credit checkout identifier is required.'),
})

const rawCheckoutDetailsSchema = z.object({
  email: z
    .union([z.string(), z.null()])
    .transform(value => value ?? '')
    .pipe(
      z
        .string()
        .min(1, 'Trainer email is missing for this SMS credit checkout.')
    ),
  smsCreditBalance: z
    .union([z.number(), z.string()])
    .transform(value =>
      typeof value === 'number' ? value : Number.parseFloat(value)
    )
    .refine(
      value => Number.isFinite(value),
      'SMS credit balance must be a finite number.'
    ),
  country: z
    .union([z.string(), z.null()])
    .transform(value => value ?? '')
    .pipe(
      z
        .string()
        .trim()
        .min(2, 'Country code is missing for this SMS credit checkout.')
        .transform(value => value.toUpperCase())
    ),
})

type HandlerContext = RouteContext<'/api/smsCreditCheckouts/[id]'>

export async function GET(request: NextRequest, context: HandlerContext) {
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
          'Request path parameters did not match the expected schema.',
        type: '/invalid-path-parameters',
      }),
      { status: 400 }
    )
  }

  const { id } = paramsResult.data

  try {
    const checkoutDetails = await db
      .selectFrom('trainer')
      .innerJoin(
        'vw_legacy_trainer as legacyTrainer',
        'legacyTrainer.id',
        'trainer.id'
      )
      .innerJoin('country', 'country.id', 'trainer.country_id')
      .select(({ ref }) => [
        ref('trainer.email').as('email'),
        ref('legacyTrainer.sms_credit_balance').as('smsCreditBalance'),
        ref('country.alpha_2_code').as('country'),
      ])
      .where('trainer.sms_credit_checkout_id', '=', id)
      .executeTakeFirst()

    if (!checkoutDetails) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'SMS credit checkout not found',
          detail:
            'No trainer is associated with the provided SMS credit checkout identifier.',
          type: '/sms-credit-checkout-not-found',
        }),
        { status: 404 }
      )
    }

    const parsedDetails = rawCheckoutDetailsSchema.parse(checkoutDetails)
    const pricing = getSmsCreditPricingForCountry(parsedDetails.country)

    if (!pricing) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Unsupported country for SMS credit pricing',
          detail: `No SMS credit pricing is configured for country code ${parsedDetails.country}.`,
          type: '/unsupported-country',
        }),
        { status: 500 }
      )
    }

    return NextResponse.json({
      email: parsedDetails.email,
      smsCreditBalance: parsedDetails.smsCreditBalance,
      price: pricing.price,
      currency: pricing.currency,
      country: parsedDetails.country,
      creditCount: pricing.creditCount,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      const detail = error.issues.map(issue => issue.message).join('; ')

      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse SMS credit checkout data',
          detail:
            detail ||
            'SMS credit checkout data did not match the expected schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch SMS credit checkout details', {
      error,
      checkoutId: id,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch SMS credit checkout details',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
