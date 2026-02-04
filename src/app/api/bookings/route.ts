import { NextResponse } from 'next/server'
import { db, sql } from '@/lib/db'
import type { Database, Interval } from '@/lib/db'
import type { Kysely, Transaction, Insertable } from 'kysely'
import type { Point } from '@/lib/db/generated'
import type { IPostgresInterval } from 'postgres-interval'
import { z } from 'zod'
import { buildErrorResponse } from '../_lib/accessToken'
import { parseStrictJsonBody } from '../_lib/strictJson'

/**
 * Shared schemas
 */
const moneyReg = /^(?:-\d)?\d*?(?:\.\d+)?$/

const geoSchema = z.object({
  lat: z.number(),
  lng: z.number(),
})

const baseBookingSchema = z.object({
  email: z.string({ message: 'email is required' }).email('email must be valid'),
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().optional().nullable(),
  phoneNumber: z.string().trim().optional().nullable(),
  existingClient: z.boolean().optional(),
  timezone: z.string().trim().optional().nullable(),
  location: z.string().trim().optional().nullable(),
  address: z.string().trim().optional().nullable(),
  geo: geoSchema.optional().nullable(),
  googlePlaceId: z.string().trim().optional().nullable(),
  bookingQuestionResponse: z.string().trim().optional().nullable(),
  payment: z
    .object({
      amount: z
        .string()
        .refine((value) => moneyReg.test(value), 'amount must be Money')
        .refine((value) => Number.parseFloat(value) >= 0, 'amount must be greater than or equal to 0'),
      currency: z.string().optional(),
      stripePaymentMethodId: z.string().optional(),
      stripePaymentIntentId: z.string().optional(),
    })
    .optional(),
})

const serviceBookingSchema = baseBookingSchema.extend({
  serviceId: z.string().min(1, 'serviceId must not be empty'),
  bookingTime: z.string({ message: 'bookingTime is required' }).datetime({ offset: true }),
})

const sessionBookingSchema = baseBookingSchema.extend({
  sessionId: z.string().min(1, 'sessionId must not be empty'),
})

const requestSchema = z.union([serviceBookingSchema, sessionBookingSchema])

/**
 * Response helpers
 */
const makeError = (status: number, title: string, type: string, detail?: string) =>
  NextResponse.json(
    buildErrorResponse({
      status,
      title,
      detail,
      type,
    }),
    { status }
  )

const invalidBodyResponse = (detail?: string) =>
  makeError(400, 'Invalid request body', '/invalid-body', detail ?? 'Request body did not match the expected schema.')

type ServiceBookingDetails = {
  bookingTimeAvailable: boolean
  afterWindowOpens: boolean
  beforeWindowCloses: boolean
  bookableOnline: boolean
  onlineBookingsEnabled: boolean
  trainerId: string
  timezone: string
  locale: string | null
  userId: string
  serviceProviderBusinessName: string | null
  serviceProviderContactEmail: string | null
  serviceProviderContactNumber: string | null
  bookingName: string | null
  serviceDescription: string | null
  bookingPrice: string | null
  serviceDuration: Interval
  bookingStartsAt: Date | string
  bookingEndsAt: Date | string
  bookingLocation: string | null
  bookingAddress: string | null
  bookingGooglePlaceId: string | null
  bookingGeo: { lat: number; lng: number } | null
  bookingPaymentType: string
  bookingRequestClientAddressOnline: string | null
  bookingQuestion: string | null
  bookingQuestionState: string | null
  bufferMinutesBefore: number | null
  bufferMinutesAfter: number | null
  currency: string | null
}

type SessionBookingDetails = {
  sessionId: string
  trainerId: string
  bookableOnline: boolean
  onlineBookingsEnabled: boolean
  bookingStartsAt: Date | string
  bookingEndsAt: Date | string
  serviceDuration: Interval
  bookingPaymentType: string
  bookingRequestClientAddressOnline: string | null
  bookingQuestion: string | null
  bookingQuestionState: string | null
  bookingLocation: string | null
  bookingAddress: string | null
  bookingGooglePlaceId: string | null
  bookingGeo: { lat: number; lng: number } | null
  bufferMinutesBefore: number | null
  bufferMinutesAfter: number | null
  bookingName: string | null
  serviceDescription: string | null
  timezone: string
  maximumAttendance: number | null
  availableSpots: number
  afterWindowOpens: boolean
  beforeWindowCloses: boolean
  bookingPrice: string | null
  currency: string | null
}

