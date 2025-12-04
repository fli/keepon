import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db, type Json } from '@/lib/db'
import { buildErrorResponse } from '../_lib/accessToken'

const notificationSchema = z
  .object({
    password: z.string().optional(),
    environment: z.string().optional(),
  })
  .passthrough()

const createInvalidJsonResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid JSON payload',
      detail: 'Request body must be valid JSON.',
      type: '/invalid-json',
    }),
    { status: 400 }
  )

const createInvalidBodyResponse = (detail?: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid request body',
      detail: detail ?? 'Request body did not match the expected schema.',
      type: '/invalid-body',
    }),
    { status: 400 }
  )

const createInvalidAccessTokenResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 401,
      title: 'Your access token is invalid or expired.',
      type: '/invalid-access-token',
    }),
    { status: 401 }
  )

const createInternalErrorResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Failed to record App Store server notification',
      type: '/internal-server-error',
    }),
    { status: 500 }
  )

const isProductionEnvironment = () => {
  const envValue = process.env.ENV ?? process.env.NODE_ENV ?? ''
  return envValue.toLowerCase() === 'production'
}

const sanitizeNotification = (notification: Record<string, unknown>): Json =>
  JSON.parse(JSON.stringify(notification)) as Json

export async function POST(request: Request) {
  let parsedBody: z.infer<typeof notificationSchema>

  try {
    const rawBody = (await request.json()) as unknown
    const validation = notificationSchema.safeParse(rawBody)

    if (!validation.success) {
      const detail = validation.error.issues.map((issue) => issue.message).join('; ')

      return createInvalidBodyResponse(detail || undefined)
    }

    parsedBody = validation.data
  } catch (error) {
    console.error('Failed to parse App Store server notification payload', error)
    return createInvalidJsonResponse()
  }

  const sharedSecret = process.env.APP_STORE_SHARED_SECRET
  if (parsedBody.password !== sharedSecret) {
    return createInvalidAccessTokenResponse()
  }

  const { password: _ignored, ...notification } = parsedBody
  const environment = notification.environment
  const isProduction = isProductionEnvironment()

  if (environment === 'Sandbox' && isProduction) {
    console.debug('App Store server notification skipped due to production environment mismatch', {
      environment,
      appEnv: 'production',
    })
    return new Response(null, { status: 204 })
  }

  if (environment === 'PROD' && !isProduction) {
    console.debug('App Store server notification skipped due to non-production environment mismatch', {
      environment,
      appEnv: 'non-production',
    })
    return new Response(null, { status: 204 })
  }

  const sanitizedNotification = sanitizeNotification(notification)

  try {
    await db.insertInto('app_store_server_notification').values({ object: sanitizedNotification }).execute()
  } catch (error) {
    console.error('Failed to record App Store server notification', {
      error,
      environment,
    })
    return createInternalErrorResponse()
  }

  return new Response(null, { status: 204 })
}
