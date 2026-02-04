import type { CountryCode } from 'libphonenumber-js'
import type { NextRequest } from 'next/server'
import { parsePhoneNumberFromString } from 'libphonenumber-js/min'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { authenticateTrainerRequest, buildErrorResponse } from '../../../_lib/accessToken'
import { APP_NAME, NO_REPLY_EMAIL } from '../../../_lib/constants'

const paramsSchema = z.object({
  clientSessionId: z.string().trim().min(1, 'Client session id must not be empty.'),
})

const bodySchema = z.object({
  method: z.enum(['email', 'sms', 'emailAndSms']),
})

const detailsSchema = z.object({
  bookingId: z.string().trim().min(1),
  smsCreditBalance: z.union([z.string(), z.number(), z.bigint(), z.null()]),
  serviceProviderName: z.string(),
  serviceProviderEmail: z.string().email(),
  brandColor: z.string(),
  businessLogoUrl: z.string().url().nullable(),
  clientEmail: z.string().email().nullable(),
  clientMobileNumber: z.string().nullable(),
  country: z.string().length(2),
  trainerId: z.string().uuid(),
  clientId: z.string().uuid(),
  appointmentName: z.string(),
  startsAt: z.coerce.date(),
  locale: z.string(),
  timezone: z.string(),
})

type HandlerContext = { params: Promise<Record<string, string>> }

class ClientSessionNotFoundError extends Error {
  constructor() {
    super('Client session not found')
    this.name = 'ClientSessionNotFoundError'
  }
}

const createLegacyNotFoundResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 404,
      title: 'Client session not found',
      type: '/resource-not-found',
    }),
    { status: 404 }
  )

class ClientHasNoEmailError extends Error {
  constructor() {
    super('Client has no email')
    this.name = 'ClientHasNoEmailError'
  }
}

class ClientHasNoPhoneNumberError extends Error {
  constructor() {
    super('Client has no phone number')
    this.name = 'ClientHasNoPhoneNumberError'
  }
}

class ClientHasNoContactInfoError extends Error {
  constructor() {
    super('Client has no contact info')
    this.name = 'ClientHasNoContactInfoError'
  }
}

class ClientHasInvalidPhoneNumberError extends Error {
  constructor() {
    super('Client has invalid phone number')
    this.name = 'ClientHasInvalidPhoneNumberError'
  }
}

class OutOfTextCreditsError extends Error {
  constructor() {
    super('Out of text credits')
    this.name = 'OutOfTextCreditsError'
  }
}

class BookingLinkUnavailableError extends Error {
  constructor() {
    super('Booking link is unavailable')
    this.name = 'BookingLinkUnavailableError'
  }
}

const LEGACY_INVALID_JSON_MESSAGE = 'Unexpected token \'"\\", "#" is not valid JSON'

const createLegacyInvalidJsonResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: LEGACY_INVALID_JSON_MESSAGE,
    }),
    { status: 400 }
  )

const parseSmsCredits = (value: unknown): bigint => {
  if (value === null || value === undefined) {
    return 0n
  }
  if (typeof value === 'bigint') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Invalid sms credit balance')
    }
    return BigInt(Math.trunc(value))
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      return 0n
    }
    try {
      return BigInt(trimmed)
    } catch {
      throw new Error('Invalid sms credit balance')
    }
  }
  throw new Error('Invalid sms credit balance')
}

const escapeHtml = (value: string) =>
  value
    .replaceAll(/&/g, '&amp;')
    .replaceAll(/</g, '&lt;')
    .replaceAll(/>/g, '&gt;')
    .replaceAll(/"/g, '&quot;')
    .replaceAll(/'/g, '&#39;')

const formatPhoneNumber = (raw: string, countryCode: string) => {
  const normalized = countryCode.toUpperCase() as CountryCode
  const parsed = parsePhoneNumberFromString(raw, normalized)
  if (!parsed || !parsed.isValid()) {
    throw new ClientHasInvalidPhoneNumberError()
  }
  return parsed.format('E.164')
}

const formatStartLabel = (start: Date, locale: string, timezone: string) =>
  new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    hour: 'numeric',
    minute: 'numeric',
    timeZoneName: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: timezone,
  }).format(start)

