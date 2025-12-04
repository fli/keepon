import { NextResponse } from 'next/server'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import { authenticateTrainerOrClientRequest, buildErrorResponse } from '../../_lib/accessToken'

const stripeAccountSchema = z
  .object({
    id: z.string(),
    type: z.enum(['custom', 'standard']),
    charges_enabled: z.boolean(),
    payouts_enabled: z.boolean(),
    requirements: z
      .object({
        current_deadline: z.number().nullable().optional(),
        currently_due: z.array(z.string()).nullable().optional(),
        disabled_reason: z.string().nullable().optional(),
        errors: z
          .array(
            z.object({
              code: z.string(),
              reason: z.string(),
              requirement: z.string(),
            })
          )
          .nullable()
          .optional(),
        eventually_due: z.array(z.string()).nullable().optional(),
        past_due: z.array(z.string()).nullable().optional(),
        pending_verification: z.array(z.string()).nullable().optional(),
      })
      .partial()
      .optional(),
    settings: z
      .object({
        payouts: z.object({
          schedule: z.discriminatedUnion('interval', [
            z.object({
              interval: z.literal('manual'),
            }),
            z.object({
              interval: z.literal('daily'),
              delay_days: z.number(),
            }),
            z.object({
              interval: z.literal('weekly'),
              delay_days: z.number(),
              weekly_anchor: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']),
            }),
            z.object({
              interval: z.literal('monthly'),
              delay_days: z.number(),
              monthly_anchor: z.number(),
            }),
          ]),
        }),
      })
      .nullable()
      .optional(),
    alternatives: z
      .array(
        z.object({
          alternative_fields_due: z.array(z.string()),
          original_fields_due: z.array(z.string()),
        })
      )
      .nullable()
      .optional(),
  })
  .passthrough()

const trainerStripeAccountRowSchema = z.object({
  account: z.unknown(),
})

const clientStripeAccountRowSchema = z.object({
  id: z.string(),
  type: z.union([z.literal('custom'), z.literal('standard')]),
})

const stripeAccountNotFoundResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 404,
      title: 'Stripe account not found',
      detail: 'No Stripe account is associated with the authenticated user.',
      type: '/stripe-account-not-found',
    }),
    { status: 404 }
  )

const stripeAccountInvalidResponse = (detail?: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Stripe account data invalid',
      detail: detail || 'Stripe account data did not match the expected response schema.',
      type: '/invalid-stripe-account',
    }),
    { status: 500 }
  )

export async function GET(request: Request) {
  const authorization = await authenticateTrainerOrClientRequest(request, {
    trainerExtensionFailureLogMessage:
      'Failed to extend access token expiry while fetching Stripe account for trainer request',
    clientExtensionFailureLogMessage:
      'Failed to extend access token expiry while fetching Stripe account for client request',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    if (authorization.actor === 'trainer') {
      const row = await db
        .selectFrom('trainer')
        .innerJoin('stripe.account as stripeAccount', 'stripeAccount.id', 'trainer.stripe_account_id')
        .select(({ ref }) => [ref('stripeAccount.object').as('account')])
        .where('trainer.id', '=', authorization.trainerId)
        .executeTakeFirst()

      const parsedRow = trainerStripeAccountRowSchema.safeParse(row)
      if (!parsedRow.success) {
        return stripeAccountNotFoundResponse()
      }

      const parsedAccount = stripeAccountSchema.safeParse(parsedRow.data.account)
      if (!parsedAccount.success) {
        const detail = parsedAccount.error.issues.map((issue) => issue.message).join('; ')

        console.error('Failed to parse Stripe account object for trainer', {
          trainerId: authorization.trainerId,
          detail,
        })

        return stripeAccountInvalidResponse(detail)
      }

      return NextResponse.json(parsedAccount.data)
    }

    const row = await db
      .selectFrom('client')
      .innerJoin('trainer', 'trainer.id', 'client.trainer_id')
      .innerJoin('stripe.account as stripeAccount', 'stripeAccount.id', 'trainer.stripe_account_id')
      .select(() => [sql<string>`stripeAccount.id`.as('id'), sql<string>`stripeAccount.object ->> 'type'`.as('type')])
      .where('client.id', '=', authorization.clientId)
      .where('trainer.id', '=', authorization.trainerId)
      .executeTakeFirst()

    const parsedRow = clientStripeAccountRowSchema.safeParse(row)
    if (!parsedRow.success) {
      if (!row) {
        return stripeAccountNotFoundResponse()
      }

      const detail = parsedRow.error.issues.map((issue) => issue.message).join('; ')

      console.error('Failed to parse Stripe account summary for client', {
        clientId: authorization.clientId,
        trainerId: authorization.trainerId,
        detail,
      })

      return stripeAccountInvalidResponse(detail)
    }

    return NextResponse.json(parsedRow.data)
  } catch (error) {
    console.error('Failed to fetch Stripe account', {
      error,
      actor: authorization.actor,
      trainerId: authorization.trainerId,
      clientId: authorization.actor === 'client' ? authorization.clientId : null,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch Stripe account',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
