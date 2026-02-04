import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z, ZodError } from 'zod'
import { db, sql } from '@/lib/db'
import type { RawClientSessionRow } from '../../_lib/clientSessionsSchema'
import { authenticateTrainerRequest, buildErrorResponse } from '../../_lib/accessToken'
import { adaptClientSessionRow, nullableNumber } from '../../_lib/clientSessionsSchema'
import { APP_NAME, NO_REPLY_EMAIL } from '../../_lib/constants'

const LEGACY_INVALID_JSON_MESSAGE = 'Unexpected token \'"\\", "#" is not valid JSON'

const createLegacyInvalidJsonResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: LEGACY_INVALID_JSON_MESSAGE,
    }),
    { status: 400 }
  )

const requestSchema = z.object({
  clientId: z.string({ message: 'clientId is required' }).trim().min(1, 'clientId must not be empty'),
  sessionId: z.string({ message: 'sessionId is required' }).trim().min(1, 'sessionId must not be empty'),
})

const nullableCount = z.union([z.number(), z.string(), z.null()]).transform((value) => {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Invalid numeric value')
    }
    return value
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }

  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) {
    throw new TypeError('Invalid numeric value')
  }

  return parsed
})

const detailsSchema = z.object({
  sessionName: z.string().nullable(),
  start: z.coerce.date(),
  end: z.coerce.date(),
  isPastAppointment: z.boolean(),
  location: z.string().nullable(),
  price: nullableNumber,
  maximumAttendance: nullableCount,
  email: z.string().email().nullable(),
  firstName: z.string(),
  lastName: z.string().nullable(),
  serviceProviderEmail: z.string().email(),
  serviceProviderBusinessName: z.string(),
  locale: z.string(),
  timezone: z.string(),
  countryCode: z.string().length(2),
  clientId: z.string().uuid(),
  sessionId: z.string().uuid(),
  currency: z.string().length(3).nullable(),
})

class ClientOrSessionNotFoundError extends Error {
  constructor() {
    super('Client or session not found')
    this.name = 'ClientOrSessionNotFoundError'
  }
}

class ClientHasNoEmailError extends Error {
  constructor() {
    super('Client has no email')
    this.name = 'ClientHasNoEmailError'
  }
}

class AppointmentHasAlreadyStartedError extends Error {
  constructor() {
    super('Appointment has already started')
    this.name = 'AppointmentHasAlreadyStartedError'
  }
}

const escapeHtml = (value: string) =>
  value
    .replaceAll(/&/g, '&amp;')
    .replaceAll(/</g, '&lt;')
    .replaceAll(/>/g, '&gt;')
    .replaceAll(/"/g, '&quot;')
    .replaceAll(/'/g, '&#39;')

const buildInvitationEmail = (options: {
  businessName: string
  clientFirstName: string | null
  eventName: string | null
  eventLocation: string | null
  eventPrice: string | null
  eventDateRangeString: string
  maximumAttendance: number | null
  acceptLink: URL
  declineLink: URL
}) => {
  const safeBusinessName = options.businessName.trim() || APP_NAME
  const safeClientName = options.clientFirstName?.trim()
  const greeting = safeClientName ? `Hey ${escapeHtml(safeClientName)},` : 'Hey,'
  const locationLine =
    options.eventLocation && options.eventLocation.trim().length > 0
      ? `<p style="margin:0 0 8px 0;color:#1f2937;font-size:16px;line-height:1.5;">${escapeHtml(options.eventLocation)}</p>`
      : ''
  const priceLine =
    options.eventPrice !== null
      ? `<p style="margin:0 0 12px 0;color:#1f2937;font-size:16px;line-height:1.5;">Price: ${escapeHtml(options.eventPrice)}</p>`
      : ''
  const capacityLine =
    typeof options.maximumAttendance === 'number'
      ? `<p style="margin:16px 0;color:#4b5563;font-size:15px;line-height:1.5;">There's a max of ${options.maximumAttendance.toString()} clients that can attend this appointment, please reply so you don't miss out.</p>`
      : ''

  const eventTitle = options.eventName?.trim().length ? escapeHtml(options.eventName.trim()) : 'an appointment'

  return `
<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#f7f9fb;font-family:Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px;box-shadow:0 12px 40px rgba(17,24,39,0.08);">
            <tr>
              <td style="font-size:22px;font-weight:700;color:#111827;text-align:left;padding-bottom:12px;">
                ${escapeHtml(safeBusinessName)} invitation
              </td>
            </tr>
            <tr>
              <td style="font-size:16px;line-height:1.6;color:#1f2937;padding-bottom:12px;">${greeting}</td>
            </tr>
            <tr>
              <td style="font-size:16px;line-height:1.6;color:#1f2937;padding-bottom:12px;">
                You've been invited to <strong>${eventTitle}</strong>.
              </td>
            </tr>
            ${locationLine ? `<tr><td>${locationLine}</td></tr>` : ''}
            <tr>
              <td style="font-size:16px;line-height:1.6;color:#1f2937;padding-bottom:8px;">
                ${escapeHtml(options.eventDateRangeString)}
              </td>
            </tr>
            ${priceLine ? `<tr><td>${priceLine}</td></tr>` : ''}
            <tr><td><hr style="border:none;border-top:1px dashed #e5e7eb;margin:16px 0;" /></td></tr>
            ${capacityLine ? `<tr><td>${capacityLine}</td></tr>` : ''}
            <tr>
              <td style="padding-top:4px;padding-bottom:12px;">
                <a href="${options.acceptLink.toString()}" style="display:block;width:100%;text-align:center;background-color:#0085FF;color:#ffffff;padding:12px 18px;border-radius:10px;font-size:16px;font-weight:600;text-decoration:none;">I'll be there</a>
              </td>
            </tr>
            <tr>
              <td style="padding-bottom:4px;">
                <a href="${options.declineLink.toString()}" style="display:block;width:100%;text-align:center;background-color:#ffffff;border:2px solid #9ECFFD;color:#0085FF;padding:12px 18px;border-radius:10px;font-size:16px;font-weight:600;text-decoration:none;">I can't make it</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td align="center" style="padding-bottom:24px;color:#6b7280;font-size:13px;">
          You are receiving this email because you are a client of ${escapeHtml(
            safeBusinessName
          )} and they are using ${escapeHtml(APP_NAME)} to send this invitation.
        </td>
      </tr>
    </table>
  </body>
</html>
`
}

const formatEventPrice = (price: number | null, locale: string, currency?: string | null) => {
  if (price === null) {
    return null
  }
  if (price === 0) {
    return 'Free'
  }

  if (currency) {
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
      }).format(price)
    } catch (error) {
      console.warn('Failed to format price with currency', {
        price,
        locale,
        currency,
        error,
      })
    }
  }

  return new Intl.NumberFormat(locale).format(price)
}

