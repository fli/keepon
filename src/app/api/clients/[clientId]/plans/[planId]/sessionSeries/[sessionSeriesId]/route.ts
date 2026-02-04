import { NextRequest, NextResponse } from 'next/server'
import { db, sql, type Selectable, type VwLegacyPayment } from '@/lib/db'
import { z, ZodError } from 'zod'
import { authenticateTrainerRequest, buildErrorResponse } from '../../../../../../_lib/accessToken'
import { normalizePlanRow, type RawPlanRow } from '../../../../../../plans/shared'
import { paymentSchema } from '../../../../../../_lib/clientSessionsSchema'

const paramsSchema = z.object({
  clientId: z.string().trim().min(1, 'Client id is required.'),
  planId: z.string().trim().min(1, 'Plan id is required.'),
  sessionSeriesId: z
    .string()
    .trim()
    .min(1, 'Session series id is required.'),
})

const LEGACY_INVALID_JSON_MESSAGE = 'Unexpected token \'"\\", "#" is not valid JSON'

const createLegacyInvalidJsonResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: LEGACY_INVALID_JSON_MESSAGE,
    }),
    { status: 400 }
  )

type HandlerContext = { params: Promise<Record<string, string>> }

type RawPaymentRow = Selectable<VwLegacyPayment>
type Payment = z.infer<typeof paymentSchema>

type ClientSessionPaymentRow = {
  client_session_id: string
  payment_id: string
}

type SessionDetailRow = {
  client_session_id: string | null
  session_start: Date | string | null
  paid: boolean | null
  sale_id: string | null
  duration: string | null
  location: string | null
  price: string | number | null
}

type NormalizedSessionDetail = {
  clientSessionId: string
  sessionStart: Date
  paid: boolean
  saleId: string | null
  duration: string | null
  location: string | null
  price: string
}

const MAX_TIME = new Date(8640000000000000)
const MIN_TIME = new Date(-8640000000000000)
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000

class SubscriptionNotFoundError extends Error {
  constructor() {
    super('Subscription not found')
    this.name = 'SubscriptionNotFoundError'
  }
}

class AppointmentSeriesNotFoundError extends Error {
  constructor() {
    super('Appointment series not found')
    this.name = 'AppointmentSeriesNotFoundError'
  }
}

class ClientNotPartOfAppointmentsError extends Error {
  constructor() {
    super('Client is not part of appointment series')
    this.name = 'ClientNotPartOfAppointmentsError'
  }
}

class SubscriptionAlreadyEndedError extends Error {
  constructor() {
    super('Subscription already ended')
    this.name = 'SubscriptionAlreadyEndedError'
  }
}

class AppointmentsAfterSubscriptionEndError extends Error {
  constructor() {
    super('Appointments are after subscription end')
    this.name = 'AppointmentsAfterSubscriptionEndError'
  }
}

class PaymentDeletionMismatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaymentDeletionMismatchError'
  }
}

class PaymentDataMismatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PaymentDataMismatchError'
  }
}

const adaptPaymentRow = (row: RawPaymentRow) => {
  if (!row.id) {
    throw new Error('Payment row is missing id')
  }

  if (!row.trainerId) {
    throw new Error('Payment row is missing trainer id')
  }

  if (!row.paymentType) {
    throw new Error('Payment row is missing payment type')
  }

  if (!row.status) {
    throw new Error('Payment row is missing status')
  }

  if (!row.clientSessionId) {
    throw new Error('Payment row is missing client session id')
  }

  if (!row.createdAt) {
    throw new Error('Payment row is missing createdAt')
  }

  if (!row.updatedAt) {
    throw new Error('Payment row is missing updatedAt')
  }

  const paidAmount = row.paidAmount === null || row.paidAmount === undefined ? 0 : row.paidAmount

  return paymentSchema.parse({
    trainerId: row.trainerId,
    id: row.id,
    paymentType: row.paymentType,
    contributionAmount: row.contributionAmount === null ? null : row.contributionAmount,
    paidAmount,
    paymentMethod: row.paymentMethod === null ? null : String(row.paymentMethod),
    paidDate: row.paidDate === null || row.paidDate === undefined ? null : (row.paidDate as Date | string),
    status: row.status,
    stripeCharge: row.stripeCharge ?? null,
    stripeRefund: row.stripeRefund ?? null,
    clientSessionId: row.clientSessionId,
    sessionPackId: row.sessionPackId ?? null,
    planId: row.planId ?? null,
    createdAt: row.createdAt as Date | string,
    updatedAt: row.updatedAt as Date | string,
  })
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

const toDateOrThrow = (value: Date | string | number | null | undefined, label: string) => {
  if (value === 'infinity' || value === Infinity) {
    return MAX_TIME
  }

  if (value === '-infinity' || value === -Infinity) {
    return MIN_TIME
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`${label} is invalid`)
    }
    return value
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === 'infinity') {
      return MAX_TIME
    }
    if (trimmed === '-infinity') {
      return MIN_TIME
    }
    const parsed = new Date(trimmed)
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`${label} is invalid`)
    }
    return parsed
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${label} is invalid`)
    }
    return new Date(value)
  }

  throw new Error(`${label} is invalid`)
}

const normalizeNumericString = (value: string | number | null | undefined, label: string) => {
  if (value === null || value === undefined) {
    throw new Error(`${label} is missing`)
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${label} is invalid`)
    }
    return value.toString()
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      throw new Error(`${label} is invalid`)
    }
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed)) {
      throw new Error(`${label} is invalid`)
    }
    return trimmed
  }

  throw new Error(`${label} is invalid`)
}

