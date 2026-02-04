import { addDays } from 'date-fns'
import { z } from 'zod'
import { db } from '@/lib/db'
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
    const details = await trx
      .selectFrom('trainer')
      .select((eb) => [
        eb.ref('trainer.id').as('trainerId'),
        eb.ref('trainer.user_id').as('userId'),
        eb.ref('trainer.user_type').as('userType'),
        eb(
          eb.ref('trainer.password_hash'),
          '=',
          eb.fn('crypt', [eb.val(body.password), eb.ref('trainer.password_hash')])
        ).as('passwordMatch'),
      ])
      .where('trainer.email', '=', body.email)
      .executeTakeFirst()

    if (!details) {
      throw new Error('noAccount')
    }

    if (!details.passwordMatch) {
      throw new Error('incorrectPassword')
    }

    const tokenRow = await trx
      .insertInto('access_token')
      .values({
        user_id: details.userId,
        user_type: details.userType,
        expires_at: addDays(new Date(), 14),
        type: 'api',
      })
      .returning('id')
      .executeTakeFirst()

    if (!tokenRow) {
      throw new Error('tokenCreationFailed')
    }

    return {
      id: tokenRow.id,
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
    const existingTrainer = await trx
      .selectFrom('trainer')
      .select((eb) => [
        eb.ref('trainer.id').as('trainerId'),
        eb.ref('trainer.user_id').as('userId'),
        eb.ref('trainer.user_type').as('userType'),
      ])
      .where('trainer.sign_in_with_apple_user_id', '=', identity.userId)
      .executeTakeFirst()

    if (existingTrainer) {
      const tokenRow = await trx
        .insertInto('access_token')
        .values({
          user_id: existingTrainer.userId,
          user_type: existingTrainer.userType,
          expires_at: addDays(new Date(), 14),
          type: 'api',
        })
        .returning('id')
        .executeTakeFirst()

      if (!tokenRow) {
        throw new Error('tokenCreationFailed')
      }

      return {
        id: tokenRow.id,
        userId: existingTrainer.userId,
        trainerId: existingTrainer.trainerId,
      }
    }

    const linkedTrainer = await trx
      .updateTable('trainer')
      .set({ sign_in_with_apple_user_id: identity.userId })
      .where('email', '=', identity.email)
      .returning((eb) => [
        eb.ref('trainer.id').as('trainerId'),
        eb.ref('trainer.user_id').as('userId'),
        eb.ref('trainer.user_type').as('userType'),
      ])
      .executeTakeFirst()

    if (!linkedTrainer) {
      throw new Error('appleNoAccount')
    }

    const tokenRow = await trx
      .insertInto('access_token')
      .values({
        user_id: linkedTrainer.userId,
        user_type: linkedTrainer.userType,
        expires_at: addDays(new Date(), 14),
        type: 'api',
      })
      .returning('id')
      .executeTakeFirst()

    if (!tokenRow) {
      throw new Error('tokenCreationFailed')
    }

    return {
      id: tokenRow.id,
      userId: linkedTrainer.userId,
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