export async function POST(request: NextRequest) {
  let rawBody: unknown = {}
  const rawBodyText = await request.text()
  if (rawBodyText.trim().length > 0) {
    try {
      rawBody = JSON.parse(rawBodyText)
    } catch (error) {
      console.error('Failed to parse client session invite request body', error)
      return createLegacyInvalidJsonResponse()
    }

    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      return createLegacyInvalidJsonResponse()
    }
  }

  const bodyResult = requestSchema.safeParse(rawBody)
  if (!bodyResult.success) {
    const detail = bodyResult.error.issues.map((issue) => issue.message).join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid request body',
        detail: detail || 'Request body did not match the expected schema.',
        type: '/invalid-body',
      }),
      { status: 400 }
    )
  }
  const parsedBody = bodyResult.data

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while inviting client session',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    const rawRow = await db.transaction().execute(async (trx) => {
      const detailsRow = await trx
        .selectFrom('session as s')
        .innerJoin('session_series as ss', 'ss.id', 's.session_series_id')
        .innerJoin('trainer', 'trainer.id', 's.trainer_id')
        .innerJoin('country', 'country.id', 'trainer.country_id')
        .innerJoin('client', (join) =>
          join.onRef('client.trainer_id', '=', 'trainer.id').on('client.id', '=', parsedBody.clientId)
        )
        .leftJoin('supported_country_currency as scc', 'scc.country_id', 'trainer.country_id')
        .leftJoin('currency', 'currency.id', 'scc.currency_id')
        .select((eb) => [
          eb.ref('ss.name').as('sessionName'),
          eb.ref('s.start').as('start'),
          sql<Date>`s.start + s.duration`.as('end'),
          sql<boolean>`s.start <= NOW()`.as('isPastAppointment'),
          eb.ref('ss.location').as('location'),
          eb.ref('ss.price').as('price'),
          eb.ref('s.maximum_attendance').as('maximumAttendance'),
          eb.ref('client.email').as('email'),
          eb.ref('client.first_name').as('firstName'),
          eb.ref('client.last_name').as('lastName'),
          sql<string>`COALESCE(trainer.online_bookings_contact_email, trainer.email)`.as('serviceProviderEmail'),
          sql<string>`COALESCE(trainer.business_name, trainer.first_name || COALESCE(' ' || trainer.last_name, ''))`.as(
            'serviceProviderBusinessName'
          ),
          eb.ref('trainer.locale').as('locale'),
          eb.ref('trainer.timezone').as('timezone'),
          eb.ref('country.alpha_2_code').as('countryCode'),
          eb.ref('client.id').as('clientId'),
          eb.ref('s.id').as('sessionId'),
          eb.ref('currency.alpha_code').as('currency'),
        ])
        .where('s.id', '=', parsedBody.sessionId)
        .where('s.trainer_id', '=', authorization.trainerId)
        .executeTakeFirst()

      if (!detailsRow) {
        throw new ClientOrSessionNotFoundError()
      }

      const details = detailsSchema.parse(detailsRow)

      if (!details.email) {
        throw new ClientHasNoEmailError()
      }

      if (details.isPastAppointment) {
        throw new AppointmentHasAlreadyStartedError()
      }

      const insertResult = await trx
        .insertInto('client_session')
        .values({
          trainer_id: authorization.trainerId,
          client_id: parsedBody.clientId,
          session_id: parsedBody.sessionId,
          price: details.price ?? null,
          state: 'invited',
          invite_time: sql<Date>`NOW()`,
        })
        .onConflict((oc) =>
          oc.columns(['session_id', 'client_id']).doUpdateSet({
            state: 'invited',
            invite_time: sql<Date>`NOW()`,
          })
        )
        .returning('id')
        .executeTakeFirst()

      if (!insertResult) {
        throw new Error('Failed to create client session invitation')
      }

      const clientSessionId = insertResult.id

      const baseUrl = process.env.BASE_URL ?? 'http://localhost:3001'

      const eventDateRangeString = new Intl.DateTimeFormat(details.locale, {
        dateStyle: 'full',
        timeStyle: 'long',
        timeZone: details.timezone,
      }).formatRange(details.start, details.end)

      const eventPrice = formatEventPrice(details.price, details.locale, details.currency)

      const acceptLink = new URL(`/api/sessionInvitationLinks/${clientSessionId}?action=accept`, baseUrl)
      const declineLink = new URL(`/api/sessionInvitationLinks/${clientSessionId}?action=decline`, baseUrl)

      const senderName = details.serviceProviderBusinessName.trim() || `${APP_NAME} Team`

      const html = buildInvitationEmail({
        businessName: details.serviceProviderBusinessName,
        clientFirstName: details.firstName,
        eventName: details.sessionName,
        eventLocation: details.location,
        eventPrice,
        eventDateRangeString,
        maximumAttendance: details.maximumAttendance,
        acceptLink,
        declineLink,
      })

      await trx
        .insertInto('mail')
        .values({
          trainer_id: authorization.trainerId,
          client_id: details.clientId,
          from_email: NO_REPLY_EMAIL,
          from_name: `${senderName} via ${APP_NAME}`,
          to_email: details.email,
          to_name: details.firstName ?? null,
          subject: `${senderName} has invited you to ${
            details.sessionName ?? 'an appointment'
          } @ ${eventDateRangeString}`,
          html,
          reply_to: details.serviceProviderEmail,
        })
        .execute()

      const row = (await trx
        .selectFrom('vw_legacy_client_session as v')
        .innerJoin('client_session as cs', 'cs.id', 'v.id')
        .select((eb) => [
          eb.ref('v.id').as('id'),
          eb.ref('v.clientId').as('clientId'),
          eb.ref('v.sessionId').as('sessionId'),
          eb.ref('v.createdAt').as('createdAt'),
          eb.ref('v.state').as('state'),
          eb.ref('v.bookingQuestion').as('bookingQuestion'),
          eb.ref('v.bookingQuestionResponse').as('bookingQuestionResponse'),
          eb.ref('v.price').as('price'),
          eb.ref('v.attended').as('attended'),
          eb.ref('v.payment').as('payment'),
          eb.ref('v.notes').as('notes'),
          eb.ref('v.saleId').as('saleId'),
          eb.ref('v.cancelTime').as('cancelTime'),
          eb.ref('v.cancelReason').as('cancelReason'),
          eb.ref('v.acceptTime').as('acceptTime'),
          eb.ref('v.declineTime').as('declineTime'),
          eb.ref('v.inviteTime').as('inviteTime'),
          eb.ref('v.confirmTime').as('confirmTime'),
        ])
        .where('cs.trainer_id', '=', authorization.trainerId)
        .where('v.id', '=', clientSessionId)
        .executeTakeFirst()) as RawClientSessionRow | undefined

      if (!row) {
        throw new ClientOrSessionNotFoundError()
      }

      return row
    })

    const clientSession = adaptClientSessionRow(rawRow)

    return NextResponse.json(clientSession)
  } catch (error) {
    if (error instanceof ClientOrSessionNotFoundError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Client or session not found',
          type: '/resource-not-found',
        }),
        { status: 404 }
      )
    }

    if (error instanceof ClientHasNoEmailError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'Client has no email',
          detail: 'A client email address is required to send an invitation.',
          type: '/client-has-no-email',
        }),
        { status: 409 }
      )
    }

    if (error instanceof AppointmentHasAlreadyStartedError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'Appointment has already started',
          detail: 'This appointment has already started and invitations can no longer be sent.',
          type: '/appointment-has-already-started',
        }),
        { status: 409 }
      )
    }

    if (error instanceof ZodError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse client session data from database',
          detail: 'Client session data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error('Failed to invite client session', {
      trainerId: authorization.trainerId,
      clientId: parsedBody.clientId,
      sessionId: parsedBody.sessionId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to invite client session',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