const addWeeks = (date: Date, weeks: number) => new Date(date.getTime() + weeks * MS_PER_WEEK)

const normalizeSessionDetail = (row: SessionDetailRow, index: number): NormalizedSessionDetail => {
  if (!row.client_session_id) {
    throw new ClientNotPartOfAppointmentsError()
  }

  return {
    clientSessionId: row.client_session_id,
    sessionStart: toDateOrThrow(row.session_start, `session start at index ${index}`),
    paid: Boolean(row.paid),
    saleId: row.sale_id ?? null,
    duration: row.duration ?? null,
    location: row.location ?? null,
    price: normalizeNumericString(row.price, `session price at index ${index}`),
  }
}

export async function PUT(request: NextRequest, context: HandlerContext) {
  const rawBodyText = await request.text()
  if (rawBodyText.trim().length > 0) {
    try {
      const parsed = JSON.parse(rawBodyText)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return createLegacyInvalidJsonResponse()
      }
    } catch {
      return createLegacyInvalidJsonResponse()
    }
  }

  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map((issue) => issue.message).join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid path parameters',
        detail: detail || 'Request parameters did not match the expected schema.',
        type: '/invalid-path-parameters',
      }),
      { status: 400 }
    )
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while attaching subscription session series',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { clientId, planId, sessionSeriesId } = paramsResult.data

  try {
    const result = await db.transaction().execute(async (trx) => {
      const sessionDetailsResult = await sql<SessionDetailRow>`
        SELECT
          client_session.id AS client_session_id,
          session.start AS session_start,
          sale_payment_status.payment_status = 'paid' AS paid,
          sale_payment_status.sale_id,
          session.duration::text AS duration,
          COALESCE(session_series.location, '') AS location,
          COALESCE(sale_product.price, client_session.price, 0) AS price
        FROM session_series
        LEFT JOIN session ON session_series.id = session.session_series_id
        LEFT JOIN client_session ON client_session.session_id = session.id
        LEFT JOIN sale_payment_status ON client_session.sale_id = sale_payment_status.sale_id
        LEFT JOIN sale ON sale.id = client_session.sale_id
        LEFT JOIN sale_product ON sale_product.sale_id = sale.id
       WHERE session_series.id = ${sessionSeriesId}
         AND session_series.trainer_id = ${authorization.trainerId}
         AND client_session.client_id = ${clientId}
      `.execute(trx)

      const sessionDetails = sessionDetailsResult.rows.map((row, index) => normalizeSessionDetail(row, index))

      if (sessionDetails.length === 0) {
        throw new AppointmentSeriesNotFoundError()
      }

      const planDetails = await trx
        .selectFrom('payment_plan as plan')
        .select((eb) => [
          eb.ref('plan.end_').as('end'),
          eb.ref('plan.frequency_weekly_interval').as('frequencyWeeklyInterval'),
        ])
        .where('plan.id', '=', planId)
        .where('plan.client_id', '=', clientId)
        .where('plan.trainer_id', '=', authorization.trainerId)
        .executeTakeFirst()

      if (!planDetails) {
        throw new SubscriptionNotFoundError()
      }

      const planEnd = toDateOrThrow(planDetails.end, 'Subscription end date')

      if (planEnd.getTime() < Date.now()) {
        throw new SubscriptionAlreadyEndedError()
      }

      if (planEnd.getTime() !== MAX_TIME.getTime()) {
        const maxAllowedDate = addWeeks(planEnd, planDetails.frequencyWeeklyInterval ?? 0)
        const hasOutOfRangeSessions = sessionDetails.some(
          (detail) => detail.sessionStart.getTime() > maxAllowedDate.getTime()
        )

        if (hasOutOfRangeSessions) {
          throw new AppointmentsAfterSubscriptionEndError()
        }
      }

      const unpaidSessions = sessionDetails.filter((detail) => !detail.paid)
      const paymentIds: string[] = []

      for (const session of unpaidSessions) {
        let saleId = session.saleId

        if (!saleId) {
          const saleRow = await trx
            .insertInto('sale')
            .values({
              trainer_id: authorization.trainerId,
              client_id: clientId,
            })
            .returning('id')
            .executeTakeFirst()

          if (!saleRow?.id) {
            throw new Error('Failed to create sale')
          }

          saleId = saleRow.id

          const saleProductRow = await trx
            .insertInto('sale_product')
            .values({
              id: sql`uuid_generate_v1mc()`,
              trainer_id: authorization.trainerId,
              is_item: null,
              is_credit_pack: null,
              is_service: true,
              is_membership: null,
              name: 'Appointment',
              price: session.price,
              client_id: clientId,
              sale_id: saleId,
              product_id: null,
            })
            .returning('id')
            .executeTakeFirst()

          if (!saleProductRow?.id) {
            throw new Error('Failed to create sale product')
          }

          await trx
            .insertInto('sale_service')
            .values({
              id: saleProductRow.id,
              trainer_id: authorization.trainerId,
              duration: session.duration ?? null,
              location: session.location ?? null,
              address: null,
              geo: null,
              google_place_id: null,
              is_service: true,
            })
            .execute()

          const updatedSession = await trx
            .updateTable('client_session')
            .set({ sale_id: saleId })
            .where('id', '=', session.clientSessionId)
            .where('trainer_id', '=', authorization.trainerId)
            .where('client_id', '=', clientId)
            .returning('id')
            .executeTakeFirst()

          if (!updatedSession?.id) {
            throw new Error('Failed to attach sale to client session')
          }
        }

        const paymentRow = await trx
          .insertInto('payment')
          .values({
            trainer_id: authorization.trainerId,
            client_id: clientId,
            sale_id: saleId,
            is_manual: null,
            is_stripe: null,
            is_scheduled_stripe: null,
            is_credit_pack: null,
            is_subscription: true,
            amount: session.price,
          })
          .returning('id')
          .executeTakeFirst()

        if (!paymentRow?.id) {
          throw new Error('Failed to create payment')
        }

        await trx
          .insertInto('payment_subscription')
          .values({
            id: paymentRow.id,
            trainer_id: authorization.trainerId,
            subscription_id: planId,
          })
          .execute()

        paymentIds.push(paymentRow.id)
      }

      const rawPlanRow = (await trx
        .selectFrom('vw_legacy_plan as v')
        .selectAll('v')
        .where('v.id', '=', planId)
        .where('v.trainerId', '=', authorization.trainerId)
        .where('v.clientId', '=', clientId)
        .executeTakeFirst()) as RawPlanRow | undefined

      if (!rawPlanRow) {
        throw new SubscriptionNotFoundError()
      }

      const plan = normalizePlanRow(rawPlanRow)

      if (paymentIds.length === 0) {
        return {
          plan,
          payments: [] as Payment[],
        }
      }

      const paymentRows = (await trx
        .selectFrom('vw_legacy_payment as p')
        .selectAll('p')
        .where('p.trainerId', '=', authorization.trainerId)
        .where('p.id', 'in', paymentIds)
        .execute()) as RawPaymentRow[]

      if (paymentRows.length !== paymentIds.length) {
        throw new PaymentDataMismatchError(`Expected ${paymentIds.length} payments, received ${paymentRows.length}`)
      }

      const payments = paymentRows.map((row) => adaptPaymentRow(row))

      return { plan, payments }
    })

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AppointmentSeriesNotFoundError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Appointment series not found',
          type: '/resource-not-found',
        }),
        { status: 404 }
      )
    }

    if (error instanceof ClientNotPartOfAppointmentsError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Client not part of appointment series',
          detail: 'The specified client is not assigned to the requested session series.',
          type: '/resource-not-found',
        }),
        { status: 404 }
      )
    }

    if (error instanceof SubscriptionNotFoundError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Subscription not found',
          type: '/resource-not-found',
        }),
        { status: 404 }
      )
    }

    if (error instanceof SubscriptionAlreadyEndedError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'Subscription already ended',
          detail: 'Ended subscriptions cannot be linked to additional appointments.',
          type: '/subscription-already-ended',
        }),
        { status: 409 }
      )
    }

    if (error instanceof AppointmentsAfterSubscriptionEndError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'Appointments are past the subscription end date',
          detail: 'One or more appointments occur after the subscription end date, so they cannot be attached.',
          type: '/appointments-past-subscription-end',
        }),
        { status: 409 }
      )
    }

    if (error instanceof PaymentDataMismatchError) {
      console.error('Payment data mismatch while attaching subscription session series', {
        trainerId: authorization.trainerId,
        clientId,
        planId,
        sessionSeriesId,
        error: error.message,
      })

      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to retrieve subscription payments',
          detail: 'Updated client sessions did not match the expected payment records.',
          type: '/payment-data-mismatch',
        }),
        { status: 500 }
      )
    }

    if (error instanceof ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse subscription data from database',
          detail: 'Subscription or payment data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to attach session series to subscription', {
      trainerId: authorization.trainerId,
      clientId,
      planId,
      sessionSeriesId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to attach session series to subscription',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest, context: HandlerContext) {

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while removing subscription session series',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { clientId, planId, sessionSeriesId } = await context.params

  try {
    const result = await db.transaction().execute(async (trx) => {
      const clientSessionsResult = await sql<ClientSessionPaymentRow>`
        SELECT
          client_session.id AS client_session_id,
          payment.id AS payment_id
        FROM payment_subscription
        JOIN payment ON payment_subscription.id = payment.id
        JOIN sale ON sale.id = payment.sale_id
        JOIN client_session ON client_session.sale_id = sale.id
        JOIN session ON session.id = client_session.session_id
        JOIN session_series ON session_series.id = session.session_series_id
       WHERE payment_subscription.subscription_id = ${planId}
         AND payment.trainer_id = ${authorization.trainerId}
         AND payment.client_id = ${clientId}
         AND session_series.id = ${sessionSeriesId}
      `.execute(trx)

      const clientSessions = clientSessionsResult.rows

      if (clientSessions.length > 0) {
        const paymentIds = clientSessions
          .map((row) => row.payment_id)
          .filter((value): value is string => typeof value === 'string')

        if (paymentIds.length > 0) {
          const deleteResult = await trx
            .deleteFrom('payment')
            .where('payment.id', 'in', paymentIds)
            .where('payment.trainer_id', '=', authorization.trainerId)
            .executeTakeFirst()

          const deletedCount = normalizeDeletedCount(deleteResult?.numDeletedRows)

          if (deletedCount !== paymentIds.length) {
            throw new PaymentDeletionMismatchError(`Deleted ${deletedCount} of ${paymentIds.length} payment records`)
          }
        }
      }

      const rawPlanRow = (await trx
        .selectFrom('vw_legacy_plan as v')
        .selectAll('v')
        .where('v.id', '=', planId)
        .executeTakeFirst()) as RawPlanRow | undefined

      const plan = normalizePlanRow(rawPlanRow)

      const clientSessionIds = Array.from(
        new Set(
          clientSessions
            .map((row) => row.client_session_id)
            .filter((value): value is string => typeof value === 'string')
        )
      )

      if (clientSessionIds.length === 0) {
        return { plan, payments: [] as Payment[] }
      }

      const paymentRows = (await trx
        .selectFrom('vw_legacy_payment as p')
        .selectAll('p')
        .where('p.trainerId', '=', authorization.trainerId)
        .where('p.id', 'in', clientSessionIds)
        .execute()) as RawPaymentRow[]

      if (paymentRows.length !== clientSessionIds.length) {
        throw new PaymentDataMismatchError(
          `Expected ${clientSessionIds.length} payments, received ${paymentRows.length}`
        )
      }

      const payments = paymentRows.map((row) => adaptPaymentRow(row))

      return { plan, payments }
    })

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof PaymentDeletionMismatchError) {
      console.error('Payment deletion mismatch while removing subscription session series', {
        trainerId: authorization.trainerId,
        clientId,
        planId,
        sessionSeriesId,
        error: error.message,
      })

      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to remove subscription payments',
          detail: 'Deleted payment count did not match the expected number of subscription payments.',
          type: '/payment-deletion-mismatch',
        }),
        { status: 500 }
      )
    }

    if (error instanceof PaymentDataMismatchError) {
      console.error('Payment data mismatch while fetching subscription payments after deletion', {
        trainerId: authorization.trainerId,
        clientId,
        planId,
        sessionSeriesId,
        error: error.message,
      })

      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to retrieve subscription payments',
          detail: 'Updated client sessions did not match the expected payment records.',
          type: '/payment-data-mismatch',
        }),
        { status: 500 }
      )
    }

    if (error instanceof ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse subscription data from database',
          detail: 'Subscription or payment data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to remove session series from subscription', {
      trainerId: authorization.trainerId,
      clientId,
      planId,
      sessionSeriesId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to remove session series from subscription',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
