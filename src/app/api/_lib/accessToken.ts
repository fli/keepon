import { Buffer } from 'node:buffer'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'

const TRAINER_ACCESS_TOKEN_EXTENSION_MS = 28 * 24 * 60 * 60 * 1000
const CLIENT_ACCESS_TOKEN_EXTENSION_MS = 7 * 24 * 60 * 60 * 1000

const authRowSchema = z.object({
  accessToken: z.string(),
  userId: z.string(),
  trainerId: z.string().nullable(),
  expiresAt: z.coerce.date(),
})

const clientAuthRowSchema = z.object({
  accessToken: z.string(),
  userId: z.string(),
  clientId: z.string(),
  trainerId: z.string(),
  expiresAt: z.coerce.date(),
})

const trainerOrClientAuthRowSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('api'),
    accessToken: z.string(),
    userId: z.string(),
    trainerId: z.string(),
    expiresAt: z.coerce.date(),
  }),
  z.object({
    type: z.literal('client_dashboard'),
    accessToken: z.string(),
    userId: z.string(),
    clientId: z.string(),
    trainerId: z.string(),
    expiresAt: z.coerce.date(),
  }),
])

type BuildErrorResponseArgs = {
  status: number
  title: string
  detail?: string
  type?: string
}

export const buildErrorResponse = ({
  status,
  title,
  detail,
  type,
}: BuildErrorResponseArgs) => ({
  code: status,
  status,
  message: detail ?? title,
  error: {
    statusCode: status,
    message: detail ?? title,
  },
  type: type ?? 'about:blank',
  title,
  detail,
})

export type ErrorResponseBody = ReturnType<typeof buildErrorResponse>

export const extractAccessToken = (request: Request) => {
  const headerValue = request.headers.get('authorization')
  if (headerValue) {
    const [authType, value] = headerValue.split(/\s+/)
    if (authType === 'Basic' && value) {
      try {
        const decoded = Buffer.from(value, 'base64').toString('utf8')
        const [token] = decoded.split(':')
        if (token) {
          return token
        }
      } catch {
        // Ignore decode errors and fall through to other mechanisms
      }
    } else if (authType === 'Bearer' && value) {
      return value
    } else if (headerValue.trim().length > 0) {
      return headerValue.trim()
    }
  }

  const url = new URL(request.url)
  const queryToken = url.searchParams.get('access_token')
  if (queryToken) {
    return queryToken
  }

  return undefined
}

type AuthenticateTrainerOptions = {
  extensionFailureLogMessage?: string
}

type AuthenticateTrainerSuccess = {
  ok: true
  accessToken: string
  trainerId: string
  userId: string
}

type AuthenticateTrainerFailure = {
  ok: false
  response: NextResponse<ErrorResponseBody>
}

type AuthenticateClientSuccess = {
  ok: true
  accessToken: string
  clientId: string
  trainerId: string
  userId: string
}

type AuthenticateClientFailure = {
  ok: false
  response: NextResponse<ErrorResponseBody>
}

type AuthenticateTrainerOrClientOptions = {
  trainerExtensionFailureLogMessage?: string
  clientExtensionFailureLogMessage?: string
}

type AuthenticateTrainerOrClientSuccess =
  | {
      ok: true
      actor: 'trainer'
      accessToken: string
      trainerId: string
      userId: string
    }
  | {
      ok: true
      actor: 'client'
      accessToken: string
      clientId: string
      trainerId: string
      userId: string
    }

type AuthenticateTrainerOrClientFailure = {
  ok: false
  response: NextResponse<ErrorResponseBody>
}

const createMissingTokenResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 401,
      title: 'No access token was provided',
      type: '/no-access-token',
    }),
    { status: 401 }
  )

const createInvalidTokenResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 401,
      title: 'Your access token is invalid or expired.',
      type: '/invalid-access-token',
    }),
    { status: 401 }
  )

