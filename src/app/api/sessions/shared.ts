import { z } from 'zod'
import {
  adaptNotes,
  adaptPayment,
  clientSessionListSchema,
  isoDateTimeString,
  isoDateTimeStringOrNull,
  normalizeClientSessionState,
  nullableNumber,
  noteSchema,
  parseNullableBoolean,
  parseNullableString,
} from '../_lib/clientSessionsSchema'
import { parseAmount } from '../paymentPlans/shared'

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
  name: z.string().nullable(),
  startTime: isoDateTimeString,
  price: z.string().nullable(),
  currency: z.string(),
  type: sessionTypeSchema.nullable(),
  timezone: z.string(),
  date: z.string(),
  length: z.number(),
  clientSessions: clientSessionListSchema,
  bookedOnline: z.boolean(),
  serviceId: z.string().nullable(),
  notes: z.array(noteSchema),
  location: z.string().nullable(),
  address: z.string().nullable(),
  geo: geoSchema.nullable(),
  googlePlaceId: z.string().nullable(),
  bookableOnline: z.boolean(),
  description: z.string().nullable(),
  bookingPaymentType: bookingPaymentTypeSchema.nullable(),
  maximumAttendance: z.number().nullable(),
  invitations: z.array(invitationSchema),
  serviceProviderReminder1: serviceProviderReminderSchema.nullable(),
  serviceProviderReminder2: serviceProviderReminderSchema.nullable(),
  clientReminder1: clientReminderSchema.nullable(),
  clientReminder2: clientReminderSchema.nullable(),
  bufferMinutesBefore: z.number(),
  bufferMinutesAfter: z.number(),
  canClientsCancel: z.boolean(),
  cancellationAdvanceNoticeDuration: z.string().nullable(),
  requestClientAddressOnline: requestClientAddressOnlineValueSchema.nullable().default(null),
  bookingQuestion: z.string().nullable(),
  bookingQuestionState: bookingQuestionStateValueSchema.nullable(),
})

export const sessionListSchema = z.array(sessionSchema)

export type Session = z.infer<typeof sessionSchema>

export type RawSessionRow = {
  id: string | null
  sessionSeriesId: string | null
  name: string | null
  startTime: Date | string | null
  price: string | number | null
  currency: string | null
  type: string | null
  timezone: string | null
  date: string | null
  length: number | null
  clientSessions: unknown
  bookedOnline: boolean | null
  serviceId: string | null
  notes: unknown
  location: string | null
  address: string | null
  geo: unknown
  googlePlaceId: string | null
  bookableOnline: boolean | null
  description: string | null
  bookingPaymentType: string | null
  maximumAttendance: number | string | null
  invitations: unknown
  serviceProviderReminder1: unknown
  serviceProviderReminder2: unknown
  clientReminder1: unknown
  clientReminder2: unknown
  bufferMinutesBefore: number | string | null
  bufferMinutesAfter: number | string | null
  canClientsCancel: boolean | null
  cancellationAdvanceNoticeDuration: string | null
  requestClientAddressOnline: string | null
  bookingQuestion: string | null
  bookingQuestionState: string | null
}

const parseRequiredString = (value: unknown, label: string) => {
  if (typeof value !== 'string') {
    throw new Error(`Session row is missing ${label}`)
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new Error(`Session row is missing ${label}`)
  }
  return trimmed
}

const parseRequiredBoolean = (value: unknown, label: string) => {
  if (typeof value !== 'boolean') {
    throw new Error(`Session row is missing ${label}`)
  }
  return value
}

const parseLength = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('Session row is missing length')
  }
  return value
}

const parseBufferMinutes = (value: unknown, label: string) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  throw new Error(`Session row is missing ${label}`)
}

