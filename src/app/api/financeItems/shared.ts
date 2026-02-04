import { z } from 'zod'

const isoDateTimeString = z.union([z.string(), z.date()]).transform((value) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('Invalid date-time value')
  }
  return date.toISOString()
})

const trimmedNullableString = z.union([z.string(), z.null(), z.undefined()]).transform((value) => {
  if (value === null || value === undefined) {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
})

export const financeItemNoteSchema = z.object({
  id: z.string(),
  content: trimmedNullableString,
  classification: z.literal('financeItem'),
  financeItemId: z.string(),
})

export const financeItemSchema = z.object({
  id: z.string(),
  trainerId: z.string(),
  amount: z.number(),
  imageUrl: z.string().nullable(),
  name: z.string().optional(),
  status: z.string().nullable().optional(),
  paymentType: z.string().nullable().optional(),
  stripeApplicationFeeId: z.string().nullable().optional(),
  startDate: isoDateTimeString.optional(),
  notes: z.array(financeItemNoteSchema).optional(),
  createdAt: isoDateTimeString.optional(),
  updatedAt: isoDateTimeString.optional(),
})

export const financeItemListSchema = z.array(financeItemSchema)

export type FinanceItemRow = {
  id: string | null
  trainerId: string | null
  amount: number | string | null
  imageUrl: string | null
  name: string | null
  status: string | null
  paymentType: string | null
  stripeApplicationFeeId: string | null
  startDate: Date | string | null
  createdAt: Date | string | null
  updatedAt: Date | string | null
  notes?: unknown
}

const ensureString = (value: unknown, label: string) => {
  if (typeof value !== 'string') {
    throw new TypeError(`${label} is missing or invalid`)
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new Error(`${label} is empty`)
  }
  return trimmed
}

const parseAmount = (value: unknown, label: string) => {
  if (value === null || value === undefined) {
    throw new Error(`${label} is missing`)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${label} is invalid`)
    }
    return value
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      throw new Error(`${label} is empty`)
    }
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed)) {
      throw new TypeError(`${label} is invalid`)
    }
    return parsed
  }
  throw new Error(`${label} is invalid`)
}

const parseNullableString = (value: unknown) => {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'string') {
    throw new TypeError('Expected value to be a string')
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const parseOptionalIsoDateTime = (value: Date | string | null | undefined): string | undefined => {
  if (value === null || value === undefined) {
    return undefined
  }
  return isoDateTimeString.parse(value)
}

const parseNotes = (value: unknown) => {
  if (value === null || value === undefined) {
    return [] as z.infer<typeof financeItemNoteSchema>[]
  }
  if (!Array.isArray(value)) {
    throw new TypeError('Finance item notes value was not an array')
  }
  return value.map((note, index) => {
    const parsed = financeItemNoteSchema.safeParse(note)
    if (!parsed.success) {
      const messages = parsed.error.issues.map((issue) => `${issue.message} (${issue.path.join('.')})`).join('; ')
      throw new Error(`Finance item note at index ${index} did not match schema: ${messages}`)
    }
    return parsed.data
  })
}

export const adaptFinanceItemRow = (row: FinanceItemRow): z.input<typeof financeItemSchema> => {
  const id = ensureString(row.id, 'Finance item id')
  const trainerId = ensureString(row.trainerId, 'Finance item trainer id')
  const amount = parseAmount(row.amount, 'Finance item amount')

  const imageUrl = parseNullableString(row.imageUrl)
  const status = parseNullableString(row.status)
  const paymentType = parseNullableString(row.paymentType)
  const stripeApplicationFeeId = parseNullableString(row.stripeApplicationFeeId)
  const notes = parseNotes(row.notes)

  const adapted: z.input<typeof financeItemSchema> = {
    id,
    trainerId,
    amount,
    imageUrl,
    status,
    paymentType,
    stripeApplicationFeeId,
  }

  if (notes.length > 0) {
    adapted.notes = notes
  }

  const name = parseNullableString(row.name)
  if (name) {
    adapted.name = name
  }

  const startDate = parseOptionalIsoDateTime(row.startDate)
  if (startDate) {
    adapted.startDate = startDate
  }

  const createdAt = parseOptionalIsoDateTime(row.createdAt)
  if (createdAt) {
    adapted.createdAt = createdAt
  }

  const updatedAt = parseOptionalIsoDateTime(row.updatedAt)
  if (updatedAt) {
    adapted.updatedAt = updatedAt
  }

  return adapted
}

export type FinanceItem = z.infer<typeof financeItemSchema>
export type FinanceItemList = z.infer<typeof financeItemListSchema>