type ExistingClient = {
  id: string
  firstName: string
  lastName: string | null
  email: string | null
  phoneNumber: string | null
  stripeCustomerId: string | null
  location: string | null
  address: string | null
  geo: { x: number; y: number } | null
  googlePlaceId: string | null
}

const toNumber = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) return 0
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

type DbExecutor = Kysely<Database> | Transaction<Database>

const fetchExistingClients = async (
  executor: DbExecutor,
  trainerId: string,
  email: string
): Promise<ExistingClient[]> => {
  return executor
    .selectFrom('client')
    .select((eb) => [
      eb.ref('client.id').as('id'),
      eb.ref('client.first_name').as('firstName'),
      eb.ref('client.last_name').as('lastName'),
      eb.ref('client.email').as('email'),
      eb.ref('client.mobile_number').as('phoneNumber'),
      eb.ref('client.stripe_customer_id').as('stripeCustomerId'),
      eb.ref('client.location').as('location'),
      eb.ref('client.address').as('address'),
      eb.ref('client.geo').as('geo'),
      eb.ref('client.google_place_id').as('googlePlaceId'),
    ])
    .where('client.trainer_id', '=', trainerId)
    .where(sql<boolean>`LOWER(client.email) = LOWER(${email})`)
    .execute()
}

const createClient = async (executor: DbExecutor, trainerId: string, data: z.infer<typeof baseBookingSchema>) => {
  if (!data.firstName) {
    throw new Error('First name is required for new clients')
  }

  const userRow = await executor.insertInto('user_').values({ type: 'client' }).returning('id').executeTakeFirst()

  if (!userRow) {
    throw new Error('Failed to create user record for client')
  }

  const clientRow = await executor
    .insertInto('client')
    .values({
      trainer_id: trainerId,
      user_id: userRow.id,
      email: data.email,
      first_name: data.firstName,
      last_name: data.lastName ?? null,
      mobile_number: data.phoneNumber ?? null,
      status: 'current',
      location: data.location ?? null,
      address: data.address ?? null,
      geo: data.geo ? sql`point(${data.geo.lat}, ${data.geo.lng})` : null,
      google_place_id: data.googlePlaceId ?? null,
    })
    .returning((eb) => [
      eb.ref('client.id').as('id'),
      eb.ref('client.first_name').as('firstName'),
      eb.ref('client.last_name').as('lastName'),
      eb.ref('client.email').as('email'),
      eb.ref('client.mobile_number').as('phoneNumber'),
      eb.ref('client.stripe_customer_id').as('stripeCustomerId'),
      eb.ref('client.location').as('location'),
      eb.ref('client.address').as('address'),
      eb.ref('client.geo').as('geo'),
      eb.ref('client.google_place_id').as('googlePlaceId'),
    ])
    .executeTakeFirst()

  if (!clientRow) {
    throw new Error('Failed to create client')
  }

  return clientRow
}

