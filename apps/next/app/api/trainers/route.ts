import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { db, sql, type Point } from '@keepon/db'
import { z } from 'zod'

import { buildErrorResponse } from '../_lib/accessToken'
import {
  AppleSignInError,
  verifyAppleIdentityToken,
} from '../_lib/appleSignIn'

export const runtime = 'nodejs'

const DEFAULT_BRAND_COLOR = '#3b82f6'
const BANNED_COUNTRIES = new Set(['NG', 'CN', 'IN'])

const defaultServices = [
  {
    name: 'Consultation',
    description: 'This is a test service. Book in to see how online bookings works!',
    price: '0.00',
    durationMinutes: 30,
    location: 'Victoria Square / Tarntanyangga',
    address: 'Grote St, Adelaide SA 5000',
    googlePlaceId: 'ChIJVeCrXdjOsGoRMEC6RVU2Aw8',
    geo: { lat: -34.92813189936252, lng: 138.59992296839098 },
  },
  {
    name: 'Appointment',
    description: 'This is a test service. Book in to see how online bookings works!',
    price: '60.00',
    durationMinutes: 45,
    location: 'Victoria Square / Tarntanyangga',
    address: 'Grote St, Adelaide SA 5000',
    googlePlaceId: 'ChIJVeCrXdjOsGoRMEC6RVU2Aw8',
    geo: { lat: -34.92813189936252, lng: 138.59992296839098 },
  },
]

const FALLBACK_TRIAL_DURATION = 14 * 24 * 60 * 60 * 1000 // 14 days in ms

const intervalLiteral = z
  .string()
  .trim()
  .regex(
    /^(?:[0-9]+\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?))(?:\s+[0-9]+\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?))*$/i,
    'DEFAULT_TRIAL_DURATION must be a valid interval literal, e.g. "14 days".'
  )

const defaultTrialDurationMs = (() => {
  const raw = process.env.DEFAULT_TRIAL_DURATION
  if (!raw) return FALLBACK_TRIAL_DURATION
  const parsed = intervalLiteral.safeParse(raw)
  if (!parsed.success) {
    console.warn(
      'DEFAULT_TRIAL_DURATION is invalid, falling back to 14 days.',
      parsed.error.issues.map(issue => issue.message).join('; ')
    )
    return FALLBACK_TRIAL_DURATION
  }

  const parts = parsed.data.split(/\s+/)
  let total = 0
  for (let i = 0; i < parts.length; i += 2) {
    const value = Number.parseInt(parts[i] ?? '0', 10)
    const unit = (parts[i + 1] ?? '').toLowerCase()
    const multiplier =
      unit.startsWith('second')
        ? 1000
        : unit.startsWith('minute')
          ? 60 * 1000
          : unit.startsWith('hour')
            ? 60 * 60 * 1000
            : unit.startsWith('day')
              ? 24 * 60 * 60 * 1000
              : unit.startsWith('week')
                ? 7 * 24 * 60 * 60 * 1000
                : unit.startsWith('month')
                  ? 30 * 24 * 60 * 60 * 1000
                  : unit.startsWith('year')
                    ? 365 * 24 * 60 * 60 * 1000
                    : 0

    if (!Number.isFinite(value) || multiplier === 0) {
      console.warn('Unsupported interval unit in DEFAULT_TRIAL_DURATION:', unit)
      return FALLBACK_TRIAL_DURATION
    }

    total += value * multiplier
  }

  return total || FALLBACK_TRIAL_DURATION
})()

const nullableTrimmedString = z
  .string()
  .trim()
  .transform(value => (value.length === 0 ? null : value))
  .nullable()
  .optional()

const brandColorSchema = z
  .string()
  .trim()
  .regex(/^#?[0-9a-fA-F]{6}$/)
  .optional()

const baseSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required'),
  lastName: nullableTrimmedString,
  country: z
    .string()
    .trim()
    .length(2, 'Country must be a 2-letter ISO code')
    .transform(value => value.toUpperCase()),
  timezone: z.string().trim().min(1, 'Timezone is required'),
  locale: z.string().trim().min(1, 'Locale is required'),
  businessName: nullableTrimmedString,
  industry: nullableTrimmedString,
  phone: nullableTrimmedString,
  brandColor: brandColorSchema,
  partner: nullableTrimmedString,
})

