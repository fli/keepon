import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
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
      const row = await trx
        .selectFrom('trainer')
        .innerJoin('access_token', (join) =>
          join
            .onRef('access_token.user_id', '=', 'trainer.user_id')
            .onRef('access_token.user_type', '=', 'trainer.user_type')
        )
        .select((eb) => eb.ref('trainer.user_id').as('userId'))
        .where('access_token.type', '=', 'password_reset')
        .where((eb) => eb('access_token.expires_at', '>=', eb.fn<Date>('now')))
        .where('access_token.id', '=', accessToken)
        .executeTakeFirst()

      if (!row) {
        return { ok: false as const }
      }

      await trx
        .updateTable('trainer')
        .set((eb) => ({
          password_hash: eb.fn('crypt', [eb.val(password), eb.fn('gen_salt', [eb.val('bf'), eb.val(10)])]),
        }))
        .where('user_id', '=', row.userId)
        .execute()

      await trx
        .deleteFrom('access_token')
        .where('user_id', '=', row.userId)
        .where('type', 'in', ['api', 'password_reset'])
        .execute()

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
