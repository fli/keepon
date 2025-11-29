import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import {
  buildErrorResponse,
  extractAccessToken,
} from '../../_lib/accessToken'

export const runtime = 'nodejs'

const FIFTEEN_MINUTES_IN_MS = 15 * 60 * 1000

const paramsSchema = z.object({
  userId: z
    .string()
    .trim()
    .min(1, 'User id is required')
    .uuid({ message: 'User id must be a valid UUID' }),
})

const responseSchema = z.object({
  id: z.string().uuid(),
})

type RouteContext = {
  params?: {
    userId?: string
  }
}

export async function GET(request: Request, context: RouteContext) {
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

  const { userId } = paramsResult.data

  const accessToken = extractAccessToken(request)

  if (!accessToken) {
    return NextResponse.json(
      buildErrorResponse({
        status: 401,
        title: 'No access token was provided',
        type: '/no-access-token',
      }),
      { status: 401 }
    )
  }

  const now = new Date()
  const extendedExpiry = new Date(now.getTime() + FIFTEEN_MINUTES_IN_MS)

  try {
    const updatedToken = await db
      .updateTable('access_token')
      .set({
        expires_at: extendedExpiry,
      })
      .where('id', '=', accessToken)
      .where('type', '=', 'password_reset')
      .where('user_id', '=', userId)
      .where('expires_at', '>=', now)
      .returning(['user_id'])
      .executeTakeFirst()

    if (!updatedToken) {
      return NextResponse.json(
        buildErrorResponse({
          status: 401,
          title: 'Code was invalid, expired, or already used.',
          type: '/temporary-code-invalid',
        }),
        { status: 401 }
      )
    }

    const responseBody = responseSchema.parse({
      id: updatedToken.user_id,
    })

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse member data from database',
          detail:
            'Member data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to verify password reset access token', {
      userId,
      accessToken,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to verify access token',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