const buildShareEmail = (options: {
  serviceProviderName: string
  appointmentName: string
  formattedStart: string
  bookingUrl: URL
  brandColor: string
  businessLogoUrl: string | null
}) => {
  const safeProvider = options.serviceProviderName.trim() || APP_NAME
  const safeAppointment = options.appointmentName.trim() || 'Appointment'
  const logoBlock = options.businessLogoUrl
    ? `<tr><td style="padding-bottom:12px;text-align:center;"><img src="${escapeHtml(
        options.businessLogoUrl
      )}" alt="${escapeHtml(safeProvider)}" style="max-width:180px;height:auto;"/></td></tr>`
    : ''

  return `
<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#f7f9fb;font-family:Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px;box-shadow:0 12px 36px rgba(17,24,39,0.08);">
            ${logoBlock}
            <tr>
              <td style="font-size:22px;font-weight:700;color:#111827;padding-bottom:10px;">
                ${escapeHtml(safeAppointment)} on ${escapeHtml(options.formattedStart)}
              </td>
            </tr>
            <tr>
              <td style="font-size:15px;line-height:1.6;color:#1f2937;padding-bottom:18px;">
                ${escapeHtml(
                  safeProvider
                )} has shared the details of this booking with you. You can view more details at the link below.
              </td>
            </tr>
            <tr>
              <td>
                <a href="${options.bookingUrl.toString()}" style="display:block;text-align:center;background-color:${escapeHtml(
                  options.brandColor
                )};color:#ffffff;padding:12px 18px;border-radius:10px;font-size:16px;font-weight:600;text-decoration:none;">View booking details</a>
              </td>
            </tr>
          </table>
          <div style="color:#6b7280;font-size:12px;margin-top:14px;">You are receiving this because your service provider uses ${APP_NAME}.</div>
        </td>
      </tr>
    </table>
  </body>
</html>
`
}

