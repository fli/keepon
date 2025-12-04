import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { authenticateTrainerRequest, buildErrorResponse } from '../_lib/accessToken'
import { adaptClientRow, clientListSchema } from './shared'

const querySchema = z.object({
  sessionId: z.string().min(1).optional(),
})

export async function GET(request: Request) {
  const url = new URL(request.url)
  const rawSessionId = url.searchParams.get('sessionId')
  const trimmedSessionId = rawSessionId?.trim()
  const queryParse = querySchema.safeParse({
    sessionId: trimmedSessionId && trimmedSessionId.length > 0 ? trimmedSessionId : undefined,
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
    const authorization = await authenticateTrainerRequest(request, {
      extensionFailureLogMessage: 'Failed to extend access token expiry while fetching clients',
    })
    if (!authorization.ok) {
      return authorization.response
    }
    const { trainerId } = authorization

    const { sessionId } = queryParse.data

    let clientQuery = db
      .selectFrom('vw_legacy_client as client')
      .selectAll('client')
      .where('client.trainerId', '=', trainerId)

    if (sessionId) {
      const sessionClients = db
        .selectFrom('client_session')
        .select('client_session.client_id')
        .where('client_session.session_id', '=', sessionId)
        .as('session_clients')

      clientQuery = clientQuery.innerJoin(sessionClients, 'session_clients.client_id', 'client.id')
    }

    const clientRows = await clientQuery.execute()

    const clients = clientListSchema.parse(clientRows.map(adaptClientRow))

    return NextResponse.json(clients)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse client data from database',
          detail: 'Client data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch clients', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch clients',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
