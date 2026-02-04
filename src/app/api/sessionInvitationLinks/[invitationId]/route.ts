import type { Transaction } from 'kysely'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { validate as validateUuid } from 'uuid'
import { z } from 'zod'
import type { Database } from '@/lib/db'
import { db } from '@/lib/db'
import { enqueueWorkflowTask } from '@/server/workflow/outbox'
import { buildErrorResponse } from '../../_lib/accessToken'
import { nullableNumber } from '../../_lib/clientSessionsSchema'
import { APP_EMAIL, APP_NAME, NO_REPLY_EMAIL } from '../../_lib/constants'

const querySchema = z.object({
  action: z.enum(['accept', 'decline'] as const),
})

const nullableCount = z.union([z.number(), z.string(), z.null()]).transform((value) => {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Invalid numeric value')
    }
    return value
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) {
    throw new Error('Invalid numeric value')
  }
  return parsed
})

const invitationRowSchema = z.object({
  invitationState: z.enum(['invited', 'declined', 'accepted', 'expired'] as const),
  clientId: z.string().uuid(),
  sessionId: z.string().uuid(),
  trainerId: z.string().uuid(),
  trainerUserId: z.string(),
  clientFirstName: z.string(),
  clientLastName: z.string().nullable(),
  clientEmail: z.string().email().nullable(),
  serviceProviderEmail: z.string().email(),
  publicEmail: z.string().email(),
  serviceProviderFirstName: z.string(),
  serviceProviderLastName: z.string().nullable(),
  serviceProviderName: z.string(),
  sessionName: z.string().nullable(),
  location: z.string().nullable(),
  start: z.coerce.date(),
  end: z.coerce.date(),
  timezone: z.string(),
  locale: z.string(),
  maximumAttendance: nullableCount,
  price: nullableNumber,
  currency: z.string().length(3).nullable(),
})

type InvitationRow = z.infer<typeof invitationRowSchema>

type HandlerContext = { params: Promise<Record<string, string>> }

type OutcomeType = 'accepted' | 'declined' | 'expired' | 'full' | 'not-found'

type InvitationDetails = InvitationRow & {
  dateRange: string
  priceText: string | null
  clientFullName: string
  eventName: string
}

const normalizeUpdatedCount = (value: unknown) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value === 'bigint') {
    return Number(value)
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

const escapeHtml = (value: string) =>
  value
    .replaceAll(/&/g, '&amp;')
    .replaceAll(/</g, '&lt;')
    .replaceAll(/>/g, '&gt;')
    .replaceAll(/"/g, '&quot;')
    .replaceAll(/'/g, '&#39;')

const joinNames = (...parts: (string | null | undefined)[]) =>
  parts
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ')

const formatEventPrice = (price: number | null, locale: string, currency?: string | null) => {
  if (price === null) {
    return null
  }
  if (price === 0) {
    return 'Free'
  }

  if (currency) {
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(price)
    } catch (error) {
      console.warn('Failed to format price with currency', { price, locale, currency, error })
    }
  }

  return new Intl.NumberFormat(locale).format(price)
}

const formatDateRange = (start: Date, end: Date, locale: string, timeZone: string) => {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'long', timeZone }).formatRange(start, end)
  } catch (error) {
    console.warn('Failed to format date range, falling back to ISO strings', { start, end, locale, timeZone, error })
    return `${start.toISOString()} – ${end.toISOString()}`
  }
}