export const authenticateTrainerRequest = async (
  request: Request,
  options: AuthenticateTrainerOptions = {}
): Promise<AuthenticateTrainerSuccess | AuthenticateTrainerFailure> => {
  const accessToken = extractAccessToken(request)
  if (!accessToken) {
    return {
      ok: false,
      response: createMissingTokenResponse(),
    }
  }

  const authRow = await db
    .selectFrom('access_token')
    .innerJoin(
      'vw_legacy_trainer',
      'vw_legacy_trainer.member_id',
      'access_token.user_id'
    )
    .select(({ ref }) => [
      ref('access_token.id').as('accessToken'),
      ref('access_token.user_id').as('userId'),
      ref('vw_legacy_trainer.id').as('trainerId'),
      ref('access_token.expires_at').as('expiresAt'),
    ])
    .where('access_token.id', '=', accessToken)
    .where('access_token.type', '=', 'api')
    .executeTakeFirst()

  const parsedAuthRow = authRowSchema.safeParse(authRow)
  if (
    !parsedAuthRow.success ||
    !parsedAuthRow.data.trainerId ||
    parsedAuthRow.data.expiresAt.getTime() < Date.now()
  ) {
    return {
      ok: false,
      response: createInvalidTokenResponse(),
    }
  }

  const { trainerId, accessToken: parsedAccessToken, userId } = parsedAuthRow.data

  try {
    await db
      .updateTable('access_token')
      .set({
        expires_at: new Date(Date.now() + TRAINER_ACCESS_TOKEN_EXTENSION_MS),
      })
      .where('id', '=', parsedAccessToken)
      .where('type', '=', 'api')
      .execute()
  } catch (extensionError) {
    console.error(
      options.extensionFailureLogMessage ??
        'Failed to extend access token expiry for trainer request',
      extensionError
    )
  }

  return {
    ok: true,
    accessToken: parsedAccessToken,
    trainerId,
    userId,
  }
}

export async function validateTrainerToken(
  accessToken: string,
  options: AuthenticateTrainerOptions = {}
): Promise<{ trainerId: string; userId: string; accessToken: string }> {
  const authRow = await db
    .selectFrom('access_token')
    .innerJoin(
      'vw_legacy_trainer',
      'vw_legacy_trainer.member_id',
      'access_token.user_id'
    )
    .select(({ ref }) => [
      ref('access_token.id').as('accessToken'),
      ref('access_token.user_id').as('userId'),
      ref('vw_legacy_trainer.id').as('trainerId'),
      ref('access_token.expires_at').as('expiresAt'),
    ])
    .where('access_token.id', '=', accessToken)
    .executeTakeFirst()

  const parsed = authRow ? authRowSchema.safeParse(authRow) : null

  if (!parsed?.success) {
    throw new Error('invalid-access-token')
  }

  if (parsed.data.expiresAt.getTime() < Date.now()) {
    throw new Error('expired-access-token')
  }

  if (!parsed.data.trainerId) {
    throw new Error('invalid-access-token')
  }

  try {
    await db
      .updateTable('access_token')
      .set({
        expires_at: new Date(
          Date.now() + TRAINER_ACCESS_TOKEN_EXTENSION_MS
        ),
      })
      .where('id', '=', parsed.data.accessToken)
      .execute()
  } catch (error) {
    console.error(
      options.extensionFailureLogMessage ??
        'Failed to extend trainer access token',
      error
    )
  }

  return {
    trainerId: parsed.data.trainerId,
    userId: parsed.data.userId,
    accessToken: parsed.data.accessToken,
  }
}

type AuthenticateClientOptions = {
  extensionFailureLogMessage?: string
}

export const authenticateClientRequest = async (
  request: Request,
  options: AuthenticateClientOptions = {}
): Promise<AuthenticateClientSuccess | AuthenticateClientFailure> => {
  const accessToken = extractAccessToken(request)
  if (!accessToken) {
    return {
      ok: false,
      response: createMissingTokenResponse(),
    }
  }

  const authRow = await db
    .selectFrom('access_token')
    .innerJoin('client', 'client.user_id', 'access_token.user_id')
    .select(({ ref }) => [
      ref('access_token.id').as('accessToken'),
      ref('access_token.user_id').as('userId'),
      ref('client.id').as('clientId'),
      ref('client.trainer_id').as('trainerId'),
      ref('access_token.expires_at').as('expiresAt'),
    ])
    .where('access_token.id', '=', accessToken)
    .where('access_token.type', '=', 'client_dashboard')
    .executeTakeFirst()

  const parsedAuthRow = clientAuthRowSchema.safeParse(authRow)
  if (
    !parsedAuthRow.success ||
    parsedAuthRow.data.expiresAt.getTime() < Date.now()
  ) {
    return {
      ok: false,
      response: createInvalidTokenResponse(),
    }
  }

  const { clientId, trainerId, accessToken: parsedAccessToken, userId } =
    parsedAuthRow.data

  try {
    await db
      .updateTable('access_token')
      .set({
        expires_at: new Date(Date.now() + CLIENT_ACCESS_TOKEN_EXTENSION_MS),
      })
      .where('id', '=', parsedAccessToken)
      .where('type', '=', 'client_dashboard')
      .execute()
  } catch (extensionError) {
    console.error(
      options.extensionFailureLogMessage ??
        'Failed to extend access token expiry for client request',
      extensionError
    )
  }

  return {
    ok: true,
    accessToken: parsedAccessToken,
    clientId,
    trainerId,
    userId,
  }
}

