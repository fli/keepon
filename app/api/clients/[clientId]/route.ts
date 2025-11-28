import { NextResponse } from 'next/server'
import { db } from '@keepon/db'
import { z, ZodError } from 'zod'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../../_lib/accessToken'
import { adaptClientRow, clientSchema } from '../../_lib/clients'

export const runtime = 'nodejs'

const paramsSchema = z.object({
  clientId: z
    .string()
    .trim()
    .min(1, 'Client id is required.')
    .uuid({ message: 'Client id must be a valid UUID.' }),
})

type RouteContext = {
  params?: {
    clientId?: string
  }
}

export async function GET(request: Request, context: RouteContext) {
  const paramsResult = paramsSchema.safeParse(context?.params ?? {})

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
    if (error instanceof ZodError) {
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

    console.error('Failed to fetch client', error, {
      trainerId: authorization.trainerId,
      clientId,
    })

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
