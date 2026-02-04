import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  addDaysToLocalDateTime,
  compareLocalDateTimes,
  isoLocalDateTimeToUtc,
  localDateTimeToUtc,
  parseIsoLocalDateTime,
} from '@/lib/dates/timezone'
import { db } from '@/lib/db'
import { intervalFromDays, intervalFromMinutes, toPoint } from '@/lib/db/values'
import { authenticateTrainerRequest, buildErrorResponse } from '../_lib/accessToken'
import { parseStrictJsonBody } from '../_lib/strictJson'
import { normalizeSessionSeriesRow, type RawSessionSeriesRow } from './shared'

const isoDateTimeSchema = z.string().trim().datetime({ offset: true })

const nullableTrimmedString = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return undefined
    }
    if (value === null) {
      return null
    }
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  })

const reminderSchema = z
  .object({
    type: z.enum(['email', 'notification', 'emailAndNotification']),
    timeBeforeStart: z.string().trim().min(1),
  })
  .nullable()
  .optional()

const clientReminderSchema = z
  .object({
    type: z.enum(['email', 'sms', 'emailAndSms']),
    timeBeforeStart: z.string().trim().min(1),
  })
  .nullable()
  .optional()

const geoSchema = z.object({ lat: z.number(), lng: z.number() }).nullable().optional()

const nonNegativeNumberSchema = z.preprocess(
  (value) => {
    if (value === null || value === undefined) {
      return value
    }
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.length === 0) {
        return Number.NaN
      }
      return Number(trimmed)
    }
    return value
  },
  z.number().min(0, { message: 'price must be a non-negative number' })
)

const nullableNonNegativeNumberSchema = z.preprocess(
  (value) => {
    if (value === null || value === undefined) {
      return value
    }
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.length === 0) {
        return Number.NaN
      }
      return Number(trimmed)
    }
    return value
  },
  z.union([z.number().min(0, { message: 'price must be a non-negative number' }), z.null()])
)

const appointmentProductSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('creditPack'),
    name: z.string().trim().min(1),
    price: nonNegativeNumberSchema,
    currency: z.string().trim().min(1),
    totalCredits: z.number().int().min(0),
    productId: nullableTrimmedString,
  }),
  z.object({
    type: z.literal('item'),
    name: z.string().trim().min(1),
    price: nonNegativeNumberSchema,
    currency: z.string().trim().min(1),
    productId: nullableTrimmedString,
    quantity: z.number().int().min(1).optional(),
  }),
  z.object({
    type: z.literal('service'),
    name: z.string().trim().min(1),
    price: nonNegativeNumberSchema,
    currency: z.string().trim().min(1),
    productId: nullableTrimmedString,
    durationMinutes: z.number().int().min(1),
    location: nullableTrimmedString,
    address: nullableTrimmedString,
    geo: geoSchema,
    googlePlaceId: nullableTrimmedString,
  }),
])

const commonPartialSchema = {
  reminderHours: z.union([z.literal(-1), z.number().nonnegative(), z.null()]).optional(),
  serviceProviderReminder1: reminderSchema,
  serviceProviderReminder2: reminderSchema,
  clientReminder1: clientReminderSchema,
  clientReminder2: clientReminderSchema,
  sessionName: nullableTrimmedString,
  location: nullableTrimmedString,
  address: nullableTrimmedString,
  geo: geoSchema,
  googlePlaceId: nullableTrimmedString,
  repeatsEvery: z.number().int().positive().nullable().optional(),
  endDate: isoDateTimeSchema.nullable().optional(),
  price: nullableNonNegativeNumberSchema.optional(),
  serviceId: nullableTrimmedString,
  sessionColor: nullableTrimmedString,
  avatarName: nullableTrimmedString,
  maximumAttendance: z.number().int().min(0).nullable().optional(),
  clients: z.array(z.string().uuid()).optional(),
  bufferMinutesBefore: z.number().int().min(0).optional(),
  bufferMinutesAfter: z.number().int().min(0).optional(),
  bookableOnline: z.boolean().optional(),
  description: nullableTrimmedString,
  bookingPaymentType: z.enum(['hidePrice', 'noPrepayment', 'fullPrepayment']).optional(),
  timezone: z.string().trim().optional(),
  canClientsCancel: z.boolean().optional(),
  cancellationAdvanceNoticeDuration: z.string().trim().optional(),
  requestClientAddressOnline: z.enum(['optional', 'required']).nullable().optional(),
  bookingQuestion: nullableTrimmedString,
  bookingQuestionState: z.enum(['optional', 'required']).nullable().optional(),
  saleProducts: z.array(appointmentProductSchema).optional(),
}

