import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import BigNumber from 'bignumber.js'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import Stripe from 'stripe'
import { authenticateTrainerRequest, buildErrorResponse } from '../_lib/accessToken'
import { getAccountSubscriptionPricingForCountry } from '../_lib/accountSubscriptionPricing'
import { currencyChargeLimits } from '../_lib/transactionFees'
import { getStripeClient, STRIPE_API_VERSION } from '../_lib/stripeClient'

const patchRequestBodySchema = z.object({
  cancelAtPeriodEnd: z.boolean(),
})

const addressSchema = z.object({
  country: z
    .string()
    .trim()
    .min(2, 'country is required')
    .transform((value) => value.toUpperCase()),
  line1: z.string().trim().min(1, 'line1 is required'),
  city: z.string().trim().min(1).optional(),
  line2: z.string().trim().min(1).optional(),
  postalCode: z.string().trim().min(1).optional(),
  state: z.string().trim().min(1).optional(),
})

const putRequestBodySchema = z.object({
  address: addressSchema,
  interval: z.enum(['month', 'year']),
})

const accountSubscriptionSchema = z.object({
  status: z.enum(['limited', 'grandfathered', 'lapsed', 'cancelled', 'subscribed', 'trialling']),
  platform: z.enum(['stripe', 'apple']).optional(),
})

const subscriptionRowSchema = z.object({
  subscription: z.unknown().nullable(),
  stripeSubscriptionId: z.string().nullable(),
})

const trainerSubscriptionRowSchema = z.object({
  stripeCustomerId: z.string().nullable(),
  stripeSubscriptionId: z.string().nullable(),
  email: z.string().trim().min(1, 'Trainer email is required'),
  country: z
    .string()
    .min(2, 'Country code must contain at least 2 characters.')
    .transform((value) => value.toUpperCase()),
  subscription: z.unknown().nullable(),
  monthlyPriceOverride: z.union([z.string(), z.number(), z.null()]),
  yearlyPriceOverride: z.union([z.string(), z.number(), z.null()]),
})

const subscriptionClientSecretSchema = z.object({
  clientSecret: z.string(),
})

const stripeApiVersionDate = STRIPE_API_VERSION.split('.')[0]

const alreadySubscribedStripeStatuses = new Set(['active', 'past_due', 'trialing'])

const extractClientIp = async () => {
  const headerStore = await headers()
  const forwardedFor = headerStore.get('x-forwarded-for')
  if (forwardedFor) {
    const [first] = forwardedFor.split(',')
    const ip = first?.trim()
    if (ip) {
      return ip
    }
  }

  const realIp = headerStore.get('x-real-ip')
  return realIp?.trim() || undefined
}

const buildAlreadySubscribedResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 409,
      title: "You're already subscribed.",
      type: '/already-subscribed',
    }),
    { status: 409 }
  )

