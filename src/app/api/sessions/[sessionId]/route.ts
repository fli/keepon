import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db, sql } from '@/lib/db'
import type { RawSessionRow } from '../shared'
import { authenticateTrainerRequest, buildErrorResponse } from '../../_lib/accessToken'
import { parseStrictJsonBody } from '../../_lib/strictJson'
import { adaptSessionRow } from '../shared'

const paramsSchema = z.object({
  sessionId: z.string().trim().min(1, 'sessionId must not be empty'),
})

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

const isoDurationSchema = z.string().trim().regex(/^P/i, 'Duration must be an ISO 8601 duration, e.g. PT1H')

const reminderSchema = z
  .object({
    type: z.enum(['email', 'notification', 'emailAndNotification']),
    timeBeforeStart: isoDurationSchema,
  })
  .nullable()
  .optional()

const clientReminderSchema = z
  .object({
    type: z.enum(['email', 'sms', 'emailAndSms']),
    timeBeforeStart: isoDurationSchema,
  })
  .nullable()
  .optional()

const geoSchema = z
  .union([z.object({ lat: z.number(), lng: z.number() }), z.object({ lat: z.null(), lng: z.null() })])
  .nullable()
  .optional()

const legacyDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/, 'date must be in YYYY-MM-DD HH:mm or YYYY-MM-DD HH:mm:ss format')

const requestBodySchema = z
  .object({
    length: z.number().positive().optional(),
    date: legacyDateSchema.optional(),
    maximumAttendance: z.number().int().min(0).nullable().optional(),
    location: nullableTrimmedString,
    address: nullableTrimmedString,
    geo: geoSchema,
    googlePlaceId: nullableTrimmedString,
    serviceProviderReminder1: reminderSchema,
    serviceProviderReminder2: reminderSchema,
    clientReminder1: clientReminderSchema,
    clientReminder2: clientReminderSchema,
    bufferMinutesBefore: z.number().int().min(0).optional(),
    bufferMinutesAfter: z.number().int().min(0).optional(),
    bookableOnline: z.boolean().optional(),
    description: nullableTrimmedString,
    bookingPaymentType: z.enum(['hidePrice', 'noPrepayment', 'fullPrepayment']).optional(),
    note: nullableTrimmedString,
    canClientsCancel: z.boolean().optional(),
    cancellationAdvanceNoticeDuration: isoDurationSchema.optional(),
    requestClientAddressOnline: z.enum(['optional', 'required']).nullable().optional(),
    bookingQuestion: nullableTrimmedString,
    bookingQuestionState: z.enum(['optional', 'required']).nullable().optional(),
  })
  .strict()

const deleteResponseSchema = z.object({
  count: z.number().int().nonnegative(),
})

type HandlerContext = RouteContext<'/api/sessions/[sessionId]'>

class SessionNotFoundError extends Error {
  constructor() {
    super('Appointment not found')
    this.name = 'SessionNotFoundError'
  }
}

class PaidAppointmentDeletionError extends Error {
  constructor() {
    super('Cannot delete paid appointment')
    this.name = 'PaidAppointmentDeletionError'
  }
}

type RawDeleteDetailRow = {
  paid_for: boolean
  deletable_sale_id: string | null
}

