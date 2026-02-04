import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { toPoint } from '@/lib/db/values'
import { authenticateTrainerRequest, buildErrorResponse } from '../../_lib/accessToken'
import { getStripeClient } from '../../_lib/stripeClient'
import { adaptClientRow, clientSchema } from '../shared'

const paramsSchema = z.object({
  clientId: z.string().trim().min(1, 'Client id is required').uuid({ message: 'Client id must be a valid UUID' }),
})

const deleteResponseSchema = z.object({
  count: z.number().int().nonnegative(),
})

const nullableTrimmedString = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return undefined
    }
    if (value === null) {
      return null
    }
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  })

const nullablePhoneString = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return undefined
    }
    if (value === null) {
      return null
    }
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  })

const nullableEmail = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return undefined
    }
    if (value === null) {
      return null
    }
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  })
  .refine((value) => value === undefined || value === null || z.string().email().safeParse(value).success, {
    message: 'Email must be a valid email address.',
  })

const nullableUrl = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return undefined
    }
    if (value === null) {
      return null
    }
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  })
  .refine((value) => value === undefined || value === null || z.string().url().safeParse(value).success, {
    message: 'profileImageURL must be a valid URL.',
  })

const birthdaySchema = z.preprocess((value) => {
  if (value === undefined) {
    return undefined
  }
  if (value === null) {
    return null
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  return value
}, z.union([z.coerce.date(), z.null()]).optional())

const geoSchema = z
  .union([z.object({ lat: z.number(), lng: z.number() }), z.object({ lat: z.null(), lng: z.null() })])
  .nullable()
  .optional()

const requestBodySchema = z
  .object({
    status: z.enum(['current', 'past', 'lead']).optional(),
    firstName: z
      .string({ message: 'firstName must be a string.' })
      .trim()
      .min(1, 'firstName must not be empty.')
      .optional(),
    lastName: nullableTrimmedString,
    email: nullableEmail,
    mobileNumber: nullablePhoneString,
    otherNumber: nullablePhoneString,
    birthday: birthdaySchema,
    emergencyContactName: nullableTrimmedString,
    emergencyContactMobileNumber: nullablePhoneString,
    profileImageURL: nullableUrl,
    company: nullableTrimmedString,
    notes: nullableTrimmedString,
    location: nullableTrimmedString,
    address: nullableTrimmedString,
    geo: geoSchema,
    googlePlaceId: nullableTrimmedString,
  })
  .partial()
  .strict()

const LEGACY_INVALID_JSON_MESSAGE = 'Unexpected token \'"\', "#" is not valid JSON'

const createLegacyNotFoundResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 404,
      title: 'Client not found',
      type: '/resource-not-found',
    }),
    { status: 404 }
  )

const clientDetailsSchema = z.object({
  email: z.string().nullable(),
  stripeCustomerId: z.string().nullable(),
  stripeAccountId: z.string().nullable(),
  stripeAccountType: z.enum(['standard', 'custom', 'express']).nullable(),
  userId: z.string(),
})

type HandlerContext = RouteContext<'/api/clients/[clientId]'>

