import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import type { Trainer } from '@/lib/db'
import { z } from 'zod'
import { parsePhoneNumberFromString } from 'libphonenumber-js/min'
import type { CountryCode } from 'libphonenumber-js'
import { authenticateTrainerRequest, buildErrorResponse } from '../../_lib/accessToken'

const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const

type Weekday = (typeof weekdays)[number]
type AcceptingKey = `${Weekday}AcceptingBookings`
type IntervalsKey = `${Weekday}AvailableIntervals`

const ISO_DURATION_PATTERN = /^-?P/
const SENTINEL_RANGE = '[01:23:45,01:23:46]'

const timeStringSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'Time must be in HH:MM format')

const availabilityIntervalSchema = z.tuple([timeStringSchema, timeStringSchema])

const timeToMinutes = (time: string) => {
  const [hours, minutes] = time.split(':') as [string, string]

  return Number.parseInt(hours, 10) * 60 + Number.parseInt(minutes, 10)
}

const availabilitySchema = z.object({
  acceptingBookings: z.boolean(),
  availableIntervals: z
    .array(availabilityIntervalSchema)
    .refine(
      (intervals) => intervals.every(([start, end]) => start !== end && timeToMinutes(start) < timeToMinutes(end)),
      'Intervals must represent non-zero durations'
    ),
})

const overrideAvailabilitySchema = z.object({
  acceptingBookings: z.boolean().nullable(),
  availableIntervals: z
    .array(availabilityIntervalSchema)
    .refine(
      (intervals) => intervals.every(([start, end]) => start !== end && timeToMinutes(start) < timeToMinutes(end)),
      'Intervals must represent non-zero durations'
    )
    .nullable(),
})

const onlineBookingsSettingsSchema = z.object({
  enabled: z.boolean(),
  pageUrl: z.string().url(),
  pageUrlSlug: z.string().min(1, 'Page slug must not be empty'),
  contactEmail: z.string().email().nullable(),
  contactNumber: z.string().nullable(),
  businessName: z.string().nullable(),
  showContactNumber: z.boolean(),
  durationUntilBookingWindowOpens: z.string().regex(ISO_DURATION_PATTERN, 'Duration must be an ISO 8601 string'),
  durationUntilBookingWindowCloses: z.string().regex(ISO_DURATION_PATTERN, 'Duration must be an ISO 8601 string'),
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
    overrides: z.record(z.string(), overrideAvailabilitySchema),
  }),
  bookingNote: z.string().nullable(),
  termsAndConditions: z.string().nullable(),
  cancellationPolicy: z.string().nullable(),
})

const patchAvailabilitySchema = z
  .object({
    acceptingBookings: z.boolean().optional(),
    availableIntervals: z
      .array(availabilityIntervalSchema)
      .refine(
        (intervals) => intervals.every(([start, end]) => start !== end && timeToMinutes(start) < timeToMinutes(end)),
        'Intervals must represent non-zero durations'
      )
      .optional(),
  })
  .strict()

const patchOverrideAvailabilitySchema = z
  .object({
    acceptingBookings: z.boolean().nullable().optional(),
    availableIntervals: z
      .array(availabilityIntervalSchema)
      .refine(
        (intervals) => intervals.every(([start, end]) => start !== end && timeToMinutes(start) < timeToMinutes(end)),
        'Intervals must represent non-zero durations'
      )
      .nullable()
      .optional(),
  })
  .strict()

