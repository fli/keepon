import { NextResponse } from 'next/server'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import { buildErrorResponse } from '../../../_lib/accessToken'

const ISO_DURATION_PATTERN = /^-?P/

const timeStringSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be in HH:MM format')

const availabilityIntervalSchema = z.tuple([timeStringSchema, timeStringSchema])

const availabilitySchema = z.object({
  acceptingBookings: z.boolean(),
  availableIntervals: z.array(availabilityIntervalSchema),
})

const availabilityOverridesSchema = z.record(
  z.string(),
  z.object({
    acceptingBookings: z.boolean().nullable(),
    availableIntervals: z.array(availabilityIntervalSchema).nullable(),
  })
)

const geoSchema = z
  .object({
    lat: z.number(),
    lng: z.number(),
  })
  .nullable()

const serviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  price: z.string().nullable(),
  durationMinutes: z.number(),
  location: z.string().nullable(),
  address: z.string().nullable(),
  geo: geoSchema,
  googlePlaceId: z.string().nullable(),
  description: z.string().nullable(),
  bookingPaymentType: z.union([z.literal('hidePrice'), z.literal('noPrepayment'), z.literal('fullPrepayment')]),
  coverImageUrl: z.string().nullable(),
  iconUrl: z.string().nullable(),
  image0Url: z.string().nullable(),
  image1Url: z.string().nullable(),
  image2Url: z.string().nullable(),
  image3Url: z.string().nullable(),
  image4Url: z.string().nullable(),
  image5Url: z.string().nullable(),
  bufferMinutesBefore: z.number(),
  bufferMinutesAfter: z.number(),
  timeSlotFrequencyMinutes: z.number(),
  displayOrder: z.number().nullable(),
  requestClientAddressOnline: z.union([z.literal('optional'), z.literal('required'), z.null()]).nullable(),
  bookingQuestion: z.string().nullable(),
  bookingQuestionState: z.union([z.literal('optional'), z.literal('required'), z.null()]).nullable(),
})

const providerSchema = z.object({
  currency: z.string(),
  country: z.string(),
  timezone: z.string(),
  onlineBookingsEnabled: z.boolean(),
  providerName: z.string(),
  pageUrl: z.string(),
  pageUrlSlug: z.string(),
  contactEmail: z.string(),
  contactNumber: z.string().nullable(),
  durationUntilBookingWindowOpens: z.string().regex(ISO_DURATION_PATTERN, 'Duration must be an ISO 8601 string'),
  durationUntilBookingWindowCloses: z.string().regex(ISO_DURATION_PATTERN, 'Duration must be an ISO 8601 string'),
  bookingNote: z.string().nullable(),
  availability: z.object({
    defaults: z.object({
      monday: availabilitySchema,
      tuesday: availabilitySchema,
      wednesday: availabilitySchema,
      thursday: availabilitySchema,
      friday: availabilitySchema,
      saturday: availabilitySchema,
      sunday: availabilitySchema,
    }),
    overrides: availabilityOverridesSchema,
  }),
  services: z.array(serviceSchema),
  unavailability: z.array(z.tuple([z.union([z.string(), z.date()]), z.union([z.string(), z.date()])])),
  brandColor: z.string(),
  brandDarkMode: z.boolean(),
  businessLogoUrl: z.string().nullable(),
  coverImageUrl: z.string().nullable(),
  termsAndConditions: z.string().nullable(),
  cancellationPolicy: z.string().nullable(),
  stripeAccountId: z.string().nullable(),
  stripeAccountType: z.union([z.literal('standard'), z.literal('custom'), z.null()]).nullable(),
})

type Provider = z.infer<typeof providerSchema>

type ProviderRow = Omit<Provider, 'pageUrl' | 'unavailability'> & {
  unavailability: Array<[string | Date, string | Date]>
}

type HandlerContext = { params: Promise<Record<string, string>> }

const paramsSchema = z.object({
  pageUrlSlug: z.string().trim().min(1, 'Page URL slug must not be empty'),
})

const removeTrailingSlash = (value: string) => (value.endsWith('/') ? value.slice(0, -1) : value)