const successHtml = ({
  eventName,
  price,
  location,
  serviceProviderFullName,
  dateRangeString,
}: {
  eventName: string | null
  dateRangeString: string
  serviceProviderFullName: string
  location: string | null
  price: string | null
}) => `<link
    href="https://unpkg.com/tailwindcss@^1.4.6/dist/tailwind.min.css"
    rel="stylesheet"
  />
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>You're all booked in!</title>
  <div class="bg-gray-200">
    <div
      class="flex justify-center items-center max-w-screen-xl h-screen mx-auto text-center py-12 px-12 lg:py-16"
    >
      <div class="bg-white p-12 rounded-lg shadow-2xl">
        <div class="text-left">
          <p
            class="mb-4 text-base leading-6 text-blue-600 font-semibold tracking-wide uppercase"
          >
            Success!
          </p>
          <h3
            class=" mb-8 mt-2 text-3xl leading-8 font-heavy tracking-tight text-gray-900 sm:text-4xl sm:leading-10"
          >
            You're booked.
          </h3>
          <p
            className="mt-4 max-w-2xl text-xl leading-8 text-gray-600 lg:mx-auto"
          >
           ${eventName ? `<span className="text-gray-900 text-2xl font-bold">${eventName}</span>` : ''}
            <br />
            ${escapeHtml(dateRangeString)}${price === null ? '' : `, ${escapeHtml(price)}`}<br />
            ${location ? `at : <span>${escapeHtml(location)}</span> <br />` : ''} With :
            <span>${escapeHtml(serviceProviderFullName)}</span>
          </p>
          <p class="mt-4 max-w-2xl text-xl leading-8 text-gray-600 lg:mx-auto">
            We're looking forward to seeing you!
          </p>
        </div>
      </div>
    </div>
  </div>`

const declineHtml = `<link
    href="https://unpkg.com/tailwindcss@^1.4.6/dist/tailwind.min.css"
    rel="stylesheet"
  />
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>We've marked you as not going</title>
  <div class="bg-gray-200">
    <div
      class="flex justify-center items-center max-w-screen-xl h-screen mx-auto text-center py-12 px-12 lg:py-16"
    >
      <div class="bg-white p-12 rounded-lg shadow-2xl">
        <div class="text-left">
          <p
            class="mb-4 text-base leading-6 text-blue-600 font-semibold tracking-wide uppercase"
          >
            No worries.
          </p>
          <h3
            class=" mb-8 mt-2 text-3xl leading-8 font-heavy tracking-tight text-gray-900 sm:text-4xl sm:leading-10"
          >
            We'll see you at the next one...
          </h3>
          <p class="mt-4 max-w-2xl text-xl leading-8 text-gray-600 lg:mx-auto">
            Don't hesitate to reach out if you change your mind and we’ll
            hopefully see you at the next one.
          </p>
        </div>
      </div>
    </div>
  </div>`

const maxReachedHtml = ({
  maximumAttendance,
  serviceProviderEmail,
}: {
  maximumAttendance: number
  serviceProviderEmail: string
}) => `
  <link
    href="https://unpkg.com/tailwindcss@^1.4.6/dist/tailwind.min.css"
    rel="stylesheet"
  />
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>This appointment is full</title>
  <div class="bg-gray-200">
    <div
      class="flex justify-center items-center max-w-screen-xl h-screen mx-auto text-center py-12 px-12 lg:py-16"
    >
      <div class="bg-white p-12 rounded-lg shadow-2xl">
        <div class="text-left">
          <p
            class="mb-4 text-base leading-6 text-red-600 font-semibold tracking-wide uppercase"
          >
            We couldn't book you in sorry.
          </p>
          <h3
            class=" mb-8 mt-2 text-3xl leading-8 font-heavy tracking-tight text-gray-900 sm:text-4xl sm:leading-10"
          >
            We've reached max capacity
          </h3>
          <p class="mt-4 max-w-2xl text-xl leading-8 text-gray-600 lg:mx-auto">
            Unfortunately we couldn’t reserve your spot as the max number of
            ${maximumAttendance} client${maximumAttendance === 1 ? '' : 's'} has
            been reached. Please contact us to see if there are any
            cancellations or if you have any questions.
            <br />
          </p>
          <div class="mt-8 flex justify-left">
            <div class="inline-flex rounded-md shadow">
              <a
                href="mailto:${serviceProviderEmail}"
                class="inline-flex items-center justify-center px-5 py-3 border border-transparent text-lg leading-6 font-medium rounded-md text-white bg-blue-500 hover:bg-blue-900 focus:outline-none focus:shadow-outline transition duration-150 ease-in-out"
              >
                Contact us
              </a>
            </div>
            <div class="ml-3 inline-flex"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
`