const maybeUpdateClient = async (
  executor: DbExecutor,
  client: ExistingClient,
  data: z.infer<typeof baseBookingSchema>
) => {
  if (
    data.location === undefined &&
    data.address === undefined &&
    data.geo === undefined &&
    data.googlePlaceId === undefined
  ) {
    return client
  }

  const updates: Partial<Insertable<Database['client']>> = {}
  if (data.location !== undefined) updates.location = data.location
  if (data.address !== undefined) updates.address = data.address
  if (data.googlePlaceId !== undefined) updates.google_place_id = data.googlePlaceId
  if (data.geo !== undefined) {
    updates.geo = data.geo ? ({ x: data.geo.lat, y: data.geo.lng } satisfies Point) : null
  }

  const updated = await executor
    .updateTable('client')
    .set(updates)
    .where('client.id', '=', client.id)
    .returning((eb) => [
      eb.ref('client.id').as('id'),
      eb.ref('client.first_name').as('firstName'),
      eb.ref('client.last_name').as('lastName'),
      eb.ref('client.email').as('email'),
      eb.ref('client.mobile_number').as('phoneNumber'),
      eb.ref('client.stripe_customer_id').as('stripeCustomerId'),
      eb.ref('client.location').as('location'),
      eb.ref('client.address').as('address'),
      eb.ref('client.geo').as('geo'),
      eb.ref('client.google_place_id').as('googlePlaceId'),
    ])
    .executeTakeFirst()

  return updated ?? client
}

export async function POST(request: Request) {
  let parsed: z.infer<typeof requestSchema>

  const parsedJson = await parseStrictJsonBody(request)
  if (!parsedJson.ok) {
    return parsedJson.response
  }

  const validation = requestSchema.safeParse(parsedJson.data)
  if (!validation.success) {
    const detail = validation.error.issues.map((issue) => issue.message).join('; ')
    return invalidBodyResponse(detail || undefined)
  }
  parsed = validation.data

  if ('serviceId' in parsed) {
    return handleServiceBooking(parsed)
  }

  return handleSessionBooking(parsed)
}

