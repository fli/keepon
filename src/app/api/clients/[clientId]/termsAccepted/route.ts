import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticateClientRequest, buildErrorResponse } from '../../../_lib/accessToken'
import { createLegacyInvalidJsonResponse, parseStrictJsonBody } from '../../../_lib/strictJson'

type HandlerContext = RouteContext<'/api/clients/[clientId]/termsAccepted'>

const toNumber = (value: unknown) => {
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

export async function PUT(request: NextRequest, context: HandlerContext) {
  void context
  const parsed = await parseStrictJsonBody(request)
  if (!parsed.ok) {
    return parsed.response
  }
  const body = parsed.data

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return createLegacyInvalidJsonResponse()
  }

  const authorization = await authenticateClientRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while accepting client terms',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const result = await db
      .updateTable('client')
      .set({
        terms_accepted: true,
      })
      .where('id', '=', authorization.clientId)
      .where('trainer_id', '=', authorization.trainerId)
      .executeTakeFirst()

    const updatedCount = toNumber(result?.numUpdatedRows ?? 0)

    if (updatedCount === 0) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Client not found',
          type: '/resource-not-found',
        }),
        { status: 404 }
      )
    }

    return new Response(null, { status: 204 })
  } catch (error) {
    console.error('Failed to mark client terms as accepted', authorization.trainerId, authorization.clientId, error)

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to accept terms',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
