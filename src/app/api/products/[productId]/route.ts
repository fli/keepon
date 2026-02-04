import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { intervalFromMinutes, toPoint } from '@/lib/db/values'
import { getProductById, moneyString } from '@/server/products'
import { authenticateTrainerRequest, buildErrorResponse } from '../../_lib/accessToken'
import { parseStrictJsonBody } from '../../_lib/strictJson'

const nonNegativeMoneyString = moneyString.refine(
  (value) => Number.parseFloat(value) >= 0,
  'Price must be non-negative'
)

const priceSchema = z
  .union([z.string(), z.number()])
  .transform((value) => {
    const raw = typeof value === 'number' ? value.toString() : typeof value === 'string' ? value.trim() : value

    if (typeof raw !== 'string') {
      return raw
    }

    const numeric = Number.parseFloat(raw)
    if (Number.isNaN(numeric)) {
      return raw
    }

    return numeric.toFixed(2)
  })
  .pipe(nonNegativeMoneyString)

const nullableTrimmedToNull = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return undefined
    }
    if (value === null) {
      return null
    }
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  })

const descriptionSchema = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return undefined
    }
    if (value === null) {
      return ''
    }
    return value.trim()
  })

const geoSchema = z
  .object({
    lat: z.number(),
    lng: z.number(),
  })
  .nullable()
  .optional()

const patchRequestBodySchema = z
  .object({
    price: priceSchema.optional(),
    name: z.string().trim().min(1, 'Name is required').optional(),
    description: descriptionSchema,
    durationMinutes: z.number().int().min(1).optional(),
    location: nullableTrimmedToNull,
    address: nullableTrimmedToNull,
    geo: geoSchema,
    googlePlaceId: nullableTrimmedToNull,
    bookableOnline: z.boolean().optional(),
    showPriceOnline: z.boolean().optional(),
    totalCredits: z.number().int().min(0).optional(),
    bookingPaymentType: z.enum(['hidePrice', 'noPrepayment', 'fullPrepayment']).optional(),
    bufferMinutesBefore: z.number().int().min(0).optional(),
    bufferMinutesAfter: z.number().int().min(0).optional(),
    timeSlotFrequencyMinutes: z.number().int().min(1).optional(),
    displayOrder: z.number().int().nullable().optional(),
    image0Url: z.union([z.string(), z.null()]).optional(),
    image1Url: z.union([z.string(), z.null()]).optional(),
    image2Url: z.union([z.string(), z.null()]).optional(),
    image3Url: z.union([z.string(), z.null()]).optional(),
    image4Url: z.union([z.string(), z.null()]).optional(),
    image5Url: z.union([z.string(), z.null()]).optional(),
    coverImageUrl: z.union([z.string(), z.null()]).optional(),
    iconUrl: z.union([z.string(), z.null()]).optional(),
    requestClientAddressOnline: z.union([z.literal('optional'), z.literal('required'), z.null()]).optional(),
    bookingQuestion: nullableTrimmedToNull,
    bookingQuestionState: z.union([z.literal('optional'), z.literal('required'), z.null()]).optional(),
  })
  .strict()

class UpdatedGalleryImageMustExistError extends Error {}
class MustUpdateImageUsingUploadError extends Error {}

type HandlerContext = { params: Promise<{ productId: string }> }

export async function GET(request: NextRequest, context: HandlerContext) {
  const { productId } = await context.params

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while fetching product',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const product = await getProductById(authorization.trainerId, productId)

    if (!product) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Product not found',
          type: '/resource-not-found',
        }),
        { status: 404 }
      )
    }

    return NextResponse.json(product)
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

    console.error('Failed to fetch product', {
      trainerId: authorization.trainerId,
      productId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch product',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest, context: HandlerContext) {
  const { productId } = await context.params

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while deleting product',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const deleted = await db.transaction().execute(async (trx) => {
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
        .returning((eb) => [eb.ref('product.id').as('id')])
        .executeTakeFirst()

      return removed
    })

    if (!deleted) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Product not found',
          type: '/resource-not-found',
        }),
        { status: 404 }
      )
    }

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to validate product deletion response',
          detail: 'Product deletion response did not match the expected schema.',
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

