import { z } from 'zod'
import { db, sql } from '@/lib/db'
import { AppleSignInError, verifyAppleIdentityToken } from '../app/api/_lib/appleSignIn'

const passwordLoginSchema = z.object({
  email: z.string().trim().min(1).email(),
  password: z.string().min(1),
})

const appleLoginSchema = z.object({
  signInWithAppleIdentityToken: z.string().trim().min(1),
  signInWithAppleNonce: z.string().trim().min(1).optional(),
})

export const loginRequestSchema = z.union([passwordLoginSchema, appleLoginSchema])

type LoginResult = { id: string; userId: string; trainerId: string }

const APPLE_AUDIENCE = process.env.APPLE_CLIENT_ID ?? process.env.IOS_BUNDLE_ID ?? null

async function loginWithPassword(body: z.infer<typeof passwordLoginSchema>): Promise<LoginResult> {
  const result = await db.transaction().execute(async (trx) => {
    const detailsResult = await sql<{
      trainerId: string
      userId: string
      userType: string
      passwordMatch: boolean
    }>`
          SELECT
            trainer.id AS "trainerId",
            trainer.user_id AS "userId",
            trainer.user_type AS "userType",
            trainer.password_hash = crypt(${body.password}, trainer.password_hash) AS "passwordMatch"
          FROM trainer
          WHERE trainer.email = ${body.email}
        `.execute(trx)

    const details = detailsResult.rows[0]
    if (!details) {
      throw new Error('noAccount')
    }

    if (!details.passwordMatch) {
      throw new Error('incorrectPassword')
    }

    const tokenResult = await sql<{ accessToken: string }>`
          INSERT INTO access_token (user_id, user_type, expires_at, type)
          VALUES (
            ${details.userId},
            ${details.userType},
            NOW() + INTERVAL '14 days',
            'api'
          )
          RETURNING id AS "accessToken"
        `.execute(trx)

    const tokenRow = tokenResult.rows[0]
    if (!tokenRow) {
      throw new Error('tokenCreationFailed')
    }

    return {
      id: tokenRow.accessToken,
      userId: details.userId,
      trainerId: details.trainerId,
    }
  })

  return result
}

async function loginWithApple(body: z.infer<typeof appleLoginSchema>): Promise<LoginResult> {
  if (!APPLE_AUDIENCE) {
    throw new Error('appleNotConfigured')
  }

  let identity: { email: string; userId: string }
  try {
    identity = await verifyAppleIdentityToken(body.signInWithAppleIdentityToken, {
      expectedAudience: APPLE_AUDIENCE,
      expectedNonce: body.signInWithAppleNonce,
    })
  } catch (error) {
    if (error instanceof AppleSignInError) {
      throw new TypeError('appleTokenInvalid', { cause: error })
    }
    throw error
  }

  const result = await db.transaction().execute(async (trx) => {
    const existingToken = await sql<{
      accessToken: string
      userId: string
      trainerId: string
    }>`
          WITH inserted AS (
            INSERT INTO access_token (user_id, user_type, expires_at, type)
              SELECT
                trainer.user_id,
                trainer.user_type,
                NOW() + INTERVAL '14 days',
                'api'
              FROM trainer
              WHERE trainer.sign_in_with_apple_user_id = ${identity.userId}
            RETURNING id, user_id
          )
          SELECT
            inserted.id AS "accessToken",
            inserted.user_id AS "userId",
            trainer.id AS "trainerId"
          FROM inserted
          JOIN trainer ON trainer.user_id = inserted.user_id
        `.execute(trx)

    const existing = existingToken.rows[0]
    if (existing) {
      return {
        id: existing.accessToken,
        userId: existing.userId,
        trainerId: existing.trainerId,
      }
    }

    const linkResult = await sql<{ trainerId: string }>`
          UPDATE trainer
             SET sign_in_with_apple_user_id = ${identity.userId}
           WHERE email = ${identity.email}
          RETURNING trainer.id AS "trainerId"
        `.execute(trx)

    const linkedTrainer = linkResult.rows[0]
    if (!linkedTrainer) {
      throw new Error('appleNoAccount')
    }

    const tokenResult = await sql<{
      accessToken: string
      userId: string
    }>`
          WITH inserted AS (
            INSERT INTO access_token (user_id, user_type, expires_at, type)
              SELECT
                trainer.user_id,
                trainer.user_type,
                NOW() + INTERVAL '14 days',
                'api'
              FROM trainer
              WHERE trainer.sign_in_with_apple_user_id = ${identity.userId}
            RETURNING id, user_id
          )
          SELECT
            inserted.id AS "accessToken",
            inserted.user_id AS "userId"
          FROM inserted
        `.execute(trx)

    const tokenRow = tokenResult.rows[0]
    if (!tokenRow) {
      throw new Error('tokenCreationFailed')
    }

    return {
      id: tokenRow.accessToken,
      userId: tokenRow.userId,
      trainerId: linkedTrainer.trainerId,
    }
  })

  return result
}

export async function login(body: unknown): Promise<LoginResult> {
  const parsed = loginRequestSchema.safeParse(body)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => issue.message).join('; ')
    throw new Error(detail || 'Invalid login payload')
  }

  if ('signInWithAppleIdentityToken' in parsed.data) {
    return loginWithApple(parsed.data)
  }

  return loginWithPassword(parsed.data)
}

export async function logout(accessToken: string): Promise<void> {
  await db.deleteFrom('access_token').where('id', '=', accessToken).execute()
}
