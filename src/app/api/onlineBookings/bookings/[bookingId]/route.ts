import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { buildErrorResponse } from '../../../_lib/accessToken'

const paramsSchema = z.object({
  bookingId: z.string().trim().min(1, 'Booking identifier must not be empty'),
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
  state: z.enum(['maybe', 'cancelled', 'invited', 'confirmed', 'accepted', 'declined']),
})

type BookingRow = z.infer<typeof bookingSchema>

type HandlerContext = { params: Promise<Record<string, string>> }

export async function GET(_request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)

  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map((issue) => issue.message).join('; ')

    return NextResponse.json(
      buildErrorResponse({
        status: 400,
        title: 'Invalid booking identifier',
        detail: detail || 'Request parameters did not match the expected booking identifier schema.',
        type: '/invalid-parameter',
      }),
      { status: 400 }
    )
  }

  const { bookingId } = paramsResult.data

  try {
    const bookingRow = await db
      .selectFrom('client_session')
      .innerJoin('session', 'session.id', 'client_session.session_id')
      .innerJoin('session_series', 'session_series.id', 'session.session_series_id')
      .innerJoin('trainer', 'trainer.id', 'session_series.trainer_id')
      .innerJoin('supported_country_currency', 'supported_country_currency.country_id', 'trainer.country_id')
      .innerJoin('currency', 'currency.id', 'supported_country_currency.currency_id')
      .leftJoin('sale', 'sale.id', 'client_session.sale_id')
      .leftJoin('payment', 'payment.sale_id', 'sale.id')
      .select((eb) => [
        eb.ref('client_session.booking_icalendar_url').as('iCalendarUrl'),
        eb.ref('session.location').as('location'),
        eb.ref('session.address').as('address'),
        eb.ref('session.geo').as('geo'),
        eb.ref('session.google_place_id').as('googlePlaceId'),
        eb.ref('session.start').as('startTime'),
        eb(eb.ref('session.start'), '+', eb.ref('session.duration')).as('endTime'),
        eb.ref('client_session.price').as('price'),
        eb.ref('session.booking_payment_type').as('bookingPaymentType'),
        eb.ref('currency.alpha_code').as('currency'),
        eb.ref('session.timezone').as('timezone'),
        eb.ref('trainer.online_bookings_page_url_slug').as('serviceProviderPageUrlSlug'),
        eb.ref('session_series.name').as('name'),
        eb.ref('session.can_clients_cancel').as('canClientsCancel'),
        eb.ref('client_session.state').as('state'),
        eb.ref('session.cancellation_advance_notice_duration').as('cancellationAdvanceNoticeDuration'),
        eb.ref('payment.created_at').as('paidAt'),
        eb.ref('payment.refunded_time').as('refundedAt'),
      ])
      .where('client_session.booking_id', '=', bookingId)
      .executeTakeFirst()

    const booking = bookingRow
      ? {
          iCalendarUrl: bookingRow.iCalendarUrl,
          location: bookingRow.location,
          address: bookingRow.address,
          geo: bookingRow.geo ? { lat: bookingRow.geo.x, lng: bookingRow.geo.y } : null,
          googlePlaceId: bookingRow.googlePlaceId,
          startTime: new Date(bookingRow.startTime).toISOString(),
          endTime: new Date(bookingRow.endTime).toISOString(),
          price:
            bookingRow.bookingPaymentType !== 'hidePrice' && bookingRow.price !== null
              ? Number(bookingRow.price).toFixed(2)
              : null,
          paidAt: bookingRow.paidAt ? new Date(bookingRow.paidAt).toISOString() : null,
          refundedAt: bookingRow.refundedAt ? new Date(bookingRow.refundedAt).toISOString() : null,
          currency: bookingRow.currency,
          timezone: bookingRow.timezone,
          serviceProviderPageUrlSlug: bookingRow.serviceProviderPageUrlSlug,
          name: bookingRow.name,
          canClientsCancel: bookingRow.canClientsCancel,
          cancellationAdvanceNoticeDuration:
            typeof bookingRow.cancellationAdvanceNoticeDuration === 'string'
              ? bookingRow.cancellationAdvanceNoticeDuration
              : '',
          state: bookingRow.state,
        }
      : null

    if (!booking) {
      return NextResponse.json(
        buildErrorResponse({
          status: 404,
          title: 'Booking not found.',
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

    console.error('Failed to fetch online booking by bookingId', bookingId, error)

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
