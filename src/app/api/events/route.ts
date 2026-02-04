import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db, sql } from '@/lib/db'
import { buildErrorResponse } from '../_lib/accessToken'
import { parseAmount } from '../paymentPlans/shared'

const querySchema = z.object({
  providerUrlSlug: z.string().trim().min(1, 'providerUrlSlug must not be empty'),
})

const bookingPaymentTypeSchema = z.enum(['hidePrice', 'noPrepayment', 'fullPrepayment'])

const requestClientAddressOnlineSchema = z.enum(['optional', 'required'])

const bookingQuestionStateSchema = z.enum(['optional', 'required'])

const isoDateTimeString = z.string().datetime({ offset: true })

const geoSchema = z.object({
  lat: z.number(),
  lng: z.number(),
})

const eventSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  startsAt: isoDateTimeString,
  durationMinutes: z.number().int().min(1),
  timezone: z.string(),
  currency: z.string(),
  currentAttendance: z.number().int().min(0),
  bookingPaymentType: bookingPaymentTypeSchema,
  requestClientAddressOnline: requestClientAddressOnlineSchema.nullable(),
  bookingQuestion: z.string().nullable(),
  bookingQuestionState: bookingQuestionStateSchema.nullable(),
  maximumAttendance: z.number().int().min(0).nullable(),
  location: z.string().nullable(),
  address: z.string().nullable(),
  geo: geoSchema.nullable(),
  googlePlaceId: z.string().nullable(),
  price: z.string().nullable(),
})

const eventListSchema = z.array(eventSchema)

type RawEventRow = {
  id: string | null
  name: string | null
  startsAt: Date | string | null
  durationMinutes: number | string | null
  timezone: string | null
  currency: string | null
  currentAttendance: number | string | null
  bookingPaymentType: string | null
  requestClientAddressOnline: string | null
  bookingQuestion: string | null
  bookingQuestionState: string | null
  maximumAttendance: number | string | null
  location: string | null
  address: string | null
  geo: { x: number | string; y: number | string } | null
  googlePlaceId: string | null
  price: string | number | null
}

const toIsoString = (value: Date | string | null, label: string) => {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${label} in event record`)
  }
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Invalid ${label} value encountered in event record`)
  }
  return date.toISOString()
}

