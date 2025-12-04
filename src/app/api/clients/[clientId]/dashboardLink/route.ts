import { NextRequest, NextResponse } from 'next/server'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import {
  authenticateTrainerRequest,
  buildErrorResponse,
} from '../../../_lib/accessToken'
import { APP_NAME, NO_REPLY_EMAIL } from '../../../_lib/constants'

export const runtime = 'nodejs'

const paramsSchema = z.object({
  clientId: z
    .string()
    .trim()
    .min(1, 'Client id is required')
    .uuid({ message: 'Client id must be a valid UUID' }),
})

const clientDetailsSchema = z.object({
  clientId: z.string().uuid(),
  email: z.string().email().nullable(),
  userId: z.string().uuid(),
  serviceProviderName: z.string(),
  brandColor: z.string().nullable(),
  businessLogoUrl: z.string().nullable(),
})

const tailwind600: Record<string, string> = {
  amber: '#d97706',
  blue: '#2563eb',
  cyan: '#0ea5e9',
  emerald: '#059669',
  fuchsia: '#c026d3',
  green: '#16a34a',
  indigo: '#4f46e5',
  lightBlue: '#0284c7',
  lime: '#65a30d',
  orange: '#ea580c',
  pink: '#db2777',
  purple: '#7c3aed',
  red: '#dc2626',
  rose: '#e11d48',
  sky: '#0284c7',
  teal: '#0d9488',
  violet: '#7c3aed',
  yellow: '#ca8a04',
}

const resolveBrandColor = (value?: string | null) =>
  (value && tailwind600[value]) ?? tailwind600.blue

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const buildDashboardLinkEmail = (options: {
  serviceProviderName: string
  brandColor?: string | null
  businessLogoUrl?: string | null
  link: URL
}) => {
  const serviceProvider =
    options.serviceProviderName.trim() || `${APP_NAME} Team`
  const buttonColor = resolveBrandColor(options.brandColor)
  const logo = options.businessLogoUrl
    ? `<img src="${options.businessLogoUrl}" alt="${escapeHtml(
        serviceProvider
      )}" style="max-width:160px;height:auto;border-radius:12px;" />`
    : ''

  return `
<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#f7f9fb;font-family:Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px;">
            <tr>
              <td align="center" style="padding-bottom:24px;">
                ${logo}
              </td>
            </tr>
            <tr>
              <td style="font-size:22px;font-weight:700;color:#111827;text-align:center;padding-bottom:12px;">
                Client Dashboard Link
              </td>
            </tr>
            <tr>
              <td style="font-size:16px;line-height:1.6;color:#1f2937;padding-bottom:16px;text-align:center;">
                A ${escapeHtml(
                  APP_NAME
                )} dashboard login link was requested for this email address.
                Click the button below to start managing your ${escapeHtml(
                  APP_NAME
                )} client profile.
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:24px;">
                <a href="${options.link.toString()}" style="display:inline-block;background-color:${buttonColor};color:#ffffff;padding:12px 20px;border-radius:10px;font-size:16px;font-weight:600;text-decoration:none;">
                  Go to Dashboard
                </a>
              </td>
            </tr>
            <tr>
              <td style="font-size:13px;line-height:1.5;color:#6b7280;text-align:center;">
                You received this email because ${escapeHtml(
                  serviceProvider
                )} requested a client dashboard link.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`
}

class ClientNotFoundError extends Error {
  constructor() {
    super('Client not found')
    this.name = 'ClientNotFoundError'
  }
}

class ClientHasNoEmailError extends Error {
  constructor() {
    super('Client has no email')
    this.name = 'ClientHasNoEmailError'
  }
}

class AccessTokenCreationError extends Error {
  constructor() {
    super('Failed to create access token')
    this.name = 'AccessTokenCreationError'
  }
}

type HandlerContext = RouteContext<'/api/clients/[clientId]/dashboardLink'>

export async function PUT(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues
      .map(issue => issue.message)
      .join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid client identifier',
        detail:
          detail ||
          'Request parameters did not match the expected client identifier schema.',
        type: '/invalid-parameter',
      }),
      { status: 400 }
    )
  }

  const { clientId } = paramsResult.data

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage:
      'Failed to extend access token expiry while sending client dashboard link',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  const baseUrl = process.env.BASE_URL ?? 'http://localhost:3001'

  try {
    await db.transaction().execute(async trx => {
      const row = await trx
        .selectFrom('client')
        .innerJoin('trainer', 'trainer.id', 'client.trainer_id')
        .select(({ ref }) => [
          ref('client.id').as('clientId'),
          ref('client.email').as('email'),
          ref('client.user_id').as('userId'),
          sql<string>`
            COALESCE(
              trainer.online_bookings_business_name,
              trainer.business_name,
              trainer.first_name || COALESCE(' ' || trainer.last_name, '')
            )
          `.as('serviceProviderName'),
          ref('trainer.brand_color').as('brandColor'),
          ref('trainer.business_logo_url').as('businessLogoUrl'),
        ])
        .where('client.id', '=', clientId)
        .where('trainer.id', '=', authorization.trainerId)
        .executeTakeFirst()

      if (!row) {
        throw new ClientNotFoundError()
      }

      const details = clientDetailsSchema.parse({
        clientId: row.clientId,
        email: row.email,
        userId: row.userId,
        serviceProviderName: row.serviceProviderName ?? '',
        brandColor: row.brandColor ?? null,
        businessLogoUrl: row.businessLogoUrl ?? null,
      })

      if (!details.email) {
        throw new ClientHasNoEmailError()
      }

      const tokenRow = await trx
        .insertInto('access_token')
        .values({
          user_id: details.userId,
          user_type: 'client',
          type: 'client_dashboard',
          expires_at: sql`NOW() + INTERVAL '7 days'`,
        })
        .returning('id')
        .executeTakeFirst()

      if (!tokenRow) {
        throw new AccessTokenCreationError()
      }

      const link = new URL(baseUrl)
      link.hash = `/client/${details.clientId}/${tokenRow.id}?email=${encodeURIComponent(
        details.email
      )}`

      const html = buildDashboardLinkEmail({
        serviceProviderName: details.serviceProviderName,
        brandColor: details.brandColor,
        businessLogoUrl: details.businessLogoUrl,
        link,
      })

      const senderName =
        details.serviceProviderName.trim() || `${APP_NAME} Team`
      const subject = `${senderName}: Client Dashboard Link`

      await trx
        .insertInto('mail')
        .values({
          trainer_id: authorization.trainerId,
          client_id: details.clientId,
          from_email: NO_REPLY_EMAIL,
          from_name: `${senderName} via ${APP_NAME}`,
          to_email: details.email,
          to_name: null,
          subject,
          html,
          reply_to: null,
        })
        .execute()
    })

    return new Response(null, { status: 204 })
  } catch (error) {
    if (error instanceof ClientNotFoundError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Client not found',
          detail:
            'We could not find a client with the specified identifier for the authenticated trainer.',
          type: '/client-not-found',
        }),
        { status: 404 }
      )
    }

    if (error instanceof ClientHasNoEmailError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'Client has no email',
          detail:
            'A client email address is required to send a dashboard link.',
          type: '/client-has-no-email',
        }),
        { status: 409 }
      )
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to validate dashboard link data',
          detail:
            'Client dashboard link data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    if (error instanceof AccessTokenCreationError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to create client dashboard access token',
          type: '/internal-server-error',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to send client dashboard link', {
      trainerId: authorization.trainerId,
      clientId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to send client dashboard link',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