export async function GET(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    return NextResponse.json(
      buildErrorResponse({
        status: 404,
        title: 'Client not found',
        type: '/resource-not-found',
      }),
      { status: 404 }
    )
  }

  const { clientId } = paramsResult.data

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while fetching client',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const clientRow = await db
      .selectFrom('vw_legacy_client as client')
      .selectAll('client')
      .where('client.trainerId', '=', authorization.trainerId)
      .where('client.id', '=', clientId)
      .executeTakeFirst()

    if (!clientRow) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Client not found',
          type: '/resource-not-found',
        }),
        { status: 404 }
      )
    }

    const client = clientSchema.parse(adaptClientRow(clientRow))

    return NextResponse.json(client)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Something on our end went wrong.',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch client', authorization.trainerId, clientId, error)

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch client',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map((issue) => issue.message).join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid client identifier',
        detail: detail || 'Request parameters did not match the expected client identifier schema.',
        type: '/invalid-parameter',
      }),
      { status: 400 }
    )
  }

  const { clientId } = paramsResult.data

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while updating client',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  let parsedBody: z.infer<typeof requestBodySchema>

  const invalidJsonResponse = () =>
    NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: LEGACY_INVALID_JSON_MESSAGE,
      }),
      { status: 400 }
    )

  try {
    const rawText = await request.text()
    if (rawText.trim().length === 0) {
      parsedBody = {}
    } else {
      const parsed = JSON.parse(rawText) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return invalidJsonResponse()
      }

      const validation = requestBodySchema.safeParse(parsed)

      if (!validation.success) {
        const detail = validation.error.issues.map((issue) => issue.message).join('; ')

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

      parsedBody = validation.data
    }
  } catch (error) {
    console.error('Failed to parse client update request body', {
      clientId,
      error,
    })

    return invalidJsonResponse()
  }

  const hasUpdates = Object.values(parsedBody).some((value) => value !== undefined)

  const fetchClient = async () => {
    const clientRow = await db
      .selectFrom('vw_legacy_client as client')
      .selectAll('client')
      .where('client.trainerId', '=', authorization.trainerId)
      .where('client.id', '=', clientId)
      .executeTakeFirst()

    if (!clientRow) {
      return null
    }

    return clientSchema.parse(adaptClientRow(clientRow))
  }

  if (!hasUpdates) {
    try {
      const client = await fetchClient()

      if (!client) {
        return createLegacyNotFoundResponse()
      }

      return NextResponse.json(client)
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          buildErrorResponse({
            status: 500,
            title: 'Failed to parse client data from database',
            detail: 'Client data did not match the expected response schema.',
            type: '/invalid-response',
          }),
          { status: 500 }
        )
      }

      console.error('Failed to fetch client while handling empty update', {
        trainerId: authorization.trainerId,
        clientId,
        error,
      })

      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to fetch client',
          type: '/internal-server-error',
        }),
        { status: 500 }
      )
    }
  }

  try {
    await db.transaction().execute(async (trx) => {
      const detailsRow = await trx
        .selectFrom('client as client')
        .innerJoin('trainer as trainer', 'trainer.id', 'client.trainer_id')
        .leftJoin('stripe.account as stripeAccount', 'stripeAccount.id', 'trainer.stripe_account_id')
        .select((eb) => [
          eb.ref('client.email').as('email'),
          eb.ref('client.user_id').as('userId'),
          eb.ref('client.stripe_customer_id').as('stripeCustomerId'),
          eb.ref('trainer.stripe_account_id').as('stripeAccountId'),
          eb.fn('json_extract_path_text', [eb.ref('stripeAccount.object'), 'type']).as('stripeAccountType'),
        ])
        .where('client.id', '=', clientId)
        .where('client.trainer_id', '=', authorization.trainerId)
        .executeTakeFirst()

      if (!detailsRow) {
        throw new ClientNotFoundError()
      }

      const details = clientDetailsSchema.parse(detailsRow)

      const changeValidEmail =
        parsedBody.email !== undefined && details.email !== null && parsedBody.email !== details.email

      const updates: Partial<{
        status: string
        first_name: string
        last_name: string | null
        email: string | null
        mobile_number: string | null
        other_number: string | null
        birthday: Date | null
        emergency_contact_name: string | null
        emergency_contact_mobile_number: string | null
        profile_image_url: string | null
        company: string | null
        notes: string | null
        location: string | null
        address: string | null
        google_place_id: string | null
      }> = {}

      if (parsedBody.status !== undefined) {
        updates.status = parsedBody.status
      }
      if (parsedBody.firstName !== undefined) {
        updates.first_name = parsedBody.firstName
      }
      if (parsedBody.lastName !== undefined) {
        updates.last_name = parsedBody.lastName
      }
      if (parsedBody.email !== undefined) {
        updates.email = parsedBody.email
      }
      if (parsedBody.mobileNumber !== undefined) {
        updates.mobile_number = parsedBody.mobileNumber
      }
      if (parsedBody.otherNumber !== undefined) {
        updates.other_number = parsedBody.otherNumber
      }
      if (parsedBody.birthday !== undefined) {
        updates.birthday = parsedBody.birthday
      }
      if (parsedBody.emergencyContactName !== undefined) {
        updates.emergency_contact_name = parsedBody.emergencyContactName
      }
      if (parsedBody.emergencyContactMobileNumber !== undefined) {
        updates.emergency_contact_mobile_number = parsedBody.emergencyContactMobileNumber
      }
      if (parsedBody.profileImageURL !== undefined) {
        updates.profile_image_url = parsedBody.profileImageURL
      }
      if (parsedBody.company !== undefined) {
        updates.company = parsedBody.company
      }
      if (parsedBody.notes !== undefined) {
        updates.notes = parsedBody.notes
      }
      if (parsedBody.location !== undefined) {
        updates.location = parsedBody.location
      }
      if (parsedBody.address !== undefined) {
        updates.address = parsedBody.address
      }
      if (parsedBody.googlePlaceId !== undefined) {
        updates.google_place_id = parsedBody.googlePlaceId
      }

      let updateBuilder = trx.updateTable('client').set(updates)

      if (parsedBody.geo !== undefined) {
        const geoValue =
          !parsedBody.geo || parsedBody.geo.lat === null ? null : toPoint(parsedBody.geo.lat, parsedBody.geo.lng)

        updateBuilder = updateBuilder.set('geo', geoValue)
      }

      const updated = await updateBuilder
        .where('client.id', '=', clientId)
        .where('client.trainer_id', '=', authorization.trainerId)
        .returning(['id'])
        .executeTakeFirst()

      if (!updated) {
        throw new ClientNotFoundError()
      }

      if (changeValidEmail) {
        await trx
          .deleteFrom('access_token')
          .where('access_token.user_id', '=', details.userId)
          .where('access_token.type', '=', 'client_dashboard')
          .where('access_token.user_type', '=', 'client')
          .execute()
      }

      if (changeValidEmail && details.stripeCustomerId && details.stripeAccountId && details.stripeAccountType) {
        const stripeClient = getStripeClient()

        if (!stripeClient) {
          throw new StripeConfigurationMissingError()
        }

        const stripeOptions =
          details.stripeAccountType === 'standard' ? { stripeAccount: details.stripeAccountId } : undefined

        const paymentMethods = await stripeClient.paymentMethods
          .list(
            {
              customer: details.stripeCustomerId,
              type: 'card',
              limit: 100,
            },
            stripeOptions
          )
          .autoPagingToArray({ limit: 1000 })

        await Promise.all(
          paymentMethods.map((method) => stripeClient.paymentMethods.detach(method.id, undefined, stripeOptions))
        )
      }
    })

    const client = await fetchClient()

    if (!client) {
      return createLegacyNotFoundResponse()
    }

    return NextResponse.json(client)
  } catch (error) {
    if (error instanceof ClientNotFoundError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Client not found',
          type: '/resource-not-found',
        }),
        { status: 404 }
      )
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to validate client update response',
          detail: 'Client update response did not match the expected schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    if (error instanceof StripeConfigurationMissingError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Stripe configuration missing',
          type: '/missing-stripe-configuration',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to update client', {
      trainerId: authorization.trainerId,
      clientId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to update client',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}