const ensureNonEmptyString = (value: string | null | undefined, label: string) => {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${label} in event record`)
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new Error(`Missing ${label} in event record`)
  }
  return trimmed
}

const parseInteger = (value: number | string | null, label: string, options: { minimum?: number } = {}) => {
  if (value === null || value === undefined) {
    throw new Error(`Missing ${label} in event record`)
  }
  const numeric = typeof value === 'number' ? value : Number.parseFloat(String(value))
  if (!Number.isFinite(numeric)) {
    throw new TypeError(`Invalid ${label} value encountered in event record`)
  }
  const rounded = Math.round(numeric)
  if (!Number.isInteger(rounded)) {
    throw new TypeError(`Invalid ${label} value encountered in event record`)
  }
  if (options.minimum !== undefined && rounded < options.minimum) {
    throw new Error(`${label} must be at least ${options.minimum} but was ${rounded}`)
  }
  return rounded
}

const parseOptionalInteger = (value: number | string | null, label: string, options: { minimum?: number } = {}) => {
  if (value === null || value === undefined) {
    return null
  }
  return parseInteger(value, label, options)
}

const parseBookingPaymentType = (value: string | null) => {
  if (typeof value !== 'string') {
    throw new TypeError('Missing bookingPaymentType in event record')
  }
  const parsed = bookingPaymentTypeSchema.safeParse(value.trim())
  if (!parsed.success) {
    throw new Error(`Invalid bookingPaymentType encountered in event record: ${value}`)
  }
  return parsed.data
}

const parseRequestClientAddressOnline = (value: string | null) => {
  if (value === null || value === undefined) {
    return null
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }
  const parsed = requestClientAddressOnlineSchema.safeParse(trimmed)
  if (!parsed.success) {
    throw new Error(`Invalid requestClientAddressOnline encountered in event record: ${value}`)
  }
  return parsed.data
}

const parseBookingQuestionState = (value: string | null) => {
  if (value === null || value === undefined) {
    return null
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }
  const parsed = bookingQuestionStateSchema.safeParse(trimmed)
  if (!parsed.success) {
    throw new Error(`Invalid bookingQuestionState encountered in event record: ${value}`)
  }
  return parsed.data
}

const formatPrice = (value: string | number | null): string | null => {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Invalid price value encountered in event record')
    }
    return value.toFixed(2)
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }
  const parsed = Number.parseFloat(trimmed)
  if (!Number.isFinite(parsed)) {
    throw new TypeError('Invalid price value encountered in event record')
  }
  return parsed.toFixed(2)
}

const normalizeGeo = (value: RawEventRow['geo']): z.infer<typeof geoSchema> | null => {
  if (!value) {
    return null
  }

  const latValue = 'x' in value ? value.x : undefined
  const lngValue = 'y' in value ? value.y : undefined

  const lat =
    typeof latValue === 'number' ? latValue : typeof latValue === 'string' ? Number.parseFloat(latValue) : undefined
  const lng =
    typeof lngValue === 'number' ? lngValue : typeof lngValue === 'string' ? Number.parseFloat(lngValue) : undefined

  if (lat === undefined || lng === undefined || Number.isNaN(lat) || Number.isNaN(lng)) {
    throw new Error('Invalid geo coordinates encountered in event record')
  }

  return { lat, lng }
}

const mapRowToEvent = (row: RawEventRow) => {
  const id = ensureNonEmptyString(row.id, 'id')
  const startsAt = toIsoString(row.startsAt, 'startsAt')
  const durationMinutes = parseInteger(row.durationMinutes, 'durationMinutes', {
    minimum: 1,
  })
  const timezone = ensureNonEmptyString(row.timezone, 'timezone')
  const currency = ensureNonEmptyString(row.currency, 'currency')
  const currentAttendance = parseInteger(row.currentAttendance, 'currentAttendance', {
    minimum: 0,
  })
  const maximumAttendance = parseOptionalInteger(row.maximumAttendance, 'maximumAttendance', {
    minimum: 0,
  })
  const bookingPaymentType = parseBookingPaymentType(row.bookingPaymentType)
  const requestClientAddressOnline = parseRequestClientAddressOnline(row.requestClientAddressOnline)
  const bookingQuestionState = parseBookingQuestionState(row.bookingQuestionState)

  const price = bookingPaymentType === 'hidePrice' ? null : formatPrice(parseAmount(row.price, 'price'))

  const geo = row.geo ? normalizeGeo(row.geo) : null

  return {
    id,
    name: row.name ?? null,
    startsAt,
    durationMinutes,
    timezone,
    currency,
    currentAttendance,
    bookingPaymentType,
    requestClientAddressOnline,
    bookingQuestion: row.bookingQuestion ?? null,
    bookingQuestionState,
    maximumAttendance,
    location: row.location ?? null,
    address: row.address ?? null,
    geo,
    googlePlaceId: row.googlePlaceId ?? null,
    price,
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const rawProviderUrlSlug = url.searchParams.get('providerUrlSlug')

  const queryParse = querySchema.safeParse({
    providerUrlSlug: rawProviderUrlSlug && rawProviderUrlSlug.trim().length > 0 ? rawProviderUrlSlug.trim() : undefined,
  })

  if (!queryParse.success) {
    const detail = queryParse.error.issues.map((issue) => issue.message).join('; ')
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid query parameters',
        detail: detail || 'Request query parameters did not match the expected schema.',
        type: '/invalid-query',
      }),
      { status: 400 }
    )
  }

  try {
    const provider = await db
      .selectFrom('trainer as trainer')
      .select('trainer.id')
      .where('trainer.online_bookings_page_url_slug', '=', queryParse.data.providerUrlSlug)
      .limit(1)
      .executeTakeFirst()

    if (!provider) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Service provider not found',
          type: '/resource-not-found',
        }),
        { status: 404 }
      )
    }

    const rows = (await db
      .selectFrom('session as s')
      .innerJoin('session_series as series', 'series.id', 's.session_series_id')
      .innerJoin('trainer', 'trainer.id', 'series.trainer_id')
      .innerJoin('supported_country_currency as scc', 'scc.country_id', 'trainer.country_id')
      .innerJoin('currency', 'currency.id', 'scc.currency_id')
      .select((eb) => [
        eb.ref('s.id').as('id'),
        eb.ref('series.name').as('name'),
        eb.ref('s.start').as('startsAt'),
        sql<number>`
          (EXTRACT(EPOCH FROM ${sql.ref('s.duration')}) / 60)::int
        `.as('durationMinutes'),
        eb.ref('s.timezone').as('timezone'),
        eb.ref('currency.alpha_code').as('currency'),
        sql<number>`
          (
            SELECT COUNT(*)
            FROM client_session
            WHERE client_session.session_id = ${sql.ref('s.id')}
              AND client_session.state IN ('confirmed', 'accepted')
          )::int
        `.as('currentAttendance'),
        eb.ref('s.booking_payment_type').as('bookingPaymentType'),
        eb.ref('s.request_client_address_online').as('requestClientAddressOnline'),
        eb.ref('s.booking_question').as('bookingQuestion'),
        eb.ref('s.booking_question_state').as('bookingQuestionState'),
        eb.ref('s.maximum_attendance').as('maximumAttendance'),
        eb.ref('s.location').as('location'),
        eb.ref('s.address').as('address'),
        eb.ref('s.geo').as('geo'),
        eb.ref('s.google_place_id').as('googlePlaceId'),
        eb.ref('series.price').as('price'),
      ])
      .where('series.trainer_id', '=', provider.id)
      .where('series.event_type', '=', 'group_session')
      .where('s.bookable_online', '=', true)
      .where(({ eb }) =>
        eb(
          's.start',
          '<',
          sql<Date>`NOW() + ${sql.ref('trainer.online_bookings_duration_until_booking_window_closes')}`
        )
      )
      .where(({ eb }) =>
        eb(
          's.start',
          '>=',
          sql<Date>`NOW() + ${sql.ref('trainer.online_bookings_duration_until_booking_window_opens')}`
        )
      )
      .orderBy('s.start', 'asc')
      .execute()) as RawEventRow[]

    const events = eventListSchema.parse(rows.map(mapRowToEvent))

    return NextResponse.json(events)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse event data from database',
          detail: 'Event data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch events', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch events',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
