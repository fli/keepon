import { NextRequest, NextResponse } from 'next/server'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import { buildErrorResponse, extractAccessToken } from '../../../_lib/accessToken'
import { parseStrictJsonBody } from '../../../_lib/strictJson'

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

type HandlerContext = RouteContext<'/api/members/[userId]/password'>

export async function POST(request: NextRequest, context: HandlerContext) {
  void context

  let parsedBody: z.infer<typeof requestSchema>
  const parsed = await parseStrictJsonBody(request)
  if (!parsed.ok) {
    return parsed.response
  }

  const validation = requestSchema.safeParse(parsed.data)
  if (!validation.success) {
    const detail = validation.error.issues.map((issue) => issue.message).join('; ')

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

  const accessToken = await extractAccessToken(request)
  if (!accessToken) {
    return createMissingTokenResponse()
  }

  const { password } = parsedBody

  try {
    const result = await db.transaction().execute(async (trx) => {
      const update = await sql<{ userId: string }>`
          UPDATE trainer
             SET password_hash = crypt(${password}, gen_salt('bf', 10))
            FROM access_token
           WHERE access_token.user_id = trainer.user_id
             AND access_token.user_type = trainer.user_type
             AND access_token.type = 'password_reset'
             AND access_token.expires_at >= NOW()
             AND access_token.id = ${accessToken}
           RETURNING trainer.user_id AS "userId"
        `.execute(trx)

      const row = update.rows[0]
      if (!row) {
        return { ok: false as const }
      }

      await sql`
          DELETE FROM access_token
           WHERE user_id = ${row.userId}
             AND type IN ('api', 'password_reset')
        `.execute(trx)

      return { ok: true as const }
    })

    if (!result.ok) {
      return createTemporaryCodeInvalidResponse()
    }

    return new Response(null, { status: 204 })
  } catch (error) {
    console.error('Failed to reset member password', { error })

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