const patchRequestSchema = z
  .object({
    enabled: z.boolean().optional(),
    pageUrlSlug: z.string().trim().min(4, 'Page slug must be at least 4 characters long').optional(),
    contactEmail: z.string().email().nullable().optional(),
    contactNumber: z.string().nullable().optional(),
    businessName: z.string().trim().nullable().optional(),
    showContactNumber: z.boolean().optional(),
    durationUntilBookingWindowOpens: z
      .string()
      .regex(ISO_DURATION_PATTERN, 'Duration must be an ISO 8601 string')
      .optional(),
    durationUntilBookingWindowCloses: z
      .string()
      .regex(ISO_DURATION_PATTERN, 'Duration must be an ISO 8601 string')
      .optional(),
    availability: z
      .object({
        defaults: z
          .object({
            monday: patchAvailabilitySchema.optional(),
            tuesday: patchAvailabilitySchema.optional(),
            wednesday: patchAvailabilitySchema.optional(),
            thursday: patchAvailabilitySchema.optional(),
            friday: patchAvailabilitySchema.optional(),
            saturday: patchAvailabilitySchema.optional(),
            sunday: patchAvailabilitySchema.optional(),
          })
          .partial()
          .optional(),
        overrides: z.record(z.string(), patchOverrideAvailabilitySchema.nullable()).optional(),
      })
      .optional(),
    bookingNote: z.string().trim().nullable().optional(),
    termsAndConditions: z.string().trim().nullable().optional(),
    cancellationPolicy: z.string().trim().nullable().optional(),
  })
  .strict()

type Availability = z.infer<typeof availabilitySchema>

type AvailabilityOverrideRow = {
  date: Date | string
  acceptingBookings: boolean | null
  availableIntervals: string[] | null
}

type RawTrainerSettingsRow = {
  enabled: boolean | null
  pageUrlSlug: string | null
  contactEmail: string | null
  contactNumber: string | null
  businessName: string | null
  showContactNumber: boolean | null
  bookingNote: string | null
  termsAndConditions: string | null
  cancellationPolicy: string | null
  durationUntilBookingWindowOpens: unknown
  durationUntilBookingWindowCloses: unknown
} & {
  [K in AcceptingKey]: boolean | null
} & {
  [K in IntervalsKey]: string[] | null
}

const dayFieldMap: Array<{
  day: Weekday
  acceptingKey: AcceptingKey
  intervalsKey: IntervalsKey
}> = weekdays.map((day) => ({
  day,
  acceptingKey: `${day}AcceptingBookings`,
  intervalsKey: `${day}AvailableIntervals`,
}))

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

const normalizeTimeComponent = (raw: string, isEnd: boolean) => {
  const trimmed = raw.trim()
  if (!trimmed) {
    return null
  }

  const parts = trimmed.split(':')
  if (parts.length < 2) {
    return null
  }

  const [hoursPart, minutesPart] = parts as [string, string]

  if (!/^-?\d+$/.test(hoursPart) || !/^\d+$/.test(minutesPart)) {
    return null
  }

  const hours = Number.parseInt(hoursPart, 10)
  const minutes = Number.parseInt(minutesPart, 10)

  if (Number.isNaN(hours) || Number.isNaN(minutes) || minutes < 0 || minutes > 59) {
    return null
  }

  if (hours < 0) {
    return null
  }

  if (hours > 24) {
    return null
  }

  if (hours === 24) {
    if (!isEnd || minutes !== 0) {
      return null
    }
  }

  const normalizedHours = hours.toString().padStart(2, '0')
  const normalizedMinutes = minutes.toString().padStart(2, '0')
  return `${normalizedHours}:${normalizedMinutes}`
}

const parseTimerange = (value: string): [string, string] | null => {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const compact = trimmed.replace(/\s+/g, '')
  if (compact === SENTINEL_RANGE) {
    return null
  }

  if (trimmed.length < 3) {
    return null
  }

  const content = trimmed.slice(1, trimmed.length - 1)
  const [startRaw, endRaw] = content.split(',')
  if (!startRaw || !endRaw) {
    return null
  }

  const start = normalizeTimeComponent(startRaw, false)
  const end = normalizeTimeComponent(endRaw, true)

  if (!start || !end) {
    return null
  }

  if (start === end) {
    return null
  }

  if (timeToMinutes(start) >= timeToMinutes(end)) {
    return null
  }

  return [start, end]
}

const parseTimerangeList = (values: readonly string[] | null | undefined): Array<[string, string]> => {
  if (!values || values.length === 0) {
    return []
  }

  const intervals = values.map(parseTimerange).filter((interval): interval is [string, string] => interval !== null)

  return intervals
    .slice()
    .sort((a, b) => timeToMinutes(a[0]) - timeToMinutes(b[0]) || timeToMinutes(a[1]) - timeToMinutes(b[1]))
}

