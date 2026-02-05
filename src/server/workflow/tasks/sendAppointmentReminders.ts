import type { CountryCode } from 'libphonenumber-js'
import { formatRelative } from 'date-fns'
import { parsePhoneNumberFromString } from 'libphonenumber-js/min'
import type { WorkflowTaskPayloadMap } from '@/server/workflow/types'
import { APP_EMAIL, APP_NAME, NO_REPLY_EMAIL, KEEPON_LOGO_COLOR_URL } from '@/app/api/_lib/constants'
import { db } from '@/lib/db'
import { enqueueWorkflowTask } from '@/server/workflow/outbox'
import { parseScheduledAt, scheduleNextRecurringTaskSafe } from '@/server/workflow/schedules'
import { ctaEmail } from '@/server/workflow/templates/ctaEmail'
import { joinIgnoreEmpty } from '@/server/workflow/utils'

const reminderTypeValues = [
  'emailServiceProvider',
  'notificationServiceProvider',
  'emailAndNotificationServiceProvider',
  'emailClient',
  'smsClient',
  'emailAndSmsClient',
] as const

type ReminderType = (typeof reminderTypeValues)[number]

type ReminderRow = {
  trainerId: string
  sessionId: string
  type: ReminderType
}

type ReminderClient = {
  id: string
  firstName: string
  lastName: string | null
  email: string | null
  mobileNumber: string | null
  mailId: string
  clientSessionId: string
  bookingId: string
}

type ReminderDetailRow = {
  mailId: string
  serviceProviderName: string
  serviceProviderEmail: string
  brandColor: string
  businessLogoUrl: string | null
  trainerId: string
  smsCreditCheckoutId: string
  userId: string
  country: string
  smsCreditBalance: string | null
  clientRemindersEnabled: boolean
  sessionId: string
  startsAt: Date
  endsAt: Date
  timezone: string
  location: string | null
  address: string | null
  geo: { lat: number; lng: number } | null
  googlePlaceId: string | null
  locale: string | null
  cancelled: boolean
  name: string
  contactEmail: string
  contactNumber: string | null
  reminderType: ReminderType
  clients: ReminderClient[]
}

type SmsMessage = {
  trainerId: string
  clientId: string
  toNumber: string
  body: string
}

const isAppleRelayEmail = (email: string) => email.toLowerCase().endsWith('@privaterelay.appleid.com')

const capitalize = (value: string) => (value.length === 0 ? value : value[0].toUpperCase() + value.slice(1))

const toZonedTime = (date: Date, timeZone: string) => new Date(date.toLocaleString('en-US', { timeZone }))

const formatCalendarDate = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''

  return `${get('year')}${get('month')}${get('day')}T${get('hour')}${get('minute')}${get('second')}`
}

const formatDateRange = (formatter: Intl.DateTimeFormat, start: Date, end: Date) => {
  if (typeof formatter.formatRange === 'function') {
    return formatter.formatRange(start, end)
  }
  return `${formatter.format(start)} - ${formatter.format(end)}`
}

const createGoogleMapsUrl = (args: { query: string | { lat: number; lng: number }; queryPlaceId?: string | null }) => {
  const url = new URL('https://www.google.com/maps/search/')
  url.searchParams.append('api', '1')
  url.searchParams.append('query', typeof args.query === 'string' ? args.query : `${args.query.lat},${args.query.lng}`)
  if (args.queryPlaceId) {
    url.searchParams.append('query_place_id', args.queryPlaceId)
  }
  return url
}

const createAppleMapsUrl = (args: {
  geo?: { lat: number; lng: number } | null
  query?: string | null
  address?: string | null
}) => {
  const url = new URL('http://maps.apple.com')
  if (args.geo) {
    url.searchParams.append('ll', `${args.geo.lat},${args.geo.lng}`)
  }
  if (args.query) {
    url.searchParams.append('q', args.query)
  }
  if (args.address) {
    url.searchParams.append('address', args.address)
  }
  return url
}

const createGoogleCalendarUrl = (args: {
  title: string
  start: Date
  end: Date
  timezone: string
  description?: string
  location?: string
}) => {
  const url = new URL('https://calendar.google.com/calendar/u/0/r/eventedit')
  url.searchParams.append('text', args.title)
  url.searchParams.append(
    'dates',
    [args.start, args.end].map((date) => formatCalendarDate(date, args.timezone)).join('/')
  )
  url.searchParams.append('ctz', args.timezone)
  if (args.description) {
    url.searchParams.append('details', args.description)
  }
  if (args.location) {
    url.searchParams.append('location', args.location)
  }
  return url
}