const handleServiceBooking = async (data: z.infer<typeof serviceBookingSchema>) => {
  try {
    const result = await db.transaction().execute(async (trx) => {
      const detailsResult = await sql<ServiceBookingDetails>`
        SELECT
          is_booking_time_available(service.id, ${data.bookingTime}::timestamptz) AS "bookingTimeAvailable",
          (${data.bookingTime}::timestamptz >= NOW() + trainer.online_bookings_duration_until_booking_window_opens) AS "afterWindowOpens",
          (${data.bookingTime}::timestamptz < NOW() + trainer.online_bookings_duration_until_booking_window_closes) AS "beforeWindowCloses",
          service.bookable_online AS "bookableOnline",
          trainer.online_bookings_enabled AS "onlineBookingsEnabled",
          trainer.id AS "trainerId",
          trainer.timezone AS "timezone",
          trainer.locale AS "locale",
          trainer.user_id AS "userId",
          COALESCE(
            trainer.business_name,
            trainer.first_name || COALESCE(' ' || trainer.last_name, '')
          ) AS "serviceProviderBusinessName",
          COALESCE(trainer.online_bookings_contact_email, trainer.email) AS "serviceProviderContactEmail",
          CASE
            WHEN trainer.online_bookings_show_contact_number THEN COALESCE(trainer.online_bookings_contact_number, trainer.phone_number)
            ELSE NULL
          END AS "serviceProviderContactNumber",
          product.name AS "bookingName",
          product.description AS "serviceDescription",
          product.price::text AS "bookingPrice",
          service.duration AS "serviceDuration",
          ${data.bookingTime}::timestamptz AS "bookingStartsAt",
          ${data.bookingTime}::timestamptz + service.duration AS "bookingEndsAt",
          service.location AS "bookingLocation",
          service.address AS "bookingAddress",
          service.google_place_id AS "bookingGooglePlaceId",
          CASE
            WHEN service.geo IS NOT NULL THEN json_build_object('lat', service.geo[0], 'lng', service.geo[1])
            ELSE NULL
          END AS "bookingGeo",
          service.booking_payment_type AS "bookingPaymentType",
          service.request_client_address_online AS "bookingRequestClientAddressOnline",
          service.booking_question AS "bookingQuestion",
          service.booking_question_state AS "bookingQuestionState",
          service.buffer_minutes_before AS "bufferMinutesBefore",
          service.buffer_minutes_after AS "bufferMinutesAfter",
          currency.alpha_code AS "currency"
        FROM service
        JOIN product ON product.id = service.id
        JOIN trainer ON trainer.id = service.trainer_id
        JOIN currency ON currency.id = product.currency_id
        WHERE service.id = ${data.serviceId}
      `.execute(trx)

      const details = detailsResult.rows[0]
      if (!details) {
        return {
          ok: false,
          response: makeError(404, 'Service not found', '/resource-not-found'),
        } as const
      }

      if (!details.onlineBookingsEnabled) {
        return {
          ok: false,
          response: makeError(
            409,
            'Service provider does not have online bookings enabled.',
            '/service-provider-online-bookings-disabled'
          ),
        } as const
      }

      if (!details.bookableOnline) {
        return {
          ok: false,
          response: makeError(
            409,
            'This service is not available for online bookings.',
            '/service-not-bookable-online'
          ),
        } as const
      }

      if (!details.bookingTimeAvailable || !details.afterWindowOpens || !details.beforeWindowCloses) {
        return {
          ok: false,
          response: makeError(409, 'That booking time is unavailable.', '/booking-time-unavailable'),
        } as const
      }

      const existingClients = await fetchExistingClients(trx, details.trainerId, data.email)

      if (existingClients.length > 1) {
        return {
          ok: false,
          response: makeError(
            409,
            'The provided email is associated with more than one client.',
            '/booking-email-has-multiple-clients'
          ),
        } as const
      }

      const foundClient = existingClients[0]

      if (data.existingClient && !foundClient) {
        return {
          ok: false,
          response: makeError(
            409,
            "Can't find a client with that email for this service provider.",
            '/booking-email-has-no-client'
          ),
        } as const
      }

      const addressRequired = details.bookingRequestClientAddressOnline === 'required'
      const hasAddress = data.location ?? data.address ?? foundClient?.location ?? foundClient?.address

      if (addressRequired && !hasAddress) {
        return {
          ok: false,
          response: makeError(409, 'This booking requires you to provide your address.', '/booking-requires-address'),
        } as const
      }

      const bookingQuestionRequired = details.bookingQuestionState === 'required' && details.bookingQuestion
      if (bookingQuestionRequired && !data.bookingQuestionResponse) {
        return {
          ok: false,
          response: makeError(
            409,
            'This booking requires you to provide a question response',
            '/booking-requires-question-response'
          ),
        } as const
      }

      const priceNumber = toNumber(details.bookingPrice)
      if (details.bookingPaymentType === 'fullPrepayment' && priceNumber > 0) {
        return {
          ok: false,
          response: makeError(409, 'This booking must be fully prepaid.', '/booking-requires-deposit'),
        } as const
      }

      const clientRecord = foundClient
        ? await maybeUpdateClient(trx, foundClient, data)
        : await createClient(trx, details.trainerId, data)

      const bookingStartsAt = new Date(details.bookingStartsAt)
      if (Number.isNaN(bookingStartsAt.getTime())) {
        throw new Error('Invalid booking start time')
      }

      const sessionSeries = await trx
        .insertInto('session_series')
        .values({
          trainer_id: details.trainerId,
          event_type: 'single_session',
          duration: details.serviceDuration as unknown as IPostgresInterval,
          start: bookingStartsAt,
          price: details.bookingPrice ?? '0',
          timezone: details.timezone,
          name: details.bookingName,
        })
        .returning('id')
        .executeTakeFirst()

      if (!sessionSeries) {
        throw new Error('Failed to create session series for booking')
      }

      const session = await trx
        .insertInto('session')
        .values({
          session_series_id: sessionSeries.id,
          start: bookingStartsAt,
          duration: details.serviceDuration as unknown as IPostgresInterval,
          timezone: details.timezone,
          service_id: data.serviceId,
          booked_online: true,
          trainer_id: details.trainerId,
          location: details.bookingLocation,
          address: details.bookingAddress,
          geo: details.bookingGeo ? ({ x: details.bookingGeo.lat, y: details.bookingGeo.lng } satisfies Point) : null,
          google_place_id: details.bookingGooglePlaceId,
          booking_payment_type: details.bookingPaymentType,
          request_client_address_online: details.bookingRequestClientAddressOnline,
          booking_question: details.bookingQuestion,
          booking_question_state: details.bookingQuestionState,
          buffer_minutes_before: details.bufferMinutesBefore ?? undefined,
          buffer_minutes_after: details.bufferMinutesAfter ?? undefined,
        })
        .returning('id')
        .executeTakeFirst()

      if (!session) {
        throw new Error('Failed to create session for booking')
      }

      const clientSession = await trx
        .insertInto('client_session')
        .values({
          trainer_id: details.trainerId,
          client_id: clientRecord.id,
          session_id: session.id,
          price: details.bookingPrice ?? null,
          booked_online: true,
          booking_question: details.bookingQuestion,
          booking_question_response: details.bookingQuestion ? (data.bookingQuestionResponse ?? null) : null,
        })
        .returning(['id', 'booking_id'])
        .executeTakeFirst()

      if (!clientSession) {
        throw new Error('Failed to create client session for booking')
      }

      return {
        ok: true,
        bookingId: clientSession.booking_id ?? clientSession.id,
      } as const
    })

    if (!result.ok) {
      return result.response
    }

    return NextResponse.json({ id: result.bookingId })
  } catch (error) {
    console.error('Failed to create booking (service)', error)
    return makeError(500, 'Failed to create booking', '/internal-server-error')
  }
}

