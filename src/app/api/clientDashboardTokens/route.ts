import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { buildErrorResponse } from '../_lib/accessToken'
import { parseStrictJsonBody } from '../_lib/strictJson'

const requestSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Email must be a valid email address.'),
  code: z.string().trim().min(1, 'Code is required'),
  clientId: z.string().trim().min(1, 'Client id is required'),
})

const responseSchema = z.object({
  id: z.string().uuid(),
})

const createTemporaryCodeInvalidResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 401,
      title: 'Code was invalid, expired, or already used.',
      type: '/temporary-code-invalid',
    }),
    { status: 401 }
  )

export async function POST(request: Request) {
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

  const { email, code, clientId } = parsedBody

  try {
    const now = new Date()
    const updateResult = await db
      .updateTable('client_login_request')
      .set({ authenticated: true })
      .where('email', '=', email)
      .where('code', '=', code)
      .where('expires_at', '>', now)
      .where('authenticated', '=', false)
      .where('failed_authentication_count', '<', 3)
      .returning('id')
      .execute()

    if (updateResult.length === 0) {
      await db
        .updateTable('client_login_request')
        .set((eb) => ({
          failed_authentication_count: eb('failed_authentication_count', '+', 1),
        }))
        .where('email', '=', email)
        .where('expires_at', '>', now)
        .where('authenticated', '=', false)
        .execute()

      return createTemporaryCodeInvalidResponse()
    }

    const tokenRow = await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('client_login_request')
        .set({ expires_at: now })
        .where('expires_at', '>', now)
        .where('email', '=', email)
        .where('authenticated', '=', false)
        .execute()

      const clientRow = await trx
        .selectFrom('client')
        .select('user_id')
        .where('id', '=', clientId)
        .where('email', '=', email)
        .executeTakeFirst()

      if (!clientRow) {
        throw new Error('No client record for dashboard login request')
      }

      const inserted = await trx
        .insertInto('access_token')
        .values({
          user_id: clientRow.user_id,
          user_type: 'client',
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          type: 'client_dashboard',
        })
        .returning('id')
        .executeTakeFirst()

      if (!inserted) {
        throw new Error('No access token created for client dashboard login request')
      }

      return inserted
    })

    const responseBody = responseSchema.parse({ id: tokenRow.id })
    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse client dashboard token data',
          detail: 'Client dashboard token data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to create client dashboard token', {
      email,
      clientId,
      error,
    })

    if (error instanceof Error && error.message === 'No access token created for client dashboard login request') {
      return NextResponse.json(
        buildErrorResponse({
          status: 400,
          title: 'Unable to create access token for client',
          detail: 'Client identifier or email did not match an existing client record.',
          type: '/client-not-found',
        }),
        { status: 400 }
      )
    }

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to create client dashboard token',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
