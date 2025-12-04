import { NextRequest, NextResponse } from 'next/server'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import { buildErrorResponse } from '../../../../_lib/accessToken'
import { APP_EMAIL, APP_NAME, NO_REPLY_EMAIL } from '../../../../_lib/constants'

const paramsSchema = z.object({
  bookingId: z.string().trim().min(1, 'Booking identifier must not be empty'),
})

const detailsSchema = z.object({
  clientEmail: z.string().email().nullable(),
  serviceProviderName: z.string(),
  serviceProviderEmail: z.string().email(),
  clientId: z.string(),
  trainerId: z.string(),
  trainerUserId: z.string(),
  clientFirstName: z.string(),
  clientLastName: z.string().nullable(),
  appointmentName: z.string().nullable(),
  eventType: z.enum(['event', 'single_session', 'group_session']),
  brandColor: z.string(),
  businessLogoUrl: z.string().nullable(),
  serviceProviderContactEmail: z.string().email(),
  serviceProviderContactNumber: z.string().nullable(),
  startsAt: z.coerce.date(),
  timezone: z.string(),
  locale: z.string(),
  canCancel: z.boolean(),
})

type HandlerContext = { params: Promise<Record<string, string>> }

class BookingNotFoundError extends Error {
  constructor() {
    super('Booking not found')
    this.name = 'BookingNotFoundError'
  }
}

