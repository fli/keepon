import { NextResponse } from 'next/server'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import Stripe from 'stripe'
import { authenticateTrainerRequest, buildErrorResponse } from '../_lib/accessToken'
import { getStripeClient } from '../_lib/stripeClient'

const requestBodySchema = z.object({
  type: z.enum(['verification', 'update']).optional(),
  collect: z.enum(['currentlyDue', 'eventuallyDue']).optional(),
})

const trainerStripeRowSchema = z.object({
  stripeAccountId: z.string().nullable(),
  cardPayments: z.boolean(),
  transfers: z.boolean(),
  stripeAccountType: z.string().nullable(),
})

const accountLinkResponseSchema = z.object({
  object: z.literal('account_link'),
  created: z.number(),
  expires_at: z.number(),
  url: z.string(),
})

const baseUrl = process.env.BASE_URL ?? 'http://localhost:3001'
const successUrl = new URL('/ios-links/stripe-onboarding-success', baseUrl).toString()
const failureUrl = new URL('/ios-links/stripe-onboarding-failure', baseUrl).toString()

const createInvalidJsonResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid JSON payload',
      detail: 'Request body must be valid JSON.',
      type: '/invalid-json',
    }),
    { status: 400 }
  )

const createInvalidBodyResponse = (detail?: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid request body',
      detail: detail || 'Request body did not match the expected schema.',
      type: '/invalid-body',
    }),
    { status: 400 }
  )

const createTrainerNotFoundResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 404,
      title: 'Trainer not found',
      detail: 'No trainer record was found for the authenticated access token.',
      type: '/trainer-not-found',
    }),
    { status: 404 }
  )

const createStripePaymentsNotEnabledResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 409,
      title: 'Stripe payments not enabled',
      detail: 'Your Stripe account is still being created.',
      type: '/stripe-account-pending-creation',
    }),
    { status: 409 }
  )

const createStripeConfigurationMissingResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Stripe configuration missing',
      detail: 'STRIPE_SECRET_KEY is not configured, so Stripe onboarding links cannot be created.',
      type: '/missing-stripe-configuration',
    }),
    { status: 500 }
  )

const createInternalErrorResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Failed to create Stripe onboarding link',
      type: '/internal-server-error',
    }),
    { status: 500 }
  )

export async function POST(request: Request) {
  let body: z.infer<typeof requestBodySchema>

  try {
    const rawBody = (await request.json()) as unknown
    const parsed = requestBodySchema.safeParse(rawBody)

    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => issue.message).join('; ')
      return createInvalidBodyResponse(detail || undefined)
    }

    body = parsed.data
  } catch (error) {
    console.error('Failed to parse Stripe onboarding link request body', error)
    return createInvalidJsonResponse()
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while creating Stripe onboarding link',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const stripeClient = getStripeClient()

  if (!stripeClient) {
    return createStripeConfigurationMissingResponse()
  }

  let trainerRow: z.infer<typeof trainerStripeRowSchema>

  try {
    const row = await db
      .selectFrom('trainer')
      .leftJoin('stripe.account as stripeAccount', 'stripeAccount.id', 'trainer.stripe_account_id')
      .select((eb) => [
        eb.ref('trainer.stripe_account_id').as('stripeAccountId'),
        sql<boolean>`(stripeAccount.object #>> '{capabilities,card_payments}') IS NOT NULL`.as('cardPayments'),
        sql<boolean>`(stripeAccount.object #>> '{capabilities,transfers}') IS NOT NULL`.as('transfers'),
        sql<string | null>`stripeAccount.object ->> 'type'`.as('stripeAccountType'),
      ])
      .where('trainer.id', '=', authorization.trainerId)
      .executeTakeFirst()

    if (!row) {
      return createTrainerNotFoundResponse()
    }

    const parsedRow = trainerStripeRowSchema.safeParse(row)

    if (!parsedRow.success) {
      const detail = parsedRow.error.issues.map((issue) => issue.message).join('; ')

      console.error('Failed to parse trainer Stripe account data', {
        trainerId: authorization.trainerId,
        detail,
      })

      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse trainer data',
          detail: detail || 'Trainer data did not match the expected schema.',
          type: '/invalid-database-response',
        }),
        { status: 500 }
      )
    }

    trainerRow = parsedRow.data
  } catch (error) {
    console.error('Failed to fetch trainer Stripe account data', {
      trainerId: authorization.trainerId,
      error,
    })

    return createInternalErrorResponse()
  }

  const { stripeAccountId, stripeAccountType, cardPayments, transfers } = trainerRow

  if (!stripeAccountId) {
    return createStripePaymentsNotEnabledResponse()
  }

  if ((!cardPayments || !transfers) && stripeAccountType === 'custom') {
    try {
      await stripeClient.accounts.update(stripeAccountId, {
        capabilities: {
          transfers: { requested: true },
          card_payments: { requested: true },
        },
      })
    } catch (error) {
      if (error instanceof Stripe.errors.StripeError) {
        console.error('Stripe API error while requesting capabilities for onboarding link', {
          trainerId: authorization.trainerId,
          stripeAccountId,
          statusCode: error.statusCode,
          message: error.message,
          code: error.code,
          type: error.type,
        })

        return NextResponse.json(
          buildErrorResponse({
            status: error.statusCode ?? 502,
            title: 'Stripe API error',
            detail: error.message,
            type: '/stripe-api-error',
          }),
          { status: error.statusCode ?? 502 }
        )
      }

      console.error('Unexpected error while requesting Stripe capabilities for onboarding link', {
        trainerId: authorization.trainerId,
        stripeAccountId,
        error,
      })

      return createInternalErrorResponse()
    }
  }

  const accountLinkType: Stripe.AccountLinkCreateParams.Type =
    body.type === 'update' && stripeAccountType !== 'standard' ? 'account_update' : 'account_onboarding'

  const collect: Stripe.AccountLinkCreateParams.Collect | undefined =
    stripeAccountType === 'custom'
      ? body.collect === 'eventuallyDue'
        ? 'eventually_due'
        : 'currently_due'
      : undefined

  try {
    const accountLink = await stripeClient.accountLinks.create({
      account: stripeAccountId,
      refresh_url: failureUrl,
      return_url: successUrl,
      type: accountLinkType,
      ...(collect ? { collect } : {}),
    })

    const { lastResponse: _ignored, ...accountLinkData } = accountLink

    const parsedLink = accountLinkResponseSchema.safeParse(accountLinkData)

    if (!parsedLink.success) {
      const detail = parsedLink.error.issues.map((issue) => issue.message).join('; ')

      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to validate Stripe account link response',
          detail: detail || 'Stripe account link response did not match the expected schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    return NextResponse.json({
      collect: body.collect ?? 'currentlyDue',
      type: body.type ?? 'verification',
      createdAt: new Date(parsedLink.data.created * 1000).toISOString(),
      expiresAt: new Date(parsedLink.data.expires_at * 1000).toISOString(),
      url: parsedLink.data.url,
    })
  } catch (error) {
    if (error instanceof Stripe.errors.StripeError) {
      console.error('Stripe API error while creating onboarding link', {
        trainerId: authorization.trainerId,
        stripeAccountId,
        statusCode: error.statusCode,
        message: error.message,
        code: error.code,
        type: error.type,
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

    console.error('Failed to create Stripe onboarding link', {
      trainerId: authorization.trainerId,
      stripeAccountId,
      error,
    })

    return createInternalErrorResponse()
  }
}