const handleSessionBooking = async (data: z.infer<typeof sessionBookingSchema>) => {
  try {
    const result = await db.transaction().execute(async (trx) => {
      const detailsResult = await sql<SessionBookingDetails>`
        SELECT
          session.id AS "sessionId",
          session.trainer_id AS "trainerId",
          session.bookable_online AS "bookableOnline",
          trainer.online_bookings_enabled AS "onlineBookingsEnabled",
          session.start AS "bookingStartsAt",
          session.start + session.duration AS "bookingEndsAt",
          session.duration AS "serviceDuration",
          session.booking_payment_type AS "bookingPaymentType",
          session.request_client_address_online AS "bookingRequestClientAddressOnline",
          session.booking_question AS "bookingQuestion",
          session.booking_question_state AS "bookingQuestionState",
          session.location AS "bookingLocation",
          session.address AS "bookingAddress",
          session.google_place_id AS "bookingGooglePlaceId",
          CASE
            WHEN session.geo IS NOT NULL THEN json_build_object('lat', session.geo[0], 'lng', session.geo[1])
            ELSE NULL
          END AS "bookingGeo",
          session.buffer_minutes_before AS "bufferMinutesBefore",
          session.buffer_minutes_after AS "bufferMinutesAfter",
          session_series.name AS "bookingName",
          session_series.description AS "serviceDescription",
          session_series.timezone AS "timezone",
          session.maximum_attendance AS "maximumAttendance",
          COALESCE(
            session.maximum_attendance - (
              SELECT count(*)
              FROM client_session
              WHERE client_session.session_id = session.id
              AND client_session.state IN ('accepted','confirmed')
            ),
            1
          )::int AS "availableSpots",
          (session.start >= NOW() + trainer.online_bookings_duration_until_booking_window_opens) AS "afterWindowOpens",
          (session.start < NOW() + trainer.online_bookings_duration_until_booking_window_closes) AS "beforeWindowCloses",
          session_series.price::text AS "bookingPrice",
          currency.alpha_code AS "currency"
        FROM session
        JOIN session_series ON session_series.id = session.session_series_id
        JOIN trainer ON trainer.id = session.trainer_id
        JOIN supported_country_currency ON supported_country_currency.country_id = trainer.country_id
        JOIN currency ON currency.id = supported_country_currency.currency_id
        WHERE session.id = ${data.sessionId}
      `.execute(trx)

      const details = detailsResult.rows[0]
      if (!details) {
        return {
          ok: false,
          response: makeError(
            404,
            'Session not found',
            '/resource-not-found',
            'No session matched the provided sessionId.'
          ),
        } as const
      }

      if (!details.onlineBookingsEnabled) {
        return {
          ok: false,
          response: makeError(
            409,
            'Service provider does not have online bookings enabled.',
            '/service-provider-online-bookings-disabled'
          ),
        } as const
      }

      if (!details.bookableOnline) {
        return {
          ok: false,
          response: makeError(
            409,
            'This session is not available for online bookings.',
            '/session-not-bookable-online'
          ),
        } as const
      }

      if (!details.afterWindowOpens || !details.beforeWindowCloses) {
        return {
          ok: false,
          response: makeError(409, 'That booking time is unavailable.', '/booking-time-unavailable'),
        } as const
      }

      if (details.availableSpots <= 0) {
        return {
          ok: false,
          response: makeError(409, 'This event is full.', '/event-is-full'),
        } as const
      }

      const existingClients = await fetchExistingClients(trx, details.trainerId, data.email)

      if (existingClients.length > 1) {
        return {
          ok: false,
          response: makeError(
            409,
            'The provided email is associated with more than one client.',
            '/booking-email-has-multiple-clients'
          ),
        } as const
      }

      const foundClient = existingClients[0]

      if (data.existingClient && !foundClient) {
        return {
          ok: false,
          response: makeError(
            409,
            "Can't find a client with that email for this service provider.",
            '/booking-email-has-no-client'
          ),
        } as const
      }

      const addressRequired = details.bookingRequestClientAddressOnline === 'required'
      const hasAddress = data.location ?? data.address ?? foundClient?.location ?? foundClient?.address

      if (addressRequired && !hasAddress) {
        return {
          ok: false,
          response: makeError(409, 'This booking requires you to provide your address.', '/booking-requires-address'),
        } as const
      }

      const bookingQuestionRequired = details.bookingQuestionState === 'required' && details.bookingQuestion
      if (bookingQuestionRequired && !data.bookingQuestionResponse) {
        return {
          ok: false,
          response: makeError(
            409,
            'This booking requires you to provide a question response',
            '/booking-requires-question-response'
          ),
        } as const
      }

      const priceNumber = toNumber(details.bookingPrice)
      if (details.bookingPaymentType === 'fullPrepayment' && priceNumber > 0) {
        return {
          ok: false,
          response: makeError(409, 'This booking must be fully prepaid.', '/booking-requires-deposit'),
        } as const
      }

      const clientRecord = foundClient
        ? await maybeUpdateClient(trx, foundClient, data)
        : await createClient(trx, details.trainerId, data)

      const bookingStartsAt = new Date(details.bookingStartsAt)
      if (Number.isNaN(bookingStartsAt.getTime())) {
        throw new Error('Invalid booking start time')
      }

      const clientAlreadyBooked = await trx
        .selectFrom('client_session')
        .select(sql`TRUE`.as('exists'))
        .innerJoin('client', 'client.id', 'client_session.client_id')
        .where('client_session.session_id', '=', details.sessionId)
        .where(sql<boolean>`LOWER(client.email) = LOWER(${data.email})`)
        .executeTakeFirst()

      if (clientAlreadyBooked) {
        return {
          ok: false,
          response: makeError(409, 'Client is already booked into this event.', '/already-booked-in-event'),
        } as const
      }

      const clientSession = await trx
        .insertInto('client_session')
        .values({
          trainer_id: details.trainerId,
          client_id: clientRecord.id,
          session_id: details.sessionId,
          price: details.bookingPrice ?? null,
          booked_online: true,
          booking_question: details.bookingQuestion,
          booking_question_response: details.bookingQuestion ? (data.bookingQuestionResponse ?? null) : null,
        })
        .returning(['id', 'booking_id'])
        .executeTakeFirst()

      if (!clientSession) {
        throw new Error('Failed to create client session booking')
      }

      return {
        ok: true,
        bookingId: clientSession.booking_id ?? clientSession.id,
      } as const
    })

    if (!result.ok) {
      return result.response
    }

    return NextResponse.json({ id: result.bookingId })
  } catch (error) {
    console.error('Failed to create booking (session)', error)
    return makeError(500, 'Failed to create booking', '/internal-server-error')
  }
}