const resolveBookingShortBaseUrl = () => {
  const baseUrl = process.env.BASE_URL ?? 'http://localhost:3001'
  const bookingsBase = new URL('book', baseUrl)
  const shortUrl = process.env.BOOKING_SHORT_URL
  return shortUrl ? new URL(shortUrl) : bookingsBase
}

const getShortBookingUrl = (bookingId: string) => new URL(bookingId, resolveBookingShortBaseUrl())

const parseGeo = (value: unknown): { lat: number; lng: number } | null => {
  if (!value || typeof value !== 'object') {
    return null
  }
  const record = value as Record<string, unknown>
  if (typeof record.lat === 'number' && typeof record.lng === 'number') {
    return { lat: record.lat, lng: record.lng }
  }
  return null
}

const parseClients = (value: unknown): ReminderClient[] => {
  if (!Array.isArray(value)) {
    return []
  }
  const results: ReminderClient[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      continue
    }
    const record = entry as Record<string, unknown>
    if (
      typeof record.id !== 'string' ||
      typeof record.mail_id !== 'string' ||
      typeof record.client_session_id !== 'string'
    ) {
      continue
    }
    results.push({
      id: record.id,
      firstName: typeof record.first_name === 'string' ? record.first_name : '',
      lastName: typeof record.last_name === 'string' ? record.last_name : null,
      email: typeof record.email === 'string' ? record.email : null,
      mobileNumber: typeof record.mobile_number === 'string' ? record.mobile_number : null,
      mailId: record.mail_id,
      clientSessionId: record.client_session_id,
      bookingId: typeof record.booking_id === 'string' ? record.booking_id : '',
    })
  }
  return results
}

const toReminderType = (base: string | null, suffix: 'ServiceProvider' | 'Client') => {
  if (!base) {
    return null
  }
  const value = `${base}${suffix}`
  return reminderTypeValues.includes(value as ReminderType) ? (value as ReminderType) : null
}

