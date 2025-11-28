import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import {
  authenticateTrainerOrClientRequest,
  buildErrorResponse,
} from '../_lib/accessToken'
import {
  adaptSaleRow,
  fetchSales,
  saleListSchema,
  salesQuerySchema,
  type SalesQuery,
} from '../_lib/sales'

export const runtime = 'nodejs'

const normalizeQueryValue = (value: string | null) =>
  value && value.trim().length > 0 ? value.trim() : undefined

const parseQuery = (request: Request) => {
  const url = new URL(request.url)
  const queryResult = salesQuerySchema.safeParse({
    updatedAfter: normalizeQueryValue(url.searchParams.get('updatedAfter')),
    clientId: normalizeQueryValue(url.searchParams.get('clientId')),
  })

  if (!queryResult.success) {
    const detail = queryResult.error.issues
      .map(issue => issue.message)
      .join('; ')

    return {
      ok: false as const,
      response: NextResponse.json(
        buildErrorResponse({
          status: 400,
          title: 'Invalid query parameters',
          detail:
            detail ||
            'Request query parameters did not match the expected schema.',
          type: '/invalid-query',
        }),
        { status: 400 }
      ),
    }
  }

  return { ok: true as const, data: queryResult.data }
}

const assertClientAccess = (
  authorization:
    | {
        actor: 'trainer'
        trainerId: string
      }
    | {
        actor: 'client'
        trainerId: string
        clientId: string
      },
  filters: SalesQuery
) => {
  if (authorization.actor === 'client') {
    if (filters.clientId && filters.clientId !== authorization.clientId) {
      return NextResponse.json(
        buildErrorResponse({
          status: 403,
          title: 'You are not authorized to view sales for other clients',
          type: '/forbidden',
        }),
        { status: 403 }
      )
    }

    filters.clientId = authorization.clientId
  }

  return null
}

export async function GET(request: Request) {
  const query = parseQuery(request)
  if (!query.ok) {
    return query.response
  }

  const authorization = await authenticateTrainerOrClientRequest(request, {
    trainerExtensionFailureLogMessage:
      'Failed to extend access token expiry while fetching sales for trainer request',
    clientExtensionFailureLogMessage:
      'Failed to extend access token expiry while fetching sales for client request',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const filters = query.data

  const accessError = assertClientAccess(authorization, filters)
  if (accessError) {
    return accessError
  }

  try {
    const rows = await fetchSales({
      trainerId: authorization.trainerId,
      clientId: filters.clientId,
      updatedAfter: filters.updatedAfter,
    })

    const sales = saleListSchema.parse(rows.map(adaptSaleRow))

    return NextResponse.json(sales)
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse sale data from database',
          detail: 'Sale data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch sales', error, {
      trainerId: authorization.trainerId,
      actor: authorization.actor,
      clientId:
        authorization.actor === 'client' ? authorization.clientId : filters.clientId ?? null,
      updatedAfter: filters.updatedAfter?.toISOString() ?? null,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch sales',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