export async function PATCH(request: Request) {
  let body: z.infer<typeof patchRequestBodySchema>

  try {
    const rawBody = (await request.json()) as unknown
    const parsed = patchRequestBodySchema.safeParse(rawBody)

    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => issue.message).join('; ')

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

    body = parsed.data
  } catch (error) {
    console.error('Failed to parse account subscription request body', error)

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
    extensionFailureLogMessage: 'Failed to extend access token expiry while updating account subscription',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  let subscriptionRow: unknown

  try {
    subscriptionRow = await db
      .selectFrom('vw_legacy_trainer')
      .innerJoin('trainer', 'trainer.id', 'vw_legacy_trainer.id')
      .select(({ ref }) => [
        ref('vw_legacy_trainer.subscription').as('subscription'),
        ref('trainer.stripe_subscription_id').as('stripeSubscriptionId'),
      ])
      .where('trainer.id', '=', authorization.trainerId)
      .executeTakeFirst()
  } catch (error) {
    console.error('Failed to fetch trainer subscription data', {
      trainerId: authorization.trainerId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to load subscription data',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }

  if (!subscriptionRow) {
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

  const parsedRow = subscriptionRowSchema.safeParse(subscriptionRow)

  if (!parsedRow.success) {
    const detail = parsedRow.error.issues.map((issue) => issue.message).join('; ')

    console.error('Failed to parse subscription row', {
      trainerId: authorization.trainerId,
      detail,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to parse subscription data from database',
        detail: detail || 'Subscription data did not match the expected schema.',
        type: '/invalid-database-response',
      }),
      { status: 500 }
    )
  }

  const parsedSubscription = accountSubscriptionSchema.safeParse(parsedRow.data.subscription)

  if (
    !parsedSubscription.success ||
    parsedSubscription.data.status !== 'subscribed' ||
    parsedSubscription.data.platform !== 'stripe' ||
    !parsedRow.data.stripeSubscriptionId
  ) {
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
        detail: 'STRIPE_SECRET_KEY is not configured, so Stripe subscriptions cannot be updated.',
        type: '/missing-stripe-configuration',
      }),
      { status: 500 }
    )
  }

  try {
    const stripeSubscription = (await stripeClient.subscriptions.update(parsedRow.data.stripeSubscriptionId, {
      cancel_at_period_end: body.cancelAtPeriodEnd,
    })) as Stripe.Subscription

    try {
      await db
        .insertInto('stripe.subscription')
        .values({
          id: stripeSubscription.id,
          api_version: sql<Date>`cast(${stripeApiVersionDate} as date)`,
          object: JSON.stringify(stripeSubscription),
        })
        .onConflict((oc) =>
          oc.column('id').doUpdateSet({
            api_version: sql<Date>`cast(${stripeApiVersionDate} as date)`,
            object: JSON.stringify(stripeSubscription),
          })
        )
        .execute()
    } catch (persistError) {
      console.error('Failed to persist Stripe subscription', {
        trainerId: authorization.trainerId,
        stripeSubscriptionId: stripeSubscription.id,
        error: persistError,
      })
    }

    type SubscriptionLike = {
      status: string
      cancel_at_period_end?: boolean | null
      current_period_end?: number | null
      latest_invoice?: Stripe.Invoice | string | null
    }

    const normalizedSubscription = stripeSubscription as SubscriptionLike

    return NextResponse.json({
      status: normalizedSubscription.status,
      cancelAtPeriodEnd: normalizedSubscription.cancel_at_period_end ?? null,
      currentPeriodEnd: normalizedSubscription.current_period_end
        ? new Date(normalizedSubscription.current_period_end * 1000).toISOString()
        : null,
    })
  } catch (error) {
    if (error instanceof Stripe.errors.StripeError) {
      console.error('Stripe API error while updating subscription', {
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

    console.error('Failed to update Stripe subscription', {
      trainerId: authorization.trainerId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to update account subscription',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  let parsedBody: z.infer<typeof putRequestBodySchema>

  try {
    const rawBody = (await request.json()) as unknown
    const bodyResult = putRequestBodySchema.safeParse(rawBody)

    if (!bodyResult.success) {
      const detail = bodyResult.error.issues.map((issue) => issue.message).join('; ')

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

    parsedBody = bodyResult.data
  } catch (error) {
    console.error('Failed to parse account subscription create request body', error)

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
    extensionFailureLogMessage: 'Failed to extend access token expiry while creating account subscription',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  let trainerRow: z.infer<typeof trainerSubscriptionRowSchema> | undefined

  try {
    trainerRow = await db
      .selectFrom('trainer')
      .innerJoin('country', 'country.id', 'trainer.country_id')
      .innerJoin('vw_legacy_trainer', 'vw_legacy_trainer.id', 'trainer.id')
      .select(({ ref }) => [
        ref('trainer.stripe_customer_id').as('stripeCustomerId'),
        ref('trainer.stripe_subscription_id').as('stripeSubscriptionId'),
        ref('trainer.email').as('email'),
        ref('country.alpha_2_code').as('country'),
        ref('vw_legacy_trainer.subscription').as('subscription'),
        ref('trainer.monthly_price_override').as('monthlyPriceOverride'),
        ref('trainer.yearly_price_override').as('yearlyPriceOverride'),
      ])
      .where('trainer.id', '=', authorization.trainerId)
      .executeTakeFirst()
  } catch (error) {
    console.error('Failed to fetch trainer data for account subscription creation', {
      trainerId: authorization.trainerId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch trainer data',
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

  let parsedTrainerRow: z.infer<typeof trainerSubscriptionRowSchema>
  try {
    parsedTrainerRow = trainerSubscriptionRowSchema.parse(trainerRow)
  } catch (error) {
    const detail = error instanceof z.ZodError ? error.issues.map((issue) => issue.message).join('; ') : undefined

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

  const currentAccountSubscription = accountSubscriptionSchema.safeParse(parsedTrainerRow.subscription)

  if (
    currentAccountSubscription.success &&
    (currentAccountSubscription.data.status === 'subscribed' || currentAccountSubscription.data.status === 'trialling')
  ) {
    return buildAlreadySubscribedResponse()
  }

  const pricing = getAccountSubscriptionPricingForCountry(parsedTrainerRow.country)

  if (!pricing) {
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Unsupported country for account subscription pricing',
        detail: `No subscription pricing is configured for country code ${parsedTrainerRow.country}.`,
        type: '/unsupported-country',
      }),
      { status: 500 }
    )
  }

  const currency = pricing.currency.toUpperCase()
  const limits = currencyChargeLimits[currency as keyof typeof currencyChargeLimits]

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

  let monthlyPrice: BigNumber
  let yearlyPrice: BigNumber

  try {
    monthlyPrice = new BigNumber(parsedTrainerRow.monthlyPriceOverride ?? pricing.monthlyPrice)
    yearlyPrice = new BigNumber(parsedTrainerRow.yearlyPriceOverride ?? pricing.yearlyPrice)

    if (!monthlyPrice.isFinite() || monthlyPrice.lt(0)) {
      throw new Error('Monthly price override is invalid')
    }

    if (!yearlyPrice.isFinite() || yearlyPrice.lt(0)) {
      throw new Error('Yearly price override is invalid')
    }
  } catch (error) {
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Invalid subscription pricing override',
        detail: error instanceof Error ? error.message : 'Trainer subscription pricing override values are invalid.',
        type: '/invalid-pricing-override',
      }),
      { status: 500 }
    )
  }

  const price = parsedBody.interval === 'month' ? monthlyPrice : yearlyPrice
  const unitAmount = price.shiftedBy(limits.smallestUnitDecimals)

  if (!unitAmount.isInteger()) {
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Invalid subscription price',
        detail: 'Subscription price could not be represented in the smallest currency unit.',
        type: '/invalid-price',
      }),
      { status: 500 }
    )
  }

  const stripeClient = getStripeClient()

  if (!stripeClient) {
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Stripe configuration missing',
        detail: 'STRIPE_SECRET_KEY is not configured, so Stripe subscriptions cannot be created.',
        type: '/missing-stripe-configuration',
      }),
      { status: 500 }
    )
  }

  if (parsedTrainerRow.stripeSubscriptionId) {
    try {
      const existingSubscription = await stripeClient.subscriptions.retrieve(parsedTrainerRow.stripeSubscriptionId)

      if (alreadySubscribedStripeStatuses.has(existingSubscription.status)) {
        return buildAlreadySubscribedResponse()
      }
    } catch (error) {
      if (error instanceof Stripe.errors.StripeError && error.statusCode === 404) {
        // Treat missing subscription as not subscribed.
      } else if (error instanceof Stripe.errors.StripeError) {
        console.error('Stripe API error while checking subscription status', {
          trainerId: authorization.trainerId,
          error,
        })

        return NextResponse.json(
          buildErrorResponse({
            status: error.statusCode ?? 502,
            title: error.message,
            detail: error.message,
            type: '/stripe-error',
          }),
          { status: error.statusCode ?? 502 }
        )
      } else {
        console.error('Failed to check existing Stripe subscription status', {
          trainerId: authorization.trainerId,
          error,
        })
      }
    }
  }

  const ipAddress = await extractClientIp()
  const stripeAddress: Stripe.AddressParam = {
    line1: parsedBody.address.line1,
    line2: parsedBody.address.line2 ?? undefined,
    city: parsedBody.address.city ?? undefined,
    postal_code: parsedBody.address.postalCode ?? undefined,
    state: parsedBody.address.state ?? undefined,
    country: parsedBody.address.country,
  }

  let stripeCustomer: Stripe.Customer

  try {
    if (parsedTrainerRow.stripeCustomerId) {
      try {
        stripeCustomer = await stripeClient.customers.update(parsedTrainerRow.stripeCustomerId, {
          email: parsedTrainerRow.email,
          address: stripeAddress,
          tax: ipAddress ? { ip_address: ipAddress } : undefined,
        })
      } catch (error) {
        if (error instanceof Stripe.errors.StripeError && error.statusCode === 404) {
          stripeCustomer = await stripeClient.customers.create({
            description: 'Service provider',
            email: parsedTrainerRow.email,
            metadata: { serviceProviderId: authorization.trainerId },
            address: stripeAddress,
            tax: ipAddress ? { ip_address: ipAddress } : undefined,
          })
        } else {
          throw error
        }
      }
    } else {
      stripeCustomer = await stripeClient.customers.create({
        description: 'Service provider',
        email: parsedTrainerRow.email,
        metadata: { serviceProviderId: authorization.trainerId },
        address: stripeAddress,
        tax: ipAddress ? { ip_address: ipAddress } : undefined,
      })
    }
  } catch (error) {
    if (error instanceof Stripe.errors.StripeError) {
      console.error('Stripe API error while creating/updating customer', {
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

    console.error('Failed to create or update Stripe customer', {
      trainerId: authorization.trainerId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to create Stripe customer',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }

  try {
    for await (const incomplete of stripeClient.subscriptions.list({
      status: 'incomplete',
      customer: stripeCustomer.id,
      limit: 100,
      collection_method: 'charge_automatically',
    })) {
      await stripeClient.subscriptions.cancel(incomplete.id).catch((cancelError: unknown) => {
        console.warn('Failed to delete incomplete subscription before creating new one', {
          trainerId: authorization.trainerId,
          subscriptionId: incomplete.id,
          error: cancelError,
        })
      })
    }
  } catch (error) {
    console.warn('Failed to clean up incomplete Stripe subscriptions', {
      trainerId: authorization.trainerId,
      customerId: stripeCustomer.id,
      error,
    })
  }

  let stripeSubscription: Stripe.Subscription

  try {
    stripeSubscription = (await stripeClient.subscriptions.create({
      customer: stripeCustomer.id,
      items: [
        {
          price_data: {
            currency: currency.toLowerCase(),
            product: 'essentials',
            recurring: { interval: parsedBody.interval },
            tax_behavior: 'inclusive',
            unit_amount: unitAmount.toNumber(),
          },
        },
      ],
      automatic_tax: {
        enabled: true,
      },
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent'],
    })) as Stripe.Subscription
  } catch (error) {
    if (error instanceof Stripe.errors.StripeError) {
      console.error('Stripe API error while creating subscription', {
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

    console.error('Failed to create Stripe subscription', {
      trainerId: authorization.trainerId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to create account subscription',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }

  const latestInvoice = (
    stripeSubscription as {
      latest_invoice?: Stripe.Invoice | string | null
    }
  ).latest_invoice
  const paymentIntent =
    latestInvoice && typeof latestInvoice !== 'string'
      ? (
          latestInvoice as Stripe.Invoice & {
            payment_intent?: Stripe.PaymentIntent | string | null
          }
        ).payment_intent
      : null

  const clientSecret = paymentIntent && typeof paymentIntent !== 'string' ? paymentIntent.client_secret : null

  if (!clientSecret) {
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to retrieve Stripe payment intent',
        detail: 'Stripe did not return a payment intent client secret for the subscription.',
        type: '/invalid-stripe-response',
      }),
      { status: 500 }
    )
  }

  try {
    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto('stripe.customer')
        .values({
          id: stripeCustomer.id,
          api_version: sql<Date>`cast(${stripeApiVersionDate} as date)`,
          object: JSON.stringify(stripeCustomer),
        })
        .onConflict((oc) =>
          oc.column('id').doUpdateSet({
            api_version: sql<Date>`cast(${stripeApiVersionDate} as date)`,
            object: JSON.stringify(stripeCustomer),
          })
        )
        .execute()

      await trx
        .insertInto('stripe.subscription')
        .values({
          id: stripeSubscription.id,
          api_version: sql<Date>`cast(${stripeApiVersionDate} as date)`,
          object: JSON.stringify(stripeSubscription),
        })
        .onConflict((oc) =>
          oc.column('id').doUpdateSet({
            api_version: sql<Date>`cast(${stripeApiVersionDate} as date)`,
            object: JSON.stringify(stripeSubscription),
          })
        )
        .execute()

      await trx
        .updateTable('trainer')
        .set({
          stripe_customer_id: stripeCustomer.id,
          stripe_subscription_id: stripeSubscription.id,
        })
        .where('id', '=', authorization.trainerId)
        .execute()
    })
  } catch (error) {
    console.error('Failed to persist Stripe subscription data', {
      trainerId: authorization.trainerId,
      subscriptionId: stripeSubscription.id,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to save subscription',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }

  const responseBody = subscriptionClientSecretSchema.parse({
    clientSecret,
  })

  return NextResponse.json(responseBody)
}
