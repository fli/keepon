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
  returnUrl: z
    .string()
    .trim()
    .min(1, 'returnUrl is required')
    .url('returnUrl must be a valid URL'),
})

const trainerStripeCustomerSchema = z.object({
  stripeCustomerId: z.string().nullable(),
})

const billingPortalSessionResponseSchema = z.object({
  url: z.string().url(),
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
          detail: detail || 'Request body did not match the expected schema.',
          type: '/invalid-body',
        }),
        { status: 400 }
      )
    }

    parsedBody = result.data
  } catch (error) {
    console.error('Failed to parse billing portal session request body', error)

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
      'Failed to extend access token expiry while creating Stripe billing portal session',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  if (isProductionEnvironment()) {
    try {
      const parsedUrl = new URL(parsedBody.returnUrl)
      if (!isGetKeeponHostname(parsedUrl)) {
        return NextResponse.json(
          buildErrorResponse({
            status: 400,
            title: 'Invalid return url.',
            type: '/invalid-return-url',
          }),
          { status: 400 }
        )
      }
    } catch {
      return NextResponse.json(
        buildErrorResponse({
          status: 400,
          title: 'Invalid return url.',
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
        ref('trainer.stripe_customer_id').as('stripeCustomerId'),
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

    const parsedRow = trainerStripeCustomerSchema.safeParse(row)
    if (!parsedRow.success) {
      const detail = parsedRow.error.issues
        .map(issue => issue.message)
        .join('; ')

      console.error('Failed to parse trainer Stripe customer data', {
        trainerId: authorization.trainerId,
        detail,
      })

      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse trainer data',
          detail:
            detail || 'Trainer data did not match the expected schema.',
          type: '/invalid-database-response',
        }),
        { status: 500 }
      )
    }

    if (!parsedRow.data.stripeCustomerId) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'You must be subscribed via web to manage it.',
          type: '/subscription-not-stripe',
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
            'STRIPE_SECRET_KEY is not configured, so Stripe billing portal sessions cannot be created.',
          type: '/missing-stripe-configuration',
        }),
        { status: 500 }
      )
    }

    try {
      const session = await stripeClient.billingPortal.sessions.create({
        customer: parsedRow.data.stripeCustomerId,
        return_url: parsedBody.returnUrl,
      })

      const parsedSession = billingPortalSessionResponseSchema.safeParse({
        url: session.url,
      })

      if (!parsedSession.success) {
        const detail = parsedSession.error.issues
          .map(issue => issue.message)
          .join('; ')

        console.error(
          'Stripe billing portal session response did not match schema',
          {
            trainerId: authorization.trainerId,
            detail,
          }
        )

        return NextResponse.json(
          buildErrorResponse({
            status: 500,
            title: 'Failed to validate Stripe billing portal session response',
            detail:
              detail ||
              'Stripe billing portal session response did not match the expected schema.',
            type: '/invalid-response',
          }),
          { status: 500 }
        )
      }

      return NextResponse.json(parsedSession.data)
    } catch (error) {
      if (error instanceof Stripe.errors.StripeError) {
        console.error('Stripe API error while creating billing portal session', {
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
      console.error('Zod error while creating billing portal session', {
        trainerId: authorization.trainerId,
        error,
      })

      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse trainer data',
          detail: 'Trainer data did not match the expected schema.',
          type: '/invalid-database-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to create Stripe billing portal session', {
      trainerId: authorization.trainerId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to create Stripe billing portal session',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
