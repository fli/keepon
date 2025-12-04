import { NextRequest, NextResponse } from 'next/server'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import { buildErrorResponse } from '../../../_lib/accessToken'

export const runtime = 'nodejs'

const paramsSchema = z.object({
  bookingId: z
    .string()
    .trim()
    .min(1, 'Booking identifier must not be empty'),
})

const bookingSchema = z.object({
  iCalendarUrl: z.string().nullable(),
  location: z.string().nullable(),
  address: z.string().nullable(),
  geo: z
    .object({
      lat: z.number(),
      lng: z.number(),
    })
    .nullable(),
  googlePlaceId: z.string().nullable(),
  startTime: z.string(),
  endTime: z.string(),
  price: z.string().nullable(),
  paidAt: z.string().nullable(),
  refundedAt: z.string().nullable(),
  currency: z.string(),
  timezone: z.string(),
  serviceProviderPageUrlSlug: z.string(),
  name: z.string().nullable(),
  canClientsCancel: z.boolean(),
  cancellationAdvanceNoticeDuration: z.string(),
  state: z.enum([
    'maybe',
    'cancelled',
    'invited',
    'confirmed',
    'accepted',
    'declined',
  ]),
})

type BookingRow = z.infer<typeof bookingSchema>

type HandlerContext = { params: Promise<Record<string, string>> }

export async function GET(_request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues
      .map(issue => issue.message)
      .join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid booking identifier',
        detail:
          detail ||
          'Request parameters did not match the expected booking identifier schema.',
        type: '/invalid-parameter',
      }),
      { status: 400 }
    )
  }

  const { bookingId } = paramsResult.data

  try {
    const bookingResult = await sql<BookingRow>`
      SELECT
        client_session.booking_icalendar_url AS "iCalendarUrl",
        session.location,
        session.address,
        CASE
          WHEN session.geo IS NOT NULL THEN json_build_object('lat', session.geo[0], 'lng', session.geo[1])
          ELSE NULL
        END AS geo,
        session.google_place_id AS "googlePlaceId",
        to_json(session.start) AS "startTime",
        to_json(session.start + session.duration) AS "endTime",
        CASE
          WHEN session.booking_payment_type != 'hidePrice' THEN to_char(client_session.price, 'FMMI999999990.00')
          ELSE NULL
        END AS price,
        currency.alpha_code AS currency,
        session.timezone,
        trainer.online_bookings_page_url_slug AS "serviceProviderPageUrlSlug",
        session_series.name,
        session.can_clients_cancel AS "canClientsCancel",
        client_session.state,
        session.cancellation_advance_notice_duration::text AS "cancellationAdvanceNoticeDuration",
        to_json(payment.created_at) AS "paidAt",
        to_json(payment.refunded_time) AS "refundedAt"
      FROM client_session
      JOIN session ON session.id = client_session.session_id
      JOIN session_series ON session_series.id = session.session_series_id
      JOIN trainer ON trainer.id = session_series.trainer_id
      JOIN supported_country_currency ON supported_country_currency.country_id = trainer.country_id
      JOIN currency ON currency.id = supported_country_currency.currency_id
      LEFT JOIN sale ON sale.id = client_session.sale_id
      LEFT JOIN payment ON payment.sale_id = sale.id
      WHERE client_session.booking_id = ${bookingId}
    `.execute(db)

    const booking = bookingResult.rows[0]

    if (!booking) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Booking not found',
          detail: 'No booking matched the provided identifier.',
          type: '/resource-not-found',
        }),
        { status: 404 }
      )
    }

    const responseBody = bookingSchema.parse(booking)

    return NextResponse.json(responseBody)
  } catch (error) {
    if (error instanceof z.ZodError) {
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
      'Failed to fetch online booking by bookingId',
      bookingId,
      error
    )

    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Failed to fetch online booking',
        type: '/internal-server-error',
      }),
      { status: 500 }
    )
  }
}
