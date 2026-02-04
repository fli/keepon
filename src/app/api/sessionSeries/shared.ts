import { z } from 'zod'
import type { Selectable, VwLegacySessionSeries2 } from '@/lib/db'
import {
  adaptNotes,
  clientSessionListSchema,
  isoDateTimeString,
  isoDateTimeStringOrNull,
  nullableNumber,
  noteSchema,
  parseNullableString,
} from '../_lib/clientSessionsSchema'

type RawRow = Selectable<VwLegacySessionSeries2>

export const sessionTypeSchema = z.enum(['single', 'group', 'event'])
export const bookingPaymentTypeSchema = z.enum(['hidePrice', 'noPrepayment', 'fullPrepayment'])
export const requestClientAddressOnlineValueSchema = z.enum(['optional', 'required'])
export const bookingQuestionStateValueSchema = z.enum(['optional', 'required'])

export const serviceProviderReminderSchema = z.object({
  type: z.enum(['email', 'notification', 'emailAndNotification']),
  timeBeforeStart: z.string(),
})

export const clientReminderSchema = z.object({
  type: z.enum(['email', 'sms', 'emailAndSms']),
  timeBeforeStart: z.string(),
})

export const geoSchema = z.object({
  lat: z.number().nullable(),
  lng: z.number().nullable(),
})

export const invitationSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  sessionId: z.string(),
  status: z.enum(['sent', 'declined', 'accepted']),
  sentAt: isoDateTimeString,
  actionedAt: isoDateTimeStringOrNull,
})

export const sessionSchema = z.object({
  id: z.string(),
  sessionSeriesId: z.string(),
  timezone: z.string(),
  date: z.string(),
  length: z.number(),
  clientSessions: clientSessionListSchema,
  notes: z.array(noteSchema),
  bookedOnline: z.boolean(),
  serviceId: z.string().nullable(),
  location: z.string().nullable(),
  address: z.string().nullable(),
  geo: geoSchema.nullable(),
  googlePlaceId: z.string().nullable(),
  bookingPaymentType: bookingPaymentTypeSchema.nullable(),
  maximumAttendance: nullableNumber,
  invitations: z.array(invitationSchema),
  serviceProviderReminder1: serviceProviderReminderSchema.nullable(),
  serviceProviderReminder2: serviceProviderReminderSchema.nullable(),
  clientReminder1: clientReminderSchema.nullable(),
  clientReminder2: clientReminderSchema.nullable(),
  bufferMinutesBefore: z.number(),
  bufferMinutesAfter: z.number(),
  bookableOnline: z.boolean(),
  description: z.string().nullable(),
  canClientsCancel: z.boolean(),
  cancellationAdvanceNoticeDuration: z.string().nullable(),
  requestClientAddressOnline: requestClientAddressOnlineValueSchema.nullable(),
  bookingQuestion: z.string().nullable(),
  bookingQuestionState: bookingQuestionStateValueSchema.nullable(),
  startTime: isoDateTimeString,
  name: z.string().nullable(),
  type: sessionTypeSchema.nullable(),
  price: z.string().nullable(),
  currency: z.string().nullable(),
})

export const sessionSeriesSchema = z.object({
  id: z.string(),
  trainerId: z.string(),
  createdAt: isoDateTimeString,
  sessionType: sessionTypeSchema,
  sessionName: z.string().nullable(),
  sessionColor: z.string().nullable(),
  avatarName: z.string().nullable(),
  imageURL: z.string().nullable(),
  sessionLength: z.number(),
  timezone: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  repeatsEvery: nullableNumber,
  reminderHours: z.number(),
  location: z.string().nullable(),
  price: nullableNumber,
  currency: z.string(),
  sessions: z.array(sessionSchema),
  notes: z.array(noteSchema),
  clients: z.array(z.string()),
})

export type Session = z.infer<typeof sessionSchema>
export type SessionSeries = z.infer<typeof sessionSeriesSchema>
export type RawSessionSeriesRow = RawRow

const bookingPaymentTypeMap: Record<string, z.infer<typeof bookingPaymentTypeSchema>> = {
  hidePrice: 'hidePrice',
  hide_price: 'hidePrice',
  noPrepayment: 'noPrepayment',
  no_prepayment: 'noPrepayment',
  fullPrepayment: 'fullPrepayment',
  full_prepayment: 'fullPrepayment',
}

const normalizeJsonArray = (value: unknown, label: string): unknown[] => {
  if (value === null || value === undefined) {
    return []
  }

  if (Array.isArray(value)) {
    return value
  }

  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      if (Array.isArray(parsed)) {
        return parsed
      }
    } catch {
      // fall through to error below
    }
  }

  throw new Error(`${label} was not an array`)
}

const ensureString = (value: unknown, label: string): string => {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length > 0) {
      return trimmed
    }
  }
  throw new Error(`${label} is missing or invalid`)
}