const passwordSignupSchema = baseSchema.extend({
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(5, 'Password must be at least 5 characters'),
})

const appleSignupSchema = baseSchema.extend({
  signInWithAppleIdentityToken: z
    .string()
    .trim()
    .min(1, 'Sign in with Apple identity token is required'),
  signInWithAppleNonce: z.string().trim().min(1).optional(),
})

const requestSchema = z.union([passwordSignupSchema, appleSignupSchema])

const responseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  trainerId: z.string(),
})

const invalidJsonResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid JSON payload',
      detail: 'Request body must be valid JSON.',
      type: '/invalid-json',
    }),
    { status: 400 }
  )

const invalidBodyResponse = (detail?: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid request body',
      detail: detail || 'Request body did not match the expected schema.',
      type: '/invalid-body',
    }),
    { status: 400 }
  )

const appleSignInNotConfiguredResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Apple sign-in is not configured',
      detail:
        'APPLE_CLIENT_ID or IOS_BUNDLE_ID must be set to enable sign in with Apple.',
      type: '/apple-sign-in-not-configured',
    }),
    { status: 500 }
  )

const signInWithAppleTokenInvalidResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Sign in with Apple token could not be verified.',
      type: '/sign-in-with-apple-token-invalid',
    }),
    { status: 400 }
  )

const emailAlreadyTakenResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 409,
      title: 'An account with that email already exists.',
      type: '/email-already-taken',
    }),
    { status: 409 }
  )

const appleAlreadyLinkedResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 409,
      title: 'That Apple account is already linked to a Keepon user.',
      type: '/apple-id-already-linked',
    }),
    { status: 409 }
  )

const countryNotSupportedResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Keepon is not available in your country yet.',
      type: '/country-not-supported',
    }),
    { status: 400 }
  )

const emailFakeOrInvalidResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Please use a real email address.',
      type: '/email-fake-or-invalid',
    }),
    { status: 400 }
  )

const internalErrorResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Failed to create account',
      type: '/internal-server-error',
    }),
    { status: 500 }
  )

const APPLE_AUDIENCE =
  process.env.APPLE_CLIENT_ID ?? process.env.IOS_BUNDLE_ID ?? null

type ParsedRequest = z.infer<typeof requestSchema>

