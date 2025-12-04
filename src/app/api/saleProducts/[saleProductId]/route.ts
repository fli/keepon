import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authenticateTrainerOrClientRequest,
  buildErrorResponse,
} from '../../_lib/accessToken'
import {
  adaptSaleProductRow,
  fetchSaleProducts,
  saleProductSchema,
  type FetchSaleProductFilters,
} from '../shared'

const paramsSchema = z.object({
  saleProductId: z
    .string()
    .trim()
    .min(1, 'Sale product id is required')
    .uuid({ message: 'Sale product id must be a valid UUID' }),
})

type HandlerContext = RouteContext<'/api/saleProducts/[saleProductId]'>

export async function GET(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues
      .map(issue => issue.message)
      .join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid sale product identifier',
        detail:
          detail ||
          'Request parameters did not match the expected sale product identifier schema.',
        type: '/invalid-parameter',
      }),
      { status: 400 }
    )
  }

  const authorization = await authenticateTrainerOrClientRequest(request, {
    trainerExtensionFailureLogMessage:
      'Failed to extend access token expiry while fetching sale product for trainer request',
    clientExtensionFailureLogMessage:
      'Failed to extend access token expiry while fetching sale product for client request',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { saleProductId } = paramsResult.data

  try {
    const filters: FetchSaleProductFilters = {
      saleProductId,
    }

    if (authorization.actor === 'client') {
      filters.clientId = authorization.clientId
    }

    const rows = await fetchSaleProducts(authorization.trainerId, filters)
    const saleProductRow = rows[0]

    if (!saleProductRow) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Sale product not found',
          detail:
            'We could not find a sale product with the specified identifier for the authenticated account.',
          type: '/sale-product-not-found',
        }),
        { status: 404 }
      )
    }

    const responseBody = saleProductSchema.parse(
      adaptSaleProductRow(saleProductRow)
    )

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse sale product data from database',
          detail: 'Sale product data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error(
      'Failed to fetch sale product',
      authorization.trainerId,
      authorization.actor === 'client' ? authorization.clientId : undefined,
      saleProductId,
      error
    )

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch sale product',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