export const authenticateTrainerOrClientRequest = async (
  request: Request,
  options: AuthenticateTrainerOrClientOptions = {}
): Promise<
  AuthenticateTrainerOrClientSuccess | AuthenticateTrainerOrClientFailure
> => {
  const accessToken = extractAccessToken(request)
  if (!accessToken) {
    return {
      ok: false,
      response: createMissingTokenResponse(),
    }
  }

  const authRow = await db
    .selectFrom('access_token')
    .leftJoin(
      'vw_legacy_trainer',
      'vw_legacy_trainer.member_id',
      'access_token.user_id'
    )
    .leftJoin('client', 'client.user_id', 'access_token.user_id')
    .select(({ ref }) => [
      ref('access_token.id').as('accessToken'),
      ref('access_token.user_id').as('userId'),
      ref('access_token.type').as('type'),
      ref('access_token.expires_at').as('expiresAt'),
      ref('vw_legacy_trainer.id').as('trainerId'),
      ref('client.id').as('clientId'),
      ref('client.trainer_id').as('clientTrainerId'),
    ])
    .where('access_token.id', '=', accessToken)
    .where(({ eb }) =>
      eb.or([
        eb('access_token.type', '=', 'api'),
        eb('access_token.type', '=', 'client_dashboard'),
      ])
    )
    .executeTakeFirst()

  let parsedAuthRow:
    | ReturnType<typeof trainerOrClientAuthRowSchema.safeParse>
    | { success: false } = { success: false }

  if (authRow?.type === 'api') {
    if (authRow.accessToken && authRow.userId && authRow.trainerId) {
      parsedAuthRow = trainerOrClientAuthRowSchema.safeParse({
        type: 'api',
        accessToken: authRow.accessToken,
        userId: authRow.userId,
        trainerId: authRow.trainerId,
        expiresAt: authRow.expiresAt,
      })
    }
  } else if (authRow?.type === 'client_dashboard') {
    if (
      authRow.accessToken &&
      authRow.userId &&
      authRow.clientId &&
      authRow.clientTrainerId
    ) {
      parsedAuthRow = trainerOrClientAuthRowSchema.safeParse({
        type: 'client_dashboard',
        accessToken: authRow.accessToken,
        userId: authRow.userId,
        clientId: authRow.clientId,
        trainerId: authRow.clientTrainerId,
        expiresAt: authRow.expiresAt,
      })
    }
  }

  if (!parsedAuthRow.success) {
    return {
      ok: false,
      response: createInvalidTokenResponse(),
    }
  }

  if (parsedAuthRow.data.expiresAt.getTime() < Date.now()) {
    return {
      ok: false,
      response: createInvalidTokenResponse(),
    }
  }

  const trainerExtensionLogMessage =
    options.trainerExtensionFailureLogMessage ??
    'Failed to extend access token expiry for trainer request'
  const clientExtensionLogMessage =
    options.clientExtensionFailureLogMessage ??
    'Failed to extend access token expiry for client request'

  if (parsedAuthRow.data.type === 'api') {
    try {
      await db
        .updateTable('access_token')
        .set({
          expires_at: new Date(Date.now() + TRAINER_ACCESS_TOKEN_EXTENSION_MS),
        })
        .where('id', '=', parsedAuthRow.data.accessToken)
        .where('type', '=', 'api')
        .execute()
    } catch (extensionError) {
      console.error(trainerExtensionLogMessage, extensionError)
    }

    return {
      ok: true,
      actor: 'trainer',
      accessToken: parsedAuthRow.data.accessToken,
      trainerId: parsedAuthRow.data.trainerId,
      userId: parsedAuthRow.data.userId,
    }
  }

  try {
    await db
      .updateTable('access_token')
      .set({
        expires_at: new Date(Date.now() + CLIENT_ACCESS_TOKEN_EXTENSION_MS),
      })
      .where('id', '=', parsedAuthRow.data.accessToken)
      .where('type', '=', 'client_dashboard')
      .execute()
  } catch (extensionError) {
    console.error(clientExtensionLogMessage, extensionError)
  }

  return {
    ok: true,
    actor: 'client',
    accessToken: parsedAuthRow.data.accessToken,
    clientId: parsedAuthRow.data.clientId,
    trainerId: parsedAuthRow.data.trainerId,
    userId: parsedAuthRow.data.userId,
  }
}
