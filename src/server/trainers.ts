import { randomUUID } from 'node:crypto'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import { AppleSignInError, verifyAppleIdentityToken } from '../app/api/_lib/appleSignIn'
import { brandColors } from '@/config/referenceData'
import type { Transaction } from 'kysely'
import type { DB } from '@/lib/db'

type BrandColorName = (typeof brandColors)[number]

const DEFAULT_BRAND_COLOR: BrandColorName = 'blue'
const BANNED_COUNTRIES = new Set(['NG', 'CN', 'IN'])
const FALLBACK_TRIAL_DURATION = 14 * 24 * 60 * 60 * 1000

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
    return FALLBACK_TRIAL_DURATION
  }

  const parts = parsed.data.split(/\s+/)
  let total = 0
  for (let i = 0; i < parts.length; i += 2) {
    const value = Number.parseInt(parts[i] ?? '0', 10)
    const unit = (parts[i + 1] ?? '').toLowerCase()
    const multiplier = unit.startsWith('second')
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
      return FALLBACK_TRIAL_DURATION
    }

    total += value * multiplier
  }

  return total || FALLBACK_TRIAL_DURATION
})()

const nullableTrimmedString = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()
  .optional()

const brandColorSchema = z.enum(brandColors as unknown as [BrandColorName, ...BrandColorName[]]).optional()

const baseSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required'),
  lastName: nullableTrimmedString,
  country: z
    .string()
    .trim()
    .length(2, 'Country must be a 2-letter ISO code')
    .transform((value) => value.toUpperCase()),
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
  signInWithAppleIdentityToken: z.string().trim().min(1, 'Sign in with Apple identity token is required'),
  signInWithAppleNonce: z.string().trim().min(1).optional(),
})

export const trainerSignupSchema = z.union([passwordSignupSchema, appleSignupSchema])

export type TrainerSignupInput = z.infer<typeof trainerSignupSchema>

const APPLE_AUDIENCE = process.env.APPLE_CLIENT_ID ?? process.env.IOS_BUNDLE_ID ?? null

type SeedDefaultsParams = {
  trx: Transaction<DB>
  trainerId: string
  email: string
  timezone: string
  currencyId: number
}

const defaultServices = [
  {
    name: 'Consultation',
    description: 'This is a test service. Book in to see how online bookings works!',
    price: 0,
    durationMinutes: 30,
    location: 'Victoria Square / Tarntanyangga',
    address: 'Grote St, Adelaide SA 5000',
    googlePlaceId: 'ChIJVeCrXdjOsGoRMEC6RVU2Aw8',
    geo: { lat: -34.92813189936252, lng: 138.59992296839098 },
  },
  {
    name: 'Appointment',
    description: 'This is a test service. Book in to see how online bookings works!',
    price: 60,
    durationMinutes: 45,
    location: 'Victoria Square / Tarntanyangga',
    address: 'Grote St, Adelaide SA 5000',
    googlePlaceId: 'ChIJVeCrXdjOsGoRMEC6RVU2Aw8',
    geo: { lat: -34.92813189936252, lng: 138.59992296839098 },
  },
]

const formatMoney = (value: number) => value.toFixed(2)

