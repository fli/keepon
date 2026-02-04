import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { z } from 'zod'
import { db } from '@/lib/db'
import { authenticateTrainerRequest, buildErrorResponse } from '../../_lib/accessToken'
import { parseStrictJsonBody } from '../../_lib/strictJson'
import { getStripeClient } from '../../_lib/stripeClient'

const requestBodySchema = z.object({
  refresh_url: z.string(),
  return_url: z.string(),
  type: z.enum(['account_onboarding', 'account_update']),
  collect: z.enum(['currently_due', 'eventually_due']).optional(),
})

const trainerStripeAccountSchema = z.object({
  stripeAccountId: z.string().nullable(),
})

const isProductionEnvironment = () => (process.env.ENV ?? '').toLowerCase() === 'production'

const createInvalidBodyResponse = (detail: string | undefined) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Your parameters were invalid.',
      detail: detail || 'Request body did not match the expected schema.',
      type: '/invalid-parameters',
    }),
    { status: 400 }
  )

const createInvalidReturnUrlResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid return url.',
      type: '/invalid-return-url',
    }),
    { status: 400 }
  )

const createStripePaymentsNotEnabledResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 409,
      title: 'Your stripe account is still being created.',
      type: '/stripe-account-pending-creation',
    }),
    { status: 409 }
  )

const createStripeErrorResponse = (error: Stripe.errors.StripeError) =>
  NextResponse.json(
    {
      ...buildErrorResponse({
        status: 409,
        title: error.message,
        type: '/stripe-error',
      }),
      stripeError: error,
    },
    { status: 409 }
  )

const createInternalErrorResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Something on our end went wrong.',
    }),
    { status: 500 }
  )

const isGetKeeponHostname = (url: URL) => {
  const parts = url.hostname.split('.')
  if (parts.length < 2) {
    return false
  }
  const secondLevel = parts.slice(-2)[0]
  return secondLevel === 'getkeepon'
}

export async function POST(request: Request) {
  let parsedBody: z.infer<typeof requestBodySchema>

  const parsed = await parseStrictJsonBody(request)
  if (!parsed.ok) {
    return parsed.response
  }

  const validation = requestBodySchema.safeParse(parsed.data)

  if (!validation.success) {
    const detail = validation.error.issues.map((issue) => issue.message).join('; ')
    return createInvalidBodyResponse(detail)
  }

  parsedBody = validation.data

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while creating Stripe account link',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  if (isProductionEnvironment()) {
    let returnUrl: URL
    let refreshUrl: URL
    try {
      returnUrl = new URL(parsedBody.return_url)
      refreshUrl = new URL(parsedBody.refresh_url)
    } catch {
      return createInvalidReturnUrlResponse()
    }

    if ([returnUrl, refreshUrl].some((url) => !isGetKeeponHostname(url))) {
      return createInvalidReturnUrlResponse()
    }
  }

  const stripeClient = getStripeClient()
  if (!stripeClient) {
    return createInternalErrorResponse()
  }

  try {
    const row = await db
      .selectFrom('trainer')
      .select((eb) => [eb.ref('trainer.stripe_account_id').as('stripeAccountId')])
      .where('trainer.id', '=', authorization.trainerId)
      .executeTakeFirst()

    const trainerRow = trainerStripeAccountSchema.safeParse(row)

    if (!trainerRow.success) {
      return createInternalErrorResponse()
    }

    if (!trainerRow.data.stripeAccountId) {
      return createStripePaymentsNotEnabledResponse()
    }

    try {
      const stripeParams: Stripe.AccountLinkCreateParams = {
        account: trainerRow.data.stripeAccountId,
        refresh_url: parsedBody.refresh_url,
        return_url: parsedBody.return_url,
        type: parsedBody.type,
        ...(parsedBody.collect ? { collect: parsedBody.collect } : {}),
      }

      const response = await stripeClient.accountLinks.create(stripeParams)

      const { lastResponse: _ignored, ...accountLinkData } = response

      return NextResponse.json(accountLinkData)
    } catch (error) {
      if (error instanceof Stripe.errors.StripeError) {
        console.error('Stripe API error while creating account link', {
          trainerId: authorization.trainerId,
          error,
        })
        return createStripeErrorResponse(error)
      }

      console.error('Unexpected error while creating Stripe account link', error)
      return createInternalErrorResponse()
    }
  } catch (error) {
    console.error('Failed to load trainer Stripe account', error)
    return createInternalErrorResponse()
  }
}
