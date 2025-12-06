import { NextRequest, NextResponse } from 'next/server'
import { db, sql } from '@/lib/db'
import { z } from 'zod'
import { APP_EMAIL, APP_NAME, NO_REPLY_EMAIL } from '../../_lib/constants'
import { nullableNumber } from '../../_lib/clientSessionsSchema'
import type { Transaction } from 'kysely'
import type { Database } from '@/lib/db'

const paramsSchema = z.object({
  invitationId: z
    .string()
    .trim()
    .min(1, 'Invitation id must not be empty.')
    .uuid({ message: 'Invitation id must be a valid UUID.' }),
})

const querySchema = z.object({
  action: z.enum(['accept', 'decline'] as const),
})

const nullableCount = z.union([z.number(), z.string(), z.null()]).transform((value) => {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Invalid numeric value')
    return value
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) throw new Error('Invalid numeric value')
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
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const joinNames = (...parts: Array<string | null | undefined>) =>
  parts
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ')

const formatEventPrice = (price: number | null, locale: string, currency?: string | null) => {
  if (price === null) return null
  if (price === 0) return 'Free'

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

const renderPage = (options: {
  badge: string
  headline: string
  message: string
  details?: InvitationDetails
  statusColor?: string
}) => {
  const { badge, headline, message, details, statusColor = '#2563eb' } = options

  const eventRows = details
    ? [
        { label: 'Appointment', value: details.eventName },
        { label: 'When', value: details.dateRange },
        details.location ? { label: 'Where', value: details.location } : null,
        details.priceText ? { label: 'Price', value: details.priceText } : null,
        { label: 'With', value: details.serviceProviderName },
      ].filter(Boolean)
    : []

  const contactLine =
    details && details.publicEmail
      ? `<p style="margin:16px 0 0 0;color:#4b5563;font-size:14px;">Need help? <a href="mailto:${details.publicEmail}" style="color:${statusColor};text-decoration:none;">Email ${escapeHtml(details.serviceProviderName)}</a></p>`
      : ''

  const rowsHtml = eventRows
    .map(
      (row) => `
        <div style="display:flex;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px;background:#f9fafb;">
          <span style="font-weight:600;color:#111827;font-size:14px;">${escapeHtml(row!.label)}</span>
          <span style="color:#111827;font-size:14px;text-align:right;max-width:65%;">${escapeHtml(row!.value ?? '')}</span>
        </div>`
    )
    .join('')

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(headline)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;">
      <div style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;padding:28px 24px;box-shadow:0 20px 60px rgba(15,23,42,0.12);border:1px solid #e5e7eb;">
        <div style="display:inline-flex;padding:6px 12px;border-radius:999px;background:${statusColor}1A;color:${statusColor};font-weight:700;font-size:12px;letter-spacing:0.02em;text-transform:uppercase;">${escapeHtml(
          badge
        )}</div>
        <h1 style="margin:16px 0 8px 0;font-size:26px;font-weight:800;color:#0f172a;">${escapeHtml(headline)}</h1>
        <p style="margin:0 0 18px 0;color:#1f2937;font-size:16px;line-height:1.55;">${escapeHtml(message)}</p>
        ${rowsHtml ? `<div style="display:flex;flex-direction:column;gap:10px;margin-top:14px;">${rowsHtml}</div>` : ''}
        ${contactLine}
      </div>
    </div>
  </body>
</html>`
}

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
  if (!details.trainerUserId) return

  const notificationPayload = {
    clientId: details.clientId,
    userId: details.trainerUserId,
    messageType: payload.messageType,
    notificationType: 'general',
    title: payload.title,
    body: payload.body,
  }

  await sql`
    INSERT INTO task_queue (task_type, data)
    VALUES ('user.notify', ${JSON.stringify(notificationPayload)}::jsonb)
  `.execute(trx)
}

const sendAcceptSideEffects = async (trx: DbTransaction, details: InvitationDetails) => {
  const tasks: Array<Promise<unknown>> = []

  tasks.push(
    sql`
      INSERT INTO mail (trainer_id, client_id, from_email, from_name, to_email, to_name, subject, html, reply_to)
      VALUES (
        ${details.trainerId},
        ${details.clientId},
        ${APP_EMAIL},
        ${`${APP_NAME} Team`},
        ${details.serviceProviderEmail},
        NULL,
        ${`${details.clientFullName} accepted your invitation to ${details.eventName} @ ${details.dateRange}`},
        ${buildTrainerAcceptEmail(details)},
        NULL
      )
    `.execute(trx)
  )

  if (details.clientEmail) {
    tasks.push(
      sql`
        INSERT INTO mail (trainer_id, client_id, from_email, from_name, to_email, to_name, subject, html, reply_to)
        VALUES (
          ${details.trainerId},
          ${details.clientId},
          ${NO_REPLY_EMAIL},
          ${`${details.serviceProviderName} via ${APP_NAME}`},
          ${details.clientEmail},
          ${details.clientFirstName ?? null},
          ${`You're booked in for ${details.eventName}`},
          ${buildClientAcceptEmail(details)},
          ${details.serviceProviderEmail}
        )
      `.execute(trx)
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
  const tasks: Array<Promise<unknown>> = []

  tasks.push(
    sql`
      INSERT INTO mail (trainer_id, client_id, from_email, from_name, to_email, to_name, subject, html, reply_to)
      VALUES (
        ${details.trainerId},
        ${details.clientId},
        ${APP_EMAIL},
        ${`${APP_NAME} Team`},
        ${details.serviceProviderEmail},
        NULL,
        ${`${details.clientFullName} declined your invitation to ${details.eventName} @ ${details.dateRange}`},
        ${buildTrainerDeclineEmail(details)},
        NULL
      )
    `.execute(trx)
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

const sendCapacityReachedSideEffects = async (trx: DbTransaction, details: InvitationDetails, maximumAttendance: number) => {
  await sql`
    INSERT INTO mail (trainer_id, client_id, from_email, from_name, to_email, to_name, subject, html, reply_to)
    VALUES (
      ${details.trainerId},
      ${details.clientId},
      ${APP_EMAIL},
      ${`${APP_NAME} Team`},
      ${details.serviceProviderEmail},
      NULL,
      ${`${details.clientFullName} tried to accept an invitation but the appointment was full`},
      ${buildCapacityReachedEmail(details, maximumAttendance)},
      NULL
    )
  `.execute(trx)
}

const badRequestResponse = (message: string) =>
  new NextResponse(
    renderPage({
      badge: 'Invalid Link',
      headline: 'We could not process this invitation',
      message,
      statusColor: '#dc2626',
    }),
    { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )

export async function GET(request: NextRequest, context: HandlerContext) {
  const paramsResult = paramsSchema.safeParse(await context.params)
  if (!paramsResult.success) {
    const detail = paramsResult.error.issues.map((issue) => issue.message).join('; ')
    return badRequestResponse(detail || 'Invitation identifier was invalid.')
  }

  const url = new URL(request.url)
  const queryResult = querySchema.safeParse({ action: url.searchParams.get('action') })
  if (!queryResult.success) {
    const detail = queryResult.error.issues.map((issue) => issue.message).join('; ')
    return badRequestResponse(detail || 'Action must be either accept or decline.')
  }

  const { invitationId } = paramsResult.data
  const { action } = queryResult.data

  try {
    const outcome = await db.transaction().execute(async (trx) => {
      const result = await sql<InvitationRow>`
        SELECT
          CASE WHEN session.start < NOW() THEN 'expired' ELSE client_session.state END AS "invitationState",
          client_session.client_id AS "clientId",
          client_session.session_id AS "sessionId",
          client_session.trainer_id AS "trainerId",
          trainer.user_id AS "trainerUserId",
          client.first_name AS "clientFirstName",
          client.last_name AS "clientLastName",
          client.email AS "clientEmail",
          trainer.email AS "serviceProviderEmail",
          COALESCE(trainer.online_bookings_contact_email, trainer.email) AS "publicEmail",
          trainer.first_name AS "serviceProviderFirstName",
          trainer.last_name AS "serviceProviderLastName",
          COALESCE(trainer.online_bookings_business_name, trainer.business_name, trainer.first_name || COALESCE(' ' || trainer.last_name, '')) AS "serviceProviderName",
          session_series.name AS "sessionName",
          COALESCE(session_series.location, session.location) AS "location",
          session.start AS "start",
          session.start + session.duration AS "end",
          session.timezone AS "timezone",
          trainer.locale AS "locale",
          session.maximum_attendance AS "maximumAttendance",
          session_series.price AS price,
          currency.alpha_code AS currency
        FROM client_session
        INNER JOIN session ON session.id = client_session.session_id
        INNER JOIN session_series ON session_series.id = session.session_series_id
        INNER JOIN trainer ON trainer.id = client_session.trainer_id
        INNER JOIN country ON country.id = trainer.country_id
        LEFT JOIN supported_country_currency scc ON scc.country_id = trainer.country_id
        LEFT JOIN currency ON currency.id = scc.currency_id
        INNER JOIN client ON client.id = client_session.client_id
       WHERE client_session.id = ${invitationId}
         AND client_session.state IN ('invited', 'declined', 'accepted')
       FOR NO KEY UPDATE
      `.execute(trx)

      const row = result.rows[0]
      if (!row) {
        return { type: 'not-found' as OutcomeType }
      }

      const parsed = invitationRowSchema.parse(row)

      const details: InvitationDetails = {
        ...parsed,
        dateRange: formatDateRange(parsed.start, parsed.end, parsed.locale, parsed.timezone),
        priceText: formatEventPrice(parsed.price, parsed.locale, parsed.currency),
        clientFullName: joinNames(parsed.clientFirstName, parsed.clientLastName) || 'A client',
        eventName: parsed.sessionName?.trim() || 'an appointment',
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
              accept_time: sql<Date>`NOW()`,
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
            decline_time: sql<Date>`NOW()`,
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
      return new NextResponse(
        renderPage({
          badge: 'Not Found',
          headline: 'We can’t find this invitation',
          message: 'The invitation link may be incorrect or has already been handled.',
          statusColor: '#dc2626',
        }),
        { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      )
    }

    const details = 'details' in outcome ? outcome.details : undefined

    if (outcome.type === 'expired') {
      return new NextResponse(
        renderPage({
          badge: 'Expired',
          headline: 'This invitation has expired',
          message: 'This appointment has already started or finished. Please contact the provider if you think this is a mistake.',
          details,
          statusColor: '#dc2626',
        }),
        { status: 410, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      )
    }

    if (outcome.type === 'full') {
      return new NextResponse(
        renderPage({
          badge: 'Full',
          headline: 'This appointment is full',
          message: 'We could not reserve your spot because the maximum number of attendees has been reached.',
          details,
          statusColor: '#d97706',
        }),
        { status: 409, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      )
    }

    if (outcome.type === 'declined') {
      return new NextResponse(
        renderPage({
          badge: 'Updated',
          headline: 'You’re marked as not attending',
          message: 'We’ve let the provider know you can’t make it.',
          details,
          statusColor: '#334155',
        }),
        { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      )
    }

    return new NextResponse(
      renderPage({
        badge: 'Booked',
        headline: 'You’re all booked in!',
        message: 'Thanks for confirming. We’ll see you there.',
        details,
        statusColor: '#16a34a',
      }),
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  } catch (error) {
    console.error('Failed to handle session invitation link', { invitationId, action, error })
    return new NextResponse(
      renderPage({
        badge: 'Error',
        headline: 'Something went wrong',
        message: 'We could not process your request right now. Please try again later.',
        statusColor: '#dc2626',
      }),
      { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }
}