const seedTrainerDefaults = async ({ trx, trainerId, email, timezone, currencyId }: SeedDefaultsParams) => {
  // Reward + missions
  const rewardRow = await trx
    .insertInto('reward')
    .values({ trainer_id: trainerId, type: '2TextCredits' })
    .returning('id')
    .executeTakeFirst()

  const missionRows = [
    {
      trainer_id: trainerId,
      id: 'createInitialData',
      reward_id: rewardRow?.id ?? null,
      completed_at: new Date(),
      display_order: 0,
    },
    { trainer_id: trainerId, id: 'enableNotifications', reward_id: null, completed_at: null, display_order: 1 },
    { trainer_id: trainerId, id: 'createOnlineBooking', reward_id: null, completed_at: null, display_order: 2 },
    { trainer_id: trainerId, id: 'completeStripeVerification', reward_id: null, completed_at: null, display_order: 3 },
    { trainer_id: trainerId, id: 'createActiveSubscription', reward_id: null, completed_at: null, display_order: 4 },
  ]

  await trx.insertInto('mission').values(missionRows).execute()

  // Default products and services
  for (const [index, service] of defaultServices.entries()) {
    const serviceId = randomUUID()
    await trx
      .insertInto('product')
      .values({
        id: serviceId,
        trainer_id: trainerId,
        name: service.name,
        description: service.description,
        price: formatMoney(service.price),
        currency_id: currencyId,
        is_credit_pack: null,
        is_item: null,
        is_service: true,
        is_membership: null,
        display_order: index,
      })
      .execute()

    await trx
      .insertInto('service')
      .values({
        id: serviceId,
        trainer_id: trainerId,
        duration: sql`make_interval(mins := ${service.durationMinutes})`,
        location: service.location,
        address: service.address,
        google_place_id: service.googlePlaceId,
        geo: sql`point(${service.geo.lat}, ${service.geo.lng})`,
        bookable_online: true,
        booking_payment_type: 'noPrepayment',
        is_service: true,
      })
      .execute()
  }

  const packProductId = randomUUID()
  await trx
    .insertInto('product')
    .values({
      id: packProductId,
      trainer_id: trainerId,
      name: '12 Session Pack',
      description:
        "Sell this credit pack to a client. You can then use it as a payment option. We'll keep track of how many credits they've used up.",
      price: '120.00',
      currency_id: currencyId,
      is_credit_pack: true,
      is_item: null,
      is_service: null,
      is_membership: null,
      display_order: defaultServices.length,
    })
    .execute()

  await trx
    .insertInto('credit_pack')
    .values({
      id: packProductId,
      trainer_id: trainerId,
      total_credits: 12,
      is_credit_pack: true,
    })
    .execute()

  // Default client
  const clientUser = await trx.insertInto('user_').values({ type: 'client' }).returning('id').executeTakeFirst()
  if (!clientUser?.id) {
    throw new Error('clientUserCreateFailed')
  }

  const clientRow = await trx
    .insertInto('client')
    .values({
      user_id: clientUser.id,
      user_type: 'client',
      email,
      first_name: 'Test',
      last_name: 'Client',
      status: 'current',
      trainer_id: trainerId,
    })
    .returning('id')
    .executeTakeFirst()

  if (!clientRow?.id) {
    throw new Error('clientCreateFailed')
  }

  // Sample sessions
  const now = Date.now()
  const sessionSeriesData = [
    {
      id: randomUUID(),
      eventType: 'single_session',
      name: 'Example Appointment',
      start: new Date(now + 11 * 60 * 1000),
      price: '50.00',
    },
    {
      id: randomUUID(),
      eventType: 'group_session',
      name: 'Example Group Appointment',
      start: new Date(now + 41 * 60 * 1000),
      price: '50.00',
    },
  ] as const

  for (const series of sessionSeriesData) {
    await trx
      .insertInto('session_series')
      .values({
        id: series.id,
        trainer_id: trainerId,
        event_type: series.eventType,
        duration: sql`make_interval(mins := ${30})`,
        start: series.start,
        end_: null,
        daily_recurrence_interval: null,
        location: 'Area 51',
        timezone,
        price: series.price,
        name: series.name,
        color: null,
        session_icon_id: null,
        icon_url: null,
      })
      .execute()

    const sessionId = await trx
      .insertInto('session')
      .values({
        session_series_id: series.id,
        trainer_id: trainerId,
        start: series.start,
        duration: sql`make_interval(mins := ${30})`,
        timezone,
        location: 'Area 51',
        address: 'Nevada, USA',
        geo: sql`point(${37.2514874}, ${-115.8043178})`,
        google_place_id: 'ChIJgYw-uqobuIARrjdijuMnBJc',
      })
      .returning('id')
      .executeTakeFirst()

    if (sessionId?.id) {
      await trx
        .insertInto('client_session')
        .values({
          client_id: clientRow.id,
          session_id: sessionId.id,
          trainer_id: trainerId,
          price: series.price,
        })
        .execute()
    }
  }
}

