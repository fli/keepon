import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../_lib/accessToken'
import { getAccountSubscriptionPricingForCountry } from '../_lib/accountSubscriptionPricing'

export const runtime = 'nodejs'

const trainerPricingRowSchema = z.object({
  country: z
    .string()
    .min(2, 'Country code must be at least 2 characters long')
    .transform(value => value.toUpperCase()),
  monthlyPriceOverride: z.union([z.string(), z.number(), z.null()]),
  yearlyPriceOverride: z.union([z.string(), z.number(), z.null()]),
})

const planResponseSchema = z.object({
  monthlyPrice: z.string(),
  yearlyPrice: z.string(),
  currency: z.string(),
})

const normalizeDecimalString = (rawValue: string): string => {
  const trimmed = rawValue.trim()

  if (trimmed.length === 0) {
    throw new Error('Price value must not be empty')
  }

  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Price value "${rawValue}" is not a valid decimal string`)
  }

  if (!trimmed.includes('.')) {
    return trimmed
  }

  const [integerPartRaw = '', fractionalPartRaw = ''] = trimmed.split('.', 2)
  const integerPart = integerPartRaw
  const fractionalPart = fractionalPartRaw.replace(/0+$/, '')

  return fractionalPart.length > 0
    ? `${integerPart}.${fractionalPart}`
    : integerPart
}

const coerceOverride = (value: string | number | null) => {
  if (value === null || value === undefined) {
    return null
  }

  const asString = typeof value === 'number' ? value.toString() : value

  return normalizeDecimalString(asString)
}

export async function GET(request: Request) {
  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while fetching account subscription plan',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const row = await db
      .selectFrom('trainer')
      .innerJoin('country', 'country.id', 'trainer.country_id')
      .select(({ ref }) => [
        ref('country.alpha_2_code').as('country'),
        ref('trainer.monthly_price_override').as('monthlyPriceOverride'),
        ref('trainer.yearly_price_override').as('yearlyPriceOverride'),
      ])
      .where('trainer.id', '=', authorization.trainerId)
      .executeTakeFirst()

    if (!row) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Trainer not found',
          detail:
            'No trainer record was found for the authenticated access token.',
          type: '/trainer-not-found',
        }),
        { status: 404 }
      )
    }

    let trainerPricingRow: z.infer<typeof trainerPricingRowSchema>
    try {
      trainerPricingRow = trainerPricingRowSchema.parse(row)
    } catch (error) {
      const message =
        error instanceof z.ZodError
          ? error.issues.map(issue => issue.message).join('; ')
          : undefined

      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse trainer pricing details',
          detail:
            message ??
            'Trainer pricing details did not match the expected schema.',
          type: '/invalid-database-response',
        }),
        { status: 500 }
      )
    }

    const pricing = getAccountSubscriptionPricingForCountry(
      trainerPricingRow.country
    )

    if (!pricing) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Unsupported country for account subscription pricing',
          detail: `No subscription pricing is configured for country code ${trainerPricingRow.country}.`,
          type: '/unsupported-country',
        }),
        { status: 500 }
      )
    }

    let monthlyPrice: string
    let yearlyPrice: string

    const pricingForCountry = pricing

    try {
      const overrideMonthly = coerceOverride(
        trainerPricingRow.monthlyPriceOverride
      )
      const overrideYearly = coerceOverride(
        trainerPricingRow.yearlyPriceOverride
      )

      monthlyPrice = normalizeDecimalString(pricingForCountry.monthlyPrice)
      if (overrideMonthly !== null) {
        monthlyPrice = overrideMonthly
      }

      yearlyPrice = normalizeDecimalString(pricingForCountry.yearlyPrice)
      if (overrideYearly !== null) {
        yearlyPrice = overrideYearly
      }
    } catch (error) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Invalid subscription pricing override',
          detail:
            error instanceof Error
              ? error.message
              : 'Trainer subscription pricing override values are invalid.',
          type: '/invalid-pricing-override',
        }),
        { status: 500 }
      )
    }

    try {
      const response = planResponseSchema.parse({
        monthlyPrice,
        yearlyPrice,
        currency: pricing.currency,
      })

      return NextResponse.json(response)
    } catch (error) {
      const detail =
        error instanceof z.ZodError
          ? error.issues.map(issue => issue.message).join('; ')
          : undefined

      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to validate account subscription plan response',
          detail:
            detail ??
            'Account subscription plan response did not match the expected schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }
  } catch (error) {
    console.error('Failed to fetch account subscription plan', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch account subscription plan',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