const buildBookingsPageUrl = (slug: string) => {
  const trimmedSlug = slug.trim()
  if (!trimmedSlug) {
    throw new Error('Online bookings page slug is empty')
  }

  const explicitBase =
    process.env.BOOKINGS_BASE_URL ?? process.env.BOOKINGS_URL ?? process.env.NEXT_PUBLIC_BOOKINGS_URL ?? null

  if (explicitBase) {
    const explicit = new URL(explicitBase)
    return `${removeTrailingSlash(explicit.toString())}/${trimmedSlug}`
  }

  const baseUrl = process.env.BASE_URL ?? 'http://localhost:3001'
  const bookingsBase = new URL('book', baseUrl)
  return `${removeTrailingSlash(bookingsBase.toString())}/${trimmedSlug}`
}

const normalizeDateValue = (value: unknown) => {
  if (value instanceof Date) {
    return value.toISOString()
  }

  if (typeof value === 'string') {
    return value
  }

  return null
}

export async function GET(_request: Request, context: HandlerContext) {
  const parsedParams = paramsSchema.safeParse(await context.params)

  if (!parsedParams.success) {
    const detail = parsedParams.error.issues.map((issue) => issue.message).join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid path parameters',
        detail: detail || 'Request path parameters did not match the expected schema.',
        type: '/invalid-path-parameters',
      }),
      { status: 400 }
    )
  }

  const { pageUrlSlug } = parsedParams.data

  try {
    const providerResult = await sql<ProviderRow>`
      SELECT
        CASE
          WHEN vw_legacy_trainer.subscription->>'status' IN ('subscribed', 'trialling') THEN trainer.online_bookings_enabled
          ELSE FALSE
        END "onlineBookingsEnabled",
        COALESCE(
          trainer.online_bookings_business_name,
          trainer.business_name,
          trainer.first_name || COALESCE(' ' || trainer.last_name, '')
        ) "providerName",
        trainer.online_bookings_page_url_slug "pageUrlSlug",
        COALESCE(trainer.online_bookings_contact_email, trainer.email) "contactEmail",
        CASE WHEN trainer.online_bookings_show_contact_number
          THEN COALESCE(trainer.online_bookings_contact_number, trainer.phone_number)
          ELSE NULL
        END "contactNumber",
        trainer.online_bookings_duration_until_booking_window_opens::text "durationUntilBookingWindowOpens",
        trainer.online_bookings_duration_until_booking_window_closes::text "durationUntilBookingWindowCloses",
        trainer.online_bookings_booking_note "bookingNote",
        json_build_object(
          'defaults',
          json_build_object(
            'monday',
            json_build_object(
              'acceptingBookings',
              trainer.online_bookings_monday_accepting_bookings,
              'availableIntervals',
              (
                select
                  COALESCE(
                    json_agg(
                      ARRAY [to_char(lower(intervals), 'HH24:MI'), to_char(upper(intervals), 'HH24:MI')]
                    ),
                    '[]'
                  )
                FROM
                  (
                    SELECT
                      unnest(a.online_bookings_monday_available_intervals) intervals
                    FROM
                      trainer a
                    WHERE
                      a.id = trainer.id
                  ) i WHERE not isempty(intervals)
              )
            ),
            'tuesday',
            json_build_object(
              'acceptingBookings',
              online_bookings_tuesday_accepting_bookings,
              'availableIntervals',
              (
                select
                  COALESCE(
                    json_agg(
                      ARRAY [to_char(lower(intervals), 'HH24:MI'), to_char(upper(intervals), 'HH24:MI')]
                    ),
                    '[]'
                  )
                FROM
                  (
                    SELECT
                      unnest(a.online_bookings_tuesday_available_intervals) intervals
                    FROM
                      trainer a
                    WHERE
                      a.id = trainer.id
                  ) i WHERE not isempty(intervals)
              )
            ),
            'wednesday',
            json_build_object(
              'acceptingBookings',
              online_bookings_wednesday_accepting_bookings,
              'availableIntervals',
              (
                select
                  COALESCE(
                    json_agg(
                      ARRAY [to_char(lower(intervals), 'HH24:MI'), to_char(upper(intervals), 'HH24:MI')]
                    ),
                    '[]'
                  )
                FROM
                  (
                    SELECT
                      unnest(a.online_bookings_wednesday_available_intervals) intervals
                    FROM
                      trainer a
                    WHERE
                      a.id = trainer.id
                  ) i WHERE not isempty(intervals)
              )
            ),
            'thursday',
            json_build_object(
              'acceptingBookings',
              online_bookings_thursday_accepting_bookings,
              'availableIntervals',
              (
                select
                  COALESCE(
                    json_agg(
                      ARRAY [to_char(lower(intervals), 'HH24:MI'), to_char(upper(intervals), 'HH24:MI')]
                    ),
                    '[]'
                  )
                FROM
                  (
                    SELECT
                      unnest(a.online_bookings_thursday_available_intervals) intervals
                    FROM
                      trainer a
                    WHERE
                      a.id = trainer.id
                  ) i WHERE not isempty(intervals)
              )
            ),
            'friday',
            json_build_object(
              'acceptingBookings',
              online_bookings_friday_accepting_bookings,
              'availableIntervals',
              (
                select
                  COALESCE(
                    json_agg(
                      ARRAY [to_char(lower(intervals), 'HH24:MI'), to_char(upper(intervals), 'HH24:MI')]
                    ),
                    '[]'
                  )
                FROM
                  (
                    SELECT
                      unnest(a.online_bookings_friday_available_intervals) intervals
                    FROM
                      trainer a
                    WHERE
                      a.id = trainer.id
                  ) i WHERE not isempty(intervals)
              )
            ),
            'saturday',
            json_build_object(
              'acceptingBookings',
              online_bookings_saturday_accepting_bookings,
              'availableIntervals',
              (
                select
                  COALESCE(
                    json_agg(
                      ARRAY [to_char(lower(intervals), 'HH24:MI'), to_char(upper(intervals), 'HH24:MI')]
                    ),
                    '[]'
                  )
                FROM
                  (
                    SELECT
                      unnest(a.online_bookings_saturday_available_intervals) intervals
                    FROM
                      trainer a
                    WHERE
                      a.id = trainer.id
                  ) i WHERE not isempty(intervals)
              )
            ),
            'sunday',
            json_build_object(
              'acceptingBookings',
              online_bookings_sunday_accepting_bookings,
              'availableIntervals',
              (
                select
                  COALESCE(
                    json_agg(
                      ARRAY [to_char(lower(intervals), 'HH24:MI'), to_char(upper(intervals), 'HH24:MI')]
                    ),
                    '[]'
                  )
                FROM
                  (
                    SELECT
                      unnest(a.online_bookings_sunday_available_intervals) intervals
                    FROM
                      trainer a
                    WHERE
                      a.id = trainer.id
                  ) i WHERE not isempty(intervals)
              )
            )
          ),
          'overrides',
          COALESCE(
            (
              SELECT
                json_object_agg(
                  date,
                  json_build_object(
                    'acceptingBookings',
                    accepting_bookings,
                    'availableIntervals',
                    (
                      select
                        CASE WHEN array_agg(intervals) = '{"[01:23:45, 01:23:46]"}' THEN NULL
                        ELSE
                        COALESCE(
                          json_agg(
                            ARRAY [to_char(lower(intervals), 'HH24:MI'), to_char(upper(intervals), 'HH24:MI')]
                          ),
                          '[]'
                        )
                        END
                      FROM
                        (
                          SELECT
                           unnest(coalesce(a.available_intervals, '{"[01:23:45, 01:23:46]"}' )) intervals
                          FROM
                            availability b
                          WHERE
                            b.trainer_id = a.trainer_id
                            and b.date = a.date
                        ) i WHERE not isempty(intervals)
                    )
                  )
                )
              from
                availability a
              where
                a.trainer_id = trainer.id
            ),
            '{}'
          )
        ) availability,
        (
          SELECT coalesce(json_agg(s), '[]')
          FROM (
            SELECT
              service.id,
              product.name,
              CASE WHEN service.booking_payment_type != 'hidePrice' THEN TO_CHAR(product.price, 'FM99999990.00') ELSE NULL END price,
              EXTRACT(EPOCH FROM service.duration) / 60 "durationMinutes",
              COALESCE(service.location, '') "location",
              service.address,
              CASE
                WHEN service.geo IS NOT NULL THEN json_build_object('lat', service.geo[0], 'lng', service.geo[1])
                ELSE NULL
              END AS geo,
              service.google_place_id "googlePlaceId",
              product.description,
              service.booking_payment_type "bookingPaymentType",
              service.cover_image_url "coverImageUrl",
              service.icon_url "iconUrl",
              service.image_0_url "image0Url",
              service.image_1_url "image1Url",
              service.image_2_url "image2Url",
              service.image_3_url "image3Url",
              service.image_4_url "image4Url",
              service.image_5_url "image5Url",
              service.buffer_minutes_before "bufferMinutesBefore",
              service.buffer_minutes_after "bufferMinutesAfter",
              service.time_slot_frequency_minutes "timeSlotFrequencyMinutes",
              product.display_order "displayOrder",
              service.request_client_address_online "requestClientAddressOnline",
              service.booking_question "bookingQuestion",
              service.booking_question_state "bookingQuestionState"
            FROM service
            JOIN product ON service.id = product.id
            WHERE service.trainer_id=trainer.id
            AND service.bookable_online
            ORDER BY product.display_order, service.created_at
          ) s
        ) services,
        (
          SELECT
            COALESCE(json_agg(json_build_array(start_time, end_time)), '[]')
          FROM (
            SELECT
              coalesce(start_time, timezone(trainer.timezone, start_date)) start_time,
              coalesce(end_time, timezone(trainer.timezone, end_date)) end_time
            FROM
              busy_time
            WHERE
              trainer.id = busy_time.trainer_id
            UNION ALL
            SELECT
              session.start - make_interval(mins => session.buffer_minutes_before),
              session.start + session.duration + make_interval(mins => session.buffer_minutes_after)
            FROM
              session
              JOIN session_series ON session_series.id = session.session_series_id
            WHERE
              trainer.id = session.trainer_id
              AND session_series.event_type != 'single_session'
            UNION ALL
            SELECT
              session.start - make_interval(mins => session.buffer_minutes_before),
              session.start + session.duration + make_interval(mins => session.buffer_minutes_after)
            FROM
              session
              JOIN session_series ON session_series.id = session.session_series_id
              LEFT JOIN client_session ON client_session.session_id = session.id
            WHERE
              trainer.id = session.trainer_id
              AND session_series.event_type = 'single_session'
              AND client_session.state != 'cancelled'
              AND client_session.state != 'declined') u
          WHERE
            (u.start_time, u.end_time) OVERLAPS (
              NOW() + trainer.online_bookings_duration_until_booking_window_opens,
              NOW() + trainer.online_bookings_duration_until_booking_window_closes + '1 hour'::interval
            )) unavailability,
        currency.alpha_code "currency",
        country.alpha_2_code "country",
        trainer.timezone,
        trainer.brand_color "brandColor",
        trainer.business_logo_url "businessLogoUrl",
        trainer.cover_image_url "coverImageUrl",
        trainer.brand_dark_mode "brandDarkMode",
        trainer.online_bookings_terms_and_conditions "termsAndConditions",
        trainer.online_bookings_cancellation_policy "cancellationPolicy",
        trainer.stripe_account_id "stripeAccountId",
        stripe.account.object->>'type' "stripeAccountType"
      FROM trainer
      JOIN country on country.id=trainer.country_id
      JOIN supported_country_currency ON country.id = supported_country_currency.country_id
      JOIN currency ON currency.id = supported_country_currency.currency_id
      JOIN vw_legacy_trainer on trainer.id=vw_legacy_trainer.id
      LEFT JOIN stripe.account ON stripe.account.id = trainer.stripe_account_id
      WHERE trainer.online_bookings_page_url_slug=${pageUrlSlug}
    `.execute(db)

    const row = providerResult.rows[0]

    if (!row) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Service provider page not found',
          detail: 'No online bookings page exists for the provided slug.',
          type: '/resource-not-found',
        }),
        { status: 404 }
      )
    }

    const normalizedUnavailability = Array.isArray(row.unavailability)
      ? row.unavailability
          .map((interval) => {
            if (!Array.isArray(interval) || interval.length < 2) return null
            const [start, end] = interval

            const normalizedStart = normalizeDateValue(start)
            const normalizedEnd = normalizeDateValue(end)

            if (!normalizedStart || !normalizedEnd) {
              return null
            }

            return [normalizedStart, normalizedEnd] as [string, string]
          })
          .filter(Boolean)
      : []

    const response: Provider = providerSchema.parse({
      ...row,
      pageUrl: buildBookingsPageUrl(row.pageUrlSlug),
      unavailability: normalizedUnavailability,
    })

    return NextResponse.json(response)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse provider data from database',
          detail: 'Provider data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch online bookings provider by slug', pageUrlSlug, error)

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch online bookings provider',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