const ensureBoolean = (value: unknown, label: string): boolean => {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') {
      return true
    }
    if (normalized === 'false') {
      return false
    }
  }
  throw new Error(`${label} is missing or invalid`)
}

const ensureFiniteNumber = (value: unknown, label: string): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  throw new Error(`${label} is missing or invalid`)
}

const coerceString = (value: unknown, label: string): string => {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length > 0) {
      return trimmed
    }
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  throw new Error(`${label} is missing or invalid`)
}

const normalizeBookingPaymentType = (
  value: unknown,
  label: string
): z.infer<typeof bookingPaymentTypeSchema> | null => {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'string') {
    throw new TypeError(`${label} is missing or invalid`)
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }

  const normalized = bookingPaymentTypeMap[trimmed] ?? bookingPaymentTypeMap[trimmed.toLowerCase()]

  if (!normalized) {
    throw new Error(`${label} contained an unexpected value`)
  }

  return normalized
}

const parseOptionalReminder = <Schema extends z.ZodTypeAny>(
  value: unknown,
  schema: Schema,
  label: string
): z.infer<Schema> | null => {
  if (value === null || value === undefined) {
    return null
  }

  const candidate =
    typeof value === 'string'
      ? (() => {
          try {
            return JSON.parse(value) as unknown
          } catch {
            throw new Error(`${label} was not valid JSON`)
          }
        })()
      : value

  if (typeof candidate !== 'object' || candidate === null) {
    throw new Error(`${label} was not an object`)
  }

  const record = candidate as Record<string, unknown>
  if (record.timeBeforeStart === undefined || record.timeBeforeStart === null) {
    throw new Error(`${label} is missing or invalid`)
  }

  return schema.parse({
    type: record.type,
    timeBeforeStart: coerceString(record.timeBeforeStart, `${label}.timeBeforeStart`),
  })
}

const parseGeo = (value: unknown): z.infer<typeof geoSchema> | null => {
  if (value === null || value === undefined) {
    return null
  }

  const candidate =
    typeof value === 'string'
      ? (() => {
          try {
            return JSON.parse(value) as unknown
          } catch {
            throw new Error('Geo value was not valid JSON')
          }
        })()
      : value

  if (typeof candidate !== 'object' || candidate === null) {
    throw new Error('Geo value was not an object')
  }

  const record = candidate as Record<string, unknown>

  const lat = record.lat === null || record.lat === undefined ? null : ensureFiniteNumber(record.lat, 'geo.lat')
  const lng = record.lng === null || record.lng === undefined ? null : ensureFiniteNumber(record.lng, 'geo.lng')

  return geoSchema.parse({ lat, lng })
}

const parseInvitations = (value: unknown, label: string) =>
  normalizeJsonArray(value, label).map((entry, index) => {
    try {
      return invitationSchema.parse(entry)
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw error
      }
      throw new Error(`${label}[${index}] was invalid`, { cause: error })
    }
  })

const normalizeRequestClientAddressOnline = (value: unknown, label: string) => {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'string') {
    throw new TypeError(`${label} is missing or invalid`)
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }
  const result = requestClientAddressOnlineValueSchema.safeParse(trimmed)
  if (!result.success) {
    throw new Error(`${label} contained an unexpected value`)
  }
  return result.data
}

const normalizeBookingQuestionState = (value: unknown, label: string) => {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'string') {
    throw new TypeError(`${label} is missing or invalid`)
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }
  const result = bookingQuestionStateValueSchema.safeParse(trimmed)
  if (!result.success) {
    throw new Error(`${label} contained an unexpected value`)
  }
  return result.data
}

const normalizeNullableSessionType = (value: unknown, label: string) => {
  if (value === null || value === undefined) {
    return null
  }
  const result = sessionTypeSchema.safeParse(value)
  if (!result.success) {
    throw new Error(`${label} contained an unexpected value`)
  }
  return result.data
}

const parseSessions = (value: unknown): Session[] =>
  normalizeJsonArray(value, 'sessions').map((entry, index) => parseSession(entry, index))

