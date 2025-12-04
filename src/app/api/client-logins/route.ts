import { Buffer } from 'node:buffer'
import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import { buildErrorResponse } from '../_lib/accessToken'

const authorizationSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Email must be a valid email address.'),
  code: z.string().trim().min(1, 'Code is required'),
})

const clientSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string().nullable(),
  serviceProviderFirstName: z.string(),
  serviceProviderLastName: z.string().nullable(),
})

const responseSchema = z.object({
  clients: z.array(clientSchema),
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

type ParsedAuthorization = { ok: true; email: string; code: string } | { ok: false }

const parseBasicAuthorization = (headerValue: string | null): ParsedAuthorization => {
  if (!headerValue) {
    return { ok: false }
  }

  const [scheme, encodedCredentials] = headerValue.split(' ')
  if (!scheme || !encodedCredentials || scheme.toLowerCase() !== 'basic') {
    return { ok: false }
  }

  let decoded: string

  try {
    decoded = Buffer.from(encodedCredentials, 'base64').toString('utf8')
  } catch {
    return { ok: false }
  }

  const separatorIndex = decoded.indexOf(':')
  if (separatorIndex < 0) {
    return { ok: false }
  }

  const email = decoded.slice(0, separatorIndex)
  const code = decoded.slice(separatorIndex + 1)

  const parsed = authorizationSchema.safeParse({ email, code })

  if (!parsed.success) {
    return { ok: false }
  }

  return { ok: true, ...parsed.data }
}

export async function GET(_request: Request) {
  const authorization = parseBasicAuthorization((await headers()).get('authorization'))

  if (!authorization.ok) {
    return createMissingTokenResponse()
  }

  try {
    const result = await db.transaction().execute(async (trx) => {
      const loginRequest = await sql<{ exists: true }>`
          SELECT TRUE AS exists
            FROM client_login_request
           WHERE email = ${authorization.email}
             AND code = ${authorization.code}
             AND expires_at > NOW()
             AND NOT authenticated
             AND failed_authentication_count < 3
           FOR UPDATE
        `.execute(trx)

      if (loginRequest.rows.length === 0) {
        await sql`
            UPDATE client_login_request
               SET failed_authentication_count = failed_authentication_count + 1
             WHERE email = ${authorization.email}
               AND expires_at > NOW()
               AND NOT authenticated
          `.execute(trx)

        return { ok: false as const }
      }

      const clientsResult = await sql<{
        id: string
        first_name: string
        last_name: string | null
        service_provider_first_name: string
        service_provider_last_name: string | null
      }>`
          SELECT
            client.id,
            client.first_name,
            client.last_name,
            trainer.first_name AS service_provider_first_name,
            trainer.last_name AS service_provider_last_name
          FROM client
          JOIN trainer ON trainer.id = client.trainer_id
         WHERE client.email = ${authorization.email}
        `.execute(trx)

      if (clientsResult.rows.length === 0) {
        return { ok: false as const }
      }

      const clients = clientsResult.rows.map((row) => ({
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        serviceProviderFirstName: row.service_provider_first_name,
        serviceProviderLastName: row.service_provider_last_name,
      }))

      return { ok: true as const, clients }
    })

    if (!result.ok) {
      return createTemporaryCodeInvalidResponse()
    }

    const responseBody = responseSchema.parse({ clients: result.clients })

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse client login data from database',
          detail: 'Client login data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to list client logins', {
      error,
      email: authorization.ok ? authorization.email : undefined,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to list client logins',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
