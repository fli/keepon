import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticateTrainerRequest, buildErrorResponse } from '../../../_lib/accessToken'
import { PublicBucketNotConfiguredError, uploadToPublicBucket } from '../../../_lib/storage'
import { adaptFinanceItemRow, financeItemSchema, type FinanceItemRow } from '../../shared'

const MAX_FILE_BYTES = 5 * 1024 * 1024
const allowedExtensions = new Set(['jpg', 'jpeg', 'png', 'gif'])

type HandlerContext = { params: Promise<Record<string, string>> }

const LEGACY_INVALID_JSON_MESSAGE = 'Unexpected token \'"\', "#" is not valid JSON'

const createNotFoundResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 404,
      title: 'Finance item not found',
      type: '/resource-not-found',
    }),
    { status: 404 }
  )

const createLegacyInvalidJsonResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: LEGACY_INVALID_JSON_MESSAGE,
    }),
    { status: 400 }
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

const createUnexpectedErrorResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Something on our end went wrong.',
    }),
    { status: 500 }
  )

const parseFinanceItem = (row: FinanceItemRow) => {
  try {
    const parsed = financeItemSchema.safeParse(adaptFinanceItemRow(row))
    if (!parsed.success) {
      return { ok: false as const }
    }
    return { ok: true as const, financeItem: parsed.data }
  } catch {
    return { ok: false as const }
  }
}

const fetchFinanceItem = async (trainerId: string, financeItemId: string): Promise<FinanceItemRow | undefined> =>
  (await db
    .selectFrom('vw_legacy_finance_item as v')
    .select((eb) => [
      eb.ref('v.id').as('id'),
      eb.ref('v.trainerId').as('trainerId'),
      eb.ref('v.amount').as('amount'),
      eb.ref('v.imageUrl').as('imageUrl'),
      eb.ref('v.name').as('name'),
      eb.ref('v.status').as('status'),
      eb.ref('v.paymentType').as('paymentType'),
      eb.ref('v.stripeApplicationFeeId').as('stripeApplicationFeeId'),
      eb.ref('v.startDate').as('startDate'),
      eb.ref('v.createdAt').as('createdAt'),
      eb.ref('v.updatedAt').as('updatedAt'),
    ])
    .where('v.trainerId', '=', trainerId)
    .where('v.id', '=', financeItemId)
    .executeTakeFirst()) as FinanceItemRow | undefined

export async function POST(request: Request, context: HandlerContext) {
  const { financeItemId } = await context.params

  const auth = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while uploading finance item image',
  })

  if (!auth.ok) {
    return auth.response
  }

  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.includes('multipart/form-data')) {
    const rawBodyText = await request.text()
    if (rawBodyText.trim().length > 0) {
      try {
        const parsed = JSON.parse(rawBodyText)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return createLegacyInvalidJsonResponse()
        }
      } catch {
        return createLegacyInvalidJsonResponse()
      }
    }
    return createUnexpectedErrorResponse()
  }

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      financeItemId
    )
  ) {
    return createUnexpectedErrorResponse()
  }

  let existingFinanceItem: FinanceItemRow | undefined
  try {
    existingFinanceItem = await fetchFinanceItem(auth.trainerId, financeItemId)
  } catch (error) {
    console.error('Failed to fetch finance item before upload', auth.trainerId, financeItemId, error)
    return createUnexpectedErrorResponse()
  }

  if (!existingFinanceItem) {
    return createNotFoundResponse()
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return createLegacyErrorProcessingImageResponse()
  }

  const image = formData.get('image')

  if (!image || !(image instanceof File)) {
    const parsed = parseFinanceItem(existingFinanceItem)
    if (!parsed.ok) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse finance item data from database',
          detail: 'Finance item data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }
    return NextResponse.json(parsed.financeItem)
  }

  if (image.size === 0) {
    return createLegacyErrorProcessingImageResponse()
  }

  if (image.size > MAX_FILE_BYTES) {
    return createLegacyErrorProcessingImageResponse()
  }

  let buffer: Buffer
  try {
    buffer = Buffer.from(await image.arrayBuffer())
  } catch (error) {
    console.error('Failed to read finance item upload buffer', auth.trainerId, financeItemId, error)
    return createLegacyErrorProcessingImageResponse()
  }

  try {
    const { fileTypeFromBuffer } = await import('file-type')
    const detected = await fileTypeFromBuffer(buffer)

    if (!detected || !allowedExtensions.has(detected.ext.toLowerCase())) {
      return createLegacyErrorProcessingImageResponse()
    }

    const filename = `${financeItemId}-${randomUUID()}.jpg`

    const uploadedUrl = await uploadToPublicBucket({
      buffer,
      filename,
      contentType: 'image/jpeg',
    })

    const updated = await db
      .updateTable('finance_item')
      .set({
        image_url: uploadedUrl,
      })
      .where('finance_item.trainer_id', '=', auth.trainerId)
      .where('finance_item.id', '=', financeItemId)
      .returning((eb) => [eb.ref('finance_item.id').as('id')])
      .executeTakeFirst()

    if (!updated) {
      return createNotFoundResponse()
    }

    const financeItem = await fetchFinanceItem(auth.trainerId, financeItemId)

    if (!financeItem) {
      return createNotFoundResponse()
    }

    const parsed = parseFinanceItem(financeItem)

    if (!parsed.ok) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse finance item data from database',
          detail: 'Finance item data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    return NextResponse.json(parsed.financeItem)
  } catch (error) {
    if (error instanceof PublicBucketNotConfiguredError) {
      return createMissingBucketResponse()
    }

    console.error('Failed to upload finance item image', auth.trainerId, financeItemId, error)

    return createUnexpectedErrorResponse()
  }
}
