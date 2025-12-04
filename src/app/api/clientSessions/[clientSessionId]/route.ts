import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import type { DB } from '@/lib/db'
import type { Insertable } from 'kysely'
import { z, ZodError } from 'zod'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../../_lib/accessToken'
import {
  adaptClientSessionRow,
  RawClientSessionRow,
} from '../../_lib/clientSessionsSchema'

const paramsSchema = z.object({
  clientSessionId: z
    .string()
    .trim()
    .min(1, 'Client session id is required'),
})

const trimmedStringToNull = z
  .string()
  .transform(value => {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  })

const requestBodySchema = z
  .object({
    note: z.union([trimmedStringToNull, z.null()]).optional(),
    price: z
      .union([z.number().min(0, 'Price must be at least 0'), z.null()])
      .optional(),
    attended: z.boolean().optional(),
    saleId: z.union([z.string(), z.null()]).optional(),
    cancelReason: z.union([trimmedStringToNull, z.null()]).optional(),
  })
  .strict()

type HandlerContext = RouteContext<'/api/clientSessions/[clientSessionId]'>

type ClientSessionUpdate = Partial<Insertable<DB['client_session']>>

class ClientSessionNotFoundError extends Error {
  constructor() {
    super('Client session not found')
    this.name = 'ClientSessionNotFoundError'
  }
}

