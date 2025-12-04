import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../../_lib/accessToken'

export const runtime = 'nodejs'

const paramsSchema = z.object({
  productId: z
    .string()
    .trim()
    .min(1, 'Product id is required')
    .uuid({ message: 'Product id must be a valid UUID' }),
})

const deleteResponseSchema = z.object({
  count: z.number().int().nonnegative(),
})

type HandlerContext = RouteContext<'/api/products/[productId]'>

export async function DELETE(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues
      .map(issue => issue.message)
      .join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid path parameters',
        detail:
          detail ||
          'Product identifier parameter did not match the expected schema.',
        type: '/invalid-path-parameters',
      }),
      { status: 400 }
    )
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while deleting product',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const { productId } = paramsResult.data

  try {
    const deleted = await db.transaction().execute(async trx => {
      await trx
        .updateTable('sale_product')
        .set({ product_id: null })
        .where('sale_product.product_id', '=', productId)
        .where('sale_product.trainer_id', '=', authorization.trainerId)
        .execute()

      const removed = await trx
        .deleteFrom('product')
        .where('product.id', '=', productId)
        .where('product.trainer_id', '=', authorization.trainerId)
        .returning(({ ref }) => [ref('product.id').as('id')])
        .executeTakeFirst()

      return removed
    })

    if (!deleted) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Product not found',
          detail:
            'We could not find a product with the specified identifier for the authenticated trainer.',
          type: '/product-not-found',
        }),
        { status: 404 }
      )
    }

    const responseBody = deleteResponseSchema.parse({ count: 1 })

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to validate product deletion response',
          detail:
            'Product deletion response did not match the expected schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to delete product', {
      trainerId: authorization.trainerId,
      productId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to delete product',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
