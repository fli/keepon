import { NextResponse } from 'next/server'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import {
  buildErrorResponse,
  extractAccessToken,
} from '../../../_lib/accessToken'

export const runtime = 'nodejs'

const paramsSchema = z.object({
  userId: z
    .string()
    .trim()
    .min(1, 'User id is required')
    .uuid({ message: 'User id must be a valid UUID' }),
})

const requestSchema = z.object({
  password: z.string().min(1, 'Password is required'),
})

const createMissingTokenResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 401,
      title: 'No access token was provided',
      type: '/no-access-token',
    }),
    { status: 401 }
  )

const createTemporaryCodeInvalidResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 401,
      title: 'Code was invalid, expired, or already used.',
      type: '/temporary-code-invalid',
    }),
    { status: 401 }
  )

type RouteContext = {
  params?: {
    userId?: string
  }
}

export async function POST(request: Request, context: RouteContext) {
  const paramsResult = paramsSchema.safeParse(context?.params ?? {})
  if (!paramsResult.success) {
    const detail = paramsResult.error.issues
      .map(issue => issue.message)
      .join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid user identifier',
        detail:
          detail ||
          'Request parameters did not match the expected user identifier schema.',
        type: '/invalid-parameter',
      }),
      { status: 400 }
    )
  }

  let parsedBody: z.infer<typeof requestSchema>
  try {
    const rawBody = (await request.json()) as unknown
    const validation = requestSchema.safeParse(rawBody)
    if (!validation.success) {
      const detail = validation.error.issues
        .map(issue => issue.message)
        .join('; ')

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
    parsedBody = validation.data
  } catch (error) {
    console.error(
      'Failed to parse member password reset request body as JSON',
      error
    )

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

  const accessToken = extractAccessToken(request)
  if (!accessToken) {
    return createMissingTokenResponse()
  }

  const { userId } = paramsResult.data
  const { password } = parsedBody

  try {
    const result = await db
      .transaction()
      .execute(async trx => {
        const update = await sql<{ userId: string }>`
          UPDATE trainer
             SET password_hash = crypt(${password}, gen_salt('bf', 10))
            FROM access_token
           WHERE access_token.user_id = trainer.user_id
             AND access_token.user_type = trainer.user_type
             AND access_token.type = 'password_reset'
             AND access_token.expires_at >= NOW()
             AND access_token.id = ${accessToken}
             AND trainer.user_id = ${userId}
           RETURNING trainer.user_id AS "userId"
        `.execute(trx)

        const row = update.rows[0]
        if (!row) {
          return { ok: false as const }
        }

        await sql`
          DELETE FROM access_token
           WHERE user_id = ${userId}
             AND type IN ('api', 'password_reset')
        `.execute(trx)

        return { ok: true as const }
      })

    if (!result.ok) {
      return createTemporaryCodeInvalidResponse()
    }

    return new Response(null, { status: 204 })
  } catch (error) {
    console.error('Failed to reset member password', {
      userId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to reset password',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
