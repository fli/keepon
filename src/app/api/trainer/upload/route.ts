import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import sharp, { type Sharp } from 'sharp'
import { z } from 'zod'

import { db } from '@/lib/db'
import { getTrainerProfile } from '@/server/trainerProfile'
import { authenticateTrainerRequest, buildErrorResponse } from '../../_lib/accessToken'
import { PublicBucketNotConfiguredError, uploadBufferToPublicBucket } from '../../_lib/storage'

const MAX_FILE_BYTES = 5 * 1024 * 1024
const allowedExtensions = new Set(['jpg', 'jpeg', 'png', 'gif'])
const LEGACY_INVALID_JSON_MESSAGE = 'Unexpected token \'"\', "#" is not valid JSON'

type UploadField = {
  formKey: string
  column: 'business_logo_url' | 'cover_image_url'
  square?: boolean
}

const uploadFields: readonly UploadField[] = [
  { formKey: 'businessLogo', column: 'business_logo_url', square: true },
  { formKey: 'businessIcon', column: 'business_logo_url', square: true },
  { formKey: 'coverImage', column: 'cover_image_url' },
]

const createInvalidBodyResponse = (detail?: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid request body',
      detail: detail ?? 'Request body must be multipart/form-data with image file fields.',
      type: '/invalid-body',
    }),
    { status: 400 }
  )

const createLegacyInvalidJsonResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: LEGACY_INVALID_JSON_MESSAGE,
    }),
    { status: 400 }
  )

const createLegacyGenericErrorResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Something on our end went wrong.',
    }),
    { status: 500 }
  )

const createLegacyErrorProcessingImageResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Your image could not be processed. It may be corrupt or invalid.',
      type: '/error-processing-image',
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

const createForbiddenResponse = (detail?: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 403,
      title: 'Forbidden',
      detail: detail ?? 'You are not permitted to update this trainer.',
      type: '/forbidden',
    }),
    { status: 403 }
  )

const createNotFoundResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 404,
      title: 'Trainer not found',
      detail: 'No trainer exists for the authenticated token.',
      type: '/trainer-not-found',
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
      ext: 'png',
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
    ext: 'jpg',
  }
}

export async function POST(request: Request) {
  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while uploading trainer images',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const rawBody = await request.text()
    if (!rawBody.trim()) {
      return createLegacyGenericErrorResponse()
    }
    try {
      const parsed = JSON.parse(rawBody) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return createLegacyInvalidJsonResponse()
      }
      return createLegacyGenericErrorResponse()
    } catch {
      return createLegacyInvalidJsonResponse()
    }
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return createInvalidBodyResponse()
  }

  const idField = formData.get('id')
  if (typeof idField === 'string' && idField.trim().length > 0) {
    if (idField !== authorization.trainerId) {
      return createForbiddenResponse('Trainer id does not match authenticated trainer.')
    }
  }

  const { fileTypeFromBuffer } = await import('file-type')

  const uploads: Partial<Record<UploadField['column'], string>> = {}

  try {
    for (const field of uploadFields) {
      const file = formData.get(field.formKey)

      if (!file || !(file instanceof File)) {
        continue
      }

      if (file.size === 0) {
        return createLegacyErrorProcessingImageResponse()
      }

      if (file.size > MAX_FILE_BYTES) {
        return createInvalidBodyResponse('Image file is larger than 5MB.')
      }

      let buffer: Buffer
      try {
        buffer = Buffer.from(await file.arrayBuffer())
      } catch (error) {
        console.error('Failed to read trainer upload buffer', {
          trainerId: authorization.trainerId,
          field: field.formKey,
          error,
        })
        return createLegacyErrorProcessingImageResponse()
      }

      const detected = await fileTypeFromBuffer(buffer)

      const ext = detected?.ext?.toLowerCase()
      if (!detected || !ext || !allowedExtensions.has(ext)) {
        return createLegacyErrorProcessingImageResponse()
      }

      const format: OutputFormat = ext === 'png' ? 'png' : 'jpg'
      const square = field.square === true

      let transformed: { buffer: Buffer; contentType: string; ext: OutputFormat }
      try {
        transformed = await transformImage(buffer, { square, format })
      } catch (error) {
        console.error('Failed to transform trainer upload image', {
          trainerId: authorization.trainerId,
          field: field.formKey,
          error,
        })
        return createLegacyErrorProcessingImageResponse()
      }

      const filename = `${field.formKey}-${authorization.trainerId}-${randomUUID()}.${transformed.ext}`

      const uploadedUrl = await uploadBufferToPublicBucket({
        buffer: transformed.buffer,
        filename,
        contentType: transformed.contentType,
      })

      uploads[field.column] = uploadedUrl
    }
  } catch (error) {
    if (error instanceof PublicBucketNotConfiguredError) {
      return createMissingBucketResponse()
    }

    console.error('Failed to upload trainer image', {
      trainerId: authorization.trainerId,
      error,
    })

    return createUnexpectedErrorResponse()
  }

  if (Object.keys(uploads).length > 0) {
    const updated = await db
      .updateTable('trainer')
      .set(uploads)
      .where('trainer.id', '=', authorization.trainerId)
      .returning('trainer.id')
      .executeTakeFirst()

    if (!updated) {
      return createNotFoundResponse()
    }
  }

  try {
    const trainer = await getTrainerProfile(authorization.trainerId)

    if (!trainer) {
      return createNotFoundResponse()
    }

    return NextResponse.json(trainer)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse trainer data from database',
          detail: 'Trainer data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to fetch trainer after upload', {
      trainerId: authorization.trainerId,
      error,
    })

    return createUnexpectedErrorResponse()
  }
}
