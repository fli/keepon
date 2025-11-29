import { NextRequest, NextResponse } from 'next/server'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../../_lib/accessToken'
import { adaptClientRow, clientSchema } from '../shared'

export const runtime = 'nodejs'

const paramsSchema = z.object({
  clientId: z
    .string()
    .trim()
    .min(1, 'Client id is required')
    .uuid({ message: 'Client id must be a valid UUID' }),
})

const deleteResponseSchema = z.object({
  count: z
    .number()
    .int()
    .nonnegative(),
})

type HandlerContext = RouteContext<'/api/clients/[clientId]'>

export async function GET(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues
      .map(issue => issue.message)
      .join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid client identifier',
        detail:
          detail ||
          'Request parameters did not match the expected client identifier schema.',
        type: '/invalid-parameter',
      }),
      { status: 400 }
    )
  }

  const { clientId } = paramsResult.data

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while fetching client',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const clientRow = await db
      .selectFrom('vw_legacy_client as client')
      .selectAll('client')
      .where('client.trainerId', '=', authorization.trainerId)
      .where('client.id', '=', clientId)
      .executeTakeFirst()

    if (!clientRow) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Client not found',
          detail:
            'We could not find a client with the specified identifier for the authenticated trainer.',
          type: '/client-not-found',
        }),
        { status: 404 }
      )
    }

    const client = clientSchema.parse(adaptClientRow(clientRow))

    return NextResponse.json(client)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse client data from database',
          detail:
            'Client data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error(
      'Failed to fetch client',
      authorization.trainerId,
      clientId,
      error
    )

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch client',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}

class ClientNotFoundError extends Error {
  constructor() {
    super('Client not found')
    this.name = 'ClientNotFoundError'
  }
}

export async function DELETE(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues
      .map(issue => issue.message)
      .join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid client identifier',
        detail:
          detail ||
          'Request parameters did not match the expected client identifier schema.',
        type: '/invalid-parameter',
      }),
      { status: 400 }
    )
  }

  const { clientId } = paramsResult.data

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while deleting client',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const deleteResult = await db.transaction().execute(async trx => {
      const client = await trx
        .selectFrom('client')
        .select(({ ref }) => [ref('client.id').as('id')])
        .where('client.id', '=', clientId)
        .where('client.trainer_id', '=', authorization.trainerId)
        .executeTakeFirst()

      if (!client) {
        throw new ClientNotFoundError()
      }

      await sql`
        DELETE FROM session_series
         WHERE event_type = 'single_session'
           AND trainer_id = ${authorization.trainerId}
           AND id IN (
             SELECT session.session_series_id
               FROM session
               INNER JOIN client_session
                 ON client_session.session_id = session.id
              WHERE client_session.client_id = ${clientId}
                AND session.trainer_id = ${authorization.trainerId}
           )
      `.execute(trx)

      const deleted = await trx
        .deleteFrom('client')
        .where('client.id', '=', clientId)
        .where('client.trainer_id', '=', authorization.trainerId)
        .returning(({ ref }) => [ref('client.id').as('id')])
        .executeTakeFirst()

      if (!deleted) {
        throw new ClientNotFoundError()
      }

      return { count: 1 }
    })

    const responseBody = deleteResponseSchema.parse(deleteResult)

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof ClientNotFoundError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Client not found',
          detail:
            'We could not find a client with the specified identifier for the authenticated trainer.',
          type: '/client-not-found',
        }),
        { status: 404 }
      )
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to validate client deletion response',
          detail:
            'Client deletion response did not match the expected schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to delete client', {
      trainerId: authorization.trainerId,
      clientId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to delete client',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
