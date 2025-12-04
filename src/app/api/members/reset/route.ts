import { NextResponse } from 'next/server'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import { buildErrorResponse } from '../../_lib/accessToken'
import {
  APP_EMAIL,
  APP_NAME,
  KEEPON_LOGO_COLOR_URL,
} from '../../_lib/constants'

const PASSWORD_RESET_TTL_MINUTES = 15

const requestSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Email is required')
    .email('Email must be a valid email address.'),
})

class MemberNotFoundError extends Error {
  constructor() {
    super('No user with that email')
    this.name = 'MemberNotFoundError'
  }
}

const createInvalidJsonResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid JSON payload',
      detail: 'Request body must be valid JSON.',
      type: '/invalid-json',
    }),
    { status: 400 }
  )

const createInvalidBodyResponse = (detail: string | undefined) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid request body',
      detail: detail || 'Request body did not match the expected schema.',
      type: '/invalid-body',
    }),
    { status: 400 }
  )

const createMemberNotFoundResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 404,
      title: 'No user with that email',
      detail:
        'We could not find a trainer account associated with the provided email address.',
      type: '/member-not-found',
    }),
    { status: 404 }
  )

const createInternalErrorResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Failed to create password reset request',
      type: '/internal-server-error',
    }),
    { status: 500 }
  )

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const buildEmailHtml = (firstName: string, resetUrl: URL) => `
<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#f7f9fb;font-family:Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px;">
            <tr>
              <td align="center" style="padding-bottom:24px;">
                <img src="${KEEPON_LOGO_COLOR_URL}" alt="${APP_NAME}" style="max-width:160px;height:auto;" />
              </td>
            </tr>
            <tr>
              <td style="font-size:20px;font-weight:700;color:#111827;text-align:center;padding-bottom:16px;">
                Reset your ${APP_NAME} password
              </td>
            </tr>
            <tr>
              <td style="font-size:16px;line-height:1.5;color:#1f2937;padding-bottom:16px;">
                Hi ${escapeHtml(firstName)},
              </td>
            </tr>
            <tr>
              <td style="font-size:16px;line-height:1.5;color:#1f2937;padding-bottom:16px;">
                We received a request to reset your password. Click the button below within ${PASSWORD_RESET_TTL_MINUTES} minutes to continue.
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:24px;">
                <a href="${resetUrl.toString()}" style="display:inline-block;background-color:#111827;color:#ffffff;padding:12px 24px;border-radius:8px;font-size:16px;font-weight:600;text-decoration:none;">
                  Reset your password
                </a>
              </td>
            </tr>
            <tr>
              <td style="font-size:14px;line-height:1.5;color:#6b7280;">
                If you did not request a password reset, you can safely ignore this email. This link expires in ${PASSWORD_RESET_TTL_MINUTES} minutes.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`

export async function POST(request: Request) {
  let parsedBody: z.infer<typeof requestSchema>

  try {
    const rawBody = (await request.json()) as unknown
    const validation = requestSchema.safeParse(rawBody)

    if (!validation.success) {
      const detail = validation.error.issues
        .map(issue => issue.message)
        .join('; ')

      return createInvalidBodyResponse(detail)
    }

    parsedBody = validation.data
  } catch (error) {
    console.error('Failed to parse member reset request body', error)
    return createInvalidJsonResponse()
  }

  const { email } = parsedBody
  const baseUrl = process.env.BASE_URL ?? 'http://localhost:3001'

  try {
    await db.transaction().execute(async trx => {
      const result = await sql<{
        accessToken: string
        userId: string
        firstName: string
        trainerId: string
      }>`
        WITH inserted AS (
          INSERT INTO access_token (user_id, user_type, type, expires_at)
          SELECT
            trainer.user_id,
            trainer.user_type,
            'password_reset',
            NOW() + make_interval(mins => ${PASSWORD_RESET_TTL_MINUTES})
          FROM trainer
          WHERE trainer.email = ${email}
          RETURNING id, user_id
        )
        SELECT
          inserted.id AS "accessToken",
          inserted.user_id AS "userId",
          trainer.first_name AS "firstName",
          trainer.id AS "trainerId"
        FROM inserted
        JOIN trainer ON trainer.user_id = inserted.user_id
      `.execute(trx)

      const details = result.rows[0]

      if (!details) {
        throw new MemberNotFoundError()
      }

      await sql`
        DELETE FROM access_token
         WHERE user_id = ${details.userId}
           AND type = 'password_reset'
           AND id != ${details.accessToken}
      `.execute(trx)

      const resetUrl = new URL('/password-reset', baseUrl)
      resetUrl.hash = details.accessToken

      const html = buildEmailHtml(details.firstName, resetUrl)
      const subject = `${APP_NAME} Password Reset`

      await sql`
        INSERT INTO mail (
          trainer_id,
          client_id,
          from_email,
          from_name,
          to_email,
          to_name,
          subject,
          html,
          reply_to
        )
        VALUES (
          ${details.trainerId},
          NULL,
          ${APP_EMAIL},
          ${`${APP_NAME} Team`},
          ${email},
          NULL,
          ${subject},
          ${html},
          NULL
        )
      `.execute(trx)
    })
  } catch (error) {
    if (error instanceof MemberNotFoundError) {
      return createMemberNotFoundResponse()
    }

    console.error('Failed to create password reset request', {
      error,
      email,
    })

    return createInternalErrorResponse()
  }

  return new Response(null, { status: 204 })
}
