import { NextResponse } from 'next/server'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import Stripe from 'stripe'
import BigNumber from 'bignumber.js'
import { buildErrorResponse } from '../_lib/accessToken'
import { getSmsCreditPricingForCountry } from '../_lib/smsCreditPricing'
import { getStripeClient, STRIPE_API_VERSION } from '../_lib/stripeClient'

const stripeApiVersionDate = STRIPE_API_VERSION.split('.')[0]

const requestBodySchema = z.object({
  smsCreditCheckoutId: z.string().trim().min(1, 'smsCreditCheckoutId is required'),
  creditCount: z.number().int().positive('creditCount must be a positive integer'),
})

const checkoutDetailsSchema = z.object({
  stripeCustomerId: z.string().nullable(),
  country: z.string().trim(),
  email: z.string().nullable(),
  serviceProviderId: z.string(),
  businessLogoUrl: z.string().nullable(),
  onlineBookingsBusinessName: z.string().nullable(),
  businessName: z.string().nullable(),
  firstName: z.string(),
  lastName: z.string().nullable(),
})

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
      detail: detail ?? 'Request body did not match the expected schema.',
      type: '/invalid-body',
    }),
    { status: 400 }
  )

const createCheckoutNotFoundResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 404,
      title: 'SMS credit checkout not found',
      detail: 'No trainer is associated with the provided SMS credit checkout identifier.',
      type: '/resource-not-found',
    }),
    { status: 404 }
  )

const createCountryNotSupportedResponse = (country: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 409,
      title: 'That country is not supported.',
      detail: `SMS credit pricing is not configured for country code ${country}.`,
      type: '/country-not-supported',
    }),
    { status: 409 }
  )

const createCreditPackageUnavailableResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 404,
      title: 'Credit package not available',
      detail: 'Requested credit count is not available for this checkout.',
      type: '/resource-not-found',
    }),
    { status: 404 }
  )

const createStripeConfigurationMissingResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Stripe configuration missing',
      detail: 'STRIPE_SECRET_KEY is not configured, so SMS credit checkout sessions cannot be created.',
      type: '/missing-stripe-configuration',
    }),
    { status: 500 }
  )

const createInternalErrorResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Failed to create SMS credit checkout session',
      type: '/internal-server-error',
    }),
    { status: 500 }
  )

