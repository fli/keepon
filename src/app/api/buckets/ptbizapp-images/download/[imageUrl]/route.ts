import { NextResponse } from 'next/server'
import path from 'node:path'
import { z } from 'zod'
import { buildErrorResponse } from '../../../../_lib/accessToken'

export const runtime = 'nodejs'

const paramsSchema = z.object({
  imageUrl: z.string(),
})

const createInvalidPathResponse = (detail?: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid path parameters',
      detail:
        detail ??
        'Request parameters did not match the expected schema.',
      type: '/invalid-path-parameters',
    }),
    { status: 400 }
  )

const createInvalidImageUrlResponse = (detail?: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid image URL',
      detail: detail ?? "ImageUrl can't be blank",
      type: '/invalid-image-url',
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

type HandlerContext =
  RouteContext<'/api/buckets/ptbizapp-images/download/[imageUrl]'>

export async function GET(
  _request: Request,
  context: HandlerContext
) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues
      .map(issue => issue.message)
      .join('; ')

    return createInvalidPathResponse(detail || undefined)
  }

  const { imageUrl } = paramsResult.data
  const parsed = path.parse(imageUrl)

  if (parsed.name === '') {
    return createInvalidImageUrlResponse()
  }

  if (parsed.name.endsWith('image') || parsed.name.endsWith('profile')) {
    return NextResponse.redirect(
      `https://ptbizapp-images.s3.amazonaws.com/${imageUrl}`,
      302
    )
  }

  const publicBucketName = process.env.PUBLIC_BUCKET_NAME?.trim()

  if (!publicBucketName) {
    return createMissingBucketResponse()
  }

  const publicBucketUrl = `https://storage.googleapis.com/${publicBucketName}`

  return NextResponse.redirect(`${publicBucketUrl}/${imageUrl}`, 302)
}
