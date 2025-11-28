import { NextResponse } from 'next/server'
import { db } from '@keepon/db'
import { z } from 'zod'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../../_lib/accessToken'

export const runtime = 'nodejs'

const weekdays = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const

type Weekday = (typeof weekdays)[number]
type AcceptingKey = `${Weekday}AcceptingBookings`
type IntervalsKey = `${Weekday}AvailableIntervals`

const ISO_DURATION_PATTERN = /^-?P/
const SENTINEL_RANGE = '[01:23:45,01:23:46]'

const timeStringSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'Time must be in HH:MM format')

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
      intervals =>
        intervals.every(
          ([start, end]) =>
            start !== end && timeToMinutes(start) < timeToMinutes(end)
        ),
      'Intervals must represent non-zero durations'
    ),
})

const overrideAvailabilitySchema = z.object({
  acceptingBookings: z.boolean().nullable(),
  availableIntervals: z
    .array(availabilityIntervalSchema)
    .refine(
      intervals =>
        intervals.every(
          ([start, end]) =>
            start !== end && timeToMinutes(start) < timeToMinutes(end)
        ),
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
  durationUntilBookingWindowOpens: z
    .string()
    .regex(ISO_DURATION_PATTERN, 'Duration must be an ISO 8601 string'),
  durationUntilBookingWindowCloses: z
    .string()
    .regex(ISO_DURATION_PATTERN, 'Duration must be an ISO 8601 string'),
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
}> = weekdays.map(day => ({
  day,
  acceptingKey: `${day}AcceptingBookings`,
  intervalsKey: `${day}AvailableIntervals`,
}))

const removeTrailingSlash = (value: string) =>
  value.endsWith('/') ? value.slice(0, -1) : value

const buildBookingsPageUrl = (slug: string) => {
  const trimmedSlug = slug.trim()
  if (!trimmedSlug) {
    throw new Error('Online bookings page slug is empty')
  }

  const explicitBase =
    process.env.BOOKINGS_BASE_URL ??
    process.env.BOOKINGS_URL ??
    process.env.NEXT_PUBLIC_BOOKINGS_URL ??
    null

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

  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    minutes < 0 ||
    minutes > 59
  ) {
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

const parseTimerangeList = (
  values: readonly string[] | null | undefined
): Array<[string, string]> => {
  if (!values || values.length === 0) {
    return []
  }

  const intervals = values
    .map(parseTimerange)
    .filter((interval): interval is [string, string] => interval !== null)

  return intervals
    .slice()
    .sort(
      (a, b) =>
        timeToMinutes(a[0]) - timeToMinutes(b[0]) ||
        timeToMinutes(a[1]) - timeToMinutes(b[1])
    )
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
    extensionFailureLogMessage:
      'Failed to extend access token expiry while fetching online bookings settings',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const trainerRow = (await db
      .selectFrom('trainer')
      .select(({ ref }) => [
        ref('trainer.online_bookings_enabled').as('enabled'),
        ref('trainer.online_bookings_page_url_slug').as('pageUrlSlug'),
        ref('trainer.online_bookings_contact_email').as('contactEmail'),
        ref('trainer.online_bookings_contact_number').as('contactNumber'),
        ref('trainer.online_bookings_business_name').as('businessName'),
        ref('trainer.online_bookings_show_contact_number').as(
          'showContactNumber'
        ),
        ref('trainer.online_bookings_booking_note').as('bookingNote'),
        ref('trainer.online_bookings_terms_and_conditions').as(
          'termsAndConditions'
        ),
        ref('trainer.online_bookings_cancellation_policy').as(
          'cancellationPolicy'
        ),
        ref(
          'trainer.online_bookings_duration_until_booking_window_opens'
        ).as('durationUntilBookingWindowOpens'),
        ref(
          'trainer.online_bookings_duration_until_booking_window_closes'
        ).as('durationUntilBookingWindowCloses'),
        ref('trainer.online_bookings_monday_accepting_bookings').as(
          'mondayAcceptingBookings'
        ),
        ref('trainer.online_bookings_monday_available_intervals').as(
          'mondayAvailableIntervals'
        ),
        ref('trainer.online_bookings_tuesday_accepting_bookings').as(
          'tuesdayAcceptingBookings'
        ),
        ref('trainer.online_bookings_tuesday_available_intervals').as(
          'tuesdayAvailableIntervals'
        ),
        ref('trainer.online_bookings_wednesday_accepting_bookings').as(
          'wednesdayAcceptingBookings'
        ),
        ref('trainer.online_bookings_wednesday_available_intervals').as(
          'wednesdayAvailableIntervals'
        ),
        ref('trainer.online_bookings_thursday_accepting_bookings').as(
          'thursdayAcceptingBookings'
        ),
        ref('trainer.online_bookings_thursday_available_intervals').as(
          'thursdayAvailableIntervals'
        ),
        ref('trainer.online_bookings_friday_accepting_bookings').as(
          'fridayAcceptingBookings'
        ),
        ref('trainer.online_bookings_friday_available_intervals').as(
          'fridayAvailableIntervals'
        ),
        ref('trainer.online_bookings_saturday_accepting_bookings').as(
          'saturdayAcceptingBookings'
        ),
        ref('trainer.online_bookings_saturday_available_intervals').as(
          'saturdayAvailableIntervals'
        ),
        ref('trainer.online_bookings_sunday_accepting_bookings').as(
          'sundayAcceptingBookings'
        ),
        ref('trainer.online_bookings_sunday_available_intervals').as(
          'sundayAvailableIntervals'
        ),
      ])
      .where('trainer.id', '=', authorization.trainerId)
      .executeTakeFirst()) as RawTrainerSettingsRow | undefined

    if (!trainerRow) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Trainer not found',
          detail:
            'No trainer record was found for the authenticated access token.',
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
      .select(({ ref }) => [
        ref('availability.date').as('date'),
        ref('availability.accepting_bookings').as('acceptingBookings'),
        ref('availability.available_intervals').as('availableIntervals'),
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

      const accepting =
        row.acceptingBookings === null
          ? null
          : row.acceptingBookings === true

      const availableIntervals =
        row.availableIntervals === null
          ? null
          : parseTimerangeList(row.availableIntervals)

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