const eventNotFoundHtml = `
<link href="https://unpkg.com/tailwindcss@^1.4.6/dist/tailwind.min.css" rel="stylesheet">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Event not found</title>
<div class="bg-gray-200">
  <div class="flex justify-center items-center max-w-screen-xl h-screen mx-auto text-center py-12 px-12 lg:py-16">
    <div class="bg-white p-12 rounded-lg shadow-2xl">
      <div class="text-left">
        <p class="mb-4 text-base leading-6 text-red-600 font-semibold tracking-wide uppercase">
          Can't find this event.
        </p>
        <h3 class=" mb-8 mt-2 text-3xl leading-8 font-heavy tracking-tight text-gray-900 sm:text-4xl sm:leading-10">
          Looks like this event has been removed.
        </h3>
        <p class="mt-4 max-w-2xl text-xl leading-8 text-gray-600 lg:mx-auto">
          Don't hesitate to reach out if you think this is a mistake.
        </p>
      </div>
    </div>
  </div>
</div>
`

const invitationExpiredHtml = ({ serviceProviderEmail }: { serviceProviderEmail: string }) => `
<link href="https://unpkg.com/tailwindcss@^1.4.6/dist/tailwind.min.css" rel="stylesheet">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>This invitation has expired</title>
<div class="bg-gray-200">
  <div class="flex justify-center items-center max-w-screen-xl h-screen mx-auto text-center py-12 px-12 lg:py-16">
    <div class="bg-white p-12 rounded-lg shadow-2xl">
      <div class="text-left">
        <p class="mb-4 text-base leading-6 text-red-600 font-semibold tracking-wide uppercase">
          This invitation has expired
        </p>
        <p class="mt-4 max-w-2xl text-xl leading-8 text-gray-600 lg:mx-auto">
          Don't hesitate to reach out if you think this is a mistake.
        </p>
        <div class="mt-8 flex justify-left">
          <div class="inline-flex rounded-md shadow">
          <a href="mailto:${serviceProviderEmail}"
              class="inline-flex items-center justify-center px-5 py-3 border border-transparent text-lg leading-6 font-medium rounded-md text-white bg-blue-500 hover:bg-blue-900 focus:outline-none focus:shadow-outline transition duration-150 ease-in-out">
              Contact us
            </a>
          </div>
          <div class="ml-3 inline-flex"></div>
        </div>
      </div>

    </div>
  </div>
</div>
`

const buildTrainerAcceptEmail = (details: InvitationDetails) => `
<!doctype html>
<html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;">
    <h2 style="margin:0 0 8px 0;font-size:20px;">${escapeHtml(details.clientFullName)} accepted your invitation</h2>
    <p style="margin:0 0 12px 0;">${escapeHtml(details.eventName)}<br />${escapeHtml(details.dateRange)}</p>
    ${details.location ? `<p style="margin:0 0 12px 0;">Location: ${escapeHtml(details.location)}</p>` : ''}
    ${details.priceText ? `<p style="margin:0 0 12px 0;">Price: ${escapeHtml(details.priceText)}</p>` : ''}
    <p style="margin:0;">${APP_NAME}</p>
  </body>
</html>
`

const buildClientAcceptEmail = (details: InvitationDetails) => `
<!doctype html>
<html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;">
    <h2 style="margin:0 0 10px 0;font-size:20px;">You're booked in!</h2>
    <p style="margin:0 0 12px 0;">${escapeHtml(details.eventName)} with ${escapeHtml(details.serviceProviderName)}</p>
    <p style="margin:0 0 12px 0;">${escapeHtml(details.dateRange)}</p>
    ${details.location ? `<p style="margin:0 0 12px 0;">Location: ${escapeHtml(details.location)}</p>` : ''}
    ${details.priceText ? `<p style="margin:0;">Price: ${escapeHtml(details.priceText)}</p>` : ''}
  </body>
</html>
`