const eventSessionSchema = z
  .object({
    startDate: isoDateTimeSchema,
    sessionLength: z.number().positive(),
    sessionType: z.literal('event'),
  })
  .merge(z.object(commonPartialSchema))

const singleSessionSchema = z
  .object({
    startDate: isoDateTimeSchema,
    sessionLength: z.number().positive(),
    sessionType: z.literal('single'),
    clients: z.array(z.string().uuid()).min(1, 'At least one client is required for single session'),
  })
  .merge(z.object(commonPartialSchema))

const groupSessionSchema = z
  .object({
    startDate: isoDateTimeSchema,
    sessionLength: z.number().positive(),
    sessionType: z.literal('group'),
  })
  .merge(z.object(commonPartialSchema))

const requestBodySchema = z.discriminatedUnion('sessionType', [
  eventSessionSchema,
  singleSessionSchema,
  groupSessionSchema,
])

class ClientNotFoundError extends Error {
  constructor() {
    super('Client not found for trainer')
    this.name = 'ClientNotFoundError'
  }
}

const buildSessionStarts = (options: {
  startDate: string
  endDate: string | null | undefined
  repeatsEvery: number | null | undefined
  timeZone: string
}): Date[] => {
  const startParts = parseIsoLocalDateTime(options.startDate)
  const endParts = options.endDate ? parseIsoLocalDateTime(options.endDate) : null
  const stepDays = options.repeatsEvery ?? null

  if (!stepDays && !endParts) {
    return [isoLocalDateTimeToUtc(options.startDate, options.timeZone)]
  }

  if (stepDays && !endParts) {
    return []
  }

  if (!stepDays) {
    return [isoLocalDateTimeToUtc(options.startDate, options.timeZone)]
  }

  const starts: Date[] = []
  let current = startParts

  while (compareLocalDateTimes(current, endParts) <= 0) {
    starts.push(localDateTimeToUtc(current, options.timeZone))
    current = addDaysToLocalDateTime(current, stepDays)
  }

  return starts
}

const querySchema = z.object({
  createdAfter: z
    .string()
    .trim()
    .min(1, 'createdAfter must not be empty')
    .pipe(
      z.string().datetime({
        message: 'createdAfter must be a valid ISO 8601 date-time string',
      })
    )
    .transform((value) => new Date(value))
    .optional(),
})

