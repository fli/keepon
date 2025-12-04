import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import sharp, { type Sharp } from 'sharp'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getProductById } from '@/server/products'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../../../_lib/accessToken'
import {
  PublicBucketNotConfiguredError,
  uploadBufferToPublicBucket,
} from '../../../_lib/storage'

export const runtime = 'nodejs'

const MAX_FILE_BYTES = 5 * 1024 * 1024
const allowedExtensions = new Set(['jpg', 'jpeg', 'png', 'gif'])

type UploadField = {
  formKey: string
  column: string
  square?: boolean
}

const uploadFields = [
  { formKey: 'coverImage', column: 'cover_image_url' },
  { formKey: 'icon', column: 'icon_url', square: true },
  { formKey: 'image0', column: 'image_0_url' },
  { formKey: 'image1', column: 'image_1_url' },
  { formKey: 'image2', column: 'image_2_url' },
  { formKey: 'image3', column: 'image_3_url' },
  { formKey: 'image4', column: 'image_4_url' },
  { formKey: 'image5', column: 'image_5_url' },
] as const satisfies readonly UploadField[]
type HandlerContext = { params: Promise<{ productId: string }> }

const paramsSchema = z.object({
  productId: z
    .string()
    .trim()
    .min(1, 'Product id is required')
    .uuid({ message: 'Product id must be a valid UUID' }),
})

const createInvalidParamsResponse = (detail?: string) =>
  NextResponse.json(
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

const createInvalidBodyResponse = (detail?: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid request body',
      detail:
        detail ??
        'Request body must be multipart/form-data with image file fields.',
      type: '/invalid-body',
    }),
    { status: 400 }
  )

const createInvalidFileTypeResponse = (detail?: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid file type',
      detail: detail ?? 'Only JPG, PNG, or GIF images are supported.',
      type: '/invalid-file-type',
    }),
    { status: 400 }
  )

const createMissingBucketResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Public bucket is not configured',
      detail: 'Set PUBLIC_BUCKET_NAME in the environment.',
      type: '/public-bucket-misconfigured',
    }),
    { status: 500 }
  )

const createNotFoundResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 404,
      title: 'Product not found',
      detail:
        'We could not find a product with the specified identifier for the authenticated trainer.',
      type: '/product-not-found',
    }),
    { status: 404 }
  )

const createUnexpectedErrorResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Unexpected error uploading file',
      type: '/upload-failed',
    }),
    { status: 500 }
  )

type OutputFormat = 'jpg' | 'png'

const transformImage = async (
  buffer: Buffer,
  options: { square?: boolean; format: OutputFormat }
): Promise<{ buffer: Buffer; contentType: string; ext: OutputFormat }> => {
  const sharpFactory = sharp as unknown as (input: Buffer) => Sharp
  let pipeline = sharpFactory(buffer).rotate()

  if (options.square) {
    pipeline = pipeline.resize({
      width: 512,
      height: 512,
      fit: sharp.fit.cover,
      position: sharp.strategy.entropy,
      withoutEnlargement: true,
    })
  }

  if (options.format === 'png') {
    pipeline = pipeline.png({ palette: true, progressive: true })

    return {
      buffer: await pipeline.toBuffer(),
      contentType: 'image/png',
      ext: 'png' as const,
    }
  }

  pipeline = pipeline.jpeg({
    progressive: true,
    chromaSubsampling: '4:4:4',
    trellisQuantisation: true,
    optimiseScans: true,
    optimiseCoding: true,
  })

  return {
    buffer: await pipeline.toBuffer(),
    contentType: 'image/jpeg',
    ext: 'jpg' as const,
  }
}

const fetchServiceProduct = async (trainerId: string, productId: string) =>
  db
    .selectFrom('service as service')
    .select('service.id')
    .where('service.id', '=', productId)
    .where('service.trainer_id', '=', trainerId)
    .executeTakeFirst()

export async function POST(request: Request, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues
      .map(issue => issue.message)
      .join('; ')

    return createInvalidParamsResponse(detail || undefined)
  }

  const { productId } = paramsResult.data

  const auth = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while uploading product images',
  })

  if (!auth.ok) {
    return auth.response
  }

  const serviceProduct = await fetchServiceProduct(auth.trainerId, productId)

  if (!serviceProduct) {
    return createNotFoundResponse()
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return createInvalidBodyResponse()
  }

  const { fileTypeFromBuffer } = await import('file-type')
  const uploads: Record<string, string> = {}

  try {
    for (const field of uploadFields) {
      const file = formData.get(field.formKey)

      if (!file || !(file instanceof File) || file.size === 0) {
        continue
      }

      if (file.size > MAX_FILE_BYTES) {
        return createInvalidBodyResponse('Image file is larger than 5MB.')
      }

      let buffer: Buffer
      try {
        buffer = Buffer.from(await file.arrayBuffer())
      } catch (error) {
        console.error(
          'Failed to read product upload buffer',
          auth.trainerId,
          productId,
          field.formKey,
          error
        )
        return createInvalidBodyResponse('Unable to read uploaded image.')
      }

      const detected = await fileTypeFromBuffer(buffer)

      if (!detected || !allowedExtensions.has(detected.ext.toLowerCase())) {
        return createInvalidFileTypeResponse()
      }

      const format: OutputFormat =
        detected.ext.toLowerCase() === 'png' ? 'png' : 'jpg'

      const square = 'square' in field && field.square === true

      const transformed = await transformImage(buffer, {
        square,
        format,
      })

      const filename = `${field.formKey}-${productId}-${randomUUID()}.${transformed.ext}`

      const uploadedUrl = await uploadBufferToPublicBucket({
        buffer: transformed.buffer,
        filename,
        contentType: transformed.contentType,
      })

      uploads[field.column] = uploadedUrl
    }
  } catch (error: unknown) {
    if (error instanceof PublicBucketNotConfiguredError) {
      return createMissingBucketResponse()
    }

    console.error('Failed to upload product image', {
      trainerId: auth.trainerId,
      productId,
      error,
    })

    return createUnexpectedErrorResponse()
  }

  if (Object.keys(uploads).length > 0) {
    const updated = await db
      .updateTable('service')
      .set(uploads)
      .where('service.id', '=', productId)
      .where('service.trainer_id', '=', auth.trainerId)
      .returning(({ ref }) => [ref('service.id').as('id')])
      .executeTakeFirst()

    if (!updated) {
      return createNotFoundResponse()
    }
  }

  try {
    const product = await getProductById(auth.trainerId, productId)

    if (!product) {
      return createNotFoundResponse()
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

    console.error('Failed to fetch product after upload', {
      trainerId: auth.trainerId,
      productId,
      error,
    })

    return createUnexpectedErrorResponse()
  }
}
