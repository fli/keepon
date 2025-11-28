import { NextResponse } from 'next/server'
import { db, sql } from '@keepon/db'
import { z } from 'zod'
import { buildErrorResponse } from '../_lib/accessToken'

export const runtime = 'nodejs'

const requestSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Email is required')
    .email('Email must be a valid email address.'),
  code: z.string().trim().min(1, 'Code is required'),
  clientId: z
    .string()
    .trim()
    .min(1, 'Client id is required')
    .uuid('Client id must be a valid UUID'),
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
          detail:
            detail || 'Request body did not match the expected schema.',
          type: '/invalid-body',
        }),
        { status: 400 }
      )
    }
    parsedBody = validation.data
  } catch (error) {
    console.error('Failed to parse client dashboard token request body', error)

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

  const { email, code, clientId } = parsedBody

  try {
    const updateResult = await sql<{ success: true }>`
      UPDATE client_login_request
         SET authenticated = TRUE
       WHERE email = ${email}
         AND code = ${code}
         AND expires_at > NOW()
         AND NOT authenticated
         AND failed_authentication_count < 3
       RETURNING TRUE AS success
    `.execute(db)

    if (updateResult.rows.length === 0) {
      await sql`
        UPDATE client_login_request
           SET failed_authentication_count = failed_authentication_count + 1
         WHERE email = ${email}
           AND expires_at > NOW()
           AND NOT authenticated
      `.execute(db)

      return createTemporaryCodeInvalidResponse()
    }

    const tokenRow = await db
      .transaction()
      .execute(async trx => {
        await sql`
          UPDATE client_login_request
             SET expires_at = NOW()
           WHERE expires_at > NOW()
             AND email = ${email}
             AND NOT authenticated
        `.execute(trx)

        const inserted = await sql<{ id: string }>`
          INSERT INTO access_token (user_id, user_type, expires_at, type)
          SELECT client.user_id, 'client', NOW() + INTERVAL '7 days', 'client_dashboard'
            FROM client
           WHERE id = ${clientId}
             AND email = ${email}
          RETURNING id
        `.execute(trx)

        const row = inserted.rows[0]
        if (!row) {
          throw new Error(
            'No access token created for client dashboard login request'
          )
        }

        return row
      })

    const responseBody = responseSchema.parse({ id: tokenRow.id })
    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse client dashboard token data',
          detail:
            'Client dashboard token data did not match the expected response schema.',
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

    if (
      error instanceof Error &&
      error.message ===
        'No access token created for client dashboard login request'
    ) {
      return NextResponse.json(
        buildErrorResponse({
          status: 400,
          title: 'Unable to create access token for client',
          detail:
            'Client identifier or email did not match an existing client record.',
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
