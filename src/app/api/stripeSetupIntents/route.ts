import { NextResponse } from 'next/server'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import Stripe from 'stripe'
import { authenticateClientRequest, buildErrorResponse } from '../_lib/accessToken'
import { getStripeClient, STRIPE_API_VERSION } from '../_lib/stripeClient'

const stripeApiVersionDate = STRIPE_API_VERSION.split('.')[0]

const clientStripeRowSchema = z.object({
  stripeCustomerId: z.string().nullable(),
  clientEmail: z.string().nullable(),
  serviceProviderEmail: z.string().min(1, 'Service provider email is required'),
  stripeAccountId: z.string().nullable(),
  stripeAccountType: z.enum(['standard', 'custom']).nullable(),
})

const createStripeConfigurationMissingResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Stripe configuration missing',
      detail: 'STRIPE_SECRET_KEY is not configured, so Stripe setup intents cannot be created.',
      type: '/missing-stripe-configuration',
    }),
    { status: 500 }
  )

const createStripePaymentsDisabledResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 409,
      title: "Your service provider does not have payments enabled. We've notified them.",
      type: '/service-provider-cant-take-payments',
    }),
    { status: 409 }
  )

const createClientNotFoundResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 404,
      title: 'Client not found',
      detail: 'No client record was found for the authenticated access token.',
      type: '/client-not-found',
    }),
    { status: 404 }
  )

const createInvalidDatabaseResponse = (detail?: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Failed to parse client data',
      detail: detail || 'Client data did not match the expected schema.',
      type: '/invalid-database-response',
    }),
    { status: 500 }
  )

const createInternalErrorResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Failed to create Stripe setup intent',
      type: '/internal-server-error',
    }),
    { status: 500 }
  )

// For legacy users who require 3DS when paying through connected accounts.
const threeDsExceptions = new Set(['cus_LKaEWrm9vaFNsm'])

export async function POST(request: Request) {
  const authorization = await authenticateClientRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while creating Stripe setup intent',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const stripeClient = getStripeClient()

  if (!stripeClient) {
    return createStripeConfigurationMissingResponse()
  }

  let clientStripeData: z.infer<typeof clientStripeRowSchema>

  try {
    const row = await db
      .selectFrom('client')
      .innerJoin('trainer', 'trainer.id', 'client.trainer_id')
      .leftJoin('stripe.account as stripeAccount', 'stripeAccount.id', 'trainer.stripe_account_id')
      .select((eb) => [
        eb.ref('client.stripe_customer_id').as('stripeCustomerId'),
        eb.ref('client.email').as('clientEmail'),
        eb.ref('trainer.email').as('serviceProviderEmail'),
        eb.ref('trainer.stripe_account_id').as('stripeAccountId'),
        sql<string | null>`stripeAccount.object ->> 'type'`.as('stripeAccountType'),
      ])
      .where('client.id', '=', authorization.clientId)
      .where('trainer.id', '=', authorization.trainerId)
      .executeTakeFirst()

    if (!row) {
      return createClientNotFoundResponse()
    }

    const parsedRow = clientStripeRowSchema.safeParse(row)

    if (!parsedRow.success) {
      const detail = parsedRow.error.issues.map((issue) => issue.message).join('; ')

      console.error('Failed to parse client Stripe data', {
        clientId: authorization.clientId,
        trainerId: authorization.trainerId,
        detail,
      })

      return createInvalidDatabaseResponse(detail || undefined)
    }

    clientStripeData = parsedRow.data
  } catch (error) {
    console.error('Failed to fetch client Stripe data', {
      clientId: authorization.clientId,
      trainerId: authorization.trainerId,
      error,
    })

    return createInternalErrorResponse()
  }

  const { stripeAccountId, stripeAccountType, stripeCustomerId, clientEmail, serviceProviderEmail } = clientStripeData

  if (!stripeAccountId || !stripeAccountType) {
    return createStripePaymentsDisabledResponse()
  }

  const stripeRequestOptions = stripeAccountType === 'standard' ? { stripeAccount: stripeAccountId } : undefined

  let customerId = stripeCustomerId ?? undefined

  try {
    if (!customerId) {
      const customer = await stripeClient.customers.create(
        {
          description: `Customer for ${serviceProviderEmail}`,
          email: clientEmail || undefined,
          metadata: {
            clientId: authorization.clientId,
          },
        },
        stripeRequestOptions
      )

      customerId = customer.id

      await db.transaction().execute(async (trx) => {
        await trx
          .insertInto('stripe.customer')
          .values({
            id: customer.id,
            api_version: sql<Date>`cast(${stripeApiVersionDate} as date)`,
            object: JSON.stringify(customer),
          })
          .onConflict((oc) =>
            oc.column('id').doUpdateSet({
              api_version: sql<Date>`cast(${stripeApiVersionDate} as date)`,
              object: JSON.stringify(customer),
            })
          )
          .execute()

        await trx
          .updateTable('client')
          .set({ stripe_customer_id: customer.id })
          .where('id', '=', authorization.clientId)
          .execute()
      })
    }
  } catch (error) {
    if (error instanceof Stripe.errors.StripeError) {
      console.error('Stripe API error while creating customer for setup intent', {
        clientId: authorization.clientId,
        trainerId: authorization.trainerId,
        stripeAccountId,
        statusCode: error.statusCode,
        message: error.message,
        code: error.code,
        type: error.type,
      })

      return NextResponse.json(
        buildErrorResponse({
          status: error.statusCode ?? 400,
          title: error.message,
          detail: error.message,
          type: '/stripe-error',
        }),
        { status: error.statusCode ?? 400 }
      )
    }

    console.error('Failed to create or persist Stripe customer for setup intent', {
      clientId: authorization.clientId,
      trainerId: authorization.trainerId,
      stripeAccountId,
      error,
    })

    return createInternalErrorResponse()
  }

  if (!customerId) {
    return createInternalErrorResponse()
  }

  const requestThreeDS =
    threeDsExceptions.has(customerId) || stripeAccountType === 'standard' ? 'automatic' : 'any'

  try {
    const setupIntent = await stripeClient.setupIntents.create(
      {
        customer: customerId,
        on_behalf_of: stripeAccountType === 'standard' ? undefined : stripeAccountId,
        payment_method_options: {
          card: {
            request_three_d_secure: requestThreeDS,
          },
        },
      },
      stripeRequestOptions
    )

    const clientSecret = setupIntent.client_secret

    if (!clientSecret) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to retrieve Stripe setup intent',
          detail: 'Stripe did not return a client secret for the setup intent.',
          type: '/invalid-stripe-response',
        }),
        { status: 500 }
      )
    }

    return NextResponse.json({
      clientSecret,
    })
  } catch (error) {
    if (error instanceof Stripe.errors.StripeError) {
      console.error('Stripe API error while creating setup intent', {
        clientId: authorization.clientId,
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

    console.error('Failed to create Stripe setup intent', {
      clientId: authorization.clientId,
      trainerId: authorization.trainerId,
      stripeAccountId,
      error,
    })

    return createInternalErrorResponse()
  }
}
