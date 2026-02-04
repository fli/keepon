import BigNumber from 'bignumber.js'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { authenticateTrainerRequest, buildErrorResponse } from '../_lib/accessToken'
import {
  currencyChargeLimits,
  getTransactionFee,
  CurrencyNotSupportedError,
  CountryNotSupportedError,
  type TransactionFeeType,
} from '../_lib/transactionFees'

const LEGACY_INVALID_PARAMETERS_TITLE = 'Your parameters were invalid.'

const invalidParametersResponse = (detail: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: LEGACY_INVALID_PARAMETERS_TITLE,
      detail,
      type: '/invalid-parameters',
    }),
    { status: 400 }
  )

const parseLegacyQueryValue = (value: string | null) => {
  if (value === null) {
    return undefined
  }
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

const trainerCountrySchema = z.object({
  country: z
    .string()
    .min(2, 'Trainer country code must contain at least 2 characters.')
    .transform((value) => value.toUpperCase()),
})

const feeTypeSchema = z.enum([
  'international',
  'domestic',
  'european',
  'nonEuropean',
]) satisfies z.ZodType<TransactionFeeType>

const responseSchema = z.object({
  amount: z.string(),
  passOnTotalAmount: z.string(),
  passOnSurcharge: z.string(),
  fixedFee: z.string(),
  percentFee: z.string(),
  transactionFee: z.string(),
  cardCountry: z.string(),
  chargeCountry: z.string(),
  feeType: feeTypeSchema,
})

export async function GET(request: Request) {
  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while calculating transaction fee',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const url = new URL(request.url)
  const amountValue = parseLegacyQueryValue(url.searchParams.get('amount'))
  const currencyValue = parseLegacyQueryValue(url.searchParams.get('currency'))
  const cardCountryValue = parseLegacyQueryValue(url.searchParams.get('cardCountry'))

  if (amountValue === undefined) {
    return invalidParametersResponse('amount  not provided')
  }
  if (typeof amountValue !== 'number' || Number.isNaN(amountValue)) {
    return invalidParametersResponse('amount  should be number')
  }
  if (currencyValue === undefined) {
    return invalidParametersResponse('currency  not provided')
  }
  if (typeof currencyValue !== 'string') {
    return invalidParametersResponse('currency  should be string')
  }
  if (cardCountryValue === undefined) {
    return invalidParametersResponse('cardCountry  not provided')
  }
  if (typeof cardCountryValue !== 'string') {
    return invalidParametersResponse('cardCountry  should be string')
  }

  const amount = new BigNumber(amountValue)
  const currency = currencyValue
  const cardCountry = cardCountryValue

  const limits = currencyChargeLimits[currency.toUpperCase() as keyof typeof currencyChargeLimits]

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

  let trainerRow: unknown
  try {
    trainerRow = await db
      .selectFrom('trainer')
      .innerJoin('country', 'country.id', 'trainer.country_id')
      .select((eb) => [eb.ref('country.alpha_2_code').as('country')])
      .where('trainer.id', '=', authorization.trainerId)
      .executeTakeFirst()
  } catch (error) {
    console.error('Failed to fetch trainer country for transaction fee', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch transaction fee details',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }

  if (!trainerRow) {
    return NextResponse.json(
      buildErrorResponse({
        status: 404,
        title: 'Trainer not found',
        detail: 'No trainer record was found for the authenticated access token.',
        type: '/trainer-not-found',
      }),
      { status: 404 }
    )
  }

  const parsedTrainer = trainerCountrySchema.safeParse(trainerRow)
  if (!parsedTrainer.success) {
    const detail = parsedTrainer.error.issues.map((issue) => issue.message).join('; ')
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to parse trainer country',
        detail: detail.length > 0 ? detail : 'Trainer country did not match the expected schema.',
        type: '/invalid-database-response',
      }),
      { status: 500 }
    )
  }

  const chargeCountry = parsedTrainer.data.country

  try {
    const fee = getTransactionFee({
      cardCountry,
      chargeCountry,
      currency,
    })

    const denominator = new BigNumber(1).minus(fee.percentageFee)
    if (denominator.isZero()) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Invalid fee configuration',
          detail: 'Percentage fee results in a zero denominator while calculating pass on amount.',
          type: '/invalid-fee-configuration',
        }),
        { status: 500 }
      )
    }

    const passOnAmount = amount.plus(fee.fixedFee).dividedBy(denominator).decimalPlaces(limits.smallestUnitDecimals)

    const transactionFee = amount
      .multipliedBy(fee.percentageFee)
      .plus(fee.fixedFee)
      .toFixed(limits.smallestUnitDecimals)

    const payload = {
      amount: amount.toString(),
      passOnTotalAmount: passOnAmount.toString(),
      passOnSurcharge: passOnAmount.minus(amount).toString(),
      fixedFee: fee.fixedFee.toString(),
      percentFee: fee.percentageFee.toString(),
      transactionFee,
      cardCountry,
      chargeCountry,
      feeType: fee.feeType,
    }

    const response = responseSchema.parse(payload)

    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof CurrencyNotSupportedError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'That currency is not supported.',
          type: '/currency-not-supported',
        }),
        { status: 409 }
      )
    }

    if (error instanceof CountryNotSupportedError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Trainer country is not supported for transaction fees',
          detail: `Trainer country ${chargeCountry} is not supported for transaction fee calculations.`,
          type: '/unsupported-country',
        }),
        { status: 500 }
      )
    }

    if (error instanceof z.ZodError) {
      const detail = error.issues.map((issue) => issue.message).join('; ')
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to validate transaction fee response',
          detail: detail.length > 0 ? detail : 'Transaction fee response did not match the expected schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to calculate transaction fee', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to calculate transaction fee',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
