import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { buildErrorResponse } from '../_lib/accessToken'
import { parseStrictJsonBody } from '../_lib/strictJson'
import { APP_EMAIL, APP_NAME, KEEPON_LOGO_COLOR_URL } from '../_lib/constants'

const requestSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Email must be a valid email address.'),
})

const generateRandomSixDigitCode = () => crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')

const buildEmailHtml = (code: string) => `
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
              <td style="font-size:24px;font-weight:700;color:#111827;text-align:center;padding-bottom:16px;">
                ${code} is your client dashboard login code
              </td>
            </tr>
            <tr>
              <td style="font-size:16px;line-height:1.5;color:#1f2937;text-align:center;">
                Enter <strong>${code}</strong> to log in to your client dashboard.
              </td>
            </tr>
            <tr>
              <td style="font-size:14px;line-height:1.5;color:#6b7280;text-align:center;padding-top:24px;">
                If you did not request this code, you can safely ignore this email.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`

class SilentRollbackError extends Error {}

const createInvalidBodyResponse = (detail: string | undefined) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Your parameters were invalid.',
      detail: detail || 'Request body did not match the expected schema.',
      type: '/invalid-parameters',
    }),
    { status: 400 }
  )

const createInternalErrorResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Something on our end went wrong.',
    }),
    { status: 500 }
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

    return createInvalidBodyResponse(detail)
  }

  parsedBody = validation.data

  const { email } = parsedBody

  try {
    await db.transaction().execute(async (trx) => {
      const clientRow = await trx
        .selectFrom('client')
        .select('client.email')
        .distinct()
        .where('client.email', '=', email)
        .executeTakeFirst()

      const code = generateRandomSixDigitCode()

      await trx
        .insertInto('client_login_request')
        .values({
          code,
          email,
        })
        .execute()

      if (!clientRow) {
        throw new SilentRollbackError()
      }

      const subject = `${code} is your client dashboard login code`
      const html = buildEmailHtml(code)
      const recipientEmail = clientRow.email

      if (!recipientEmail) {
        throw new SilentRollbackError()
      }

      await trx
        .insertInto('mail')
        .values({
          trainer_id: null,
          client_id: null,
          from_email: APP_EMAIL,
          from_name: `${APP_NAME} Team`,
          to_email: recipientEmail,
          to_name: null,
          subject,
          html,
          reply_to: null,
        })
        .execute()
    })
  } catch (error) {
    if (error instanceof SilentRollbackError) {
      return new Response(null, { status: 204 })
    }

    console.error('Failed to create client login request', error instanceof Error ? error : new Error(String(error)), {
      email,
    })

    return createInternalErrorResponse()
  }

  return new Response(null, { status: 204 })
}