export async function POST(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map((issue) => issue.message).join('; ')
    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid path parameters',
        detail: detail || 'Client session id parameter did not match the expected schema.',
        type: '/invalid-path-parameters',
      }),
      { status: 400 }
    )
  }

  const { clientSessionId } = paramsResult.data

  let body: unknown = {}
  const rawBodyText = await request.text()
  if (rawBodyText.trim().length > 0) {
    try {
      body = JSON.parse(rawBodyText)
    } catch (error) {
      console.error('Failed to parse client session share request body', clientSessionId, error)
      return createLegacyInvalidJsonResponse()
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return createLegacyInvalidJsonResponse()
    }
  }

  const bodyResult = bodySchema.safeParse(body)
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

  const { method } = bodyResult.data

  const authorization = await authenticateTrainerRequest(request, {
    extensionFailureLogMessage: 'Failed to extend access token expiry while sharing client session',
  })

  if (!authorization.ok) {
    return authorization.response
  }

  try {
    await db.transaction().execute(async (trx) => {
      const detailsRow = await trx
        .selectFrom('client_session as cs')
        .innerJoin('session as s', 's.id', 'cs.session_id')
        .innerJoin('session_series as ss', 'ss.id', 's.session_series_id')
        .innerJoin('trainer', 'trainer.id', 'cs.trainer_id')
        .innerJoin('client', 'client.id', 'cs.client_id')
        .innerJoin('country', 'country.id', 'trainer.country_id')
        .leftJoin('sms_balance', 'sms_balance.trainer_id', 'trainer.id')
        .select((eb) => [
          eb.ref('cs.booking_id').as('bookingId'),
          eb.ref('sms_balance.credit_balance').as('smsCreditBalance'),
          eb.ref('trainer.online_bookings_business_name').as('onlineBookingsBusinessName'),
          eb.ref('trainer.business_name').as('businessName'),
          eb.ref('trainer.first_name').as('trainerFirstName'),
          eb.ref('trainer.last_name').as('trainerLastName'),
          eb.ref('trainer.online_bookings_contact_email').as('onlineBookingsContactEmail'),
          eb.ref('trainer.email').as('trainerEmail'),
          eb.ref('trainer.brand_color').as('brandColor'),
          eb.ref('trainer.business_logo_url').as('businessLogoUrl'),
          eb.ref('client.email').as('clientEmail'),
          eb.ref('client.mobile_number').as('clientMobileNumber'),
          eb.ref('country.alpha_2_code').as('country'),
          eb.ref('trainer.id').as('trainerId'),
          eb.ref('client.id').as('clientId'),
          eb.ref('ss.name').as('appointmentName'),
          eb.ref('s.start').as('startsAt'),
          eb.ref('trainer.locale').as('locale'),
          eb.ref('s.timezone').as('timezone'),
        ])
        .where('cs.id', '=', clientSessionId)
        .where('cs.trainer_id', '=', authorization.trainerId)
        .executeTakeFirst()

      if (!detailsRow) {
        throw new ClientSessionNotFoundError()
      }

      const serviceProviderName =
        detailsRow.onlineBookingsBusinessName ??
        detailsRow.businessName ??
        [detailsRow.trainerFirstName, detailsRow.trainerLastName]
          .map((part) => part?.trim())
          .filter(Boolean)
          .join(' ')

      const serviceProviderEmail = detailsRow.onlineBookingsContactEmail ?? detailsRow.trainerEmail

      const details = detailsSchema.parse({
        bookingId: detailsRow.bookingId,
        smsCreditBalance: detailsRow.smsCreditBalance ?? '0',
        serviceProviderName: serviceProviderName || 'Appointment',
        serviceProviderEmail: serviceProviderEmail || '',
        brandColor: detailsRow.brandColor,
        businessLogoUrl: detailsRow.businessLogoUrl,
        clientEmail: detailsRow.clientEmail,
        clientMobileNumber: detailsRow.clientMobileNumber,
        country: detailsRow.country,
        trainerId: detailsRow.trainerId,
        clientId: detailsRow.clientId,
        appointmentName: detailsRow.appointmentName ?? 'Appointment',
        startsAt: detailsRow.startsAt,
        locale: detailsRow.locale,
        timezone: detailsRow.timezone,
      })

      const wantsEmail = method === 'email' || method === 'emailAndSms'
      const wantsSms = method === 'sms' || method === 'emailAndSms'

      if (wantsEmail && !details.clientEmail) {
        throw new ClientHasNoEmailError()
      }
      if (wantsSms && !details.clientMobileNumber) {
        throw new ClientHasNoPhoneNumberError()
      }
      if (method === 'emailAndSms' && !details.clientEmail && !details.clientMobileNumber) {
        throw new ClientHasNoContactInfoError()
      }

      if (!details.bookingId) {
        throw new BookingLinkUnavailableError()
      }

      if (wantsSms) {
        const balance = parseSmsCredits(details.smsCreditBalance)
        if (balance < 1n) {
          throw new OutOfTextCreditsError()
        }
      }

      const formattedStart = formatStartLabel(details.startsAt, details.locale, details.timezone)
      const baseUrl = process.env.BASE_URL ?? 'http://localhost:3001'
      const bookingUrl = new URL(`/book/bookings/${details.bookingId}`, baseUrl)

      if (wantsEmail && details.clientEmail) {
        const senderName = details.serviceProviderName.trim() || `${APP_NAME} Team`
        const html = buildShareEmail({
          serviceProviderName: details.serviceProviderName,
          appointmentName: details.appointmentName,
          formattedStart,
          bookingUrl,
          brandColor: details.brandColor,
          businessLogoUrl: details.businessLogoUrl,
        })

        await trx
          .insertInto('mail')
          .values({
            trainer_id: authorization.trainerId,
            client_id: details.clientId,
            from_email: NO_REPLY_EMAIL,
            from_name: `${senderName} via ${APP_NAME}`,
            to_email: details.clientEmail,
            to_name: null,
            subject: `${details.appointmentName} on ${formattedStart}`,
            html,
            reply_to: details.serviceProviderEmail,
          })
          .execute()
      }

      if (wantsSms && details.clientMobileNumber) {
        const toNumber = formatPhoneNumber(details.clientMobileNumber, details.country)
        const smsBody = `${details.appointmentName} with ${details.serviceProviderName} on ${formattedStart}. More: ${bookingUrl.toString()}`

        await trx
          .insertInto('sms')
          .values({
            trainer_id: authorization.trainerId,
            client_id: details.clientId,
            to_number: toNumber,
            from_number: null,
            body: smsBody,
            client_was_deleted: null,
            queued_at: null,
            queue_failed_at: null,
            queue_failed_reason: null,
            twilio_message_sid: null,
          })
          .execute()
      }
    })

    return new Response(null, { status: 204 })
  } catch (error) {
    if (error instanceof ClientSessionNotFoundError) {
      return createLegacyNotFoundResponse()
    }

    if (error instanceof ClientHasNoEmailError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'Client has no email',
          detail: 'A client email address is required to send this message.',
          type: '/client-has-no-email',
        }),
        { status: 409 }
      )
    }

    if (error instanceof ClientHasNoPhoneNumberError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'Client has no phone number',
          detail: 'A client phone number is required to send this message.',
          type: '/client-has-no-phone-number',
        }),
        { status: 409 }
      )
    }

    if (error instanceof ClientHasNoContactInfoError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'Client has no contact info',
          detail: 'A client email or phone number is required to share this booking.',
          type: '/client-has-no-contact-info',
        }),
        { status: 409 }
      )
    }

    if (error instanceof ClientHasInvalidPhoneNumberError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'Client phone number is invalid',
          detail: 'The client phone number could not be parsed for SMS sending.',
          type: '/client-has-invalid-phone-number',
        }),
        { status: 409 }
      )
    }

    if (error instanceof OutOfTextCreditsError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 402,
          title: 'Out of text credits',
          detail: 'Your account has insufficient text credits to send this message.',
          type: '/out-of-text-credits',
        }),
        { status: 402 }
      )
    }

    if (error instanceof BookingLinkUnavailableError) {
      return NextResponse.json(
        buildErrorResponse({
          status: 409,
          title: 'Booking link unavailable',
          detail: 'This booking does not have a public link to share at the moment.',
          type: '/booking-link-unavailable',
        }),
        { status: 409 }
      )
    }

    if (error instanceof z.ZodError) {
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

    console.error('Failed to share client session', {
      trainerId: authorization.trainerId,
      clientSessionId,
      error,
    })

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to share client session',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