const toTimerangeArray = (intervals: Array<[string, string]>) =>
  intervals
    .filter(([start, end]) => start !== end && timeToMinutes(start) < timeToMinutes(end))
    .map(([start, end]) => `[${start},${end})`)

const normalizeNullableTrimmed = (value: string | null | undefined): string | null | undefined => {
  if (value === undefined) {
    return undefined
  }
  if (value === null) {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

const parseOverrideDateKey = (value: string) => {
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null
  }
  const parsed = new Date(`${trimmed}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }
  return parsed
}

const isValidSlug = (value: string) => /^[A-Za-z0-9-_]+$/.test(value)

const formatContactNumber = (value: string, countryCode?: string | null) => {
  const normalizedCountry =
    countryCode && /^[a-zA-Z]{2}$/.test(countryCode.trim())
      ? (countryCode.trim().toUpperCase() as CountryCode)
      : undefined

  const parsed = parsePhoneNumberFromString(value, normalizedCountry)
  const finalParsed = parsed && parsed.isValid() ? parsed : parsePhoneNumberFromString(value, normalizedCountry)

  if (!finalParsed || !finalParsed.isValid()) {
    throw new Error('Invalid phone number')
  }

  return finalParsed.format('E.164')
}

const convertIntervalToIsoString = (value: unknown, fieldName: string) => {
  if (value === null || value === undefined) {
    throw new Error(`${fieldName} is missing`)
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!ISO_DURATION_PATTERN.test(trimmed)) {
      throw new Error(`${fieldName} is not an ISO8601 duration string`)
    }
    return trimmed
  }

  if (typeof value === 'object') {
    const record = value as { toISOString?: () => string; toISO?: () => string }
    if (record && typeof record.toISOString === 'function') {
      return record.toISOString()
    }
    if (record && typeof record.toISO === 'function') {
      return record.toISO()
    }
  }

  throw new Error(`${fieldName} has an unsupported interval representation`)
}

const formatDateKey = (value: Date | string) => {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10)
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed
  }

  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return parsed.toISOString().slice(0, 10)
}

export async function GET(request: Request) {
  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while fetching online bookings settings',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const trainerRow = (await db
      .selectFrom('trainer')
      .select((eb) => [
        eb.ref('trainer.online_bookings_enabled').as('enabled'),
        eb.ref('trainer.online_bookings_page_url_slug').as('pageUrlSlug'),
        eb.ref('trainer.online_bookings_contact_email').as('contactEmail'),
        eb.ref('trainer.online_bookings_contact_number').as('contactNumber'),
        eb.ref('trainer.online_bookings_business_name').as('businessName'),
        eb.ref('trainer.online_bookings_show_contact_number').as('showContactNumber'),
        eb.ref('trainer.online_bookings_booking_note').as('bookingNote'),
        eb.ref('trainer.online_bookings_terms_and_conditions').as('termsAndConditions'),
        eb.ref('trainer.online_bookings_cancellation_policy').as('cancellationPolicy'),
        eb.ref('trainer.online_bookings_duration_until_booking_window_opens').as('durationUntilBookingWindowOpens'),
        eb.ref('trainer.online_bookings_duration_until_booking_window_closes').as('durationUntilBookingWindowCloses'),
        eb.ref('trainer.online_bookings_monday_accepting_bookings').as('mondayAcceptingBookings'),
        eb.ref('trainer.online_bookings_monday_available_intervals').as('mondayAvailableIntervals'),
        eb.ref('trainer.online_bookings_tuesday_accepting_bookings').as('tuesdayAcceptingBookings'),
        eb.ref('trainer.online_bookings_tuesday_available_intervals').as('tuesdayAvailableIntervals'),
        eb.ref('trainer.online_bookings_wednesday_accepting_bookings').as('wednesdayAcceptingBookings'),
        eb.ref('trainer.online_bookings_wednesday_available_intervals').as('wednesdayAvailableIntervals'),
        eb.ref('trainer.online_bookings_thursday_accepting_bookings').as('thursdayAcceptingBookings'),
        eb.ref('trainer.online_bookings_thursday_available_intervals').as('thursdayAvailableIntervals'),
        eb.ref('trainer.online_bookings_friday_accepting_bookings').as('fridayAcceptingBookings'),
        eb.ref('trainer.online_bookings_friday_available_intervals').as('fridayAvailableIntervals'),
        eb.ref('trainer.online_bookings_saturday_accepting_bookings').as('saturdayAcceptingBookings'),
        eb.ref('trainer.online_bookings_saturday_available_intervals').as('saturdayAvailableIntervals'),
        eb.ref('trainer.online_bookings_sunday_accepting_bookings').as('sundayAcceptingBookings'),
        eb.ref('trainer.online_bookings_sunday_available_intervals').as('sundayAvailableIntervals'),
      ])
      .where('trainer.id', '=', authorization.trainerId)
      .executeTakeFirst()) as RawTrainerSettingsRow | undefined

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

    if (typeof trainerRow.enabled !== 'boolean') {
      throw new Error('Online bookings enabled flag is missing or invalid')
    }

    if (typeof trainerRow.showContactNumber !== 'boolean') {
      throw new Error('Online bookings show contact number flag is invalid')
    }

    if (typeof trainerRow.pageUrlSlug !== 'string') {
      throw new Error('Online bookings page URL slug is missing')
    }

    const pageUrl = buildBookingsPageUrl(trainerRow.pageUrlSlug)

    const durationUntilBookingWindowOpens = convertIntervalToIsoString(
      trainerRow.durationUntilBookingWindowOpens,
      'durationUntilBookingWindowOpens'
    )
    const durationUntilBookingWindowCloses = convertIntervalToIsoString(
      trainerRow.durationUntilBookingWindowCloses,
      'durationUntilBookingWindowCloses'
    )

    const defaultsEntries: Array<[Weekday, Availability]> = dayFieldMap.map(({ day, acceptingKey, intervalsKey }) => {
      const acceptingValue = trainerRow[acceptingKey]
      if (typeof acceptingValue !== 'boolean') {
        throw new Error(`Online bookings ${day} accepting flag is invalid`)
      }
      const intervals = parseTimerangeList(trainerRow[intervalsKey])
      return [
        day,
        {
          acceptingBookings: acceptingValue,
          availableIntervals: intervals,
        },
      ]
    })

    const defaults = Object.fromEntries(defaultsEntries)

    const overridesRows = (await db
      .selectFrom('availability')
      .select((eb) => [
        eb.ref('availability.date').as('date'),
        eb.ref('availability.accepting_bookings').as('acceptingBookings'),
        eb.ref('availability.available_intervals').as('availableIntervals'),
      ])
      .where('availability.trainer_id', '=', authorization.trainerId)
      .execute()) as AvailabilityOverrideRow[]

    const overrides = overridesRows.reduce<
      Record<
        string,
        {
          acceptingBookings: boolean | null
          availableIntervals: Array<[string, string]> | null
        }
      >
    >((accumulator, row) => {
      const dateKey = formatDateKey(row.date)
      if (!dateKey) {
        return accumulator
      }

      const accepting = row.acceptingBookings === null ? null : row.acceptingBookings === true

      const availableIntervals = row.availableIntervals === null ? null : parseTimerangeList(row.availableIntervals)

      accumulator[dateKey] = {
        acceptingBookings: accepting,
        availableIntervals,
      }

      return accumulator
    }, {})

    const responsePayload = {
      enabled: trainerRow.enabled,
      pageUrl,
      pageUrlSlug: trainerRow.pageUrlSlug.trim(),
      contactEmail: trainerRow.contactEmail ?? null,
      contactNumber: trainerRow.contactNumber ?? null,
      businessName: trainerRow.businessName ?? null,
      showContactNumber: trainerRow.showContactNumber,
      durationUntilBookingWindowOpens,
      durationUntilBookingWindowCloses,
      availability: {
        defaults,
        overrides,
      },
      bookingNote: trainerRow.bookingNote ?? null,
      termsAndConditions: trainerRow.termsAndConditions ?? null,
      cancellationPolicy: trainerRow.cancellationPolicy ?? null,
    }

    const validated = onlineBookingsSettingsSchema.parse(responsePayload)

    return NextResponse.json(validated)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse online bookings settings response',
          detail: 'Online bookings settings did not match the expected schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch online bookings settings', error)

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch online bookings settings',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}

export async function PATCH(request: Request) {
  let body: unknown

  try {
    body = await request.json()
  } catch (error) {
    console.error('Failed to parse online bookings settings body as JSON', error)
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

  const parsedBody = patchRequestSchema.safeParse(body)
  if (!parsedBody.success) {
    const detail = parsedBody.error.issues.map((issue) => issue.message).join('; ')

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

  const auth = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while updating online bookings settings',
  })

  if (!auth.ok) {
    return auth.response
  }

  const data = parsedBody.data

  if (data.availability?.overrides && Object.keys(data.availability.overrides).length > 0) {
    const invalidDateKey = Object.keys(data.availability.overrides).find((dateKey) => !parseOverrideDateKey(dateKey))

    if (invalidDateKey) {
      return NextResponse.json(
        buildErrorResponse({
          status: 400,
          title: 'Invalid availability override date',
          detail: `${invalidDateKey} is not a valid YYYY-MM-DD date.`,
          type: '/invalid-body',
        }),
        { status: 400 }
      )
    }
  }

  if (data.pageUrlSlug !== undefined) {
    const trimmedSlug = data.pageUrlSlug.trim()
    if (!isValidSlug(trimmedSlug)) {
      return NextResponse.json(
        buildErrorResponse({
          status: 400,
          title: 'Invalid page URL slug',
          detail: 'Page slug can only contain letters, numbers, hyphens, and underscores.',
          type: '/invalid-body',
        }),
        { status: 400 }
      )
    }

    const slugOwner = await db
      .selectFrom('trainer')
      .select('trainer.id')
      .where('trainer.online_bookings_page_url_slug', '=', trimmedSlug)
      .where('trainer.id', '<>', auth.trainerId)
      .executeTakeFirst()

    if (slugOwner) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'Page URL slug already in use',
          detail: 'Choose a different online bookings page URL.',
          type: '/page-url-slug-in-use',
        }),
        { status: 409 }
      )
    }
  }

  const trainerMeta = await db
    .selectFrom('trainer')
    .leftJoin('country', 'country.id', 'trainer.country_id')
    .select((eb) => [eb.ref('trainer.id').as('trainerId'), eb.ref('country.alpha_2_code').as('countryCode')])
    .where('trainer.id', '=', auth.trainerId)
    .executeTakeFirst()

  if (!trainerMeta) {
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

  let formattedContactNumber: string | null | undefined

  if (data.contactNumber !== undefined) {
    if (data.contactNumber === null) {
      formattedContactNumber = null
    } else {
      try {
        formattedContactNumber = formatContactNumber(data.contactNumber, trainerMeta.countryCode)
      } catch (error) {
        console.error('Invalid contact number provided', error)
        return NextResponse.json(
          buildErrorResponse({
            status: 400,
            title: 'Invalid contact number',
            detail: 'contactNumber must be a valid phone number.',
            type: '/invalid-body',
          }),
          { status: 400 }
        )
      }
    }
  }

  try {
    await db.transaction().execute(async (trx) => {
      // Handle availability overrides
      const overrides = data.availability?.overrides
      if (overrides) {
        for (const dateKey of Object.keys(overrides)) {
          const override = overrides[dateKey]
          const parsedDate = parseOverrideDateKey(dateKey)
          if (!parsedDate) {
            // This should be impossible due to prior validation
            continue
          }

          if (override === null) {
            await trx
              .deleteFrom('availability')
              .where('trainer_id', '=', auth.trainerId)
              .where('date', '=', parsedDate)
              .execute()
            continue
          }

          if (!override) {
            continue
          }

          if (override.acceptingBookings === null && override.availableIntervals === null) {
            await trx
              .deleteFrom('availability')
              .where('trainer_id', '=', auth.trainerId)
              .where('date', '=', parsedDate)
              .execute()
            continue
          }

          if (override.acceptingBookings === undefined && override.availableIntervals === undefined) {
            continue
          }

          const insertValues = {
            trainer_id: auth.trainerId,
            date: parsedDate,
            accepting_bookings: override.acceptingBookings === undefined ? null : override.acceptingBookings,
            available_intervals:
              override.availableIntervals === undefined
                ? null
                : override.availableIntervals === null
                  ? null
                  : toTimerangeArray(override.availableIntervals),
          }

          const updateSet: Partial<{
            accepting_bookings: boolean | null
            available_intervals: string[] | null
          }> = {}

          if (override.acceptingBookings !== undefined) {
            updateSet.accepting_bookings = override.acceptingBookings
          }

          if (override.availableIntervals !== undefined) {
            updateSet.available_intervals =
              override.availableIntervals === null ? null : toTimerangeArray(override.availableIntervals)
          }

          await trx
            .insertInto('availability')
            .values(insertValues)
            .onConflict((oc) => oc.columns(['trainer_id', 'date']).doUpdateSet(updateSet))
            .execute()
        }
      }

      const updateData: Record<string, unknown> = {}

      if (data.enabled !== undefined) {
        updateData.online_bookings_enabled = data.enabled
      }

      if (data.pageUrlSlug !== undefined) {
        updateData.online_bookings_page_url_slug = data.pageUrlSlug.trim()
      }

      if (data.contactEmail !== undefined) {
        const value = normalizeNullableTrimmed(data.contactEmail)
        updateData.online_bookings_contact_email = value === undefined ? null : value
      }

      if (formattedContactNumber !== undefined) {
        updateData.online_bookings_contact_number = formattedContactNumber
      }

      if (data.businessName !== undefined) {
        const value = normalizeNullableTrimmed(data.businessName)
        updateData.online_bookings_business_name = value === undefined ? null : value
      }

      if (data.showContactNumber !== undefined) {
        updateData.online_bookings_show_contact_number = data.showContactNumber
      }

      if (data.durationUntilBookingWindowOpens !== undefined) {
        updateData.online_bookings_duration_until_booking_window_opens = data.durationUntilBookingWindowOpens
      }

      if (data.durationUntilBookingWindowCloses !== undefined) {
        updateData.online_bookings_duration_until_booking_window_closes = data.durationUntilBookingWindowCloses
      }

      if (data.bookingNote !== undefined) {
        const value = normalizeNullableTrimmed(data.bookingNote)
        updateData.online_bookings_booking_note = value === undefined ? null : value
      }

      if (data.termsAndConditions !== undefined) {
        const value = normalizeNullableTrimmed(data.termsAndConditions)
        updateData.online_bookings_terms_and_conditions = value === undefined ? null : value
      }

      if (data.cancellationPolicy !== undefined) {
        const value = normalizeNullableTrimmed(data.cancellationPolicy)
        updateData.online_bookings_cancellation_policy = value === undefined ? null : value
      }

      const defaults = data.availability?.defaults
      if (defaults) {
        dayFieldMap.forEach(({ day }) => {
          const dayUpdate = defaults[day]
          if (!dayUpdate) {
            return
          }

          const acceptingColumn = `online_bookings_${day}_accepting_bookings` as keyof Trainer
          const intervalsColumn = `online_bookings_${day}_available_intervals` as keyof Trainer

          if (dayUpdate.acceptingBookings !== undefined) {
            updateData[acceptingColumn] = dayUpdate.acceptingBookings
          }

          if (dayUpdate.availableIntervals !== undefined) {
            updateData[intervalsColumn] = toTimerangeArray(dayUpdate.availableIntervals)
          }
        })
      }

      if (Object.keys(updateData).length > 0) {
        await trx.updateTable('trainer').set(updateData).where('id', '=', auth.trainerId).execute()
      }
    })

    return GET(request)
  } catch (error) {
    console.error('Failed to update online bookings settings', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to update online bookings settings',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
