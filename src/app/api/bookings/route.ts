import type { Kysely, Transaction, Insertable } from 'kysely'
import { sql } from 'kysely'
import type { IPostgresInterval } from 'postgres-interval'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { Database, Interval } from '@/lib/db'
import type { Point } from '@/lib/db/generated'
import { db } from '@/lib/db'
import { toPoint } from '@/lib/db/values'
import { enqueueWorkflowTask } from '@/server/workflow/outbox'
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

const joinIgnoreEmpty = (...parts: Array<string | null | undefined>) =>
  parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter((part) => part.length > 0)
    .join(' ')

const formatBookingRange = (start: Date, end: Date, locale: string, timezone: string) => {
  const formatter = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    hour: 'numeric',
    minute: 'numeric',
    timeZoneName: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: timezone,
  })

  return formatter.formatRange(start, end)
}

const formatCurrency = (amount: number, locale: string, currency?: string | null) => {
  if (!currency) {
    return undefined
  }

  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount)
}

const buildBookingNotificationPayload = (params: {
  userId: string
  clientId: string
  clientFirstName: string | null
  clientLastName: string | null
  bookingName: string | null
  bookingStartsAt: Date
  bookingEndsAt: Date
  locale: string
  timezone: string
  paymentAmount?: number
  currency?: string | null
}) => {
  const bookingRangeString = formatBookingRange(
    params.bookingStartsAt,
    params.bookingEndsAt,
    params.locale,
    params.timezone
  )
  const clientName = joinIgnoreEmpty(params.clientFirstName, params.clientLastName)
  const amountString =
    params.paymentAmount && params.paymentAmount > 0
      ? formatCurrency(params.paymentAmount, params.locale, params.currency)
      : undefined
  const bookingName = params.bookingName ?? 'an appointment'
  const paidText = amountString ? ` paid ${amountString} and` : ''

  return {
    clientId: params.clientId,
    userId: params.userId,
    title: 'New online booking',
    body: `${clientName || 'A client'} has${paidText} booked ${bookingName} at ${bookingRangeString}`,
    messageType: 'default' as const,
    notificationType: 'general' as const,
  }
}

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
  userId: string
  locale: string | null
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
  if (value === null || value === undefined) {
    return 0
  }
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

type DbExecutor = Kysely<Database> | Transaction<Database>

