import { NextRequest, NextResponse } from 'next/server'
import { db, sql } from '@/lib/db'
import type { Database } from '@/lib/db'
import { z } from 'zod'
import type { Kysely, Transaction } from 'kysely'
import { authenticateTrainerRequest, buildErrorResponse } from '../../../_lib/accessToken'
import { adaptClientSessionRow, clientSessionListSchema, RawClientSessionRow } from '../../../_lib/clientSessionsSchema'

const paramsSchema = z.object({
  sessionId: z
    .string({ message: 'Session id is required.' })
    .trim()
    .min(1, 'Session id must not be empty.')
    .uuid({ message: 'Session id must be a valid UUID.' }),
})

const priceSchema = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((value) => {
    if (value === null || value === undefined) {
      return 0
    }

    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value < 0) {
        throw new Error('Price must be a non-negative number.')
      }
      return value
    }

    const trimmed = value.trim()
    if (trimmed.length === 0) {
      return 0
    }

    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error('Price must be a non-negative number.')
    }

    return parsed
  })

const noteSchema = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => {
    if (value === null || value === undefined) {
      return null
    }
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  })

const requestBodySchema = z.object({
  clientId: z
    .string({ message: 'clientId is required.' })
    .trim()
    .min(1, 'clientId must not be empty.')
    .uuid({ message: 'clientId must be a valid UUID.' }),
  future: z
    .union([z.boolean(), z.literal('true'), z.literal('false')])
    .transform((value) => value === true || value === 'true'),
  price: priceSchema,
  note: noteSchema,
})

type HandlerContext = RouteContext<'/api/sessions/[sessionId]/clients'>

class ClientNotFoundError extends Error {
  constructor() {
    super('Client not found')
    this.name = 'ClientNotFoundError'
  }
}

const clientSessionSelect = (
  trx: Kysely<Database> | Transaction<Database>,
  trainerId: string,
  clientSessionIds: string[]
) =>
  trx
    .selectFrom('vw_legacy_client_session as v')
    .innerJoin('client_session as cs', 'cs.id', 'v.id')
    .select((eb) => [
      eb.ref('v.id').as('id'),
      eb.ref('v.clientId').as('clientId'),
      eb.ref('v.sessionId').as('sessionId'),
      eb.ref('v.createdAt').as('createdAt'),
      eb.ref('v.state').as('state'),
      eb.ref('v.bookingQuestion').as('bookingQuestion'),
      eb.ref('v.bookingQuestionResponse').as('bookingQuestionResponse'),
      eb.ref('v.price').as('price'),
      eb.ref('v.attended').as('attended'),
      eb.ref('v.payment').as('payment'),
      eb.ref('v.notes').as('notes'),
      eb.ref('v.saleId').as('saleId'),
      eb.ref('v.cancelTime').as('cancelTime'),
      eb.ref('v.cancelReason').as('cancelReason'),
      eb.ref('v.acceptTime').as('acceptTime'),
      eb.ref('v.declineTime').as('declineTime'),
      eb.ref('v.inviteTime').as('inviteTime'),
      eb.ref('v.confirmTime').as('confirmTime'),
    ])
    .where('cs.trainer_id', '=', trainerId)
    .where('v.id', 'in', clientSessionIds)

export async function POST(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map((issue) => issue.message).join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid path parameters',
        detail: detail || 'Session id parameter did not match the expected schema.',
        type: '/invalid-path-parameters',
      }),
      { status: 400 }
    )
  }

  const { sessionId } = paramsResult.data

  let parsedBody: z.infer<typeof requestBodySchema>

  try {
    const rawBody = (await request.json()) as unknown
    const bodyResult = requestBodySchema.safeParse(rawBody)

    if (!bodyResult.success) {
      const detail = bodyResult.error.issues.map((issue) => issue.message).join('; ')

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

    parsedBody = bodyResult.data
  } catch (error) {
    console.error('Failed to parse session client request body', sessionId, error)

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

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while adding client to session',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const clientSessions = await db.transaction().execute(async (trx) => {
      const client = await trx
        .selectFrom('client')
        .select('id')
        .where('trainer_id', '=', authorization.trainerId)
        .where('id', '=', parsedBody.clientId)
        .executeTakeFirst()

      if (!client) {
        throw new ClientNotFoundError()
      }

      const futureCondition = parsedBody.future ? sql`` : sql`AND session.id = selected_session.id`

      const insertResult = await sql<{ id: string }>`
        INSERT INTO client_session (trainer_id, client_id, session_id, price, note)
        SELECT
          ${authorization.trainerId},
          ${parsedBody.clientId},
          session.id,
          ${parsedBody.price ?? 0},
          ${parsedBody.note ?? null}
        FROM
          session_series
          JOIN session ON session.session_series_id = session_series.id
          JOIN (
            SELECT
              session.start,
              session.trainer_id,
              session_series_id,
              session.id
            FROM
              session
              JOIN session_series ON session.session_series_id = session_series.id
            WHERE
              session.id = ${sessionId}
              AND session_series.trainer_id = ${authorization.trainerId}
          ) selected_session ON selected_session.session_series_id = session_series.id
        WHERE
          session_series.id = selected_session.session_series_id
          AND session.start >= selected_session.start
          ${futureCondition}
        ON CONFLICT (session_id, client_id) DO UPDATE SET price = ${parsedBody.price ?? 0}
        RETURNING client_session.id
      `.execute(trx)

      const insertedIds = insertResult.rows?.map((row) => row.id).filter((id): id is string => Boolean(id)) ?? []

      if (insertedIds.length === 0) {
        return []
      }

      const rows = (await clientSessionSelect(
        trx,
        authorization.trainerId,
        insertedIds
      ).execute()) as RawClientSessionRow[]

      return rows.map((row) => adaptClientSessionRow(row))
    })

    const responseBody = clientSessionListSchema.parse(clientSessions)

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof ClientNotFoundError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Client not found',
          detail: 'We could not find a client with the specified identifier for the authenticated trainer.',
          type: '/client-not-found',
        }),
        { status: 404 }
      )
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to validate client session response',
          detail: 'Client session response did not match the expected schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to add client to session', {
      trainerId: authorization.trainerId,
      sessionId,
      clientId: parsedBody.clientId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to add client to session',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