export async function PATCH(request: NextRequest, context: HandlerContext) {
  const { productId } = await context.params

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while updating product',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const parsedJson = await parseStrictJsonBody(request)
  if (!parsedJson.ok) {
    return parsedJson.response
  }

  const bodyResult = patchRequestBodySchema.safeParse(parsedJson.data)

  if (!bodyResult.success) {
    const detail = bodyResult.error.issues.map((issue) => issue.message).join('; ')

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

  const parsedBody = bodyResult.data
  const hasUpdates = Object.values(parsedBody).some((value) => value !== undefined)

  try {
    if (!hasUpdates) {
      const product = await getProductById(authorization.trainerId, productId)

      if (!product) {
        return NextResponse.json(
          buildErrorResponse({
            status: 404,
            title: 'Product not found',
            type: '/resource-not-found',
          }),
          { status: 404 }
        )
      }

      return NextResponse.json(product)
    }

    const transactionResult = await db.transaction().execute(async (trx) => {
      const productRow = await trx
        .selectFrom('product as product')
        .leftJoin('service as service', 'service.id', 'product.id')
        .leftJoin('credit_pack as creditPack', 'creditPack.id', 'product.id')
        .select((eb) => [
          eb.ref('product.id').as('id'),
          eb.ref('product.is_credit_pack').as('isCreditPack'),
          eb.ref('product.is_item').as('isItem'),
          eb.ref('product.is_service').as('isService'),
          eb.ref('service.cover_image_url').as('coverImageUrl'),
          eb.ref('service.icon_url').as('iconUrl'),
          eb.ref('service.image_0_url').as('image0Url'),
          eb.ref('service.image_1_url').as('image1Url'),
          eb.ref('service.image_2_url').as('image2Url'),
          eb.ref('service.image_3_url').as('image3Url'),
          eb.ref('service.image_4_url').as('image4Url'),
          eb.ref('service.image_5_url').as('image5Url'),
        ])
        .where('product.id', '=', productId)
        .where('product.trainer_id', '=', authorization.trainerId)
        .executeTakeFirst()

      if (!productRow) {
        return { found: false as const }
      }

      const isService = productRow.isService === true
      const isCreditPack = productRow.isCreditPack === true

      if (isService) {
        const {
          durationMinutes,
          location,
          address,
          googlePlaceId,
          geo,
          bookableOnline,
          bookingPaymentType,
          showPriceOnline,
          bufferMinutesBefore,
          bufferMinutesAfter,
          timeSlotFrequencyMinutes,
          image0Url,
          image1Url,
          image2Url,
          image3Url,
          image4Url,
          image5Url,
          coverImageUrl,
          iconUrl,
          requestClientAddressOnline,
          bookingQuestion,
          bookingQuestionState,
        } = parsedBody

        const providedGallery = [
          image0Url,
          image1Url,
          image2Url,
          image3Url,
          image4Url,
          image5Url,
          coverImageUrl,
          iconUrl,
        ].filter((value): value is string => typeof value === 'string')

        if (providedGallery.length > 0) {
          if (typeof coverImageUrl === 'string' && coverImageUrl !== productRow.coverImageUrl) {
            throw new MustUpdateImageUsingUploadError()
          }

          if (typeof iconUrl === 'string' && iconUrl !== productRow.iconUrl) {
            throw new MustUpdateImageUsingUploadError()
          }

          const existingGallery = new Set(
            [
              productRow.image0Url,
              productRow.image1Url,
              productRow.image2Url,
              productRow.image3Url,
              productRow.image4Url,
              productRow.image5Url,
            ].filter((value): value is string => typeof value === 'string')
          )

          for (const image of [image0Url, image1Url, image2Url, image3Url, image4Url, image5Url]) {
            if (typeof image === 'string' && !existingGallery.has(image)) {
              throw new UpdatedGalleryImageMustExistError()
            }
          }
        }

        const serviceUpdate: Record<string, unknown> = {}

        if (durationMinutes !== undefined) {
          serviceUpdate.duration = intervalFromMinutes(durationMinutes)
        }

        if (location !== undefined) {
          serviceUpdate.location = location
        }

        if (address !== undefined) {
          serviceUpdate.address = address
        }

        if (googlePlaceId !== undefined) {
          serviceUpdate.google_place_id = googlePlaceId
        }

        if (geo !== undefined) {
          serviceUpdate.geo = geo === null ? null : toPoint(geo.lat, geo.lng)
        }

        if (bookableOnline !== undefined) {
          serviceUpdate.bookable_online = bookableOnline
        }

        const resolvedBookingPaymentType =
          bookingPaymentType ??
          (showPriceOnline === undefined ? undefined : showPriceOnline ? 'noPrepayment' : 'hidePrice')

        if (resolvedBookingPaymentType !== undefined) {
          serviceUpdate.booking_payment_type = resolvedBookingPaymentType
        }

        if (bufferMinutesBefore !== undefined) {
          serviceUpdate.buffer_minutes_before = bufferMinutesBefore
        }

        if (bufferMinutesAfter !== undefined) {
          serviceUpdate.buffer_minutes_after = bufferMinutesAfter
        }

        if (timeSlotFrequencyMinutes !== undefined) {
          serviceUpdate.time_slot_frequency_minutes = timeSlotFrequencyMinutes
        }

        if (coverImageUrl !== undefined) {
          serviceUpdate.cover_image_url = coverImageUrl
        }

        if (iconUrl !== undefined) {
          serviceUpdate.icon_url = iconUrl
        }

        if (image0Url !== undefined) {
          serviceUpdate.image_0_url = image0Url
        }

        if (image1Url !== undefined) {
          serviceUpdate.image_1_url = image1Url
        }

        if (image2Url !== undefined) {
          serviceUpdate.image_2_url = image2Url
        }

        if (image3Url !== undefined) {
          serviceUpdate.image_3_url = image3Url
        }

        if (image4Url !== undefined) {
          serviceUpdate.image_4_url = image4Url
        }

        if (image5Url !== undefined) {
          serviceUpdate.image_5_url = image5Url
        }

        if (requestClientAddressOnline !== undefined) {
          serviceUpdate.request_client_address_online = requestClientAddressOnline
        }

        if (bookingQuestion !== undefined) {
          serviceUpdate.booking_question = bookingQuestion
        }

        if (bookingQuestionState !== undefined) {
          serviceUpdate.booking_question_state = bookingQuestionState
        }

        if (Object.keys(serviceUpdate).length > 0) {
          await trx
            .updateTable('service')
            .set(serviceUpdate)
            .where('service.id', '=', productId)
            .where('service.trainer_id', '=', authorization.trainerId)
            .execute()
        }
      }

      if (isCreditPack && parsedBody.totalCredits !== undefined) {
        await trx
          .updateTable('credit_pack')
          .set({ total_credits: parsedBody.totalCredits })
          .where('credit_pack.id', '=', productId)
          .where('credit_pack.trainer_id', '=', authorization.trainerId)
          .execute()
      }

      const productUpdate: Record<string, unknown> = {}

      if (parsedBody.price !== undefined) {
        productUpdate.price = parsedBody.price
      }

      if (parsedBody.name !== undefined) {
        productUpdate.name = parsedBody.name
      }

      if (parsedBody.description !== undefined) {
        productUpdate.description = parsedBody.description
      }

      if (parsedBody.displayOrder !== undefined) {
        productUpdate.display_order = parsedBody.displayOrder
      }

      if (Object.keys(productUpdate).length > 0) {
        await trx
          .updateTable('product')
          .set(productUpdate)
          .where('product.id', '=', productId)
          .where('product.trainer_id', '=', authorization.trainerId)
          .execute()
      }

      return { found: true as const }
    })

    if (!transactionResult?.found) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Product not found',
          type: '/resource-not-found',
        }),
        { status: 404 }
      )
    }

    const product = await getProductById(authorization.trainerId, productId)

    if (!product) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Product not found',
          type: '/resource-not-found',
        }),
        { status: 404 }
      )
    }

    return NextResponse.json(product)
  } catch (error) {
    if (error instanceof UpdatedGalleryImageMustExistError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 400,
          title: 'Updated gallery image must be an existing gallery image.',
          type: '/updated-gallery-image-must-be-existing-gallery-image',
        }),
        { status: 400 }
      )
    }

    if (error instanceof MustUpdateImageUsingUploadError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 400,
          title: 'You must update the image url by uploading a new image',
          type: '/must-update-image-url-using-upload',
        }),
        { status: 400 }
      )
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse updated product data',
          detail: 'Product data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to update product', {
      trainerId: authorization.trainerId,
      productId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to update product',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
