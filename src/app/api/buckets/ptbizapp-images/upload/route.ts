import crypto from 'node:crypto'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { authenticateTrainerRequest, buildErrorResponse } from '../../../_lib/accessToken'
import { PublicBucketNotConfiguredError, uploadToPublicBucket } from '../../../_lib/storage'

const createInvalidBodyResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Something on our end went wrong.',
    }),
    { status: 500 }
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

const createInvalidFileTypeResponse = (detail: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid file type',
      detail,
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

const makeRandomB64urlToken = async () => {
  const bytes = crypto.randomBytes(18)
  return bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

const sanitizeBaseName = (filename: string) => {
  const base = path.basename(filename, path.extname(filename)).trim()
  return base.length > 0 ? base : 'upload'
}

type HandlerContext = RouteContext<'/api/buckets/ptbizapp-images/upload'>

export async function POST(request: Request, _context: HandlerContext) {
  const auth = await authenticateTrainerRequest(request)
  if (!auth.ok) {
    return auth.response
  }

  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.includes('multipart/form-data')) {
    const rawBodyText = await request.text()
    if (rawBodyText.trim().length === 0) {
      return createInvalidBodyResponse()
    }
    try {
      const parsed = JSON.parse(rawBodyText)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return createLegacyInvalidJsonResponse()
      }
    } catch {
      return createLegacyInvalidJsonResponse()
    }
    return createInvalidBodyResponse()
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return createInvalidBodyResponse()
  }

  const file = formData.get('file')
  if (!file || !(file instanceof File)) {
    return createInvalidBodyResponse()
  }

  const buffer = Buffer.from(await file.arrayBuffer())

  const { fileTypeFromBuffer } = await import('file-type')
  const detectedType = await fileTypeFromBuffer(buffer)

  if (!detectedType) {
    return createInvalidFileTypeResponse("Couldn't detect type of uploaded file")
  }

  if (detectedType.ext !== 'jpg') {
    return createInvalidFileTypeResponse('You can only upload jpg files')
  }

  const filename = `${sanitizeBaseName(file.name)}_${await makeRandomB64urlToken()}.${detectedType.ext}`

  try {
    const uploadedUrl = await uploadToPublicBucket({
      buffer,
      filename,
      contentType: detectedType.mime,
    })

    return NextResponse.json({
      result: {
        files: {
          file: [{ name: path.basename(uploadedUrl) }],
        },
      },
    })
  } catch (error) {
    if (error instanceof PublicBucketNotConfiguredError) {
      return createMissingBucketResponse()
    }

    console.error('Failed to upload image to public bucket', error)

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Unexpected error uploading file',
        type: '/upload-failed',
      }),
      { status: 500 }
    )
  }
}