const fetchExistingClients = async (
  executor: DbExecutor,
  trainerId: string,
  email: string
): Promise<ExistingClient[]> => {
  const normalizedEmail = email.trim().toLowerCase()

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
    .where((eb) => eb(eb.fn('lower', [eb.ref('client.email')]), '=', normalizedEmail))
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
      geo: data.geo ? toPoint(data.geo.lat, data.geo.lng) : null,
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
  if (data.location !== undefined) {
    updates.location = data.location
  }
  if (data.address !== undefined) {
    updates.address = data.address
  }
  if (data.googlePlaceId !== undefined) {
    updates.google_place_id = data.googlePlaceId
  }
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
      const bookingTime = new Date(data.bookingTime)
      const detailsRow = await trx
        .selectFrom('service')
        .innerJoin('product', 'product.id', 'service.id')
        .innerJoin('trainer', 'trainer.id', 'service.trainer_id')
        .innerJoin('currency', 'currency.id', 'product.currency_id')
        .select((eb) => [
          eb
            .fn<boolean>('is_booking_time_available', [eb.ref('service.id'), eb.val(bookingTime)])
            .as('bookingTimeAvailable'),
          eb(
            eb.val(bookingTime),
            '>=',
            sql<Date>`now() + ${sql.ref('trainer.online_bookings_duration_until_booking_window_opens')}`
          ).as('afterWindowOpens'),
          eb(
            eb.val(bookingTime),
            '<',
            sql<Date>`now() + ${sql.ref('trainer.online_bookings_duration_until_booking_window_closes')}`
          ).as('beforeWindowCloses'),
          eb.ref('service.bookable_online').as('bookableOnline'),
          eb.ref('trainer.online_bookings_enabled').as('onlineBookingsEnabled'),
          eb.ref('trainer.id').as('trainerId'),
          eb.ref('trainer.timezone').as('timezone'),
          eb.ref('trainer.locale').as('locale'),
          eb.ref('trainer.user_id').as('userId'),
          eb.ref('trainer.business_name').as('businessName'),
          eb.ref('trainer.first_name').as('trainerFirstName'),
          eb.ref('trainer.last_name').as('trainerLastName'),
          eb.ref('trainer.online_bookings_contact_email').as('onlineBookingsContactEmail'),
          eb.ref('trainer.email').as('trainerEmail'),
          eb.ref('trainer.online_bookings_show_contact_number').as('onlineBookingsShowContactNumber'),
          eb.ref('trainer.online_bookings_contact_number').as('onlineBookingsContactNumber'),
          eb.ref('trainer.phone_number').as('trainerPhoneNumber'),
          eb.ref('product.name').as('bookingName'),
          eb.ref('product.description').as('serviceDescription'),
          eb.ref('product.price').as('bookingPrice'),
          eb.ref('service.duration').as('serviceDuration'),
          eb.val(bookingTime).as('bookingStartsAt'),
          sql<Date>`${bookingTime} + ${sql.ref('service.duration')}`.as('bookingEndsAt'),
          eb.ref('service.location').as('bookingLocation'),
          eb.ref('service.address').as('bookingAddress'),
          eb.ref('service.google_place_id').as('bookingGooglePlaceId'),
          eb.ref('service.geo').as('serviceGeo'),
          eb.ref('service.booking_payment_type').as('bookingPaymentType'),
          eb.ref('service.request_client_address_online').as('bookingRequestClientAddressOnline'),
          eb.ref('service.booking_question').as('bookingQuestion'),
          eb.ref('service.booking_question_state').as('bookingQuestionState'),
          eb.ref('service.buffer_minutes_before').as('bufferMinutesBefore'),
          eb.ref('service.buffer_minutes_after').as('bufferMinutesAfter'),
          eb.ref('currency.alpha_code').as('currency'),
        ])
        .where('service.id', '=', data.serviceId)
        .executeTakeFirst()

      const details = detailsRow
        ? {
            bookingTimeAvailable: detailsRow.bookingTimeAvailable,
            afterWindowOpens: detailsRow.afterWindowOpens,
            beforeWindowCloses: detailsRow.beforeWindowCloses,
            bookableOnline: detailsRow.bookableOnline,
            onlineBookingsEnabled: detailsRow.onlineBookingsEnabled,
            trainerId: detailsRow.trainerId,
            timezone: detailsRow.timezone,
            locale: detailsRow.locale,
            userId: detailsRow.userId,
            serviceProviderBusinessName:
              detailsRow.businessName ?? joinIgnoreEmpty(detailsRow.trainerFirstName, detailsRow.trainerLastName),
            serviceProviderContactEmail: detailsRow.onlineBookingsContactEmail ?? detailsRow.trainerEmail,
            serviceProviderContactNumber: detailsRow.onlineBookingsShowContactNumber
              ? (detailsRow.onlineBookingsContactNumber ?? detailsRow.trainerPhoneNumber)
              : null,
            bookingName: detailsRow.bookingName,
            serviceDescription: detailsRow.serviceDescription,
            bookingPrice: detailsRow.bookingPrice !== null ? String(detailsRow.bookingPrice) : null,
            serviceDuration: detailsRow.serviceDuration,
            bookingStartsAt: detailsRow.bookingStartsAt,
            bookingEndsAt: detailsRow.bookingEndsAt,
            bookingLocation: detailsRow.bookingLocation,
            bookingAddress: detailsRow.bookingAddress,
            bookingGooglePlaceId: detailsRow.bookingGooglePlaceId,
            bookingGeo: detailsRow.serviceGeo ? { lat: detailsRow.serviceGeo.x, lng: detailsRow.serviceGeo.y } : null,
            bookingPaymentType: detailsRow.bookingPaymentType,
            bookingRequestClientAddressOnline: detailsRow.bookingRequestClientAddressOnline,
            bookingQuestion: detailsRow.bookingQuestion,
            bookingQuestionState: detailsRow.bookingQuestionState,
            bufferMinutesBefore: detailsRow.bufferMinutesBefore,
            bufferMinutesAfter: detailsRow.bufferMinutesAfter,
            currency: detailsRow.currency,
          }
        : null
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
        throw new TypeError('Invalid booking start time')
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

      const bookingEndsAt = new Date(details.bookingEndsAt)
      const locale = details.locale ?? 'en-US'
      const paymentAmount = data.payment?.amount ? Number.parseFloat(data.payment.amount) : undefined

      const notificationPayload = buildBookingNotificationPayload({
        userId: details.userId,
        clientId: clientRecord.id,
        clientFirstName: clientRecord.firstName,
        clientLastName: clientRecord.lastName,
        bookingName: details.bookingName,
        bookingStartsAt,
        bookingEndsAt,
        locale,
        timezone: details.timezone,
        paymentAmount: Number.isFinite(paymentAmount ?? NaN) ? paymentAmount : undefined,
        currency: details.currency ?? data.payment?.currency ?? null,
      })

      const bookingId = clientSession.booking_id ?? clientSession.id

      await enqueueWorkflowTask(trx, 'user.notify', notificationPayload, {
        dedupeKey: `user.notify:onlineBooking:${bookingId}`,
      })

      return {
        ok: true,
        bookingId,
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
      const detailsRow = await trx
        .selectFrom('session')
        .innerJoin('session_series', 'session_series.id', 'session.session_series_id')
        .innerJoin('trainer', 'trainer.id', 'session.trainer_id')
        .innerJoin('supported_country_currency', 'supported_country_currency.country_id', 'trainer.country_id')
        .innerJoin('currency', 'currency.id', 'supported_country_currency.currency_id')
        .select((eb) => [
          eb.ref('session.id').as('sessionId'),
          eb.ref('session.trainer_id').as('trainerId'),
          eb.ref('session.bookable_online').as('bookableOnline'),
          eb.ref('trainer.online_bookings_enabled').as('onlineBookingsEnabled'),
          eb.ref('trainer.user_id').as('userId'),
          eb.ref('trainer.locale').as('locale'),
          eb.ref('session.start').as('bookingStartsAt'),
          sql<Date>`(${sql.ref('session.start')} + ${sql.ref('session.duration')})`.as('bookingEndsAt'),
          eb.ref('session.duration').as('serviceDuration'),
          eb.ref('session.booking_payment_type').as('bookingPaymentType'),
          eb.ref('session.request_client_address_online').as('bookingRequestClientAddressOnline'),
          eb.ref('session.booking_question').as('bookingQuestion'),
          eb.ref('session.booking_question_state').as('bookingQuestionState'),
          eb.ref('session.location').as('bookingLocation'),
          eb.ref('session.address').as('bookingAddress'),
          eb.ref('session.google_place_id').as('bookingGooglePlaceId'),
          eb.ref('session.geo').as('bookingGeo'),
          eb.ref('session.buffer_minutes_before').as('bufferMinutesBefore'),
          eb.ref('session.buffer_minutes_after').as('bufferMinutesAfter'),
          eb.ref('session_series.name').as('bookingName'),
          eb.ref('session_series.description').as('serviceDescription'),
          eb.ref('session_series.timezone').as('timezone'),
          eb.ref('session.maximum_attendance').as('maximumAttendance'),
          eb
            .fn('coalesce', [
              eb(
                eb.ref('session.maximum_attendance'),
                '-',
                eb
                  .selectFrom('client_session')
                  .select((sub) => sub.fn.count<number>('client_session.id').as('count'))
                  .whereRef('client_session.session_id', '=', 'session.id')
                  .where('client_session.state', 'in', ['accepted', 'confirmed'])
              ),
              eb.val(1),
            ])
            .as('availableSpots'),
          eb(
            eb.ref('session.start'),
            '>=',
            sql<Date>`now() + ${sql.ref('trainer.online_bookings_duration_until_booking_window_opens')}`
          ).as('afterWindowOpens'),
          eb(
            eb.ref('session.start'),
            '<',
            sql<Date>`now() + ${sql.ref('trainer.online_bookings_duration_until_booking_window_closes')}`
          ).as('beforeWindowCloses'),
          eb.ref('session_series.price').as('bookingPrice'),
          eb.ref('currency.alpha_code').as('currency'),
        ])
        .where('session.id', '=', data.sessionId)
        .executeTakeFirst()

      const details = detailsRow
        ? {
            sessionId: detailsRow.sessionId,
            trainerId: detailsRow.trainerId,
            userId: detailsRow.userId,
            locale: detailsRow.locale,
            bookableOnline: detailsRow.bookableOnline,
            onlineBookingsEnabled: detailsRow.onlineBookingsEnabled,
            bookingStartsAt: detailsRow.bookingStartsAt,
            bookingEndsAt: detailsRow.bookingEndsAt,
            serviceDuration: detailsRow.serviceDuration,
            bookingPaymentType: detailsRow.bookingPaymentType,
            bookingRequestClientAddressOnline: detailsRow.bookingRequestClientAddressOnline,
            bookingQuestion: detailsRow.bookingQuestion,
            bookingQuestionState: detailsRow.bookingQuestionState,
            bookingLocation: detailsRow.bookingLocation,
            bookingAddress: detailsRow.bookingAddress,
            bookingGooglePlaceId: detailsRow.bookingGooglePlaceId,
            bookingGeo: detailsRow.bookingGeo ? { lat: detailsRow.bookingGeo.x, lng: detailsRow.bookingGeo.y } : null,
            bufferMinutesBefore: detailsRow.bufferMinutesBefore,
            bufferMinutesAfter: detailsRow.bufferMinutesAfter,
            bookingName: detailsRow.bookingName,
            serviceDescription: detailsRow.serviceDescription,
            timezone: detailsRow.timezone,
            maximumAttendance: detailsRow.maximumAttendance,
            availableSpots: Number(detailsRow.availableSpots),
            afterWindowOpens: detailsRow.afterWindowOpens,
            beforeWindowCloses: detailsRow.beforeWindowCloses,
            bookingPrice: detailsRow.bookingPrice !== null ? String(detailsRow.bookingPrice) : null,
            currency: detailsRow.currency,
          }
        : null
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
        throw new TypeError('Invalid booking start time')
      }

      const clientAlreadyBooked = await trx
        .selectFrom('client_session')
        .select('client_session.id')
        .innerJoin('client', 'client.id', 'client_session.client_id')
        .where('client_session.session_id', '=', details.sessionId)
        .where((eb) => eb(eb.fn('lower', [eb.ref('client.email')]), '=', data.email.toLowerCase()))
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

      const bookingEndsAt = new Date(details.bookingEndsAt)
      const locale = details.locale ?? 'en-US'
      const paymentAmount = data.payment?.amount ? Number.parseFloat(data.payment.amount) : undefined

      const notificationPayload = buildBookingNotificationPayload({
        userId: details.userId,
        clientId: clientRecord.id,
        clientFirstName: clientRecord.firstName,
        clientLastName: clientRecord.lastName,
        bookingName: details.bookingName,
        bookingStartsAt,
        bookingEndsAt,
        locale,
        timezone: details.timezone,
        paymentAmount: Number.isFinite(paymentAmount ?? NaN) ? paymentAmount : undefined,
        currency: details.currency ?? data.payment?.currency ?? null,
      })

      const bookingId = clientSession.booking_id ?? clientSession.id

      await enqueueWorkflowTask(trx, 'user.notify', notificationPayload, {
        dedupeKey: `user.notify:onlineBooking:${bookingId}`,
      })

      return {
        ok: true,
        bookingId,
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