const buildTrainerDeclineEmail = (details: InvitationDetails) => `
<!doctype html>
<html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;">
    <h2 style="margin:0 0 8px 0;font-size:20px;">${escapeHtml(details.clientFullName)} declined your invitation</h2>
    <p style="margin:0 0 12px 0;">${escapeHtml(details.eventName)}<br />${escapeHtml(details.dateRange)}</p>
    <p style="margin:0;">${APP_NAME}</p>
  </body>
</html>
`

const buildCapacityReachedEmail = (details: InvitationDetails, maximumAttendance: number) => `
<!doctype html>
<html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;">
    <h2 style="margin:0 0 8px 0;font-size:20px;">${escapeHtml(details.clientFullName)} tried to accept an invitation</h2>
    <p style="margin:0 0 12px 0;">${escapeHtml(details.eventName)}<br />${escapeHtml(details.dateRange)}</p>
    <p style="margin:0 0 12px 0;">The appointment is already at its limit of ${maximumAttendance} attendee${
      maximumAttendance === 1 ? '' : 's'
    }.</p>
    <p style="margin:0;">${APP_NAME}</p>
  </body>
</html>
`

type DbTransaction = Transaction<Database>

const sendTrainerNotification = async (
  trx: DbTransaction,
  details: InvitationDetails,
  payload: { title: string; body: string; messageType: 'success' | 'failure' | 'default' }
) => {
  if (!details.trainerUserId) {
    return
  }

  const notificationPayload = {
    clientId: details.clientId,
    userId: details.trainerUserId,
    messageType: payload.messageType,
    notificationType: 'general' as const,
    title: payload.title,
    body: payload.body,
  }

  await enqueueWorkflowTask(trx, 'user.notify', notificationPayload, {
    dedupeKey: `user.notify:sessionInvitation:${details.sessionId}:${details.clientId}:${payload.messageType}`,
  })
}

const sendAcceptSideEffects = async (trx: DbTransaction, details: InvitationDetails) => {
  const tasks: Promise<unknown>[] = []

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
        subject: `${details.clientFullName} accepted your invitation to ${details.eventName} @ ${details.dateRange}`,
        html: buildTrainerAcceptEmail(details),
        reply_to: null,
      })
      .execute()
  )

  if (details.clientEmail) {
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
          subject: `You're booked in for ${details.eventName}`,
          html: buildClientAcceptEmail(details),
          reply_to: details.serviceProviderEmail,
        })
        .execute()
    )
  }

  tasks.push(
    sendTrainerNotification(trx, details, {
      title: 'Invitation accepted',
      body: `${details.clientFullName} accepted your invitation for: ${details.eventName} @ ${details.dateRange}`,
      messageType: 'success',
    })
  )

  await Promise.all(tasks)
}

const sendDeclineSideEffects = async (trx: DbTransaction, details: InvitationDetails) => {
  const tasks: Promise<unknown>[] = []

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
        subject: `${details.clientFullName} declined your invitation to ${details.eventName} @ ${details.dateRange}`,
        html: buildTrainerDeclineEmail(details),
        reply_to: null,
      })
      .execute()
  )

  tasks.push(
    sendTrainerNotification(trx, details, {
      title: 'Invitation declined',
      body: `${details.clientFullName} declined your invitation for: ${details.eventName} @ ${details.dateRange}`,
      messageType: 'failure',
    })
  )

  await Promise.all(tasks)
}

const sendCapacityReachedSideEffects = async (
  trx: DbTransaction,
  details: InvitationDetails,
  maximumAttendance: number
) => {
  await trx
    .insertInto('mail')
    .values({
      trainer_id: details.trainerId,
      client_id: details.clientId,
      from_email: APP_EMAIL,
      from_name: `${APP_NAME} Team`,
      to_email: details.serviceProviderEmail,
      to_name: null,
      subject: `${details.clientFullName} tried to accept an invitation but the appointment was full`,
      html: buildCapacityReachedEmail(details, maximumAttendance),
      reply_to: null,
    })
    .execute()
}

const badRequestResponse = (_message: string) =>
  new NextResponse(eventNotFoundHtml, {
    status: 400,
    headers: { 'Content-Type': 'text/html' },
  })

