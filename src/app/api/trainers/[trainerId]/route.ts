import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { z } from 'zod'

import {
  brandColors,
  clientAppointmentReminderTypes,
  serviceProviderAppointmentReminderTypes,
} from '@/config/referenceData'
import { db, sql } from '@/lib/db'
import { isIsoDuration } from '@/lib/reminders'
import { getTrainerProfile } from '@/server/trainerProfile'
import { authenticateTrainerRequest, buildErrorResponse } from '../../_lib/accessToken'
import { parseStrictJsonBody } from '../../_lib/strictJson'
import { getStripeClient, STRIPE_API_VERSION } from '../../_lib/stripeClient'

type HandlerContext = RouteContext<'/api/trainers/[trainerId]'>

const shouldIncludeSessionSeries = (url: URL) => {
  const include = (value: string | null) => value?.trim().toLowerCase() ?? ''
  return (
    include(url.searchParams.get('filter[include]')) === 'sessionseries' ||
    include(url.searchParams.get('filter[include][relation]')) === 'sessionseries'
  )
}

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

const stripeApiVersionDate = STRIPE_API_VERSION.split('.')[0]

type BrandColor = (typeof brandColors)[number]
type ServiceProviderReminderType = (typeof serviceProviderAppointmentReminderTypes)[number]
type ClientReminderType = (typeof clientAppointmentReminderTypes)[number]

const isoDurationSchema = z
  .string()
  .trim()
  .refine((value) => isIsoDuration(value), {
    message: 'Duration must be an ISO 8601 duration (e.g. PT15M, P1D).',
  })

const brandColorSchema = z.enum([...brandColors] as [BrandColor, ...BrandColor[]])

const serviceProviderReminderSchema = z.object({
  type: z.enum([...serviceProviderAppointmentReminderTypes] as [
    ServiceProviderReminderType,
    ...ServiceProviderReminderType[],
  ]),
  timeBeforeStart: isoDurationSchema,
})

const clientReminderSchema = z.object({
  type: z.enum([...clientAppointmentReminderTypes] as [ClientReminderType, ...ClientReminderType[]]),
  timeBeforeStart: isoDurationSchema,
})

const nullableTrimmedString = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()
  .optional()

const updateTrainerBodySchema = z
  .object({
    firstName: z.string().trim().min(1, 'firstName is required').optional(),
    lastName: nullableTrimmedString,
    email: z.string().trim().email('Enter a valid email address').optional(),
    deviceId: z.string().trim().optional(),
    timezone: z.string().trim().min(1, 'timezone is required').optional(),
    locale: z.string().trim().min(1, 'locale is required').optional(),
    termsAccepted: z.boolean().optional(),
    businessName: nullableTrimmedString,
    businessLogoUrl: z.string().trim().url('businessLogoUrl must be a URL').nullable().optional(),
    coverImageUrl: z.string().trim().url('coverImageUrl must be a URL').nullable().optional(),
    bankAccount: z.string().trim().min(1, 'bankAccount token is required').optional(),
    brandColor: brandColorSchema.optional(),
    industry: nullableTrimmedString,
    defaultServiceProviderAppointmentReminder1: serviceProviderReminderSchema.nullable().optional(),
    defaultServiceProviderAppointmentReminder2: serviceProviderReminderSchema.nullable().optional(),
    defaultClientAppointmentReminder1: clientReminderSchema.nullable().optional(),
    defaultClientAppointmentReminder2: clientReminderSchema.nullable().optional(),
    defaultCanClientsCancelAppointment: z.boolean().optional(),
    defaultCancellationAdvanceNoticeDuration: isoDurationSchema.optional(),
  })
  .strict()

const invalidBodyResponse = (detail?: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid request body',
      detail: detail ?? 'Request body did not match the expected schema.',
      type: '/invalid-body',
    }),
    { status: 400 }
  )

const trainerNotFoundResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 404,
      title: 'Trainer not found',
      detail: 'No trainer exists for the authenticated token.',
      type: '/trainer-not-found',
    }),
    { status: 404 }
  )

const forbiddenTrainerResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 403,
      title: 'Forbidden',
      detail: 'Token does not match requested trainer.',
      type: '/forbidden',
    }),
    { status: 403 }
  )

const mustUploadImageResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'You must update the image url by uploading a new image',
      type: '/must-update-image-url-using-upload',
    }),
    { status: 400 }
  )

const emailAlreadyTakenResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 409,
      title: 'This email is already in use by an account.',
      type: '/email-already-taken',
    }),
    { status: 409 }
  )

const stripeAccountPendingResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 409,
      title: 'Stripe payments are not enabled for this trainer.',
      type: '/stripe-account-pending-creation',
    }),
    { status: 409 }
  )

const stripeConfigurationMissingResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Stripe configuration missing',
      detail: 'STRIPE_SECRET_KEY is not configured, so Stripe operations cannot be completed.',
      type: '/missing-stripe-configuration',
    }),
    { status: 500 }
  )

const tokenMustBeBankAccountResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Provided bank account token is not for a bank account.',
      type: '/token-must-be-bank-account',
    }),
    { status: 400 }
  )

const bankAccountCountryNotSupportedResponse = (country: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 409,
      title: `Bank account must be ${country.toUpperCase()} based.`,
      type: '/bank-account-country-not-supported',
    }),
    { status: 409 }
  )

const bankAccountCurrencyNotSupportedResponse = (currency: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 409,
      title: `Bank account currency must be in ${currency.toUpperCase()}.`,
      type: '/bank-account-currency-not-supported',
    }),
    { status: 409 }
  )

let clientReminderTypeCache: string[] | null = null

const loadClientReminderTypes = async () => {
  if (clientReminderTypeCache) {
    return clientReminderTypeCache
  }

  const rows = await db.selectFrom('client_appointment_reminder_type').select('type').execute()
  clientReminderTypeCache = rows.map((row) => row.type)
  return clientReminderTypeCache
}

const mapClientReminderTypeToDb = async (type: string | null | undefined) => {
  if (!type) {
    return sql`DEFAULT`
  }
  if (type !== 'emailAndSms') {
    return type
  }

  const allowed = await loadClientReminderTypes()
  if (allowed.includes('emailAndSms')) {
    return 'emailAndSms'
  }
  if (allowed.includes('email_and_sms')) {
    return 'email_and_sms'
  }
  return type
}

const normalizeDeviceId = (value: string | undefined) => (value === 'IOS-SIMULATOR' ? null : (value ?? undefined))

class StripeConfigurationMissingError extends Error {}
class TokenMustBeBankAccountError extends Error {}
class BankAccountCountryNotSupportedError extends Error {
  constructor(readonly country: string) {
    super(`Bank account must be ${country} based.`)
  }
}
class BankAccountCurrencyNotSupportedError extends Error {
  constructor(readonly currency: string) {
    super(`Bank account currency must be in ${currency}.`)
  }
}

const ensureStripeBankAccount = async (
  tokenId: string,
  stripeAccountId: string,
  options: { trainerId: string; expectedCountry?: string | null; expectedCurrency?: string | null }
) => {
  const stripeClient = getStripeClient()

  if (!stripeClient) {
    throw new StripeConfigurationMissingError()
  }

  const token = await stripeClient.tokens.retrieve(tokenId)

  if (token.type !== 'bank_account' || !token.bank_account) {
    throw new TokenMustBeBankAccountError()
  }

  const country = (token.bank_account.country ?? '').toUpperCase()
  const currency = (token.bank_account.currency ?? '').toUpperCase()

  if (options.expectedCountry && country !== options.expectedCountry.toUpperCase()) {
    throw new BankAccountCountryNotSupportedError(options.expectedCountry)
  }

  if (options.expectedCurrency && currency !== options.expectedCurrency.toUpperCase()) {
    throw new BankAccountCurrencyNotSupportedError(options.expectedCurrency)
  }

  const externalAccount = await stripeClient.accounts.createExternalAccount(stripeAccountId, {
    external_account: tokenId,
    default_for_currency: true,
  })

  if (externalAccount.object !== 'bank_account') {
    throw new TokenMustBeBankAccountError()
  }

  const { lastResponse: _ignored, ...bankAccount } = externalAccount as Stripe.BankAccount & { lastResponse?: unknown }

  await db
    .insertInto('stripe.bank_account')
    .values({
      id: bankAccount.id,
      api_version: sql<Date>`cast(${stripeApiVersionDate} as date)`,
      object: JSON.stringify(bankAccount),
    })
    .onConflict((oc) =>
      oc.column('id').doUpdateSet((eb) => ({
        api_version: eb.ref('excluded.api_version'),
        object: eb.ref('excluded.object'),
      }))
    )
    .execute()
}

