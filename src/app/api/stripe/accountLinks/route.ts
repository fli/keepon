import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import Stripe from 'stripe'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../../_lib/accessToken'
import { getStripeClient } from '../../_lib/stripeClient'

export const runtime = 'nodejs'

const requestBodySchema = z.object({
  refresh_url: z
    .string({ message: 'refresh_url is required' })
    .trim()
    .url('refresh_url must be a valid URL'),
  return_url: z
    .string({ message: 'return_url is required' })
    .trim()
    .url('return_url must be a valid URL'),
  type: z.enum(['account_onboarding', 'account_update'], {
    message: "type must be either 'account_onboarding' or 'account_update'",
  }),
  collect: z
    .enum(['currently_due', 'eventually_due'], {
      message: 'collect must be either currently_due or eventually_due',
    })
    .optional(),
})

const trainerStripeAccountSchema = z.object({
  stripeAccountId: z.string().nullable(),
})

const accountLinkResponseSchema = z.object({
  object: z.literal('account_link'),
  created: z.number(),
  expires_at: z.number(),
  url: z.string(),
})

const isProductionEnvironment = () => {
  const envValue = process.env.ENV ?? process.env.NODE_ENV ?? ''
  return envValue.toLowerCase() === 'production'
}

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

  try {
    const rawBody = (await request.json()) as unknown
    const result = requestBodySchema.safeParse(rawBody)

    if (!result.success) {
      const detail = result.error.issues.map(issue => issue.message).join('; ')

      return NextResponse.json(
        buildErrorResponse({
          status: 400,
          title: 'Invalid request body',
          detail:
            detail || 'Request body did not match the expected schema.',
          type: '/invalid-body',
        }),
        { status: 400 }
      )
    }

    parsedBody = result.data
  } catch (error) {
    console.error('Failed to parse Stripe account link request body', error)

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
      'Failed to extend access token expiry while creating Stripe account link',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  if (isProductionEnvironment()) {
    const urlsToValidate = [parsedBody.return_url, parsedBody.refresh_url]

    const hasInvalidUrl = urlsToValidate.some(value => {
      try {
        const parsedUrl = new URL(value)
        return !isGetKeeponHostname(parsedUrl)
      } catch {
        return true
      }
    })

    if (hasInvalidUrl) {
      return NextResponse.json(
        buildErrorResponse({
          status: 400,
          title: 'Invalid return url.',
          detail:
            'In production, return_url and refresh_url must point to a getkeepon domain.',
          type: '/invalid-return-url',
        }),
        { status: 400 }
      )
    }
  }

  try {
    const row = await db
      .selectFrom('trainer')
      .select(({ ref }) => [
        ref('trainer.stripe_account_id').as('stripeAccountId'),
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

    const trainerRow = trainerStripeAccountSchema.parse(row)

    if (!trainerRow.stripeAccountId) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'Your stripe account is still being created.',
          type: '/stripe-account-pending-creation',
        }),
        { status: 409 }
      )
    }

    const stripeClient = getStripeClient()

    if (!stripeClient) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Stripe configuration missing',
          detail:
            'STRIPE_SECRET_KEY is not configured, so Stripe account links cannot be created.',
          type: '/missing-stripe-configuration',
        }),
        { status: 500 }
      )
    }

    try {
      const stripeParams: Stripe.AccountLinkCreateParams = {
        account: trainerRow.stripeAccountId,
        type: parsedBody.type,
        refresh_url: parsedBody.refresh_url,
        return_url: parsedBody.return_url,
        ...(parsedBody.collect ? { collect: parsedBody.collect } : {}),
      }

      const response = await stripeClient.accountLinks.create(stripeParams)
      const { lastResponse: _ignored, ...accountLinkData } = response

      const parsedResponse = accountLinkResponseSchema.safeParse(
        accountLinkData
      )

      if (!parsedResponse.success) {
        const detail = parsedResponse.error.issues
          .map(issue => issue.message)
          .join('; ')

        return NextResponse.json(
          buildErrorResponse({
            status: 500,
            title: 'Failed to validate Stripe account link response',
            detail:
              detail ||
              'Stripe account link response did not match the expected schema.',
            type: '/invalid-response',
          }),
          { status: 500 }
        )
      }

      return NextResponse.json(parsedResponse.data)
    } catch (error) {
      if (error instanceof Stripe.errors.StripeError) {
        console.error('Stripe API error while creating account link', {
          trainerId: authorization.trainerId,
          error,
        })

        return NextResponse.json(
          buildErrorResponse({
            status: error.statusCode ?? 409,
            title: error.message,
            detail: error.message,
            type: '/stripe-error',
          }),
          { status: error.statusCode ?? 409 }
        )
      }

      throw error
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse trainer data',
          detail:
            'Trainer data did not match the expected schema.',
          type: '/invalid-database-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to create Stripe account link', {
      trainerId: authorization.trainerId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to create Stripe account link',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
