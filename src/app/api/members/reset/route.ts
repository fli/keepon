import { addMinutes } from 'date-fns'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { buildErrorResponse } from '../../_lib/accessToken'
import { APP_EMAIL, APP_NAME, KEEPON_LOGO_COLOR_URL } from '../../_lib/constants'
import { parseStrictJsonBody } from '../../_lib/strictJson'

const PASSWORD_RESET_TTL_MINUTES = 15

const requestSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Email must be a valid email address.'),
})

class MemberNotFoundError extends Error {
  constructor() {
    super('No user with that email')
    this.name = 'MemberNotFoundError'
  }
}

const createInvalidBodyResponse = (detail: string | undefined) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid request body',
      detail: detail ?? 'Request body did not match the expected schema.',
      type: '/invalid-body',
    }),
    { status: 400 }
  )

const createMemberNotFoundResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 404,
      title: 'No user with that email',
      detail: 'We could not find a trainer account associated with the provided email address.',
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
    .replaceAll(/&/g, '&amp;')
    .replaceAll(/</g, '&lt;')
    .replaceAll(/>/g, '&gt;')
    .replaceAll(/"/g, '&quot;')
    .replaceAll(/'/g, '&#39;')

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

  const parsed = await parseStrictJsonBody(request)
  if (!parsed.ok) {
    return parsed.response
  }

  const validation = requestSchema.safeParse(parsed.data)

  if (!validation.success) {
    const detail = validation.error.issues.map((issue) => issue.message).join('; ')

    return createInvalidBodyResponse(detail)
  }

  parsedBody = validation.data

  const { email } = parsedBody
  const baseUrl = process.env.BASE_URL ?? 'http://localhost:3001'

  try {
    await db.transaction().execute(async (trx) => {
      const trainerRow = await trx
        .selectFrom('trainer')
        .select(['user_id as userId', 'user_type as userType', 'first_name as firstName', 'id as trainerId'])
        .where('email', '=', email)
        .executeTakeFirst()

      if (!trainerRow) {
        throw new MemberNotFoundError()
      }

      const expiresAt = addMinutes(new Date(), PASSWORD_RESET_TTL_MINUTES)

      const inserted = await trx
        .insertInto('access_token')
        .values({
          user_id: trainerRow.userId,
          user_type: trainerRow.userType,
          type: 'password_reset',
          expires_at: expiresAt,
        })
        .returning('id')
        .executeTakeFirst()

      const details = inserted
        ? {
            accessToken: inserted.id,
            userId: trainerRow.userId,
            firstName: trainerRow.firstName,
            trainerId: trainerRow.trainerId,
          }
        : null

      if (!details) {
        throw new MemberNotFoundError()
      }

      await trx
        .deleteFrom('access_token')
        .where('user_id', '=', details.userId)
        .where('type', '=', 'password_reset')
        .where('id', '!=', details.accessToken)
        .execute()

      const resetUrl = new URL('/password-reset', baseUrl)
      resetUrl.hash = details.accessToken

      const html = buildEmailHtml(details.firstName, resetUrl)
      const subject = `${APP_NAME} Password Reset`

      await trx
        .insertInto('mail')
        .values({
          trainer_id: details.trainerId,
          client_id: null,
          from_email: APP_EMAIL,
          from_name: `${APP_NAME} Team`,
          to_email: email,
          to_name: null,
          subject,
          html,
          reply_to: null,
        })
        .execute()
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