export async function GET(request: NextRequest, context: HandlerContext) {
  void context

  const url = new URL(request.url)
  const filterValue = parseLegacyQueryValue(url.searchParams.get('filter'))

  let includeSessionSeries = false
  if (filterValue !== undefined) {
    if (!filterValue || typeof filterValue !== 'object' || Array.isArray(filterValue)) {
      return invalidParametersResponse('filter  should be Record<string, unknown>')
    }
    const includeValue = (filterValue as { include?: unknown }).include
    if (includeValue !== undefined) {
      if (typeof includeValue === 'string') {
        includeSessionSeries = includeValue.trim().toLowerCase() === 'sessionseries'
      } else if (includeValue && typeof includeValue === 'object' && !Array.isArray(includeValue)) {
        const relationValue = (includeValue as { relation?: unknown }).relation
        if (relationValue !== undefined && typeof relationValue !== 'string') {
          return invalidParametersResponse('filter.include.relation  should be string')
        }
        includeSessionSeries =
          typeof relationValue === 'string' && relationValue.trim().toLowerCase() === 'sessionseries'
      } else {
        return invalidParametersResponse('filter.include  should be string or  should be Record<string, unknown>')
      }
    }
  } else {
    includeSessionSeries = shouldIncludeSessionSeries(url)
  }

  const auth = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while fetching trainer profile',
  })

  if (!auth.ok) {
    return auth.response
  }

  try {
    const trainer = await getTrainerProfile(auth.trainerId, { includeSessionSeries })

    if (!trainer) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Trainer not found',
          detail: 'No trainer exists for the authenticated token.',
          type: '/trainer-not-found',
        }),
        { status: 404 }
      )
    }

    return NextResponse.json(trainer)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse trainer data from database',
          detail: 'Trainer data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch trainer profile', {
      trainerId: auth.trainerId,
      includeSessionSeries,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch trainer',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest, context: HandlerContext) {
  void context

  const includeSessionSeries = shouldIncludeSessionSeries(new URL(request.url))

  const auth = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while updating trainer profile',
  })

  if (!auth.ok) {
    return auth.response
  }

  let body: z.infer<typeof updateTrainerBodySchema>
  const parsed = await parseStrictJsonBody(request)
  if (!parsed.ok) {
    return parsed.response
  }

  const parsedBody = updateTrainerBodySchema.safeParse(parsed.data)

  if (!parsedBody.success) {
    const detail = parsedBody.error.issues.map((issue) => issue.message).join('; ')
    return invalidBodyResponse(detail)
  }

  body = parsedBody.data

  if (Object.keys(body).length === 0) {
    try {
      const trainer = await getTrainerProfile(auth.trainerId, { includeSessionSeries })

      if (!trainer) {
        return trainerNotFoundResponse()
      }

      return NextResponse.json(trainer)
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          buildErrorResponse({
            status: 500,
            title: 'Failed to parse trainer data from database',
            detail: 'Trainer data did not match the expected response schema.',
            type: '/invalid-response',
          }),
          { status: 500 }
        )
      }

      console.error('Failed to fetch trainer profile while handling empty PUT body', {
        trainerId: auth.trainerId,
        includeSessionSeries,
        error,
      })

      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to fetch trainer',
          type: '/internal-server-error',
        }),
        { status: 500 }
      )
    }
  }

  const trainerRow = await db
    .selectFrom('trainer')
    .innerJoin('country', 'country.id', 'trainer.country_id')
    .leftJoin('vw_legacy_trainer as v', 'v.id', 'trainer.id')
    .select((eb) => [
      eb.ref('trainer.id').as('id'),
      eb.ref('trainer.business_logo_url').as('businessLogoUrl'),
      eb.ref('trainer.cover_image_url').as('coverImageUrl'),
      eb.ref('trainer.stripe_account_id').as('stripeAccountId'),
      eb.ref('country.alpha_2_code').as('countryCode'),
      eb.ref('v.default_currency').as('defaultCurrency'),
    ])
    .where('trainer.id', '=', auth.trainerId)
    .executeTakeFirst()

  if (!trainerRow) {
    return trainerNotFoundResponse()
  }

  const parsedTrainerRow = z
    .object({
      id: z.string(),
      businessLogoUrl: z.string().nullable(),
      coverImageUrl: z.string().nullable(),
      stripeAccountId: z.string().nullable(),
      countryCode: z.string(),
      defaultCurrency: z.string().nullable(),
    })
    .safeParse(trainerRow)

  if (!parsedTrainerRow.success) {
    const detail = parsedTrainerRow.error.issues.map((issue) => issue.message).join('; ')
    console.error('Failed to parse trainer row for update', { trainerId: auth.trainerId, detail })
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

  const currentTrainer = parsedTrainerRow.data

  if (body.businessLogoUrl !== undefined && body.businessLogoUrl !== currentTrainer.businessLogoUrl) {
    return mustUploadImageResponse()
  }

  if (body.coverImageUrl !== undefined && body.coverImageUrl !== currentTrainer.coverImageUrl) {
    return mustUploadImageResponse()
  }

  if (body.email !== undefined) {
    const duplicate = await db
      .selectFrom('trainer')
      .select('id')
      .where(sql<boolean>`LOWER(email) = LOWER(${body.email})`)
      .where('id', '!=', auth.trainerId)
      .executeTakeFirst()

    if (duplicate) {
      return emailAlreadyTakenResponse()
    }
  }

  if (body.bankAccount !== undefined) {
    const stripeAccountId = currentTrainer.stripeAccountId

    if (!stripeAccountId) {
      return stripeAccountPendingResponse()
    }

    try {
      await ensureStripeBankAccount(body.bankAccount, stripeAccountId, {
        trainerId: auth.trainerId,
        expectedCountry: currentTrainer.countryCode,
        expectedCurrency: currentTrainer.defaultCurrency,
      })
    } catch (error) {
      if (error instanceof StripeConfigurationMissingError) {
        return stripeConfigurationMissingResponse()
      }

      if (error instanceof TokenMustBeBankAccountError) {
        return tokenMustBeBankAccountResponse()
      }

      if (error instanceof BankAccountCountryNotSupportedError) {
        return bankAccountCountryNotSupportedResponse(error.country)
      }

      if (error instanceof BankAccountCurrencyNotSupportedError) {
        return bankAccountCurrencyNotSupportedResponse(error.currency)
      }

      if (error instanceof Stripe.errors.StripeError) {
        console.error('Stripe API error while updating trainer bank account', {
          trainerId: auth.trainerId,
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

      console.error('Unexpected error while updating trainer bank account', {
        trainerId: auth.trainerId,
        error,
      })

      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to update bank account',
          type: '/internal-server-error',
        }),
        { status: 500 }
      )
    }
  }

  const updates: Record<string, unknown> = {}

  if (body.firstName !== undefined) {
    updates.first_name = body.firstName
  }
  if (body.lastName !== undefined) {
    updates.last_name = body.lastName ?? null
  }
  if (body.email !== undefined) {
    updates.email = body.email
  }

  if (body.deviceId !== undefined) {
    updates.last_ios_id_for_vendor = normalizeDeviceId(body.deviceId)
  }

  if (body.timezone !== undefined) {
    updates.timezone = body.timezone
  }
  if (body.locale !== undefined) {
    updates.locale = body.locale
  }
  if (body.termsAccepted !== undefined) {
    updates.terms_accepted = body.termsAccepted
  }
  if (body.businessName !== undefined) {
    updates.business_name = body.businessName
  }
  if (body.brandColor !== undefined) {
    updates.brand_color = body.brandColor
  }
  if (body.industry !== undefined) {
    updates.industry = body.industry
  }
  if (body.defaultCanClientsCancelAppointment !== undefined) {
    updates.default_can_clients_cancel_appointment = body.defaultCanClientsCancelAppointment
  }
  if (body.defaultCancellationAdvanceNoticeDuration !== undefined) {
    updates.default_cancellation_advance_notice_duration = body.defaultCancellationAdvanceNoticeDuration
  }

  if (body.defaultServiceProviderAppointmentReminder1 !== undefined) {
    updates.default_service_provider_appointment_reminder_1 =
      body.defaultServiceProviderAppointmentReminder1?.timeBeforeStart ?? null
    updates.default_service_provider_appointment_reminder_1_type =
      body.defaultServiceProviderAppointmentReminder1?.type ?? sql`DEFAULT`
  }

  if (body.defaultServiceProviderAppointmentReminder2 !== undefined) {
    updates.default_service_provider_appointment_reminder_2 =
      body.defaultServiceProviderAppointmentReminder2?.timeBeforeStart ?? null
    updates.default_service_provider_appointment_reminder_2_type =
      body.defaultServiceProviderAppointmentReminder2?.type ?? sql`DEFAULT`
  }

  if (body.defaultClientAppointmentReminder1 !== undefined) {
    updates.default_client_appointment_reminder_1 = body.defaultClientAppointmentReminder1?.timeBeforeStart ?? null
    updates.default_client_appointment_reminder_1_type = await mapClientReminderTypeToDb(
      body.defaultClientAppointmentReminder1?.type ?? null
    )
  }

  if (body.defaultClientAppointmentReminder2 !== undefined) {
    updates.default_client_appointment_reminder_2 = body.defaultClientAppointmentReminder2?.timeBeforeStart ?? null
    updates.default_client_appointment_reminder_2_type = await mapClientReminderTypeToDb(
      body.defaultClientAppointmentReminder2?.type ?? null
    )
  }

  if (Object.keys(updates).length > 0) {
    try {
      const updated = await db
        .updateTable('trainer')
        .set(updates)
        .where('id', '=', auth.trainerId)
        .returning('id')
        .executeTakeFirst()

      if (!updated) {
        return trainerNotFoundResponse()
      }
    } catch (error) {
      console.error('Failed to update trainer profile', { trainerId: auth.trainerId, updates, error })
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to update trainer',
          type: '/internal-server-error',
        }),
        { status: 500 }
      )
    }
  }

  try {
    const trainer = await getTrainerProfile(auth.trainerId, { includeSessionSeries })

    if (!trainer) {
      return trainerNotFoundResponse()
    }

    return NextResponse.json(trainer)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse trainer data from database',
          detail: 'Trainer data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch trainer profile after update', {
      trainerId: auth.trainerId,
      includeSessionSeries,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch trainer',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