const normalizeDeletedCount = (value: unknown) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }

  if (typeof value === 'bigint') {
    return Number(value)
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

export async function GET(request: NextRequest, context: HandlerContext) {
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

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while fetching session',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { sessionId } = parsedParams.data

  try {
    const row = (await db
      .selectFrom('vw_legacy_session_2 as v')
      .innerJoin('session as s', 's.id', 'v.id')
      .selectAll('v')
      .where('v.id', '=', sessionId)
      .where('s.trainer_id', '=', authorization.trainerId)
      .executeTakeFirst()) as RawSessionRow | undefined

    if (!row) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Appointment not found',
          type: '/resource-not-found',
        }),
        { status: 404 }
      )
    }

    const session = adaptSessionRow(row)

    return NextResponse.json(session)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse session data from database',
          detail: 'Session data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch session', sessionId, error)

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch session',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest, context: HandlerContext) {
  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while updating session',
  })

  if (!authorization.ok) {
    return authorization.response
  }

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

  const { sessionId } = parsedParams.data

  const parsedJson = await parseStrictJsonBody(request)
  if (!parsedJson.ok) {
    return parsedJson.response
  }

  const validation = requestBodySchema.safeParse(parsedJson.data)

  if (!validation.success) {
    const detail = validation.error.issues.map((issue) => issue.message).join('; ')

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

  const parsedBody = validation.data

  const hasUpdates = Object.values(parsedBody).some((value) => value !== undefined)

  try {
    const session = await db.transaction().execute(async (trx) => {
      const sessionContext = await trx
        .selectFrom('session as s')
        .innerJoin('session_series as ss', 'ss.id', 's.session_series_id')
        .innerJoin('trainer as t', 't.id', 'ss.trainer_id')
        .select((eb) => [
          eb.ref('s.timezone').as('sessionTimezone'),
          eb.ref('ss.timezone').as('seriesTimezone'),
          eb.ref('t.timezone').as('trainerTimezone'),
        ])
        .where('s.id', '=', sessionId)
        .where('s.trainer_id', '=', authorization.trainerId)
        .executeTakeFirst()

      if (!sessionContext) {
        throw new SessionNotFoundError()
      }

      if (hasUpdates) {
        const timezone =
          sessionContext.sessionTimezone ?? sessionContext.seriesTimezone ?? sessionContext.trainerTimezone ?? 'UTC'

        const updateData: Record<string, unknown> = {}

        if (parsedBody.date !== undefined) {
          updateData.start = sql`timezone(${timezone}, ${parsedBody.date}::timestamp)`
        }

        if (parsedBody.length !== undefined) {
          const durationMinutes = Math.round(parsedBody.length * 60)
          updateData.duration = sql`make_interval(mins := ${durationMinutes})`
        }

        if (parsedBody.maximumAttendance !== undefined) {
          updateData.maximum_attendance = parsedBody.maximumAttendance
        }

        if (parsedBody.location !== undefined) {
          updateData.location = parsedBody.location
        }

        if (parsedBody.address !== undefined) {
          updateData.address = parsedBody.address
        }

        if (parsedBody.geo !== undefined) {
          updateData.geo = parsedBody.geo === null ? null : sql`point(${parsedBody.geo.lat}, ${parsedBody.geo.lng})`
        }

        if (parsedBody.googlePlaceId !== undefined) {
          updateData.google_place_id = parsedBody.googlePlaceId
        }

        if (parsedBody.serviceProviderReminder1 !== undefined) {
          updateData.service_provider_reminder_1 = parsedBody.serviceProviderReminder1?.timeBeforeStart ?? null
          if (parsedBody.serviceProviderReminder1) {
            updateData.service_provider_reminder_1_type = parsedBody.serviceProviderReminder1.type
          }
        }

        if (parsedBody.serviceProviderReminder2 !== undefined) {
          updateData.service_provider_reminder_2 = parsedBody.serviceProviderReminder2?.timeBeforeStart ?? null
          if (parsedBody.serviceProviderReminder2) {
            updateData.service_provider_reminder_2_type = parsedBody.serviceProviderReminder2.type
          }
        }

        if (parsedBody.clientReminder1 !== undefined) {
          updateData.client_reminder_1 = parsedBody.clientReminder1?.timeBeforeStart ?? null
          if (parsedBody.clientReminder1) {
            updateData.client_reminder_1_type = parsedBody.clientReminder1.type
          }
        }

        if (parsedBody.clientReminder2 !== undefined) {
          updateData.client_reminder_2 = parsedBody.clientReminder2?.timeBeforeStart ?? null
          if (parsedBody.clientReminder2) {
            updateData.client_reminder_2_type = parsedBody.clientReminder2.type
          }
        }

        if (parsedBody.bufferMinutesBefore !== undefined) {
          updateData.buffer_minutes_before = parsedBody.bufferMinutesBefore
        }

        if (parsedBody.bufferMinutesAfter !== undefined) {
          updateData.buffer_minutes_after = parsedBody.bufferMinutesAfter
        }

        if (parsedBody.bookableOnline !== undefined) {
          updateData.bookable_online = parsedBody.bookableOnline
        }

        if (parsedBody.description !== undefined) {
          updateData.description = parsedBody.description
        }

        if (parsedBody.bookingPaymentType !== undefined) {
          updateData.booking_payment_type = parsedBody.bookingPaymentType
        }

        if (parsedBody.note !== undefined) {
          updateData.note = parsedBody.note
        }

        if (parsedBody.canClientsCancel !== undefined) {
          updateData.can_clients_cancel = parsedBody.canClientsCancel
        }

        if (parsedBody.cancellationAdvanceNoticeDuration !== undefined) {
          updateData.cancellation_advance_notice_duration = sql`${parsedBody.cancellationAdvanceNoticeDuration}::interval`
        }

        if (parsedBody.requestClientAddressOnline !== undefined && parsedBody.requestClientAddressOnline !== null) {
          updateData.request_client_address_online = parsedBody.requestClientAddressOnline
        }

        if (parsedBody.bookingQuestion !== undefined) {
          updateData.booking_question = parsedBody.bookingQuestion
        }

        if (parsedBody.bookingQuestionState !== undefined && parsedBody.bookingQuestionState !== null) {
          updateData.booking_question_state = parsedBody.bookingQuestionState
        }

        if (Object.keys(updateData).length > 0) {
          const updated = await trx
            .updateTable('session')
            .set(updateData)
            .where('session.id', '=', sessionId)
            .where('session.trainer_id', '=', authorization.trainerId)
            .returning('session.id')
            .executeTakeFirst()

          if (!updated) {
            throw new SessionNotFoundError()
          }
        }
      }

      const row = (await trx
        .selectFrom('vw_legacy_session_2 as v')
        .innerJoin('session as s', 's.id', 'v.id')
        .selectAll('v')
        .where('v.id', '=', sessionId)
        .where('s.trainer_id', '=', authorization.trainerId)
        .executeTakeFirst()) as RawSessionRow | undefined

      if (!row) {
        throw new SessionNotFoundError()
      }

      return adaptSessionRow(row)
    })

    return NextResponse.json(session)
  } catch (error) {
    if (error instanceof SessionNotFoundError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Appointment not found',
          type: '/resource-not-found',
        }),
        { status: 404 }
      )
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to validate session data',
          detail: 'Session data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to update session', {
      trainerId: authorization.trainerId,
      sessionId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to update session',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest, context: HandlerContext) {
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

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while deleting session',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { sessionId } = parsedParams.data

  try {
    const transactionResult = await db.transaction().execute(async (trx) => {
      const detailsResult = await sql<RawDeleteDetailRow>`
        SELECT
          COALESCE(sale_payment_status.payment_status = 'paid', FALSE) AS paid_for,
          deletable_payments.sale_id AS deletable_sale_id
        FROM session
        JOIN session_series ON session_series.id = session.session_series_id
        LEFT JOIN client_session ON client_session.session_id = session.id
        LEFT JOIN sale_payment_status
          ON sale_payment_status.sale_id = client_session.sale_id
        LEFT JOIN (
          SELECT sale_id
            FROM payment
           WHERE payment.is_credit_pack OR payment.is_subscription
        ) AS deletable_payments
          ON deletable_payments.sale_id = client_session.sale_id
       WHERE session_series.trainer_id = ${authorization.trainerId}
         AND session.id = ${sessionId}
      `.execute(trx)

      const details = detailsResult.rows

      if (details.length === 0) {
        throw new SessionNotFoundError()
      }

      const hasBlockingPayment = details.some((detail) => detail.paid_for && !detail.deletable_sale_id)

      if (hasBlockingPayment) {
        throw new PaidAppointmentDeletionError()
      }

      const deletableSaleIds = Array.from(
        new Set(details.map((detail) => detail.deletable_sale_id).filter((value): value is string => Boolean(value)))
      )

      if (deletableSaleIds.length > 0) {
        const deleteSalesResult = await trx
          .deleteFrom('sale')
          .where('sale.id', 'in', deletableSaleIds)
          .where('sale.trainer_id', '=', authorization.trainerId)
          .executeTakeFirst()

        const deletedSalesCount = normalizeDeletedCount(deleteSalesResult?.numDeletedRows)

        if (deletedSalesCount !== deletableSaleIds.length) {
          throw new Error(`Deleted ${deletedSalesCount} of ${deletableSaleIds.length} sale records`)
        }
      }

      const deletedSession = await trx
        .deleteFrom('session')
        .where('session.id', '=', sessionId)
        .where('session.trainer_id', '=', authorization.trainerId)
        .returning((eb) => [eb.ref('session.id').as('id')])
        .executeTakeFirst()

      if (!deletedSession) {
        throw new SessionNotFoundError()
      }

      return { count: 1 }
    })

    const responseBody = deleteResponseSchema.parse(transactionResult)

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof SessionNotFoundError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Appointment not found',
          type: '/resource-not-found',
        }),
        { status: 404 }
      )
    }

    if (error instanceof PaidAppointmentDeletionError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'One or more clients has paid for the appointment. Please refund first before deleting.',
          type: '/cant-delete-paid-appointment',
        }),
        { status: 409 }
      )
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to validate session deletion response',
          detail: 'Session deletion response did not match the expected schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to delete session', {
      trainerId: authorization.trainerId,
      sessionId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to delete session',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
