import { NextResponse } from 'next/server'
import { db, sql } from '@keepon/db'
import { z, ZodError } from 'zod'
import { buildErrorResponse } from '../../_lib/accessToken'
import {
  AppleSignInError,
  verifyAppleIdentityToken,
} from '../../_lib/appleSignIn'

export const runtime = 'nodejs'

const passwordLoginSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Email must be valid.'),
  password: z.string().min(1, 'Password is required.'),
})

const appleLoginSchema = z.object({
  signInWithAppleIdentityToken: z
    .string()
    .trim()
    .min(1, 'Sign in with Apple identity token is required.'),
  signInWithAppleNonce: z.string().trim().min(1).optional(),
})

const requestSchema = z.union([passwordLoginSchema, appleLoginSchema])

const responseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  trainerId: z.string(),
})

const APPLE_AUDIENCE =
  process.env.APPLE_CLIENT_ID ?? process.env.IOS_BUNDLE_ID ?? null

const invalidJsonResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid JSON payload',
      detail: 'Request body must be valid JSON.',
      type: '/invalid-json',
    }),
    { status: 400 }
  )

const invalidBodyResponse = (detail?: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid request body',
      detail: detail || 'Request body did not match the expected schema.',
      type: '/invalid-body',
    }),
    { status: 400 }
  )

const signInWithAppleTokenInvalidResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Sign in with Apple token could not be verified.',
      type: '/sign-in-with-apple-token-invalid',
    }),
    { status: 400 }
  )

const appleSignInNotConfiguredResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Apple sign-in is not configured',
      detail:
        'APPLE_CLIENT_ID or IOS_BUNDLE_ID must be set to enable sign in with Apple.',
      type: '/apple-sign-in-not-configured',
    }),
    { status: 500 }
  )

const appleIdHasNoAccountResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'No account found matching that Apple ID',
      type: '/apple-id-has-no-account',
    }),
    { status: 400 }
  )

const emailHasNoAccountResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'No account with that email exists.',
      type: '/email-has-no-account',
    }),
    { status: 400 }
  )

const incorrectPasswordResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Your password was incorrect.',
      type: '/incorrect-password',
    }),
    { status: 400 }
  )

const internalErrorResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Failed to sign in',
      type: '/internal-server-error',
    }),
    { status: 500 }
  )

export async function POST(request: Request) {
  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch (error) {
    console.error('Failed to parse login request body as JSON', error)
    return invalidJsonResponse()
  }

  const parsed = requestSchema.safeParse(rawBody)
  if (!parsed.success) {
    const detail = parsed.error.issues.map(issue => issue.message).join('; ')
    return invalidBodyResponse(detail || undefined)
  }

  if ('signInWithAppleIdentityToken' in parsed.data) {
    return handleAppleLogin(parsed.data)
  }

  return handlePasswordLogin(parsed.data)
}

const handlePasswordLogin = async (
  body: z.infer<typeof passwordLoginSchema>
) => {
  try {
    const result = await db
      .transaction()
      .execute(async trx => {
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
          return { ok: false as const, reason: 'noAccount' as const }
        }

        if (!details.passwordMatch) {
          return { ok: false as const, reason: 'incorrectPassword' as const }
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
          throw new Error('Failed to create access token for trainer login')
        }

        return {
          ok: true as const,
          accessToken: tokenRow.accessToken,
          userId: details.userId,
          trainerId: details.trainerId,
        }
      })

    if (!result.ok) {
      if (result.reason === 'noAccount') {
        return emailHasNoAccountResponse()
      }
      return incorrectPasswordResponse()
    }

    const responseBody = responseSchema.parse({
      id: result.accessToken,
      userId: result.userId,
      trainerId: result.trainerId,
    })

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to build login response',
          detail: 'Login response did not match the expected schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to process trainer password login', {
      email: body.email,
      error,
    })
    return internalErrorResponse()
  }
}

const handleAppleLogin = async (body: z.infer<typeof appleLoginSchema>) => {
  if (!APPLE_AUDIENCE) {
    console.error(
      'Missing APPLE_CLIENT_ID or IOS_BUNDLE_ID configuration for Apple sign-in'
    )
    return appleSignInNotConfiguredResponse()
  }

  let identity: { email: string; userId: string }
  try {
    identity = await verifyAppleIdentityToken(
      body.signInWithAppleIdentityToken,
      {
        expectedAudience: APPLE_AUDIENCE,
        expectedNonce: body.signInWithAppleNonce,
      }
    )
  } catch (error) {
    if (error instanceof AppleSignInError) {
      console.warn('Failed to verify Sign in with Apple identity token', {
        code: error.code,
        message: error.message,
      })
      return signInWithAppleTokenInvalidResponse()
    }

    console.error('Unexpected error verifying Sign in with Apple token', error)
    return signInWithAppleTokenInvalidResponse()
  }

  try {
    const result = await db
      .transaction()
      .execute(async trx => {
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
            ok: true as const,
            accessToken: existing.accessToken,
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
          return { ok: false as const, reason: 'noAccount' as const }
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
          throw new Error(
            'Failed to create access token after linking Apple sign-in user'
          )
        }

        return {
          ok: true as const,
          accessToken: tokenRow.accessToken,
          userId: tokenRow.userId,
          trainerId: linkedTrainer.trainerId,
        }
      })

    if (!result.ok) {
      return appleIdHasNoAccountResponse()
    }

    const responseBody = responseSchema.parse({
      id: result.accessToken,
      userId: result.userId,
      trainerId: result.trainerId,
    })

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to build login response',
          detail: 'Login response did not match the expected schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to process Sign in with Apple login', {
      email: identity.email,
      appleUserId: identity.userId,
      error,
    })
    return internalErrorResponse()
  }
}
