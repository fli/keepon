import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import sharp, { type Sharp } from 'sharp'
import { db } from '@/lib/db'
import { getProductById } from '@/server/products'
import { authenticateTrainerRequest, buildErrorResponse } from '../../../_lib/accessToken'
import { PublicBucketNotConfiguredError, uploadBufferToPublicBucket } from '../../../_lib/storage'

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

const createResourceNotFoundResponse = (title: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 404,
      title,
      type: '/resource-not-found',
    }),
    { status: 404 }
  )

const createErrorProcessingImageResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Your image could not be processed. It may be corrupt or invalid.',
      type: '/error-processing-image',
    }),
    { status: 400 }
  )

const LEGACY_INVALID_JSON_MESSAGE = 'Unexpected token \'"\\", "#" is not valid JSON'

const createLegacyInvalidJsonResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: LEGACY_INVALID_JSON_MESSAGE,
    }),
    { status: 400 }
  )

const createLegacyInternalErrorResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Something on our end went wrong.',
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
  const { productId } = await context.params

  const auth = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while uploading product images',
  })

  if (!auth.ok) {
    return auth.response
  }

  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const rawBody = await request.clone().text()
    if (rawBody.trim().length > 0) {
      let parsed: unknown
      try {
        parsed = JSON.parse(rawBody)
      } catch {
        return createLegacyInvalidJsonResponse()
      }

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return createLegacyInvalidJsonResponse()
      }
    }
  }

  let serviceProduct
  try {
    serviceProduct = await fetchServiceProduct(auth.trainerId, productId)
  } catch (error) {
    console.error('Failed to fetch product for upload', {
      trainerId: auth.trainerId,
      productId,
      error,
    })
    return createLegacyInternalErrorResponse()
  }

  if (!serviceProduct) {
    return createResourceNotFoundResponse('Product not found')
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return createErrorProcessingImageResponse()
  }

  const { fileTypeFromBuffer } = await import('file-type')
  const uploads: Record<string, string> = {}

  try {
    for (const field of uploadFields) {
      const file = formData.get(field.formKey)

      if (!file || !(file instanceof File)) {
        continue
      }

      if (file.size > MAX_FILE_BYTES) {
        return createErrorProcessingImageResponse()
      }

      if (file.size === 0) {
        return createErrorProcessingImageResponse()
      }

      let buffer: Buffer
      try {
        buffer = Buffer.from(await file.arrayBuffer())
      } catch (error) {
        console.error('Failed to read product upload buffer', auth.trainerId, productId, field.formKey, error)
        return createErrorProcessingImageResponse()
      }

      const detected = await fileTypeFromBuffer(buffer)

      if (!detected || !allowedExtensions.has(detected.ext.toLowerCase())) {
        return createErrorProcessingImageResponse()
      }

      const normalizedExt = detected.ext.toLowerCase()
      const format: OutputFormat = normalizedExt === 'png' || normalizedExt === 'gif' ? 'png' : 'jpg'

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
      return createLegacyInternalErrorResponse()
    }

    console.error('Failed to upload product image', {
      trainerId: auth.trainerId,
      productId,
      error,
    })

    return createLegacyInternalErrorResponse()
  }

  if (Object.keys(uploads).length > 0) {
    const updated = await db
      .updateTable('service')
      .set(uploads)
      .where('service.id', '=', productId)
      .where('service.trainer_id', '=', auth.trainerId)
      .returning((eb) => [eb.ref('service.id').as('id')])
      .executeTakeFirst()

    if (!updated) {
      return createResourceNotFoundResponse('Product not found (or not service)')
    }
  }

  try {
    const product = await getProductById(auth.trainerId, productId)

    if (!product) {
      return createResourceNotFoundResponse('Product not found')
    }

    return NextResponse.json(product)
  } catch (error) {
    console.error('Failed to fetch product after upload', {
      trainerId: auth.trainerId,
      productId,
      error,
    })

    return createLegacyInternalErrorResponse()
  }
}
