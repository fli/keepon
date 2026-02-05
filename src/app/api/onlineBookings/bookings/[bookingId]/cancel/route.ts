import type { NextRequest } from 'next/server'
import { sql } from 'kysely'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { enqueueWorkflowTask } from '@/server/workflow/outbox'
import { buildErrorResponse } from '../../../../_lib/accessToken'
import { APP_EMAIL, APP_NAME, NO_REPLY_EMAIL } from '../../../../_lib/constants'

const LEGACY_INVALID_JSON_MESSAGE = 'Unexpected token \'"\\", "#" is not valid JSON'

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
    .replaceAll(/&/g, '&amp;')
    .replaceAll(/</g, '&lt;')
    .replaceAll(/>/g, '&gt;')
    .replaceAll(/"/g, '&quot;')
    .replaceAll(/'/g, '&#39;')

const isAppleRelayEmail = (email: string) => email.toLowerCase().endsWith('@privaterelay.appleid.com')

const joinNames = (...parts: (string | null | undefined)[]) =>
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
      detail: detail ?? 'Request parameters did not match the expected booking identifier schema.',
      type: '/invalid-parameter',
    }),
    { status: 400 }
  )

const createLegacyInvalidJsonResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 400,
      title: LEGACY_INVALID_JSON_MESSAGE,
    }),
    { status: 400 }
  )