class CannotCancelBookingError extends Error {
  constructor() {
    super("You can't cancel this appointment.")
    this.name = 'CannotCancelBookingError'
  }
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const isAppleRelayEmail = (email: string) => email.toLowerCase().endsWith('@privaterelay.appleid.com')

const joinNames = (...parts: Array<string | null | undefined>) =>
  parts
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ')

const buildClientEmailHtml = (options: {
  serviceProviderName: string
  appointmentName: string | null
  formattedDate: string
  contactDetails: string | null
  brandColor: string
}) => {
  const accent = options.brandColor && options.brandColor.trim().length > 0 ? options.brandColor : '#111827'
  const eventName = (options.appointmentName?.trim().length ?? 0) ? options.appointmentName!.trim() : 'your appointment'
  const contactLine = options.contactDetails
    ? `<tr><td style="font-size:15px;line-height:1.6;color:#374151;padding-top:14px;">If you have any questions please contact ${options.contactDetails}.</td></tr>`
    : ''

  return `
<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#f7f9fb;font-family:Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px;box-shadow:0 12px 40px rgba(17,24,39,0.08);">
            <tr>
              <td style="font-size:20px;font-weight:700;color:#111827;text-align:left;padding-bottom:12px;">
                Your booking has been cancelled
              </td>
            </tr>
            <tr>
              <td style="font-size:16px;line-height:1.6;color:#1f2937;padding-bottom:10px;">
                We're no longer expecting you for ${escapeHtml(eventName)} on ${escapeHtml(options.formattedDate)}.
              </td>
            </tr>
            ${contactLine}
            <tr>
              <td style="padding-top:18px;">
                <div style="height:2px;background:${accent};width:64px;border-radius:6px;"></div>
              </td>
            </tr>
            <tr>
              <td style="font-size:14px;line-height:1.6;color:#6b7280;padding-top:16px;">
                You are receiving this because you booked with ${escapeHtml(
                  options.serviceProviderName
                )} using ${APP_NAME}.
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

const buildTrainerEmailHtml = (options: {
  clientName: string
  appointmentName: string | null
  formattedDate: string
  brandColor: string
  businessLogoUrl: string | null
  serviceProviderName: string
}) => {
  const accent = options.brandColor && options.brandColor.trim().length > 0 ? options.brandColor : '#111827'
  const appointmentText =
    options.appointmentName && options.appointmentName.trim().length > 0
      ? ` for ${escapeHtml(options.appointmentName.trim())}`
      : ''

  const logo = options.businessLogoUrl
    ? `<tr><td style="padding-bottom:16px;"><img src="${options.businessLogoUrl}" alt="${escapeHtml(
        options.serviceProviderName
      )}" style="max-width:180px;height:auto;" /></td></tr>`
    : ''

  return `
<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#f7f9fb;font-family:Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;padding:32px;box-shadow:0 12px 40px rgba(17,24,39,0.08);">
            ${logo}
            <tr>
              <td style="font-size:20px;font-weight:700;color:#111827;text-align:left;padding-bottom:12px;">
                Booking cancelled
              </td>
            </tr>
            <tr>
              <td style="font-size:16px;line-height:1.6;color:#1f2937;padding-bottom:10px;">
                ${escapeHtml(options.clientName)} has cancelled their booking${appointmentText} on ${escapeHtml(
                  options.formattedDate
                )}.
              </td>
            </tr>
            <tr>
              <td style="padding-top:18px;">
                <div style="height:2px;background:${accent};width:64px;border-radius:6px;"></div>
              </td>
            </tr>
            <tr>
              <td style="font-size:14px;line-height:1.6;color:#6b7280;padding-top:16px;">
                You are receiving this because you use ${APP_NAME} for online bookings.
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

const createInvalidParamsResponse = (detail?: string) =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: 'Invalid booking identifier',
      detail: detail || 'Request parameters did not match the expected booking identifier schema.',
      type: '/invalid-parameter',
    }),
    { status: 400 }
  )

const createBookingNotFoundResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 404,
      title: 'Booking not found',
      detail: 'No booking matched the provided identifier.',
      type: '/resource-not-found',
    }),
    { status: 404 }
  )

const createCannotCancelResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 409,
      title: "You can't cancel this appointment.",
      type: '/cant-cancel-this-appointment',
    }),
    { status: 409 }
  )

const createInternalErrorResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 500,
      title: 'Failed to cancel booking',
      type: '/internal-server-error',
    }),
    { status: 500 }
  )

export async function POST(_request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map((issue) => issue.message).join('; ')
    return createInvalidParamsResponse(detail)
  }

  const { bookingId } = paramsResult.data

  try {
    await db.transaction().execute(async (trx) => {
      const detailsResult = await sql`
        SELECT
          client.email AS "clientEmail",
          COALESCE(
            trainer.online_bookings_business_name,
            trainer.business_name,
            trainer.first_name || COALESCE(' ' || trainer.last_name, '')
          ) AS "serviceProviderName",
          trainer.email AS "serviceProviderEmail",
          client.id AS "clientId",
          trainer.id AS "trainerId",
          trainer.user_id AS "trainerUserId",
          client.first_name AS "clientFirstName",
          client.last_name AS "clientLastName",
          session_series.name AS "appointmentName",
          session_series.event_type AS "eventType",
          trainer.brand_color AS "brandColor",
          trainer.business_logo_url AS "businessLogoUrl",
          COALESCE(trainer.online_bookings_contact_email, trainer.email) AS "serviceProviderContactEmail",
          CASE
            WHEN trainer.online_bookings_show_contact_number
              THEN COALESCE(trainer.online_bookings_contact_number, trainer.phone_number)
            ELSE NULL
          END AS "serviceProviderContactNumber",
          session.timezone AS timezone,
          trainer.locale AS locale,
          session.start AS "startsAt",
          session.can_clients_cancel
            AND session.start - session.cancellation_advance_notice_duration > NOW()
            AND client_session.state IN ('accepted', 'confirmed', 'maybe') AS "canCancel"
        FROM client_session
        JOIN session ON session.id = client_session.session_id
        JOIN session_series ON session_series.id = session.session_series_id
        JOIN client ON client.id = client_session.client_id
        JOIN trainer ON trainer.id = client_session.trainer_id
        WHERE client_session.booking_id = ${bookingId}
      `.execute(trx)

      const detailsRow = detailsResult.rows[0]
      if (!detailsRow) {
        throw new BookingNotFoundError()
      }

      const details = detailsSchema.parse(detailsRow)

      if (!details.canCancel) {
        throw new CannotCancelBookingError()
      }

      await sql`
        UPDATE client_session
           SET state = 'cancelled'
         WHERE booking_id = ${bookingId}
      `.execute(trx)

      const formatter = new Intl.DateTimeFormat(details.locale, {
        weekday: 'short',
        month: 'short',
        hour: 'numeric',
        minute: 'numeric',
        timeZoneName: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: details.timezone,
      })

      const formattedDate = formatter.format(details.startsAt)
      const clientName = joinNames(details.clientFirstName, details.clientLastName)

      const unreplyable = isAppleRelayEmail(details.serviceProviderEmail)
      const contactable = !unreplyable || !!details.serviceProviderContactNumber

      const contactDetails = contactable
        ? [
            !unreplyable && details.serviceProviderContactEmail
              ? `<a href="mailto:${details.serviceProviderContactEmail}">${escapeHtml(
                  details.serviceProviderContactEmail
                )}</a>`
              : null,
            details.serviceProviderContactNumber
              ? `<a href="tel:${details.serviceProviderContactNumber}">${escapeHtml(
                  details.serviceProviderContactNumber
                )}</a>`
              : null,
          ]
            .filter(Boolean)
            .join(' or ')
        : null

      const clientSubject =
        details.eventType === 'group_session'
          ? `You've cancelled your booking${details.appointmentName ? ` for ${details.appointmentName}` : ''}`
          : `You've cancelled ${details.appointmentName ?? 'your appointment'}`

      const trainerSubject = `${clientName || 'A client'} has cancelled their booking`

      const tasks: Array<Promise<unknown>> = []

      if (details.clientEmail) {
        const clientHtml = buildClientEmailHtml({
          serviceProviderName: details.serviceProviderName,
          appointmentName: details.appointmentName,
          formattedDate,
          contactDetails,
          brandColor: details.brandColor,
        })

        tasks.push(
          sql`
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
              ${details.clientId},
              ${NO_REPLY_EMAIL},
              ${`${details.serviceProviderName} via ${APP_NAME}`},
              ${details.clientEmail},
              ${details.clientFirstName ?? null},
              ${clientSubject},
              ${clientHtml},
              ${unreplyable ? null : details.serviceProviderEmail}
            )
          `.execute(trx)
        )
      }

      const trainerHtml = buildTrainerEmailHtml({
        clientName: clientName || 'A client',
        appointmentName: details.appointmentName,
        formattedDate,
        brandColor: details.brandColor,
        businessLogoUrl: details.businessLogoUrl,
        serviceProviderName: details.serviceProviderName,
      })

      tasks.push(
        sql`
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
            ${details.clientId},
            ${APP_EMAIL},
            ${`${APP_NAME} Team`},
            ${details.serviceProviderEmail},
            NULL,
            ${trainerSubject},
            ${trainerHtml},
            NULL
          )
        `.execute(trx)
      )

      const notificationPayload = {
        clientId: details.clientId,
        userId: details.trainerUserId,
        messageType: 'default',
        notificationType: 'general',
        title: 'Booking cancelled',
        body: `${clientName || 'A client'} has cancelled their booking${
          details.appointmentName ? ` for ${details.appointmentName}` : ''
        } on ${formattedDate}`,
      }

      tasks.push(
        sql`
          INSERT INTO task_queue (task_type, data)
          VALUES ('user.notify', ${JSON.stringify(notificationPayload)}::jsonb)
        `.execute(trx)
      )

      await Promise.all(tasks)
    })

    return new Response(null, { status: 204 })
  } catch (error) {
    if (error instanceof BookingNotFoundError) {
      return createBookingNotFoundResponse()
    }

    if (error instanceof CannotCancelBookingError) {
      return createCannotCancelResponse()
    }

    if (error instanceof z.ZodError) {
      console.error('Failed to parse booking cancellation data', bookingId, error)
      return NextResponse.json(
        buildErrorResponse({
          status: 500,
          title: 'Failed to parse booking data from database',
          detail: 'Booking data did not match the expected response schema.',
          type: '/invalid-response',
        }),
        { status: 500 }
      )
    }

    console.error(
      'Failed to cancel online booking',
      bookingId,
      error instanceof Error ? error : new Error(String(error))
    )

    return createInternalErrorResponse()
  }
}
