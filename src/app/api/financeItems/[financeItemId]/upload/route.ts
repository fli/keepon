import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { authenticateTrainerRequest, buildErrorResponse } from '../../../_lib/accessToken'
import { PublicBucketNotConfiguredError, uploadToPublicBucket } from '../../../_lib/storage'
import { adaptFinanceItemRow, financeItemSchema, type FinanceItemRow } from '../../shared'

const MAX_FILE_BYTES = 5 * 1024 * 1024
const allowedExtensions = new Set(['jpg', 'jpeg', 'png', 'gif'])

const paramsSchema = z.object({
  financeItemId: z.string().trim().min(1, 'Finance item id is required'),
})

type HandlerContext = { params: Promise<Record<string, string>> }

const createNotFoundResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 404,
      title: 'Finance item not found',
      detail: 'We could not find a finance item with the specified identifier for the authenticated trainer.',
      type: '/finance-item-not-found',
    }),
    { status: 404 }
  )

const createInvalidParamsResponse = (detail?: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid path parameters',
      detail: detail ?? 'Finance item identifier parameter did not match the expected schema.',
      type: '/invalid-path-parameters',
    }),
    { status: 400 }
  )

const createInvalidBodyResponse = (detail?: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid request body',
      detail: detail ?? 'Request body must be multipart/form-data with an image file field named "image".',
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

const createUnexpectedErrorResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Unexpected error uploading file',
      type: '/upload-failed',
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
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map((issue) => issue.message).join('; ')

    return createInvalidParamsResponse(detail || undefined)
  }

  const { financeItemId } = paramsResult.data

  const auth = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while uploading finance item image',
  })

  if (!auth.ok) {
    return auth.response
  }

  const existingFinanceItem = await fetchFinanceItem(auth.trainerId, financeItemId)

  if (!existingFinanceItem) {
    return createNotFoundResponse()
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return createInvalidBodyResponse()
  }

  const image = formData.get('image')

  if (!image || !(image instanceof File) || image.size === 0) {
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

  if (image.size > MAX_FILE_BYTES) {
    return createInvalidBodyResponse('Image file is larger than 5MB.')
  }

  let buffer: Buffer
  try {
    buffer = Buffer.from(await image.arrayBuffer())
  } catch (error) {
    console.error('Failed to read finance item upload buffer', auth.trainerId, financeItemId, error)
    return createInvalidBodyResponse('Unable to read uploaded image.')
  }

  try {
    const { fileTypeFromBuffer } = await import('file-type')
    const detected = await fileTypeFromBuffer(buffer)

    if (!detected || !allowedExtensions.has(detected.ext.toLowerCase())) {
      return createInvalidFileTypeResponse()
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