const createBookingNotFoundResponse = () =>
  NextResponse.json(
    buildErrorResponse({
      status: 404,
      title: 'Booking not found',
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

export async function POST(request: NextRequest, context: HandlerContext) {
  const rawBodyText = await request.text()
  if (rawBodyText.trim().length > 0) {
    try {
      const parsedBody = JSON.parse(rawBodyText)
      if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
        return createLegacyInvalidJsonResponse()
      }
    } catch {
      return createLegacyInvalidJsonResponse()
    }
  }

  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map((issue) => issue.message).join('; ')
    return createInvalidParamsResponse(detail)
  }

  const { bookingId } = paramsResult.data

  try {
    await db.transaction().execute(async (trx) => {
      const detailsRow = await trx
        .selectFrom('client_session')
        .innerJoin('session', 'session.id', 'client_session.session_id')
        .innerJoin('session_series', 'session_series.id', 'session.session_series_id')
        .innerJoin('client', 'client.id', 'client_session.client_id')
        .innerJoin('trainer', 'trainer.id', 'client_session.trainer_id')
        .select((eb) => [
          eb.ref('client.email').as('clientEmail'),
          eb.ref('trainer.online_bookings_business_name').as('onlineBookingsBusinessName'),
          eb.ref('trainer.business_name').as('businessName'),
          eb.ref('trainer.first_name').as('serviceProviderFirstName'),
          eb.ref('trainer.last_name').as('serviceProviderLastName'),
          eb.ref('trainer.email').as('serviceProviderEmail'),
          eb.ref('client.id').as('clientId'),
          eb.ref('trainer.id').as('trainerId'),
          eb.ref('trainer.user_id').as('trainerUserId'),
          eb.ref('client.first_name').as('clientFirstName'),
          eb.ref('client.last_name').as('clientLastName'),
          eb.ref('session_series.name').as('appointmentName'),
          eb.ref('session_series.event_type').as('eventType'),
          eb.ref('trainer.brand_color').as('brandColor'),
          eb.ref('trainer.business_logo_url').as('businessLogoUrl'),
          eb.ref('trainer.online_bookings_contact_email').as('onlineBookingsContactEmail'),
          eb.ref('trainer.online_bookings_show_contact_number').as('onlineBookingsShowContactNumber'),
          eb.ref('trainer.online_bookings_contact_number').as('onlineBookingsContactNumber'),
          eb.ref('trainer.phone_number').as('serviceProviderPhoneNumber'),
          eb.ref('session.timezone').as('timezone'),
          eb.ref('trainer.locale').as('locale'),
          eb.ref('session.start').as('startsAt'),
          eb
            .and([
              eb('session.can_clients_cancel', '=', true),
              eb(
                sql<Date>`session.start - ${sql.ref('session.cancellation_advance_notice_duration')}`,
                '>',
                sql<Date>`now()`
              ),
              eb('client_session.state', 'in', ['accepted', 'confirmed', 'maybe']),
            ])
            .as('canCancel'),
        ])
        .where('client_session.booking_id', '=', bookingId)
        .executeTakeFirst()
      if (!detailsRow) {
        throw new BookingNotFoundError()
      }

      const serviceProviderName =
        detailsRow.onlineBookingsBusinessName ??
        detailsRow.businessName ??
        joinNames(detailsRow.serviceProviderFirstName, detailsRow.serviceProviderLastName)

      const serviceProviderContactEmail = detailsRow.onlineBookingsContactEmail ?? detailsRow.serviceProviderEmail
      const serviceProviderContactNumber = detailsRow.onlineBookingsShowContactNumber
        ? (detailsRow.onlineBookingsContactNumber ?? detailsRow.serviceProviderPhoneNumber)
        : null

      const details = detailsSchema.parse({
        clientEmail: detailsRow.clientEmail,
        serviceProviderName: serviceProviderName || '',
        serviceProviderEmail: detailsRow.serviceProviderEmail,
        clientId: detailsRow.clientId,
        trainerId: detailsRow.trainerId,
        trainerUserId: detailsRow.trainerUserId,
        clientFirstName: detailsRow.clientFirstName,
        clientLastName: detailsRow.clientLastName,
        appointmentName: detailsRow.appointmentName,
        eventType: detailsRow.eventType,
        brandColor: detailsRow.brandColor,
        businessLogoUrl: detailsRow.businessLogoUrl,
        serviceProviderContactEmail,
        serviceProviderContactNumber,
        startsAt: detailsRow.startsAt,
        timezone: detailsRow.timezone,
        locale: detailsRow.locale,
        canCancel: Boolean(detailsRow.canCancel),
      })

      if (!details.canCancel) {
        throw new CannotCancelBookingError()
      }

      await trx.updateTable('client_session').set({ state: 'cancelled' }).where('booking_id', '=', bookingId).execute()

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

      const tasks: Promise<unknown>[] = []

      if (details.clientEmail) {
        const clientHtml = buildClientEmailHtml({
          serviceProviderName: details.serviceProviderName,
          appointmentName: details.appointmentName,
          formattedDate,
          contactDetails,
          brandColor: details.brandColor,
        })

        tasks.push(
          trx
            .insertInto('mail')
            .values({
              trainer_id: details.trainerId,
              client_id: details.clientId,
              from_email: NO_REPLY_EMAIL,
              from_name: `${details.serviceProviderName} via ${APP_NAME}`,
              to_email: details.clientEmail,
              to_name: details.clientFirstName ?? null,
              subject: clientSubject,
              html: clientHtml,
              reply_to: unreplyable ? null : details.serviceProviderEmail,
            })
            .execute()
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
        trx
          .insertInto('mail')
          .values({
            trainer_id: details.trainerId,
            client_id: details.clientId,
            from_email: APP_EMAIL,
            from_name: `${APP_NAME} Team`,
            to_email: details.serviceProviderEmail,
            to_name: null,
            subject: trainerSubject,
            html: trainerHtml,
            reply_to: null,
          })
          .execute()
      )

      const notificationPayload = {
        clientId: details.clientId,
        userId: details.trainerUserId,
        messageType: 'default' as const,
        notificationType: 'general' as const,
        title: 'Booking cancelled',
        body: `${clientName || 'A client'} has cancelled their booking${
          details.appointmentName ? ` for ${details.appointmentName}` : ''
        } on ${formattedDate}`,
      }

      tasks.push(
        enqueueWorkflowTask(trx, 'user.notify', notificationPayload, {
          dedupeKey: `user.notify:onlineBookingCancel:${bookingId}`,
        })
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
