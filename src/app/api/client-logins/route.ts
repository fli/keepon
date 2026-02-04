import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { Buffer } from 'node:buffer'
import { z } from 'zod'
import { db } from '@/lib/db'
import { buildErrorResponse } from '../_lib/accessToken'

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

const createLegacyInternalErrorResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Something on our end went wrong.',
    }),
    { status: 500 }
  )

export async function GET(_request: Request) {
  const headerValue = (await headers()).get('authorization')
  const [authType, encodedCredentials] = headerValue?.split(' ') ?? []
  let email = ''
  let code = ''

  try {
    const decoded = Buffer.from(encodedCredentials, 'base64').toString('utf8')
    const separatorIndex = decoded.indexOf(':')
    if (separatorIndex !== -1) {
      email = decoded.slice(0, separatorIndex)
      code = decoded.slice(separatorIndex + 1)
    }
  } catch {
    return createLegacyInternalErrorResponse()
  }

  if (authType !== 'Basic' || !email || !code) {
    return createMissingTokenResponse()
  }

  try {
    const result = await db.transaction().execute(async (trx) => {
      const now = new Date()
      const loginRequest = await trx
        .selectFrom('client_login_request')
        .select('id')
        .where('email', '=', email)
        .where('code', '=', code)
        .where('expires_at', '>', now)
        .where('authenticated', '=', false)
        .where('failed_authentication_count', '<', 3)
        .forUpdate()
        .executeTakeFirst()

      if (!loginRequest) {
        await trx
          .updateTable('client_login_request')
          .set((eb) => ({
            failed_authentication_count: eb('failed_authentication_count', '+', 1),
          }))
          .where('email', '=', email)
          .where('expires_at', '>', now)
          .where('authenticated', '=', false)
          .execute()

        return { ok: false as const }
      }

      const clients = await trx
        .selectFrom('client')
        .innerJoin('trainer', 'trainer.id', 'client.trainer_id')
        .select([
          'client.id as id',
          'client.first_name as first_name',
          'client.last_name as last_name',
          'trainer.first_name as service_provider_first_name',
          'trainer.last_name as service_provider_last_name',
        ])
        .where('client.email', '=', email)
        .execute()

      if (clients.length === 0) {
        return { ok: false as const }
      }

      const mappedClients = clients.map((row) => ({
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        serviceProviderFirstName: row.service_provider_first_name,
        serviceProviderLastName: row.service_provider_last_name,
      }))

      return { ok: true as const, clients: mappedClients }
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
      email,
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