const parseSession = (value: unknown, index: number): Session => {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`sessions[${index}] was not an object`)
  }

  const record = value as Record<string, unknown>
  const label = `sessions[${index}]`

  const parsedSession = {
    id: ensureString(record.id, `${label}.id`),
    sessionSeriesId: ensureString(record.sessionSeriesId ?? record.session_series_id, `${label}.sessionSeriesId`),
    timezone: ensureString(record.timezone, `${label}.timezone`),
    date: ensureString(record.date, `${label}.date`),
    length: ensureFiniteNumber(record.length, `${label}.length`),
    clientSessions: clientSessionListSchema.parse(
      normalizeJsonArray(record.clientSessions ?? record.client_sessions, `${label}.clientSessions`)
    ),
    notes: adaptNotes(normalizeJsonArray(record.notes, `${label}.notes`)),
    bookedOnline: ensureBoolean(record.bookedOnline ?? record.booked_online, `${label}.bookedOnline`),
    serviceId: parseNullableString(record.serviceId ?? record.service_id),
    location: parseNullableString(record.location),
    address: parseNullableString(record.address),
    geo: parseGeo(record.geo),
    googlePlaceId: parseNullableString(record.googlePlaceId ?? record.google_place_id),
    bookingPaymentType: normalizeBookingPaymentType(
      record.bookingPaymentType ?? record.booking_payment_type,
      `${label}.bookingPaymentType`
    ),
    maximumAttendance: nullableNumber.parse(record.maximumAttendance ?? record.maximum_attendance),
    invitations: parseInvitations(record.invitations, `${label}.invitations`),
    serviceProviderReminder1: parseOptionalReminder(
      record.serviceProviderReminder1 ?? record.service_provider_reminder_1,
      serviceProviderReminderSchema,
      `${label}.serviceProviderReminder1`
    ),
    serviceProviderReminder2: parseOptionalReminder(
      record.serviceProviderReminder2 ?? record.service_provider_reminder_2,
      serviceProviderReminderSchema,
      `${label}.serviceProviderReminder2`
    ),
    clientReminder1: parseOptionalReminder(
      record.clientReminder1 ?? record.client_reminder_1,
      clientReminderSchema,
      `${label}.clientReminder1`
    ),
    clientReminder2: parseOptionalReminder(
      record.clientReminder2 ?? record.client_reminder_2,
      clientReminderSchema,
      `${label}.clientReminder2`
    ),
    bufferMinutesBefore: ensureFiniteNumber(
      record.bufferMinutesBefore ?? record.buffer_minutes_before,
      `${label}.bufferMinutesBefore`
    ),
    bufferMinutesAfter: ensureFiniteNumber(
      record.bufferMinutesAfter ?? record.buffer_minutes_after,
      `${label}.bufferMinutesAfter`
    ),
    bookableOnline: ensureBoolean(record.bookableOnline ?? record.bookable_online, `${label}.bookableOnline`),
    description: parseNullableString(record.description),
    canClientsCancel: ensureBoolean(record.canClientsCancel ?? record.can_clients_cancel, `${label}.canClientsCancel`),
    cancellationAdvanceNoticeDuration: parseNullableString(
      record.cancellationAdvanceNoticeDuration ?? record.cancellation_advance_notice_duration
    ),
    requestClientAddressOnline: normalizeRequestClientAddressOnline(
      record.requestClientAddressOnline ?? record.request_client_address_online,
      `${label}.requestClientAddressOnline`
    ),
    bookingQuestion: parseNullableString(record.bookingQuestion ?? record.booking_question),
    bookingQuestionState: normalizeBookingQuestionState(
      record.bookingQuestionState ?? record.booking_question_state,
      `${label}.bookingQuestionState`
    ),
    startTime: isoDateTimeString.parse(record.startTime ?? record.start_time),
    name: parseNullableString(record.name),
    type: normalizeNullableSessionType(record.type, `${label}.type`),
    price: parseNullableString(record.price),
    currency: parseNullableString(record.currency),
  }

  return sessionSchema.parse(parsedSession)
}

const collectClientIds = (sessions: Session[]) => {
  const ids = new Set<string>()
  for (const session of sessions) {
    for (const clientSession of session.clientSessions) {
      if (clientSession.clientId) {
        ids.add(clientSession.clientId)
      }
    }
  }
  return Array.from(ids)
}

export const normalizeSessionSeriesRow = (row: RawSessionSeriesRow, index: number): SessionSeries => {
  const label = `sessionSeries[${index}]`
  const createdAt = isoDateTimeString.parse(row.createdAt)
  const sessionType = sessionTypeSchema.parse(row.sessionType)
  const sessions = parseSessions(row.sessions)

  try {
    return sessionSeriesSchema.parse({
      id: ensureString(row.id, `${label}.id`),
      trainerId: ensureString(row.trainerId, `${label}.trainerId`),
      createdAt,
      sessionType,
      sessionName: parseNullableString(row.sessionName),
      sessionColor: parseNullableString(row.sessionColor),
      avatarName: parseNullableString(row.avatarName),
      imageURL: parseNullableString(row.imageURL),
      sessionLength: ensureFiniteNumber(row.sessionLength, `${label}.sessionLength`),
      timezone: ensureString(row.timezone, `${label}.timezone`),
      startDate: ensureString(row.startDate, `${label}.startDate`),
      endDate: ensureString(row.endDate, `${label}.endDate`),
      repeatsEvery: nullableNumber.parse(row.repeatsEvery),
      reminderHours: ensureFiniteNumber(row.reminderHours, `${label}.reminderHours`),
      location: parseNullableString(row.location),
      price: nullableNumber.parse(row.price),
      currency: ensureString(row.currency, `${label}.currency`),
      sessions,
      notes: [],
      clients: collectClientIds(sessions),
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw error
    }
    throw new Error(`${label} was invalid`, { cause: error })
  }
}
