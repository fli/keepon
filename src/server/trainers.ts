import { randomUUID } from 'node:crypto'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import {
  AppleSignInError,
  verifyAppleIdentityToken,
} from '../app/api/_lib/appleSignIn'

const DEFAULT_BRAND_COLOR = '#3b82f6'
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

export const trainerSignupSchema = z.union([passwordSignupSchema, appleSignupSchema])

export type TrainerSignupInput = z.infer<typeof trainerSignupSchema>

const APPLE_AUDIENCE =
  process.env.APPLE_CLIENT_ID ?? process.env.IOS_BUNDLE_ID ?? null

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
      const identity = await verifyAppleIdentityToken(
        parsed.signInWithAppleIdentityToken,
        {
          expectedAudience: APPLE_AUDIENCE,
          expectedNonce: parsed.signInWithAppleNonce,
        }
      )
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

  const brandColor = parsed.brandColor
    ? parsed.brandColor.startsWith('#')
      ? parsed.brandColor.toLowerCase()
      : `#${parsed.brandColor.toLowerCase()}`
    : DEFAULT_BRAND_COLOR

  const result = await db.transaction().execute(async trx => {
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

    const emailExists = await trx
      .selectFrom('trainer')
      .select('id')
      .where('email', '=', email)
      .executeTakeFirst()

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

    const userRow = await trx
      .insertInto('user_')
      .values({ type: 'trainer' })
      .returning('id')
      .executeTakeFirst()

    if (!userRow) {
      throw new Error('userCreateFailed')
    }

    const userId = userRow.id
    const passwordToHash =
      'password' in parsed ? parsed.password : randomUUID()

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

    return {
      id: tokenRow.accessToken,
      userId,
      trainerId: trainer.id,
      onlineBookingsPageUrlSlug: trainer.onlineBookingsPageUrlSlug,
    }
  })

  return result
}