const buildServiceProviderName = (details: z.infer<typeof checkoutDetailsSchema>) => {
  return (
    details.onlineBookingsBusinessName ??
    details.businessName ??
    [details.firstName, details.lastName].filter(Boolean).join(' ')
  )
}

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
    console.error('Failed to parse SMS credit checkout session request body', error)
    return createInvalidJsonResponse()
  }

  const stripeClient = getStripeClient()

  if (!stripeClient) {
    return createStripeConfigurationMissingResponse()
  }

  let checkoutDetails: z.infer<typeof checkoutDetailsSchema>

  try {
    const row = await db
      .selectFrom('trainer')
      .innerJoin('country', 'country.id', 'trainer.country_id')
      .select((eb) => [
        eb.ref('trainer.stripe_customer_id').as('stripeCustomerId'),
        eb.ref('country.alpha_2_code').as('country'),
        eb.ref('trainer.email').as('email'),
        eb.ref('trainer.id').as('serviceProviderId'),
        eb.ref('trainer.business_logo_url').as('businessLogoUrl'),
        eb.ref('trainer.online_bookings_business_name').as('onlineBookingsBusinessName'),
        eb.ref('trainer.business_name').as('businessName'),
        eb.ref('trainer.first_name').as('firstName'),
        eb.ref('trainer.last_name').as('lastName'),
      ])
      .where('trainer.sms_credit_checkout_id', '=', body.smsCreditCheckoutId)
      .executeTakeFirst()

    if (!row) {
      return createCheckoutNotFoundResponse()
    }

    const parsedRow = checkoutDetailsSchema.safeParse(row)

    if (!parsedRow.success) {
      const detail = parsedRow.error.issues.map((issue) => issue.message).join('; ')

      console.error('Failed to parse SMS credit checkout details', {
        smsCreditCheckoutId: body.smsCreditCheckoutId,
        detail,
      })

      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse SMS credit checkout data',
          detail: detail || 'SMS credit checkout data did not match the expected schema.',
          type: '/invalid-database-response',
        }),
        { status: 500 }
      )
    }

    checkoutDetails = parsedRow.data
  } catch (error) {
    console.error('Failed to fetch SMS credit checkout details', {
      smsCreditCheckoutId: body.smsCreditCheckoutId,
      error,
    })

    return createInternalErrorResponse()
  }

  const pricing = getSmsCreditPricingForCountry(checkoutDetails.country)

  if (!pricing) {
    return createCountryNotSupportedResponse(checkoutDetails.country)
  }

  if (body.creditCount % pricing.creditCount !== 0) {
    return createCreditPackageUnavailableResponse()
  }

  const quantity = body.creditCount / pricing.creditCount
  const totalPrice = new BigNumber(pricing.price).multipliedBy(quantity)
  const unitAmountDecimal = totalPrice.shiftedBy(2).toFixed(0)
  const baseUrl = process.env.BASE_URL ?? 'http://localhost:3001'
  const serviceProviderName = buildServiceProviderName(checkoutDetails)

  try {
    let stripeCustomerId = checkoutDetails.stripeCustomerId ?? undefined

    if (!stripeCustomerId) {
      const customer = await stripeClient.customers.create({
        description: 'Service provider',
        email: checkoutDetails.email || undefined,
        metadata: {
          serviceProviderId: checkoutDetails.serviceProviderId,
        },
      })

      stripeCustomerId = customer.id

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
          .updateTable('trainer')
          .set({ stripe_customer_id: customer.id })
          .where('trainer.id', '=', checkoutDetails.serviceProviderId)
          .execute()
      })
    } else {
      await stripeClient.customers.update(stripeCustomerId, {
        email: checkoutDetails.email || undefined,
      })
    }

    const session = await stripeClient.checkout.sessions.create({
      cancel_url: new URL(`/sms-credit-checkouts/${encodeURIComponent(body.smsCreditCheckoutId)}`, baseUrl).toString(),
      mode: 'payment',
      payment_method_types: ['card'],
      success_url: new URL(`/sms-credit-checkouts/${encodeURIComponent(body.smsCreditCheckoutId)}/success`, baseUrl).toString(),
      submit_type: 'pay',
      customer: stripeCustomerId,
      client_reference_id: checkoutDetails.serviceProviderId,
      payment_intent_data: {
        receipt_email: checkoutDetails.email || undefined,
      },
      line_items: [
        {
          price_data: {
            currency: pricing.currency.toLowerCase(),
            unit_amount_decimal: unitAmountDecimal,
            product_data: {
              name: `${body.creditCount} Text Credits`,
              description: `For: ${serviceProviderName}`,
              ...(checkoutDetails.businessLogoUrl ? { images: [checkoutDetails.businessLogoUrl] } : {}),
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        creditCount: body.creditCount.toString(),
        smsCreditCheckoutId: body.smsCreditCheckoutId,
        serviceProviderId: checkoutDetails.serviceProviderId,
      },
    })

    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto('stripe.checkout_session')
        .values({
          id: session.id,
          api_version: sql<Date>`cast(${stripeApiVersionDate} as date)`,
          object: JSON.stringify(session),
        })
        .onConflict((oc) =>
          oc.column('id').doUpdateSet({
            api_version: sql<Date>`cast(${stripeApiVersionDate} as date)`,
            object: JSON.stringify(session),
          })
        )
        .execute()

      await trx
        .insertInto('sms_credit_checkout_session')
        .values({
          id: session.id,
          trainer_id: checkoutDetails.serviceProviderId,
          credit_count: body.creditCount,
        })
        .onConflict((oc) =>
          oc.column('id').doUpdateSet({
            trainer_id: checkoutDetails.serviceProviderId,
            credit_count: body.creditCount,
          })
        )
        .execute()
    })

    return NextResponse.json({ stripeCheckoutSessionId: session.id })
  } catch (error) {
    if (error instanceof Stripe.errors.StripeError) {
      console.error('Stripe API error while creating SMS credit checkout session', {
        smsCreditCheckoutId: body.smsCreditCheckoutId,
        serviceProviderId: checkoutDetails.serviceProviderId,
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

    if (error instanceof z.ZodError) {
      const detail = error.issues.map((issue) => issue.message).join('; ')

      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to validate Stripe data',
          detail: detail || 'Stripe data did not match the expected schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to create SMS credit checkout session', {
      smsCreditCheckoutId: body.smsCreditCheckoutId,
      serviceProviderId: checkoutDetails.serviceProviderId,
      error,
    })

    return createInternalErrorResponse()
  }
}
