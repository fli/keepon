import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authenticateTrainerOrClientRequest,
  buildErrorResponse,
} from '../_lib/accessToken'
import {
  adaptSaleProductRow,
  fetchSaleProducts,
  saleProductListSchema,
  saleProductTypeSchema,
} from '../_lib/saleProducts'

export const runtime = 'nodejs'

const querySchema = z.object({
  type: saleProductTypeSchema.optional(),
  saleId: z
    .string()
    .trim()
    .min(1, 'saleId must not be empty')
    .optional(),
  updatedAfter: z
    .string()
    .trim()
    .min(1, 'updatedAfter must not be empty')
    .transform(value => {
      const parsed = new Date(value)
      if (Number.isNaN(parsed.getTime())) {
        throw new Error('updatedAfter must be a valid ISO 8601 datetime string')
      }
      return parsed
    })
    .optional(),
  clientId: z
    .string()
    .trim()
    .min(1, 'clientId must not be empty')
    .optional(),
})

export async function GET(request: Request) {
  const url = new URL(request.url)

  const normalize = (value: string | null) =>
    value && value.trim().length > 0 ? value.trim() : undefined

  const parseResult = querySchema.safeParse({
    type: normalize(url.searchParams.get('type')),
    saleId: normalize(url.searchParams.get('saleId')),
    updatedAfter: normalize(url.searchParams.get('updatedAfter')),
    clientId: normalize(url.searchParams.get('clientId')),
  })

  if (!parseResult.success) {
    const detail = parseResult.error.issues
      .map(issue => issue.message)
      .join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid query parameters',
        detail:
          detail || 'Request query parameters did not match the expected schema.',
        type: '/invalid-query',
      }),
      { status: 400 }
    )
  }

  const authorization = await authenticateTrainerOrClientRequest(request, {
    trainerExtensionFailureLogMessage:
      'Failed to extend access token expiry while fetching sale products for trainer request',
    clientExtensionFailureLogMessage:
      'Failed to extend access token expiry while fetching sale products for client request',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const filters = { ...parseResult.data }

    if (authorization.actor === 'client') {
      if (filters.clientId && filters.clientId !== authorization.clientId) {
        return NextResponse.json(
          buildErrorResponse({
            status: 403,
            title:
              'You are not authorized to view sale products for other clients',
            type: '/forbidden',
          }),
          { status: 403 }
        )
      }

      filters.clientId = authorization.clientId
    }

    const rows = await fetchSaleProducts(authorization.trainerId, {
      type: filters.type,
      saleId: filters.saleId,
      updatedAfter: filters.updatedAfter,
      clientId: filters.clientId,
    })

    const saleProducts = rows.map(row => adaptSaleProductRow(row))

    const parsedSaleProducts = saleProductListSchema.parse(saleProducts)

    return NextResponse.json(parsedSaleProducts)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse sale product data from database',
          detail:
            'Sale product data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch sale products', error, {
      actor: authorization.actor,
      trainerId: authorization.trainerId,
      clientId: authorization.actor === 'client' ? authorization.clientId : null,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch sale products',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
