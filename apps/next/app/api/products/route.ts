import { NextResponse } from 'next/server'
import { db } from '@keepon/db'
import { z } from 'zod'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../_lib/accessToken'
import {
  sanitizeProductQuery,
  listProducts,
  moneyString,
  fetchProductsForTrainer,
  productListSchema,
} from '@/server/products'

export const runtime = 'nodejs'

const createCreditPackSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  description: z.string().trim().default(''),
  price: moneyString,
  totalCredits: z.number().int().min(1, 'totalCredits must be at least 1'),
  displayOrder: z.number().int().nullable().optional(),
})

export async function GET(request: Request) {
  const paramsOrResponse = sanitizeProductQuery(request)
  if (paramsOrResponse instanceof NextResponse) {
    return paramsOrResponse
  }
  const params = paramsOrResponse

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while fetching products',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const products = await listProducts(authorization.trainerId, params)

    return NextResponse.json(products)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse product data from database',
          detail: 'Product data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch products', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch products',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch (error) {
    console.error('Failed to parse product body as JSON', error)
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

  const parsed = createCreditPackSchema.safeParse(body)
  if (!parsed.success) {
    const detail = parsed.error.issues.map(issue => issue.message).join('; ')
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid request body',
        detail: detail || undefined,
        type: '/invalid-body',
      }),
      { status: 400 }
    )
  }

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while creating product',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const data = parsed.data

    const currencyRow = await db
      .selectFrom('trainer')
      .innerJoin(
        'supported_country_currency as supportedCountryCurrency',
        'supportedCountryCurrency.country_id',
        'trainer.country_id'
      )
      .innerJoin('currency', 'currency.id', 'supportedCountryCurrency.currency_id')
      .select(['currency.id as currencyId', 'currency.alpha_code as currency'])
      .where('trainer.id', '=', authorization.trainerId)
      .executeTakeFirst()

    if (!currencyRow) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Could not resolve trainer currency',
          type: '/missing-currency',
        }),
        { status: 500 }
      )
    }

    const inserted = await db.transaction().execute(async trx => {
      const productRow = await trx
        .insertInto('product')
        .values({
          trainer_id: authorization.trainerId,
          name: data.name,
          description: data.description,
          price: data.price,
          currency_id: currencyRow.currencyId,
          is_credit_pack: true,
          is_item: null,
          is_service: null,
          is_membership: null,
          display_order: data.displayOrder ?? null,
        })
        .returning(['id', 'created_at', 'updated_at'])
        .executeTakeFirst()

      if (!productRow) {
        throw new Error('Failed to insert product')
      }

      await trx
        .insertInto('credit_pack')
        .values({
          id: productRow.id,
          trainer_id: authorization.trainerId,
          total_credits: data.totalCredits,
          is_credit_pack: true,
        })
        .execute()

      return productRow
    })

    const rows = await fetchProductsForTrainer(authorization.trainerId, {
      type: 'creditPack',
    })

    const product = productListSchema.parse(
      rows.filter(row => row.id === inserted.id).map(row => row)
    )[0]

    return NextResponse.json(product, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse product data after creation',
          detail: 'Product data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to create product', error)
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to create product',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