export async function GET(request: NextRequest, context: HandlerContext) {
  const { invitationId } = await context.params
  if (!validateUuid(invitationId)) {
    return NextResponse.json(
      buildErrorResponse({
        status: 500,
        title: 'Something on our end went wrong.',
      }),
      { status: 500 }
    )
  }

  const url = new URL(request.url)
  const queryResult = querySchema.safeParse({ action: url.searchParams.get('action') })
  if (!queryResult.success) {
    const detail = queryResult.error.issues.map((issue) => issue.message).join('; ')
    return badRequestResponse(detail || 'Action must be either accept or decline.')
  }

  const { action } = queryResult.data

  try {
    const outcome = await db.transaction().execute(async (trx) => {
      const now = new Date()
      const row = await trx
        .selectFrom('client_session')
        .innerJoin('session', 'session.id', 'client_session.session_id')
        .innerJoin('session_series', 'session_series.id', 'session.session_series_id')
        .innerJoin('trainer', 'trainer.id', 'client_session.trainer_id')
        .innerJoin('country', 'country.id', 'trainer.country_id')
        .leftJoin('supported_country_currency as scc', 'scc.country_id', 'trainer.country_id')
        .leftJoin('currency', 'currency.id', 'scc.currency_id')
        .innerJoin('client', 'client.id', 'client_session.client_id')
        .select((eb) => [
          eb.ref('client_session.state').as('invitationStateRaw'),
          eb.ref('client_session.client_id').as('clientId'),
          eb.ref('client_session.session_id').as('sessionId'),
          eb.ref('client_session.trainer_id').as('trainerId'),
          eb.ref('trainer.user_id').as('trainerUserId'),
          eb.ref('client.first_name').as('clientFirstName'),
          eb.ref('client.last_name').as('clientLastName'),
          eb.ref('client.email').as('clientEmail'),
          eb.ref('trainer.email').as('serviceProviderEmail'),
          eb
            .fn('coalesce', [eb.ref('trainer.online_bookings_contact_email'), eb.ref('trainer.email')])
            .as('publicEmail'),
          eb.ref('trainer.first_name').as('serviceProviderFirstName'),
          eb.ref('trainer.last_name').as('serviceProviderLastName'),
          eb.ref('trainer.online_bookings_business_name').as('onlineBookingsBusinessName'),
          eb.ref('trainer.business_name').as('businessName'),
          eb.ref('session_series.name').as('sessionSeriesName'),
          eb.ref('session_series.location').as('location'),
          eb.ref('session.start').as('start'),
          eb(eb.ref('session.start'), '+', eb.ref('session.duration')).as('end'),
          eb.ref('trainer.timezone').as('timezone'),
          eb.ref('trainer.locale').as('locale'),
          eb.ref('session.maximum_attendance').as('maximumAttendance'),
          eb.ref('session_series.price').as('price'),
          eb.ref('currency.alpha_code').as('currency'),
        ])
        .where('client_session.id', '=', invitationId)
        .where('client_session.state', 'in', ['invited', 'declined', 'accepted'])
        .forNoKeyUpdate()
        .executeTakeFirst()
      if (!row) {
        return { type: 'not-found' as OutcomeType }
      }

      const startDate = row.start instanceof Date ? row.start : new Date(row.start)
      const invitationState = startDate.getTime() < now.getTime() ? 'expired' : row.invitationStateRaw
      const serviceProviderName =
        row.onlineBookingsBusinessName ??
        row.businessName ??
        `${row.serviceProviderFirstName}${row.serviceProviderLastName ? ` ${row.serviceProviderLastName}` : ''}`

      const parsed = invitationRowSchema.parse({
        invitationState,
        clientId: row.clientId,
        sessionId: row.sessionId,
        trainerId: row.trainerId,
        trainerUserId: row.trainerUserId,
        clientFirstName: row.clientFirstName,
        clientLastName: row.clientLastName,
        clientEmail: row.clientEmail,
        serviceProviderEmail: row.serviceProviderEmail,
        publicEmail: row.publicEmail,
        serviceProviderFirstName: row.serviceProviderFirstName,
        serviceProviderLastName: row.serviceProviderLastName,
        serviceProviderName,
        sessionName: row.sessionSeriesName ?? 'Group Appointment',
        location: row.location,
        start: row.start,
        end: row.end,
        timezone: row.timezone,
        locale: row.locale,
        maximumAttendance: row.maximumAttendance,
        price: row.price,
        currency: row.currency,
      })

      const details: InvitationDetails = {
        ...parsed,
        dateRange: formatDateRange(parsed.start, parsed.end, parsed.locale, parsed.timezone),
        priceText: formatEventPrice(parsed.price, parsed.locale, parsed.currency),
        clientFullName: joinNames(parsed.clientFirstName, parsed.clientLastName) || 'A client',
        eventName: parsed.sessionName ?? 'Untitled session',
      }

      if (parsed.invitationState === 'expired') {
        return { type: 'expired' as OutcomeType, details }
      }

      if (action === 'accept') {
        if (parsed.invitationState !== 'accepted') {
          let sessionIsFull = false

          if (typeof parsed.maximumAttendance === 'number') {
            const countRow = await trx
              .selectFrom('client_session')
              .select((eb) => eb.fn.countAll<number>().as('count'))
              .where('session_id', '=', parsed.sessionId)
              .where('state', 'in', ['accepted', 'confirmed'])
              .where('id', '<>', invitationId)
              .executeTakeFirst()

            const acceptedCount = Number(countRow?.count ?? 0)
            sessionIsFull = acceptedCount >= parsed.maximumAttendance
          }

          if (sessionIsFull && typeof parsed.maximumAttendance === 'number') {
            await sendCapacityReachedSideEffects(trx, details, parsed.maximumAttendance)
            return { type: 'full' as OutcomeType, details }
          }

          const updateResult = await trx
            .updateTable('client_session')
            .set({
              state: 'accepted',
              accept_time: new Date(),
              decline_time: null,
            })
            .where('id', '=', invitationId)
            .executeTakeFirst()

          if (normalizeUpdatedCount(updateResult?.numUpdatedRows) === 0) {
            return { type: 'not-found' as OutcomeType }
          }

          await sendAcceptSideEffects(trx, details)
        }

        return { type: 'accepted' as OutcomeType, details }
      }

      if (parsed.invitationState !== 'declined') {
        const updateResult = await trx
          .updateTable('client_session')
          .set({
            state: 'declined',
            decline_time: new Date(),
          })
          .where('id', '=', invitationId)
          .executeTakeFirst()

        if (normalizeUpdatedCount(updateResult?.numUpdatedRows) === 0) {
          return { type: 'not-found' as OutcomeType }
        }

        await sendDeclineSideEffects(trx, details)
      }

      return { type: 'declined' as OutcomeType, details }
    })

    if (outcome.type === 'not-found') {
      return new NextResponse(eventNotFoundHtml, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    }

    const details = 'details' in outcome ? outcome.details : undefined

    if (outcome.type === 'expired') {
      return new NextResponse(invitationExpiredHtml({ serviceProviderEmail: details!.serviceProviderEmail }), {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    }

    if (outcome.type === 'full') {
      return new NextResponse(
        maxReachedHtml({
          maximumAttendance: details!.maximumAttendance ?? 0,
          serviceProviderEmail: details!.serviceProviderEmail,
        }),
        { status: 200, headers: { 'Content-Type': 'text/html' } }
      )
    }

    if (outcome.type === 'declined') {
      return new NextResponse(declineHtml, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    }

    return new NextResponse(
      successHtml({
        eventName: details!.eventName,
        dateRangeString: details!.dateRange,
        location: details!.location,
        price: details!.priceText,
        serviceProviderFullName: details!.serviceProviderName,
      }),
      { status: 200, headers: { 'Content-Type': 'text/html' } }
    )
  } catch (error) {
    console.error('Failed to handle session invitation link', { invitationId, action, error })
    return new NextResponse(eventNotFoundHtml, {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    })
  }
}
