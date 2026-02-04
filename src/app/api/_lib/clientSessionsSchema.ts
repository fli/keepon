import { z } from 'zod'

export const clientSessionStateSchema = z.enum(['maybe', 'cancelled', 'invited', 'confirmed', 'accepted', 'declined'])

export const paymentTypeSchema = z.enum(['payg', 'plan', 'sessionPack'])
export const paymentStatusSchema = z.enum(['pending', 'paid', 'requested', 'refunded', 'rejected'])
export const paymentMethodSchema = z.enum(['cash', 'card', 'instapay']).nullable()

const stateSet = new Set(clientSessionStateSchema.options)

export const isoDateTimeString = z.union([z.string(), z.date()]).transform((value) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('Invalid date-time value')
  }
  return date.toISOString()
})

export const isoDateTimeStringOrNull = z.union([z.string(), z.date(), z.null()]).transform((value) => {
  if (value === null) {
    return null
  }
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('Invalid date-time value')
  }
  return date.toISOString()
})

export const nullableNumber = z.union([z.number(), z.string(), z.null()]).transform((value) => {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Invalid numeric value')
    }
    return value
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) {
    throw new TypeError('Invalid numeric value')
  }
  return parsed
})

export const noteSchema = z
  .object({
    id: z.string(),
    content: z.string().nullable(),
    classification: z.string(),
    clientId: z.string().nullable().optional(),
    clientSessionId: z.string().nullable().optional(),
    financeItemId: z.string().nullable().optional(),
    sessionId: z.string().nullable().optional(),
    sessionSeriesId: z.string().nullable().optional(),
  })
  .passthrough()

export const paymentSchema = z.object({
  trainerId: z.string(),
  id: z.string(),
  paymentType: paymentTypeSchema,
  contributionAmount: nullableNumber,
  paidAmount: z.union([z.number(), z.string()]).transform((value) => {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new TypeError('Invalid paid amount value')
      }
      return value
    }
    const trimmed = value.trim()
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed)) {
      throw new TypeError('Invalid paid amount value')
    }
    return parsed
  }),
  paymentMethod: paymentMethodSchema,
  paidDate: isoDateTimeStringOrNull,
  status: paymentStatusSchema,
  stripeCharge: z.string().nullable(),
  stripeRefund: z.string().nullable(),
  clientSessionId: z.string(),
  sessionPackId: z.string().nullable(),
  planId: z.string().nullable(),
  createdAt: isoDateTimeString,
  updatedAt: isoDateTimeString,
})

export const clientSessionSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  sessionId: z.string(),
  createdAt: isoDateTimeString,
  state: clientSessionStateSchema,
  bookingQuestion: z.string().nullable(),
  bookingQuestionResponse: z.string().nullable(),
  price: nullableNumber,
  attended: z.boolean().nullable(),
  payment: paymentSchema.nullable(),
  notes: z.array(noteSchema),
  saleId: z.string().nullable(),
  cancelTime: isoDateTimeStringOrNull,
  cancelReason: z.string().nullable(),
  acceptTime: isoDateTimeStringOrNull,
  declineTime: isoDateTimeStringOrNull,
  inviteTime: isoDateTimeStringOrNull,
  confirmTime: isoDateTimeStringOrNull,
})

export const clientSessionListSchema = z.array(clientSessionSchema)

export const normalizeClientSessionState = (value: unknown): z.infer<typeof clientSessionStateSchema> => {
  if (typeof value !== 'string') {
    throw new TypeError('Client session state is missing or invalid')
  }
  const trimmed = value.trim()
  if (!stateSet.has(trimmed as z.infer<typeof clientSessionStateSchema>)) {
    throw new Error(`Unexpected client session state: ${value}`)
  }
  return trimmed as z.infer<typeof clientSessionStateSchema>
}

export const parseNullableBoolean = (value: unknown, label: string) => {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'boolean') {
    throw new TypeError(`Invalid ${label} value`)
  }
  return value
}

export const parseNullableString = (value: unknown) => {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  throw new Error('Expected value to be convertible to string')
}

export const adaptPayment = (value: unknown) => {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'object') {
    throw new TypeError('Payment value was not an object')
  }
  return paymentSchema.parse(value)
}

export const adaptNotes = (value: unknown) => {
  if (value === null || value === undefined) {
    return [] as z.infer<typeof noteSchema>[]
  }
  if (!Array.isArray(value)) {
    throw new TypeError('Notes value was not an array')
  }
  return z.array(noteSchema).parse(value)
}

export type RawClientSessionRow = {
  id: string | null | undefined
  clientId: string | null | undefined
  sessionId: string | null | undefined
  createdAt: string | Date | null | undefined
  state: string | null | undefined
  bookingQuestion: unknown
  bookingQuestionResponse: unknown
  price: unknown
  attended: unknown
  payment: unknown
  notes: unknown
  saleId: unknown
  cancelTime: string | Date | null | undefined
  cancelReason: unknown
  acceptTime: string | Date | null | undefined
  declineTime: string | Date | null | undefined
  inviteTime: string | Date | null | undefined
  confirmTime: string | Date | null | undefined
}

const ensureStringIdentifier = (value: string | null | undefined, label: string) => {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
  }
  throw new Error(`Client session row missing ${label}`)
}

export const adaptClientSessionRow = (row: RawClientSessionRow) => {
  const id = ensureStringIdentifier(row.id, 'id')
  const clientId = ensureStringIdentifier(row.clientId, 'clientId')
  const sessionId = ensureStringIdentifier(row.sessionId, 'sessionId')

  if (!row.createdAt) {
    throw new Error('Client session row is missing createdAt')
  }

  const createdAt = isoDateTimeString.parse(row.createdAt)

  const adapted = {
    id,
    clientId,
    sessionId,
    createdAt,
    state: normalizeClientSessionState(row.state),
    bookingQuestion: parseNullableString(row.bookingQuestion),
    bookingQuestionResponse: parseNullableString(row.bookingQuestionResponse),
    price: nullableNumber.parse(row.price ?? null),
    attended: parseNullableBoolean(row.attended, 'attended'),
    payment: adaptPayment(row.payment),
    notes: adaptNotes(row.notes),
    saleId: parseNullableString(row.saleId),
    cancelTime: isoDateTimeStringOrNull.parse(row.cancelTime ?? null),
    cancelReason: parseNullableString(row.cancelReason),
    acceptTime: isoDateTimeStringOrNull.parse(row.acceptTime ?? null),
    declineTime: isoDateTimeStringOrNull.parse(row.declineTime ?? null),
    inviteTime: isoDateTimeStringOrNull.parse(row.inviteTime ?? null),
    confirmTime: isoDateTimeStringOrNull.parse(row.confirmTime ?? null),
  }

  return clientSessionSchema.parse(adapted)
}