const normalizeUpdatedCount = (value: unknown) => {
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
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map(issue => issue.message).join('; ')
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid path parameters',
        detail:
          detail ||
          'Client session id parameter did not match the expected schema.',
        type: '/invalid-path-parameters',
      }),
      { status: 400 }
    )
  }

  const { clientSessionId } = paramsResult.data

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while fetching client session',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const row = (await db
      .selectFrom('vw_legacy_client_session as v')
      .innerJoin('client_session as cs', 'cs.id', 'v.id')
      .select(({ ref }) => [
        ref('v.id').as('id'),
        ref('v.clientId').as('clientId'),
        ref('v.sessionId').as('sessionId'),
        ref('v.createdAt').as('createdAt'),
        ref('v.state').as('state'),
        ref('v.bookingQuestion').as('bookingQuestion'),
        ref('v.bookingQuestionResponse').as('bookingQuestionResponse'),
        ref('v.price').as('price'),
        ref('v.attended').as('attended'),
        ref('v.payment').as('payment'),
        ref('v.notes').as('notes'),
        ref('v.saleId').as('saleId'),
        ref('v.cancelTime').as('cancelTime'),
        ref('v.cancelReason').as('cancelReason'),
        ref('v.acceptTime').as('acceptTime'),
        ref('v.declineTime').as('declineTime'),
        ref('v.inviteTime').as('inviteTime'),
        ref('v.confirmTime').as('confirmTime'),
      ])
      .where('cs.trainer_id', '=', authorization.trainerId)
      .where('v.id', '=', clientSessionId)
      .executeTakeFirst()) as RawClientSessionRow | undefined

    if (!row) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Client session not found',
          detail:
            'We could not find a client session with the specified identifier for the authenticated trainer.',
          type: '/client-session-not-found',
        }),
        { status: 404 }
      )
    }

    const clientSession = adaptClientSessionRow(row)

    return NextResponse.json(clientSession)
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse client session data from database',
          detail:
            'Client session data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error(
      'Failed to fetch client session',
      authorization.trainerId,
      clientSessionId,
      error
    )

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch client session',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map(issue => issue.message).join('; ')
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid path parameters',
        detail:
          detail ||
          'Client session id parameter did not match the expected schema.',
        type: '/invalid-path-parameters',
      }),
      { status: 400 }
    )
  }

  const { clientSessionId } = paramsResult.data

  let parsedBody: z.infer<typeof requestBodySchema> = {}
  const rawBodyText = await request.text()

  if (rawBodyText.trim().length > 0) {
    let jsonBody: unknown

    try {
      jsonBody = JSON.parse(rawBodyText)
    } catch (error) {
      console.error(
        'Failed to parse client session update request JSON',
        clientSessionId,
        error
      )

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

    const bodyResult = requestBodySchema.safeParse(jsonBody)
    if (!bodyResult.success) {
      const detail = bodyResult.error.issues
        .map(issue => issue.message)
        .join('; ')

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
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while updating client session',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const rawRow = await db.transaction().execute(async trx => {
      const existing = await trx
        .selectFrom('client_session')
        .select('id')
        .where('id', '=', clientSessionId)
        .where('trainer_id', '=', authorization.trainerId)
        .executeTakeFirst()

      if (!existing) {
        throw new ClientSessionNotFoundError()
      }

      const hasUpdates = Object.keys(parsedBody).length > 0

        if (hasUpdates) {
          const updates: ClientSessionUpdate = {}

        if (parsedBody.price !== undefined) {
          updates.price = parsedBody.price
        }

        if (parsedBody.attended !== undefined) {
          updates.state = parsedBody.attended ? 'confirmed' : 'cancelled'
          if (parsedBody.attended === true) {
            updates.confirm_time = new Date()
          }
        }

        if (parsedBody.saleId !== undefined) {
          updates.sale_id = parsedBody.saleId
        }

        if (parsedBody.cancelReason !== undefined) {
          updates.cancel_reason = parsedBody.cancelReason
        }

        if (parsedBody.note !== undefined) {
          updates.note = parsedBody.note
        }

        if (Object.keys(updates).length > 0) {
          const updateResult = await trx
            .updateTable('client_session')
            .set(updates)
            .where('id', '=', clientSessionId)
            .where('trainer_id', '=', authorization.trainerId)
            .executeTakeFirst()

          const updatedCount = normalizeUpdatedCount(updateResult?.numUpdatedRows)
          if (updatedCount === 0) {
            throw new ClientSessionNotFoundError()
          }
        }
      }

      const row = (await trx
        .selectFrom('vw_legacy_client_session as v')
        .innerJoin('client_session as cs', 'cs.id', 'v.id')
        .select(({ ref }) => [
          ref('v.id').as('id'),
          ref('v.clientId').as('clientId'),
          ref('v.sessionId').as('sessionId'),
          ref('v.createdAt').as('createdAt'),
          ref('v.state').as('state'),
          ref('v.bookingQuestion').as('bookingQuestion'),
          ref('v.bookingQuestionResponse').as('bookingQuestionResponse'),
          ref('v.price').as('price'),
          ref('v.attended').as('attended'),
          ref('v.payment').as('payment'),
          ref('v.notes').as('notes'),
          ref('v.saleId').as('saleId'),
          ref('v.cancelTime').as('cancelTime'),
          ref('v.cancelReason').as('cancelReason'),
          ref('v.acceptTime').as('acceptTime'),
          ref('v.declineTime').as('declineTime'),
          ref('v.inviteTime').as('inviteTime'),
          ref('v.confirmTime').as('confirmTime'),
        ])
        .where('cs.trainer_id', '=', authorization.trainerId)
        .where('v.id', '=', clientSessionId)
        .executeTakeFirst()) as RawClientSessionRow | undefined

      if (!row) {
        throw new ClientSessionNotFoundError()
      }

      return row
    })

    const clientSession = adaptClientSessionRow(rawRow)

    return NextResponse.json(clientSession)
  } catch (error) {
    if (error instanceof ClientSessionNotFoundError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Client session not found',
          detail:
            'We could not find a client session with the specified identifier for the authenticated trainer.',
          type: '/client-session-not-found',
        }),
        { status: 404 }
      )
    }

    if (error instanceof ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse client session data from database',
          detail:
            'Client session data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to update client session', {
      trainerId: authorization.trainerId,
      clientSessionId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to update client session',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