class ClientNotFoundError extends Error {
  constructor() {
    super('Client not found')
    this.name = 'ClientNotFoundError'
  }
}

class StripeConfigurationMissingError extends Error {
  constructor() {
    super('Stripe configuration missing')
    this.name = 'StripeConfigurationMissingError'
  }
}

export async function DELETE(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Something on our end went wrong.',
      }),
      { status: 500 }
    )
  }

  const { clientId } = paramsResult.data

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while deleting client',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const deleteResult = await db.transaction().execute(async (trx) => {
      const client = await trx
        .selectFrom('client')
        .select((eb) => [eb.ref('client.id').as('id')])
        .where('client.id', '=', clientId)
        .where('client.trainer_id', '=', authorization.trainerId)
        .executeTakeFirst()

      if (!client) {
        throw new ClientNotFoundError()
      }

      const sessionSeriesRows = await trx
        .selectFrom('session')
        .innerJoin('client_session', 'client_session.session_id', 'session.id')
        .select('session.session_series_id as sessionSeriesId')
        .where('client_session.client_id', '=', clientId)
        .where('session.trainer_id', '=', authorization.trainerId)
        .execute()

      const sessionSeriesIds = Array.from(new Set(sessionSeriesRows.map((row) => row.sessionSeriesId)))

      if (sessionSeriesIds.length > 0) {
        await trx
          .deleteFrom('session_series')
          .where('event_type', '=', 'single_session')
          .where('trainer_id', '=', authorization.trainerId)
          .where('id', 'in', sessionSeriesIds)
          .execute()
      }

      const deleted = await trx
        .deleteFrom('client')
        .where('client.id', '=', clientId)
        .where('client.trainer_id', '=', authorization.trainerId)
        .returning((eb) => [eb.ref('client.id').as('id')])
        .executeTakeFirst()

      if (!deleted) {
        throw new ClientNotFoundError()
      }

      return { count: 1 }
    })

    const responseBody = deleteResponseSchema.parse(deleteResult)

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof ClientNotFoundError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Client not found',
          type: '/resource-not-found',
        }),
        { status: 404 }
      )
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to validate client deletion response',
          detail: 'Client deletion response did not match the expected schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to delete client', {
      trainerId: authorization.trainerId,
      clientId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to delete client',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