const parseNullableNumber = (value: unknown, label: string) => {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid ${label} value`)
    }
    return value
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      return null
    }
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed)) {
      throw new Error(`Invalid ${label} value`)
    }
    return parsed
  }
  throw new Error(`Invalid ${label} value`)
}

const parseSessionType = (value: unknown) => {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'string') {
    throw new Error('Session row has invalid type field')
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }
  const parsed = sessionTypeSchema.safeParse(trimmed)
  if (!parsed.success) {
    throw new Error(`Unexpected session type: ${value}`)
  }
  return parsed.data
}

const parseBookingPaymentType = (value: unknown) => {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'string') {
    throw new Error('Session row has invalid booking payment type')
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }
  const parsed = bookingPaymentTypeSchema.safeParse(trimmed)
  if (!parsed.success) {
    throw new Error(`Unexpected booking payment type: ${value}`)
  }
  return parsed.data
}

const parseRequestClientAddressOnline = (value: unknown) => {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'string') {
    throw new Error('Session row has invalid requestClientAddressOnline value')
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }
  const parsed = requestClientAddressOnlineValueSchema.safeParse(trimmed)
  if (!parsed.success) {
    throw new Error(`Unexpected requestClientAddressOnline value: ${value}`)
  }
  return parsed.data
}

const parseBookingQuestionState = (value: unknown) => {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'string') {
    throw new Error('Session row has invalid bookingQuestionState value')
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }
  const parsed = bookingQuestionStateValueSchema.safeParse(trimmed)
  if (!parsed.success) {
    throw new Error(`Unexpected bookingQuestionState value: ${value}`)
  }
  return parsed.data
}

const parseGeo = (value: unknown) => {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'object') {
    throw new Error('Session row has invalid geo value')
  }
  return geoSchema.parse(value)
}

const parseInvitations = (value: unknown) => {
  if (value === null || value === undefined) {
    return [] as z.infer<typeof invitationSchema>[]
  }
  if (!Array.isArray(value)) {
    throw new Error('Session row has invalid invitations value')
  }
  return z.array(invitationSchema).parse(value)
}

const parseReminder = <TSchema extends z.ZodTypeAny>(value: unknown, schema: TSchema): z.infer<TSchema> | null => {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'object') {
    throw new Error('Session row has invalid reminder value')
  }
  return schema.parse(value)
}

const adaptClientSessions = (value: unknown) => {
  if (value === null || value === undefined) {
    return [] as z.infer<typeof clientSessionListSchema>
  }
  if (!Array.isArray(value)) {
    throw new Error('Session row has invalid clientSessions value')
  }

  const sessions = value.map((item) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error('Client session entry was not an object')
    }
    const record = item as Record<string, unknown>
    const id = record.id
    const clientId = record.clientId
    const sessionId = record.sessionId
    if (typeof id !== 'string' || typeof clientId !== 'string' || typeof sessionId !== 'string') {
      throw new Error('Client session entry was missing identifiers')
    }
    if (record.createdAt === null || record.createdAt === undefined) {
      throw new Error('Client session entry was missing createdAt')
    }
    return {
      id,
      clientId,
      sessionId,
      createdAt: isoDateTimeString.parse(record.createdAt),
      state: normalizeClientSessionState(record.state),
      bookingQuestion: parseNullableString(record.bookingQuestion),
      bookingQuestionResponse: parseNullableString(record.bookingQuestionResponse),
      price: nullableNumber.parse(record.price ?? null),
      attended: parseNullableBoolean(record.attended, 'attended'),
      payment: adaptPayment(record.payment ?? null),
      notes: adaptNotes(record.notes),
      saleId: parseNullableString(record.saleId),
      cancelTime: isoDateTimeStringOrNull.parse(record.cancelTime ?? null),
      cancelReason: parseNullableString(record.cancelReason),
      acceptTime: isoDateTimeStringOrNull.parse(record.acceptTime ?? null),
      declineTime: isoDateTimeStringOrNull.parse(record.declineTime ?? null),
      inviteTime: isoDateTimeStringOrNull.parse(record.inviteTime ?? null),
      confirmTime: isoDateTimeStringOrNull.parse(record.confirmTime ?? null),
    }
  })

  return clientSessionListSchema.parse(sessions)
}

export const adaptSessionRow = (row: RawSessionRow) => {
  if (!row.id) {
    throw new Error('Session row is missing id')
  }
  if (!row.sessionSeriesId) {
    throw new Error('Session row is missing sessionSeriesId')
  }
  if (!row.startTime) {
    throw new Error('Session row is missing startTime')
  }

  const startTimeIso = isoDateTimeString.parse(row.startTime)

  const adapted = {
    id: row.id,
    sessionSeriesId: row.sessionSeriesId,
    name: parseNullableString(row.name),
    startTime: startTimeIso,
    price: parseAmount(row.price ?? null, 'session price'),
    currency: parseRequiredString(row.currency, 'currency'),
    type: parseSessionType(row.type),
    timezone: parseRequiredString(row.timezone, 'timezone'),
    date: parseRequiredString(row.date, 'date'),
    length: parseLength(row.length),
    clientSessions: adaptClientSessions(row.clientSessions),
    bookedOnline: parseRequiredBoolean(row.bookedOnline, 'bookedOnline'),
    serviceId: parseNullableString(row.serviceId),
    notes: adaptNotes(row.notes),
    location: parseNullableString(row.location),
    address: parseNullableString(row.address),
    geo: parseGeo(row.geo),
    googlePlaceId: parseNullableString(row.googlePlaceId),
    bookableOnline: parseRequiredBoolean(row.bookableOnline, 'bookableOnline'),
    description: parseNullableString(row.description),
    bookingPaymentType: parseBookingPaymentType(row.bookingPaymentType),
    maximumAttendance: parseNullableNumber(row.maximumAttendance, 'maximum attendance'),
    invitations: parseInvitations(row.invitations),
    serviceProviderReminder1: parseReminder(row.serviceProviderReminder1, serviceProviderReminderSchema),
    serviceProviderReminder2: parseReminder(row.serviceProviderReminder2, serviceProviderReminderSchema),
    clientReminder1: parseReminder(row.clientReminder1, clientReminderSchema),
    clientReminder2: parseReminder(row.clientReminder2, clientReminderSchema),
    bufferMinutesBefore: parseBufferMinutes(row.bufferMinutesBefore, 'bufferMinutesBefore'),
    bufferMinutesAfter: parseBufferMinutes(row.bufferMinutesAfter, 'bufferMinutesAfter'),
    canClientsCancel: parseRequiredBoolean(row.canClientsCancel, 'canClientsCancel'),
    cancellationAdvanceNoticeDuration: parseNullableString(row.cancellationAdvanceNoticeDuration),
    requestClientAddressOnline: parseRequestClientAddressOnline(row.requestClientAddressOnline),
    bookingQuestion: parseNullableString(row.bookingQuestion),
    bookingQuestionState: parseBookingQuestionState(row.bookingQuestionState),
  }

  return sessionSchema.parse(adapted)
}