export async function createTrainerAccount(input: TrainerSignupInput) {
  const parsed = trainerSignupSchema.parse(input)

  if (BANNED_COUNTRIES.has(parsed.country)) {
    throw new Error('countryNotSupported')
  }

  let email: string
  let appleUserId: string | null = null

  if ('signInWithAppleIdentityToken' in parsed) {
    if (!APPLE_AUDIENCE) {
      throw new Error('appleNotConfigured')
    }

    try {
      const identity = await verifyAppleIdentityToken(parsed.signInWithAppleIdentityToken, {
        expectedAudience: APPLE_AUDIENCE,
        expectedNonce: parsed.signInWithAppleNonce,
      })
      email = identity.email
      appleUserId = identity.userId
    } catch (error) {
      if (error instanceof AppleSignInError) {
        throw new Error('appleTokenInvalid')
      }
      throw error
    }
  } else {
    email = parsed.email
  }

  if (email.toLowerCase().endsWith('@mailinator.com')) {
    throw new Error('emailInvalid')
  }

  const brandColor: BrandColorName = parsed.brandColor ?? DEFAULT_BRAND_COLOR

  const result = await db.transaction().execute(async (trx) => {
    const countryRow = await trx
      .selectFrom('country')
      .select(['id', 'alpha_2_code'])
      .where('alpha_2_code', '=', parsed.country)
      .executeTakeFirst()

    if (!countryRow) {
      throw new Error('unsupportedCountry')
    }

    const currencyRow = await trx
      .selectFrom('supported_country_currency')
      .select(['currency_id'])
      .where('country_id', '=', countryRow.id)
      .executeTakeFirst()

    if (!currencyRow) {
      throw new Error('unsupportedCountry')
    }

    const emailExists = await trx.selectFrom('trainer').select('id').where('email', '=', email).executeTakeFirst()

    if (emailExists) {
      throw new Error('emailTaken')
    }

    if (appleUserId) {
      const appleLinked = await trx
        .selectFrom('trainer')
        .select('id')
        .where('sign_in_with_apple_user_id', '=', appleUserId)
        .executeTakeFirst()

      if (appleLinked) {
        throw new Error('appleLinked')
      }
    }

    const userRow = await trx.insertInto('user_').values({ type: 'trainer' }).returning('id').executeTakeFirst()

    if (!userRow) {
      throw new Error('userCreateFailed')
    }

    const userId = userRow.id
    const passwordToHash = 'password' in parsed ? parsed.password : randomUUID()

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
          ${parsed.firstName},
          ${parsed.lastName ?? null},
          ${parsed.phone ?? null},
          ${parsed.timezone},
          ${parsed.locale},
          false,
          true,
          ${appleUserId},
          ${parsed.businessName ?? null},
          ${parsed.industry ?? null},
          ${brandColor},
          ${parsed.partner ?? null},
          null
        )
        RETURNING id, online_bookings_page_url_slug
      `.execute(trx)

    const trainer = trainerInsert.rows[0]
    if (!trainer) {
      throw new Error('trainerCreateFailed')
    }

    // Insert trial
    const defaultTrialDuration = defaultTrialDurationMs
    const now = new Date()
    await sql`
        INSERT INTO trial (trainer_id, start_time, end_time)
        VALUES (${trainer.id}, ${now}, ${new Date(now.getTime() + defaultTrialDuration)})
      `.execute(trx)

    const tokenResult = await sql<{ accessToken: string }>`
        INSERT INTO access_token (user_id, user_type, expires_at, type)
        VALUES (
          ${userId},
          'trainer',
          NOW() + INTERVAL '14 days',
          'api'
        )
        RETURNING id AS "accessToken"
      `.execute(trx)

    const tokenRow = tokenResult.rows[0]
    if (!tokenRow) {
      throw new Error('tokenCreateFailed')
    }

  await seedTrainerDefaults({
    trx,
    trainerId: trainer.id,
    email,
    timezone: parsed.timezone,
    currencyId: currencyRow.currency_id,
  })

    return {
      id: tokenRow.accessToken,
      userId,
      trainerId: trainer.id,
      onlineBookingsPageUrlSlug: trainer.onlineBookingsPageUrlSlug,
    }
  })

  return result
}