export async function GET(request: Request) {
  const url = new URL(request.url)
  const rawCreatedAfter = url.searchParams.get('createdAfter')
  const trimmedCreatedAfter = rawCreatedAfter?.trim()
  const parsedQuery = querySchema.safeParse({
    createdAfter: trimmedCreatedAfter && trimmedCreatedAfter.length > 0 ? trimmedCreatedAfter : undefined,
  })

  if (!parsedQuery.success) {
    const detail = parsedQuery.error.issues.map((issue) => issue.message).join('; ')
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

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while fetching session series',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    let query = db
      .selectFrom('vw_legacy_session_series_2 as series')
      .selectAll('series')
      .where('series.trainerId', '=', authorization.trainerId)

    if (parsedQuery.data.createdAfter) {
      query = query.where('series.createdAt', '>', parsedQuery.data.createdAfter)
    }

    const rows = (await query.execute()) as RawSessionSeriesRow[]

    const series = rows.map((row, index) => normalizeSessionSeriesRow(row, index))

    return NextResponse.json(series)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse session series data from database',
          detail: 'Session series data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch session series', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch session series',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while creating session series',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const parsedJson = await parseStrictJsonBody(request)
  if (!parsedJson.ok) {
    return parsedJson.response
  }
  const body = parsedJson.data

  const parsed = requestBodySchema.safeParse(body)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => issue.message).join('; ')
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid request body',
        detail: detail || undefined,
        type: '/invalid-body',
      }),
      { status: 400 }
    )
  }

  const data = parsed.data
  const startDate = new Date(data.startDate)
  const endDate = data.endDate ? new Date(data.endDate) : null

  if (Number.isNaN(startDate.getTime())) {
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid request body',
        detail: 'startDate must be a valid ISO 8601 date-time string.',
        type: '/invalid-body',
      }),
      { status: 400 }
    )
  }

  if (endDate && Number.isNaN(endDate.getTime())) {
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid request body',
        detail: 'endDate must be a valid ISO 8601 date-time string when provided.',
        type: '/invalid-body',
      }),
      { status: 400 }
    )
  }

  if (endDate && startDate > endDate) {
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid request body',
        detail: 'End date must not be before start date.',
        type: '/invalid-body',
      }),
      { status: 400 }
    )
  }

  const appReminderTriggerMinutes =
    data.reminderHours === undefined || data.reminderHours === null || data.reminderHours === -1
      ? null
      : Math.round(Number(data.reminderHours) * 60)

  try {
    const sessionSeries = await db.transaction().execute(async (trx) => {
      const clientIds = data.clients ? Array.from(new Set(data.clients)) : []

      if (clientIds.length > 0) {
        const clientRows = await trx
          .selectFrom('client')
          .select('id')
          .where('trainer_id', '=', authorization.trainerId)
          .where('id', 'in', clientIds)
          .execute()

        if (clientRows.length !== clientIds.length) {
          throw new ClientNotFoundError()
        }
      }

      const eventType =
        data.sessionType === 'event' ? 'event' : data.sessionType === 'single' ? 'single_session' : 'group_session'

      const trainerRow = await trx
        .selectFrom('trainer')
        .select(['id', 'timezone'])
        .where('id', '=', authorization.trainerId)
        .executeTakeFirst()

      if (!trainerRow) {
        throw new Error('Failed to load trainer data for session series')
      }

      const seriesTimezone = data.timezone ?? trainerRow.timezone ?? 'UTC'
      const duration = intervalFromMinutes(Math.round(data.sessionLength * 60))

      const seriesInsert = await trx
        .insertInto('session_series')
        .values({
          trainer_id: authorization.trainerId,
          event_type: eventType,
          duration,
          start: isoLocalDateTimeToUtc(data.startDate, seriesTimezone),
          end_: data.endDate ? isoLocalDateTimeToUtc(data.endDate, seriesTimezone) : null,
          daily_recurrence_interval: data.repeatsEvery ? intervalFromDays(data.repeatsEvery) : null,
          location: data.location ?? null,
          timezone: seriesTimezone,
          price: data.price ?? null,
          name: data.sessionName ?? null,
          color: data.sessionColor ?? null,
          session_icon_id: data.avatarName ?? null,
        })
        .returning(['id', 'timezone'])
        .executeTakeFirst()

      const sessionSeriesId = seriesInsert?.id

      if (!sessionSeriesId) {
        throw new Error('Failed to create session series')
      }

      const spReminder1Interval =
        data.serviceProviderReminder1?.timeBeforeStart ??
        (appReminderTriggerMinutes !== null ? intervalFromMinutes(appReminderTriggerMinutes) : null)

      const spReminder1Type =
        data.serviceProviderReminder1?.type ??
        (appReminderTriggerMinutes !== null ? 'notification' : 'emailAndNotification')

      const spReminder2Interval = data.serviceProviderReminder2?.timeBeforeStart ?? null
      const spReminder2Type = data.serviceProviderReminder2?.type ?? 'emailAndNotification'

      const clientReminder1Interval = data.clientReminder1?.timeBeforeStart ?? null
      const clientReminder1Type = data.clientReminder1?.type ?? 'email'

      const clientReminder2Interval = data.clientReminder2?.timeBeforeStart ?? null
      const clientReminder2Type = data.clientReminder2?.type ?? 'email'

      const sessionStarts = buildSessionStarts({
        startDate: data.startDate,
        endDate: data.endDate,
        repeatsEvery: data.repeatsEvery,
        timeZone: seriesTimezone,
      })

      if (sessionStarts.length === 0) {
        throw new Error('Failed to create sessions for session series')
      }

      const sessionInsert = await trx
        .insertInto('session')
        .values(
          sessionStarts.map((start) => ({
            session_series_id: sessionSeriesId,
            start,
            duration,
            timezone: seriesTimezone,
            maximum_attendance: data.maximumAttendance ?? null,
            trainer_id: authorization.trainerId,
            location: data.location ?? null,
            address: data.address ?? null,
            geo: data.geo ? toPoint(data.geo.lat, data.geo.lng) : null,
            google_place_id: data.googlePlaceId ?? null,
            service_id: data.serviceId ?? null,
            service_provider_reminder_1: spReminder1Interval,
            service_provider_reminder_2: spReminder2Interval,
            service_provider_reminder_1_type: spReminder1Type,
            service_provider_reminder_2_type: spReminder2Type,
            client_reminder_1: clientReminder1Interval,
            client_reminder_2: clientReminder2Interval,
            client_reminder_1_type: clientReminder1Type,
            client_reminder_2_type: clientReminder2Type,
            buffer_minutes_before: data.bufferMinutesBefore ?? 0,
            buffer_minutes_after: data.bufferMinutesAfter ?? 0,
            bookable_online: data.bookableOnline ?? false,
            description: data.description ?? null,
            booking_payment_type: data.bookingPaymentType ?? 'noPrepayment',
            can_clients_cancel: data.canClientsCancel ?? false,
            cancellation_advance_notice_duration: data.cancellationAdvanceNoticeDuration ?? 'P1D',
            request_client_address_online: data.requestClientAddressOnline ?? null,
            booking_question: data.bookingQuestion ?? null,
            booking_question_state: data.bookingQuestionState ?? null,
          }))
        )
        .returning(['id', 'start'])
        .execute()

      const sessionRows = sessionInsert

      const sessionIds = sessionRows.map((row) => row.id)
      const earliestStart = sessionRows.reduce<Date>((earliest, row) => {
        const candidate = new Date(row.start)
        return earliest && earliest < candidate ? earliest : candidate
      }, new Date(sessionRows[0].start))

      if (clientIds.length > 0) {
        const clientSessionValues = sessionIds.flatMap((sessionId) =>
          clientIds.map((clientId) => ({
            trainer_id: authorization.trainerId,
            client_id: clientId,
            session_id: sessionId,
            price: data.price ?? null,
          }))
        )

        if (clientSessionValues.length > 0) {
          await trx.insertInto('client_session').values(clientSessionValues).returning('id').execute()
        }
      }

      const saleProducts = data.saleProducts ?? []

      if (saleProducts.length > 0 && clientIds.length > 0) {
        for (const clientId of clientIds) {
          const saleRow = await trx
            .insertInto('sale')
            .values({
              trainer_id: authorization.trainerId,
              client_id: clientId,
              due_time: earliestStart,
            })
            .returning('id')
            .executeTakeFirst()

          if (!saleRow?.id) {
            throw new Error('Failed to create sale for client')
          }

          for (const saleProduct of saleProducts) {
            const saleProductRow = await trx
              .insertInto('sale_product')
              .values({
                trainer_id: authorization.trainerId,
                client_id: clientId,
                sale_id: saleRow.id,
                name: saleProduct.name,
                price: saleProduct.price,
                product_id: saleProduct.productId ?? null,
                is_item: saleProduct.type === 'item',
                is_credit_pack: saleProduct.type === 'creditPack',
                is_service: saleProduct.type === 'service',
                is_membership: null,
              })
              .returning('id')
              .executeTakeFirst()

            const saleProductId = saleProductRow?.id

            if (!saleProductId) {
              throw new Error('Failed to create sale product')
            }

            if (saleProduct.type === 'item') {
              await trx
                .insertInto('sale_item')
                .values({
                  id: saleProductId,
                  trainer_id: authorization.trainerId,
                  quantity: saleProduct.quantity ?? 1,
                })
                .executeTakeFirst()
            } else if (saleProduct.type === 'creditPack') {
              await trx
                .insertInto('sale_credit_pack')
                .values({
                  id: saleProductId,
                  trainer_id: authorization.trainerId,
                  total_credits: saleProduct.totalCredits,
                })
                .executeTakeFirst()
            } else if (saleProduct.type === 'service') {
              await trx
                .insertInto('sale_service')
                .values({
                  id: saleProductId,
                  trainer_id: authorization.trainerId,
                  duration: intervalFromMinutes(saleProduct.durationMinutes),
                  location: saleProduct.location ?? null,
                  address: saleProduct.address ?? null,
                  geo: saleProduct.geo ? toPoint(saleProduct.geo.lat, saleProduct.geo.lng) : null,
                  google_place_id: saleProduct.googlePlaceId ?? null,
                })
                .executeTakeFirst()
            }
          }
        }
      }

      const seriesRow = (await trx
        .selectFrom('vw_legacy_session_series_2 as series')
        .selectAll('series')
        .where('series.id', '=', sessionSeriesId)
        .executeTakeFirst()) as RawSessionSeriesRow | undefined

      if (!seriesRow) {
        throw new Error('Failed to load created session series')
      }

      return normalizeSessionSeriesRow(seriesRow, 0)
    })

    return NextResponse.json(sessionSeries)
  } catch (error) {
    if (error instanceof ClientNotFoundError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Client not found',
          detail: 'One or more client identifiers did not belong to the authenticated trainer.',
          type: '/client-not-found',
        }),
        { status: 404 }
      )
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse session series data from database',
          detail: 'Session series data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to create session series', error)

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to create session series',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
