import type { Kysely, Transaction } from 'kysely'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { Database } from '@/lib/db'
import { db } from '@/lib/db'
import type { RawClientSessionRow } from '../../../_lib/clientSessionsSchema'
import { authenticateTrainerRequest, buildErrorResponse } from '../../../_lib/accessToken'
import { adaptClientSessionRow } from '../../../_lib/clientSessionsSchema'

const paramsSchema = z.object({
  sessionId: z.string({ message: 'Session id is required.' }).trim().min(1, 'Session id must not be empty.'),
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

const legacyInternalErrorResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Something on our end went wrong.',
    }),
    { status: 500 }
  )

const priceSchema = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined) {
      return 0
    }

    if (typeof value === 'number') {
      return value
    }

    const trimmed = value.trim()
    if (trimmed.length === 0) {
      return 0
    }

    return Number(trimmed)
  })
  .refine((value) => Number.isFinite(value) && value >= 0, {
    message: 'price should not be provided or  should be greater than or equal to 0',
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
  clientId: z.string({ message: 'clientId is required.' }).trim().min(1, 'clientId must not be empty.'),
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

class SessionNotFoundError extends Error {
  constructor() {
    super('Session not found')
    this.name = 'SessionNotFoundError'
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

  let rawBody: unknown = {}
  const rawBodyText = await request.text()
  if (rawBodyText.trim().length > 0) {
    try {
      rawBody = JSON.parse(rawBodyText)
    } catch (error) {
      console.error('Failed to parse session client request body', sessionId, error)
      return createLegacyInvalidJsonResponse()
    }

    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      return createLegacyInvalidJsonResponse()
    }
  }

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
  const parsedBody = bodyResult.data

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

      const selectedSession = await trx
        .selectFrom('session')
        .innerJoin('session_series', 'session.session_series_id', 'session_series.id')
        .select(['session.id', 'session.start', 'session.session_series_id'])
        .where('session.id', '=', sessionId)
        .where('session_series.trainer_id', '=', authorization.trainerId)
        .executeTakeFirst()

      if (!selectedSession) {
        throw new SessionNotFoundError()
      }

      let sessionsQuery = trx
        .selectFrom('session')
        .select('session.id')
        .where('session.session_series_id', '=', selectedSession.session_series_id)
        .where('session.start', '>=', selectedSession.start)

      if (!parsedBody.future) {
        sessionsQuery = sessionsQuery.where('session.id', '=', selectedSession.id)
      }

      const sessions = await sessionsQuery.execute()
      const sessionIds = sessions.map((row) => row.id)

      if (sessionIds.length === 0) {
        throw new SessionNotFoundError()
      }

      const insertResult = await trx
        .insertInto('client_session')
        .values(
          sessionIds.map((sessionIdValue) => ({
            trainer_id: authorization.trainerId,
            client_id: parsedBody.clientId,
            session_id: sessionIdValue,
            price: parsedBody.price ?? 0,
            note: parsedBody.note ?? null,
          }))
        )
        .onConflict((oc) => oc.columns(['session_id', 'client_id']).doUpdateSet({ price: parsedBody.price ?? 0 }))
        .returning('id')
        .execute()

      const insertedIds = insertResult.map((row) => row.id).filter((id): id is string => Boolean(id))

      if (insertedIds.length === 0) {
        throw new SessionNotFoundError()
      }

      const rows = (await clientSessionSelect(
        trx,
        authorization.trainerId,
        insertedIds
      ).execute()) as RawClientSessionRow[]

      return rows.map((row) => adaptClientSessionRow(row))
    })

    return NextResponse.json(clientSessions)
  } catch (error) {
    if (error instanceof ClientNotFoundError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Client not found',
          type: '/resource-not-found',
        }),
        { status: 404 }
      )
    }

    if (error instanceof SessionNotFoundError) {
      return legacyInternalErrorResponse()
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

    return legacyInternalErrorResponse()
  }
}