export const handleSendAppointmentRemindersTask = async ({
  scheduledAt,
}: WorkflowTaskPayloadMap['sendAppointmentReminders']) => {
  const scheduleBase = parseScheduledAt(scheduledAt)
  const now = new Date()

  try {
    const reminders = await db.transaction().execute(async (trx) => {
      const collected: ReminderRow[] = []

      const dueServiceProviderReminder1 = await trx
        .updateTable('session')
        .set({ service_provider_reminder_1_checked_at: now })
        .where('service_provider_reminder_1_checked_at', 'is', null)
        .where(
          'id',
          'in',
          trx
            .selectFrom('vw_due_session_reminder_slots')
            .select('session_id')
            .where('reminder_slot', '=', 'service_provider_reminder_1')
        )
        .returning([
          'id as sessionId',
          'trainer_id as trainerId',
          'service_provider_reminder_1_type as reminderTypeBase',
        ])
        .execute()

      for (const row of dueServiceProviderReminder1) {
        const reminderType = toReminderType(row.reminderTypeBase ?? null, 'ServiceProvider')
        if (reminderType) {
          collected.push({ sessionId: row.sessionId, trainerId: row.trainerId, type: reminderType })
        }
      }

      const dueServiceProviderReminder2 = await trx
        .updateTable('session')
        .set({ service_provider_reminder_2_checked_at: now })
        .where('service_provider_reminder_2_checked_at', 'is', null)
        .where(
          'id',
          'in',
          trx
            .selectFrom('vw_due_session_reminder_slots')
            .select('session_id')
            .where('reminder_slot', '=', 'service_provider_reminder_2')
        )
        .returning([
          'id as sessionId',
          'trainer_id as trainerId',
          'service_provider_reminder_2_type as reminderTypeBase',
        ])
        .execute()

      for (const row of dueServiceProviderReminder2) {
        const reminderType = toReminderType(row.reminderTypeBase ?? null, 'ServiceProvider')
        if (reminderType) {
          collected.push({ sessionId: row.sessionId, trainerId: row.trainerId, type: reminderType })
        }
      }

      const dueClientReminder1 = await trx
        .updateTable('session')
        .set({ client_reminder_1_checked_at: now })
        .where('client_reminder_1_checked_at', 'is', null)
        .where(
          'id',
          'in',
          trx
            .selectFrom('vw_due_session_reminder_slots')
            .select('session_id')
            .where('reminder_slot', '=', 'client_reminder_1')
        )
        .returning(['id as sessionId', 'trainer_id as trainerId', 'client_reminder_1_type as reminderTypeBase'])
        .execute()

      for (const row of dueClientReminder1) {
        const reminderType = toReminderType(row.reminderTypeBase ?? null, 'Client')
        if (reminderType) {
          collected.push({ sessionId: row.sessionId, trainerId: row.trainerId, type: reminderType })
        }
      }

      const dueClientReminder2 = await trx
        .updateTable('session')
        .set({ client_reminder_2_checked_at: now })
        .where('client_reminder_2_checked_at', 'is', null)
        .where(
          'id',
          'in',
          trx
            .selectFrom('vw_due_session_reminder_slots')
            .select('session_id')
            .where('reminder_slot', '=', 'client_reminder_2')
        )
        .returning(['id as sessionId', 'trainer_id as trainerId', 'client_reminder_2_type as reminderTypeBase'])
        .execute()

      for (const row of dueClientReminder2) {
        const reminderType = toReminderType(row.reminderTypeBase ?? null, 'Client')
        if (reminderType) {
          collected.push({ sessionId: row.sessionId, trainerId: row.trainerId, type: reminderType })
        }
      }

      return collected
    })

    if (reminders.length === 0) {
      return
    }

    const reminderKeys = new Set(reminders.map((reminder) => `${reminder.sessionId}|${reminder.type}`))
    const sessionIds = [...new Set(reminders.map((reminder) => reminder.sessionId))]

    const detailRows = await db
      .selectFrom('vw_session_reminder_details')
      .select([
        'session_id as sessionId',
        'trainer_id as trainerId',
        'reminder_type as reminderType',
        'mail_id as mailId',
        'service_provider_name as serviceProviderName',
        'service_provider_email as serviceProviderEmail',
        'brand_color as brandColor',
        'business_logo_url as businessLogoUrl',
        'user_id as userId',
        'sms_credit_checkout_id as smsCreditCheckoutId',
        'sms_credit_balance as smsCreditBalance',
        'client_reminders_enabled as clientRemindersEnabled',
        'country',
        'starts_at as startsAt',
        'ends_at as endsAt',
        'timezone',
        'location',
        'address',
        'geo',
        'google_place_id as googlePlaceId',
        'locale',
        'cancelled',
        'name',
        'contact_email as contactEmail',
        'contact_number as contactNumber',
        'clients',
      ])
      .where('session_id', 'in', sessionIds)
      .execute()

    const data = detailRows
      .map((row) => {
        const reminderType = row.reminderType as ReminderType
        if (!reminderTypeValues.includes(reminderType)) {
          return null
        }
        const clients = parseClients(row.clients)
        return {
          mailId: row.mailId,
          serviceProviderName: row.serviceProviderName,
          serviceProviderEmail: row.serviceProviderEmail,
          brandColor: row.brandColor,
          businessLogoUrl: row.businessLogoUrl,
          trainerId: row.trainerId,
          smsCreditCheckoutId: row.smsCreditCheckoutId,
          userId: row.userId,
          country: row.country,
          smsCreditBalance: row.smsCreditBalance,
          clientRemindersEnabled: row.clientRemindersEnabled,
          sessionId: row.sessionId,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          timezone: row.timezone,
          location: row.location,
          address: row.address,
          geo: parseGeo(row.geo),
          googlePlaceId: row.googlePlaceId,
          locale: row.locale,
          cancelled: row.cancelled,
          name: row.name,
          contactEmail: row.contactEmail,
          contactNumber: row.contactNumber,
          reminderType,
          clients,
        }
      })
      .filter(
        (row): row is ReminderDetailRow => row !== null && reminderKeys.has(`${row.sessionId}|${row.reminderType}`)
      )

    const userNotifyTasks: WorkflowTaskPayloadMap['user.notify'][] = []
    const mail: Array<{
      id: string
      trainerId: string
      clientId: string | null
      fromEmail: string
      fromName: string
      toEmail: string
      toName: string | null
      subject: string
      html: string
      sessionId: string
    }> = []
    const smsMail: Array<{
      trainerId: string
      fromEmail: string
      fromName: string
      toEmail: string
      toName: string
      subject: string
      html: string
    }> = []
    const messages: SmsMessage[] = []

    const serviceProviderSmsBalance: Record<
      string,
      {
        userId: string
        starting: bigint
        current: bigint
        email: string
        trainerId: string
        name: string
        smsCreditCheckoutId: string
      }
    > = {}

    const bookingBaseUrl = process.env.BASE_URL ?? 'http://localhost:3001'

    for (const reminder of data) {
      if (reminder.cancelled) {
        continue
      }

      if (!serviceProviderSmsBalance[reminder.trainerId]) {
        serviceProviderSmsBalance[reminder.trainerId] = {
          userId: reminder.userId,
          starting: BigInt(reminder.smsCreditBalance ?? 0),
          current: BigInt(reminder.smsCreditBalance ?? 0),
          email: reminder.serviceProviderEmail,
          trainerId: reminder.trainerId,
          name: reminder.serviceProviderName,
          smsCreditCheckoutId: reminder.smsCreditCheckoutId,
        }
      }

      const formatter = new Intl.DateTimeFormat(reminder.locale ?? 'en-US', {
        weekday: 'short',
        month: 'short',
        hour: 'numeric',
        minute: 'numeric',
        timeZoneName: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: reminder.timezone,
      })

      let suffix = ''
      if (reminder.clients.length === 1) {
        suffix = ` with ${reminder.clients[0]?.firstName ?? ''}`
      } else if (reminder.clients.length > 1) {
        suffix = ` with ${reminder.clients.length} clients`
      }

      const unreplyable = isAppleRelayEmail(reminder.serviceProviderEmail)

      if (
        reminder.reminderType === 'notificationServiceProvider' ||
        reminder.reminderType === 'emailAndNotificationServiceProvider'
      ) {
        userNotifyTasks.push({
          title: `${reminder.name}${suffix}`,
          body: capitalize(
            formatRelative(toZonedTime(reminder.startsAt, reminder.timezone), toZonedTime(now, reminder.timezone))
          ),
          messageType: 'default',
          notificationType: 'reminder',
          userId: reminder.userId,
          skipAppNotification: true,
        })
      }

      if (
        reminder.reminderType === 'emailServiceProvider' ||
        reminder.reminderType === 'emailAndNotificationServiceProvider'
      ) {
        const serviceLocation = [reminder.location, reminder.address].filter((value) => value).join('<br/>')
        const appleMapsLink = reminder.geo
          ? createAppleMapsUrl({ geo: reminder.geo, query: reminder.location, address: reminder.address }).toString()
          : undefined
        const googleMapsLink =
          reminder.geo || (reminder.googlePlaceId && (reminder.location || reminder.address))
            ? createGoogleMapsUrl({
                query: reminder.geo
                  ? reminder.geo
                  : [reminder.location, reminder.address].filter((value) => value).join(','),
                queryPlaceId: reminder.googlePlaceId,
              }).toString()
            : undefined

        const detailsLink = new URL(`calendar/${reminder.sessionId}`, bookingBaseUrl).toString()

        const clientNames = reminder.clients
          .map((client) => joinIgnoreEmpty(client.firstName, client.lastName))
          .filter((value) => value.length > 0)

        mail.push({
          sessionId: reminder.sessionId,
          id: reminder.mailId,
          fromEmail: APP_EMAIL,
          fromName: `${APP_NAME} Team`,
          toEmail: reminder.serviceProviderEmail,
          toName: reminder.serviceProviderName,
          trainerId: reminder.trainerId,
          clientId: null,
          subject: `Reminder: ${reminder.name}${suffix} on ${formatter.format(reminder.startsAt)}`,
          html: ctaEmail({
            receivingReason: `you added an appointment reminder`,
            brandColor: reminder.brandColor ?? undefined,
            logo: reminder.businessLogoUrl
              ? {
                  url: reminder.businessLogoUrl,
                  alt: reminder.serviceProviderName,
                }
              : undefined,
            bodyHeading: 'You have an upcoming appointment',
            bodyHtml: `
            <p><strong>${reminder.name}</strong></p>
            <p>${formatDateRange(formatter, reminder.startsAt, reminder.endsAt)}</p>
            ${detailsLink ? `<p><a href="${detailsLink}">View in web app →</a></p>` : ''}
            ${clientNames.length > 0 ? `<p><strong>Client${clientNames.length === 1 ? '' : 's'}</strong><br/>${clientNames.join('<br/>')}</p>` : ''}
            ${serviceLocation ? `<p><strong>Location</strong><br/>${serviceLocation}</p>` : ''}
            ${googleMapsLink ? `<p><a href="${googleMapsLink}">Google maps →</a></p>` : ''}
            ${appleMapsLink ? `<p><a href="${appleMapsLink}">Apple maps →</a></p>` : ''}
          `,
          }),
        })
      }

      if (
        reminder.clientRemindersEnabled &&
        (reminder.reminderType === 'emailClient' || reminder.reminderType === 'emailAndSmsClient')
      ) {
        for (const client of reminder.clients) {
          if (!client.email) {
            continue
          }

          const title = `${reminder.name} with ${reminder.serviceProviderName}`
          const addToCalendarLink = new URL('/api/ics', bookingBaseUrl)
          addToCalendarLink.searchParams.append('startTime', reminder.startsAt.toISOString())
          addToCalendarLink.searchParams.append('endTime', reminder.endsAt.toISOString())
          addToCalendarLink.searchParams.append('timeZone', reminder.timezone)
          addToCalendarLink.searchParams.append('title', title)

          const locationString = [reminder.location, reminder.address].filter((value) => value).join(', ') || undefined
          if (locationString) {
            addToCalendarLink.searchParams.append('location', locationString)
          }

          const descriptionString =
            reminder.contactNumber || (!unreplyable && reminder.contactEmail)
              ? `Contact ${reminder.serviceProviderName} via ${[
                  reminder.contactNumber,
                  unreplyable ? undefined : reminder.contactEmail,
                ]
                  .filter((value) => value)
                  .join(' or ')}.`
              : undefined
          if (descriptionString) {
            addToCalendarLink.searchParams.append('description', descriptionString)
          }

          const serviceLocation = [reminder.location, reminder.address].filter((value) => value).join('<br/>')
          const appleMapsLink = reminder.geo
            ? createAppleMapsUrl({ geo: reminder.geo, query: reminder.location, address: reminder.address }).toString()
            : undefined
          const googleMapsLink =
            reminder.geo || (reminder.googlePlaceId && (reminder.location || reminder.address))
              ? createGoogleMapsUrl({
                  query: reminder.geo
                    ? reminder.geo
                    : [reminder.location, reminder.address].filter((value) => value).join(','),
                  queryPlaceId: reminder.googlePlaceId,
                }).toString()
              : undefined

          const detailsLink = new URL(`/book/bookings/${client.bookingId}`, bookingBaseUrl).toString()

          mail.push({
            sessionId: reminder.sessionId,
            id: client.mailId,
            fromEmail: NO_REPLY_EMAIL,
            fromName: `${reminder.serviceProviderName} via ${APP_NAME}`,
            toEmail: client.email,
            toName: joinIgnoreEmpty(client.firstName, client.lastName) || null,
            trainerId: reminder.trainerId,
            clientId: client.id,
            subject: `Reminder: ${reminder.name} on ${formatter.format(reminder.startsAt)}`,
            html: ctaEmail({
              receivingReason: `you have an appointment with ${reminder.serviceProviderName}`,
              brandColor: reminder.brandColor ?? undefined,
              logo: reminder.businessLogoUrl
                ? {
                    url: reminder.businessLogoUrl,
                    alt: reminder.serviceProviderName,
                  }
                : undefined,
              bodyHeading: 'Appointment Reminder',
              bodyHtml: `
              <p><strong>${reminder.name}</strong> with ${reminder.serviceProviderName}</p>
              <p>${formatDateRange(formatter, reminder.startsAt, reminder.endsAt)}</p>
              ${detailsLink ? `<p><a href="${detailsLink}">View details →</a></p>` : ''}
              ${addToCalendarLink ? `<p><a href="${addToCalendarLink.toString()}">Add to calendar →</a></p>` : ''}
              ${serviceLocation ? `<p><strong>Location</strong><br/>${serviceLocation}</p>` : ''}
              ${googleMapsLink ? `<p><a href="${googleMapsLink}">Google maps →</a></p>` : ''}
              ${appleMapsLink ? `<p><a href="${appleMapsLink}">Apple maps →</a></p>` : ''}
            `,
              button: {
                link: addToCalendarLink,
                text: 'Add to calendar',
              },
            }),
          })
        }
      }

      if (
        reminder.clientRemindersEnabled &&
        (reminder.reminderType === 'smsClient' || reminder.reminderType === 'emailAndSmsClient')
      ) {
        for (const client of reminder.clients) {
          const balance = serviceProviderSmsBalance[reminder.trainerId]
          if (!client.mobileNumber || !balance || balance.current <= 0n) {
            continue
          }

          const parsed = parsePhoneNumberFromString(client.mobileNumber, reminder.country as CountryCode)
          if (!parsed?.isValid()) {
            continue
          }

          messages.push({
            trainerId: reminder.trainerId,
            clientId: client.id,
            toNumber: parsed.format('E.164'),
            body: `Reminder: ${reminder.name} with ${reminder.serviceProviderName} on ${formatter.format(
              reminder.startsAt
            )}. More: ${getShortBookingUrl(client.bookingId).toString()}`,
          })

          balance.current -= 1n
        }
      }
    }

    for (const balance of Object.values(serviceProviderSmsBalance)) {
      if (balance.starting > 0n && balance.current <= 0n) {
        userNotifyTasks.push({
          title: `You're out of text credits`,
          body: `You'll need to top-up before you can send any more reminders.`,
          messageType: 'default',
          notificationType: 'reminder',
          userId: balance.userId,
        })
        smsMail.push({
          fromEmail: APP_EMAIL,
          fromName: `${APP_NAME} Team`,
          toEmail: balance.email,
          toName: balance.name,
          trainerId: balance.trainerId,
          subject: `You're out of text credits`,
          html: ctaEmail({
            receivingReason: `you use Text reminders with ${APP_NAME}`,
            button: {
              text: 'Buy more credits',
              link: new URL(`/sms-credit-checkouts/${encodeURIComponent(balance.smsCreditCheckoutId)}`, bookingBaseUrl),
            },
            bodyHeading: `You're out of text credits`,
            bodyHtml: `Top-up now to keep reminding your clients not to miss their appointments.`,
            logo: {
              url: KEEPON_LOGO_COLOR_URL,
              alt: APP_NAME,
            },
          }),
        })
      } else if (balance.starting > 10n && balance.current <= 10n && balance.current > 0n) {
        userNotifyTasks.push({
          title: `You're running low on text credits`,
          body: `Your text reminders will not send once you run out.`,
          messageType: 'default',
          notificationType: 'reminder',
          userId: balance.userId,
        })
        smsMail.push({
          fromEmail: APP_EMAIL,
          fromName: `${APP_NAME} Team`,
          toEmail: balance.email,
          toName: balance.name,
          trainerId: balance.trainerId,
          subject: `You're running low on text credits`,
          html: ctaEmail({
            receivingReason: `you use text reminders with ${APP_NAME}`,
            button: {
              text: 'Buy more credits',
              link: new URL(`/sms-credit-checkouts/${encodeURIComponent(balance.smsCreditCheckoutId)}`, bookingBaseUrl),
            },
            bodyHeading: `You're running low on text credits`,
            bodyHtml: `Top-up soon to reminder your clients not to miss their appointments.`,
            logo: {
              url: KEEPON_LOGO_COLOR_URL,
              alt: APP_NAME,
            },
          }),
        })
      }
    }

    await db.transaction().execute(async (trx) => {
      if (userNotifyTasks.length > 0) {
        await Promise.all(userNotifyTasks.map((task) => enqueueWorkflowTask(trx, 'user.notify', task)))
      }

      if (mail.length > 0) {
        await trx
          .insertInto('mail')
          .values(
            mail.map((email) => ({
              id: email.id,
              trainer_id: email.trainerId,
              client_id: email.clientId ?? null,
              from_email: email.fromEmail,
              from_name: email.fromName,
              to_email: email.toEmail,
              to_name: email.toName ?? null,
              subject: email.subject,
              html: email.html,
            }))
          )
          .execute()
      }

      if (smsMail.length > 0) {
        await trx
          .insertInto('mail')
          .values(
            smsMail.map((email) => ({
              trainer_id: email.trainerId,
              client_id: null,
              from_email: email.fromEmail,
              from_name: email.fromName,
              to_email: email.toEmail,
              to_name: email.toName ?? null,
              subject: email.subject,
              html: email.html,
            }))
          )
          .execute()
      }

      if (mail.length > 0) {
        await trx
          .insertInto('email_appointment_reminder')
          .values(
            mail.map((entry) => ({
              trainer_id: entry.trainerId,
              session_id: entry.sessionId,
              client_id: entry.clientId ?? null,
              mail_id: entry.id,
              is_client_reminder: entry.clientId !== null,
            }))
          )
          .execute()
      }

      if (messages.length > 0) {
        await trx
          .insertInto('sms')
          .values(
            messages.map((message) => ({
              trainer_id: message.trainerId,
              client_id: message.clientId,
              from_number: null,
              to_number: message.toNumber,
              body: message.body,
            }))
          )
          .execute()
      }
    })
  } finally {
    await scheduleNextRecurringTaskSafe(db, 'sendAppointmentReminders', scheduleBase)
  }
}