export async function POST(request: Request) {
  let parsedBody: ParsedRequest

  try {
    const rawBody = (await request.json()) as unknown
    const validation = requestSchema.safeParse(rawBody)

    if (!validation.success) {
      const detail = validation.error.issues
        .map(issue => issue.message)
        .join('; ')
      return invalidBodyResponse(detail || undefined)
    }

    parsedBody = validation.data
  } catch (error) {
    console.error('Failed to parse trainer signup request body as JSON', error)
    return invalidJsonResponse()
  }

  const country = parsedBody.country
  if (BANNED_COUNTRIES.has(country)) {
    return countryNotSupportedResponse()
  }

  let email: string
  let appleUserId: string | null = null

  if ('signInWithAppleIdentityToken' in parsedBody) {
    if (!APPLE_AUDIENCE) {
      return appleSignInNotConfiguredResponse()
    }

    try {
      const identity = await verifyAppleIdentityToken(
        parsedBody.signInWithAppleIdentityToken,
        {
          expectedAudience: APPLE_AUDIENCE,
          expectedNonce: parsedBody.signInWithAppleNonce,
        }
      )
      email = identity.email
      appleUserId = identity.userId
    } catch (error) {
      if (error instanceof AppleSignInError) {
        console.warn('Failed to verify Sign in with Apple identity token', {
          code: error.code,
          message: error.message,
        })
        return signInWithAppleTokenInvalidResponse()
      }

      console.error('Unexpected error verifying Sign in with Apple token', error)
      return signInWithAppleTokenInvalidResponse()
    }
  } else {
    email = parsedBody.email
  }

  if (email.toLowerCase().endsWith('@mailinator.com')) {
    return emailFakeOrInvalidResponse()
  }

  const brandColor = parsedBody.brandColor
    ? parsedBody.brandColor.startsWith('#')
      ? parsedBody.brandColor.toLowerCase()
      : `#${parsedBody.brandColor.toLowerCase()}`
    : DEFAULT_BRAND_COLOR

  try {
    const result = await db.transaction().execute(async trx => {
      const countryRow = await trx
        .selectFrom('country')
        .select(['id', 'alpha_2_code'])
        .where('alpha_2_code', '=', country)
        .executeTakeFirst()

      if (!countryRow) {
        return { ok: false as const, reason: 'unsupportedCountry' as const }
      }

      const currencyRow = await trx
        .selectFrom('supported_country_currency')
        .select(['currency_id'])
        .where('country_id', '=', countryRow.id)
        .executeTakeFirst()

      if (!currencyRow) {
        return { ok: false as const, reason: 'unsupportedCountry' as const }
      }

      const emailExists = await trx
        .selectFrom('trainer')
        .select('id')
        .where('email', '=', email)
        .executeTakeFirst()

      if (emailExists) {
        return { ok: false as const, reason: 'emailTaken' as const }
      }

      if (appleUserId) {
        const appleLinked = await trx
          .selectFrom('trainer')
          .select('id')
          .where('sign_in_with_apple_user_id', '=', appleUserId)
          .executeTakeFirst()

        if (appleLinked) {
          return { ok: false as const, reason: 'appleLinked' as const }
        }
      }

      const userRow = await trx
        .insertInto('user_')
        .values({ type: 'trainer' })
        .returning('id')
        .executeTakeFirst()

      if (!userRow) {
        throw new Error('Failed to create user record for trainer')
      }

      const userId = userRow.id
      const passwordToHash =
        'password' in parsedBody ? parsedBody.password : randomUUID()

      const trainerInsert = await sql<{
        id: string
        onlineBookingsPageUrlSlug: string
      }>`
        INSERT INTO trainer (
          user_id,
          user_type,
          country_id,
          email,
          password_hash,
          first_name,
          last_name,
          phone_number,
          timezone,
          locale,
          eligible_for_grandfather,
          terms_accepted,
          sign_in_with_apple_user_id,
          business_name,
          industry,
          brand_color,
          partner,
          first_user_agent
        ) VALUES (
          ${userId},
          'trainer',
          ${countryRow.id},
          ${email},
          crypt(${passwordToHash}, gen_salt('bf', 10)),
          ${parsedBody.firstName},
          ${parsedBody.lastName ?? null},
          ${parsedBody.phone ?? null},
          ${parsedBody.timezone},
          ${parsedBody.locale},
          FALSE,
          TRUE,
          ${appleUserId ?? null},
          ${parsedBody.businessName ?? null},
          ${parsedBody.industry ?? null},
          ${brandColor},
          ${parsedBody.partner ?? null},
          ${request.headers.get('user-agent')}
        )
        RETURNING id, online_bookings_page_url_slug AS "onlineBookingsPageUrlSlug"
      `.execute(trx)

      const trainerRow = trainerInsert.rows[0]
      if (!trainerRow) {
        throw new Error('Failed to create trainer record')
      }

      const trainerId = trainerRow.id

      await trx
        .insertInto('survey')
        .values({
          trainer_id: trainerId,
          features: [],
          industry: parsedBody.industry ?? null,
          topics_to_improve: [],
          years_experience: null,
        })
        .execute()

      const serviceIds = defaultServices.map(() => randomUUID())
      const creditPackId = randomUUID()

      await trx
        .insertInto('product')
        .values([
          ...defaultServices.map((service, index) => ({
            id: serviceIds[index],
            is_service: true,
            is_credit_pack: null,
            is_item: null,
            is_membership: null,
            name: service.name,
            description: service.description,
            price: service.price,
            trainer_id: trainerId,
            currency_id: currencyRow.currency_id,
            display_order: null,
          })),
          {
            id: creditPackId,
            is_service: null,
            is_credit_pack: true,
            is_item: null,
            is_membership: null,
            name: '12 Session Pack',
            description:
              "Sell this credit pack to a client. You can then use it as a payment option. We'll keep track of how many credits they have used.",
            price: '120.00',
            trainer_id: trainerId,
            currency_id: currencyRow.currency_id,
            display_order: null,
          },
        ])
        .execute()

      await trx
        .insertInto('service')
        .values(
          defaultServices.map((service, index) => ({
            id: serviceIds[index],
            trainer_id: trainerId,
            duration: `${service.durationMinutes} minutes`,
            location: service.location,
            address: service.address,
            google_place_id: service.googlePlaceId,
            geo: sql<Point>`point(${service.geo.lat}, ${service.geo.lng})`,
            bookable_online: true,
          }))
        )
        .execute()

      await trx
        .insertInto('credit_pack')
        .values({
          id: creditPackId,
          trainer_id: trainerId,
          total_credits: 12,
        })
        .execute()

      const rewardType = await trx
        .selectFrom('reward_type')
        .select('type')
        .where('type', '=', '2TextCredits')
        .executeTakeFirst()

      let rewardId: string | null = null
      if (rewardType) {
        const rewardRow = await trx
          .insertInto('reward')
          .values({ trainer_id: trainerId, type: '2TextCredits' })
          .returning('id')
          .executeTakeFirst()

        rewardId = rewardRow?.id ?? null
      }

      const missionIds = [
        'createInitialData',
        'enableNotifications',
        'createOnlineBooking',
        'completeStripeVerification',
        'createActiveSubscription',
      ] as const

      const availableMissionTypes = await trx
        .selectFrom('mission_type')
        .select('id')
        .where('id', 'in', missionIds as unknown as string[])
        .execute()

      const missionTypeSet = new Set(availableMissionTypes.map(row => row.id))

      const missionsToInsert = [
        {
          id: 'createInitialData',
          trainer_id: trainerId,
          reward_id: rewardId,
          completed_at: rewardId ? sql<Date>`NOW()` : null,
          display_order: 0,
        },
        {
          id: 'enableNotifications',
          trainer_id: trainerId,
          reward_id: null,
          completed_at: null,
          display_order: 1,
        },
        {
          id: 'createOnlineBooking',
          trainer_id: trainerId,
          reward_id: null,
          completed_at: null,
          display_order: 2,
        },
        {
          id: 'completeStripeVerification',
          trainer_id: trainerId,
          reward_id: null,
          completed_at: null,
          display_order: 3,
        },
        {
          id: 'createActiveSubscription',
          trainer_id: trainerId,
          reward_id: null,
          completed_at: null,
          display_order: 4,
        },
      ].filter(mission => missionTypeSet.has(mission.id))

      if (missionsToInsert.length > 0) {
        await trx.insertInto('mission').values(missionsToInsert).execute()
      }

      const start = new Date()
      const trialStart = start
      const trialEnd = new Date(trialStart.getTime() + defaultTrialDurationMs)

      await trx
        .insertInto('trial')
        .values({
          trainer_id: trainerId,
          start_time: trialStart,
          end_time: trialEnd,
        })
        .execute()

      const clientUser = await trx
        .insertInto('user_')
        .values({ type: 'client' })
        .returning('id')
        .executeTakeFirst()

      if (!clientUser) {
        throw new Error('Failed to create sample client user')
      }

      const clientRow = await trx
        .insertInto('client')
        .values({
          user_id: clientUser.id,
          trainer_id: trainerId,
          email,
          first_name: 'Test',
          last_name: 'Client',
          status: 'current',
        })
        .returning('id')
        .executeTakeFirst()

      const clientId = clientRow?.id

      const sessionSeriesRows = await sql<{
        id: string
        start: Date
      }>`
        INSERT INTO session_series (
          trainer_id,
          event_type,
          name,
          duration,
          start,
          timezone,
          price,
          color,
          daily_recurrence_interval,
          end_,
          icon_url,
          location,
          session_icon_id
        ) VALUES
        (
          ${trainerId},
          'single_session',
          'Example Appointment',
          '30 minutes',
          ${new Date(Date.now() + 11 * 60 * 1000)},
          ${parsedBody.timezone},
          '50.00',
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL
        ),
        (
          ${trainerId},
          'group_session',
          'Example Group Appointment',
          '30 minutes',
          ${new Date(Date.now() + 41 * 60 * 1000)},
          ${parsedBody.timezone},
          '50.00',
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL
        )
        RETURNING id, start
      `.execute(trx)

      if (sessionSeriesRows.rows.length < 2) {
        throw new Error('Failed to create sample session series')
      }

      const seriesIds = sessionSeriesRows.rows.map(row => row.id)

      const sessionRows = await sql<{ id: string }>`
        INSERT INTO session (
          session_series_id,
          trainer_id,
          start,
          duration,
          timezone,
          location,
          address,
          google_place_id,
          booking_question,
          booking_question_state,
          geo,
          maximum_attendance,
          note,
          request_client_address_online,
          service_id,
          description,
          client_reminder_1,
          client_reminder_2,
          service_provider_reminder_1,
          service_provider_reminder_2
        ) VALUES
        (
          ${seriesIds[0]},
          ${trainerId},
          ${new Date(Date.now() + 11 * 60 * 1000)},
          '30 minutes',
          ${parsedBody.timezone},
          'Area 51',
          'Nevada, USA',
          'ChIJgYw-uqobuIARrjdijuMnBJc',
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL
        ),
        (
          ${seriesIds[1]},
          ${trainerId},
          ${new Date(Date.now() + 41 * 60 * 1000)},
          '30 minutes',
          ${parsedBody.timezone},
          'Area 51',
          'Nevada, USA',
          'ChIJgYw-uqobuIARrjdijuMnBJc',
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL
        )
        RETURNING id
      `.execute(trx)

      if (sessionRows.rows.length < 2) {
        throw new Error('Failed to create sample sessions')
      }

      if (clientId) {
        const [firstSession, secondSession] = sessionRows.rows

        if (!firstSession || !secondSession) {
          throw new Error('Failed to create sample sessions for client')
        }

        await sql`
          INSERT INTO client_session (
            client_id,
            session_id,
            trainer_id,
            price,
            booking_question,
            booking_question_response,
            note,
            sale_id,
            accept_time,
            cancel_time,
            decline_time,
            invite_time,
            confirm_time,
            cancel_reason,
            booking_icalendar_url
          ) VALUES
          (
            ${clientId},
            ${firstSession.id},
            ${trainerId},
            '50.00',
            NULL,
            NULL,
            NULL,
            NULL,
            NULL,
            NULL,
            NULL,
            NULL,
            NULL,
            NULL,
            NULL
          ),
          (
            ${clientId},
            ${secondSession.id},
            ${trainerId},
            '50.00',
            NULL,
            NULL,
            NULL,
            NULL,
            NULL,
            NULL,
            NULL,
            NULL,
            NULL,
            NULL,
            NULL
          )
        `.execute(trx)
      }

      // Stripe account creation is intentionally deferred; a background worker can attach it later.

      const tokenRow = await sql<{ accessToken: string }>`
        INSERT INTO access_token (user_id, user_type, expires_at, type)
        VALUES (${userId}, 'trainer', NOW() + INTERVAL '14 days', 'api')
        RETURNING id AS "accessToken"
      `.execute(trx)

      const accessToken = tokenRow.rows[0]?.accessToken
      if (!accessToken) {
        throw new Error('Failed to create access token for trainer signup')
      }

      return {
        ok: true as const,
        trainerId,
        userId,
        accessToken,
      }
    })

    if (!result.ok) {
      if (result.reason === 'emailTaken') {
        return emailAlreadyTakenResponse()
      }
      if (result.reason === 'appleLinked') {
        return appleAlreadyLinkedResponse()
      }
      return countryNotSupportedResponse()
    }

    const responseBody = responseSchema.parse({
      id: result.accessToken,
      userId: result.userId,
      trainerId: result.trainerId,
    })

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to build trainer signup response',
          detail: 'Response did not match the expected schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to create trainer account', {
      email,
      appleUserId,
      error,
    })

    return internalErrorResponse()
  }
}
