import { z } from 'zod'

export const paymentPlanStatusSchema = z.enum(['active', 'cancelled', 'ended', 'paused', 'pending'])

export type PaymentPlanStatus = z.infer<typeof paymentPlanStatusSchema>

export const isoDateTimeString = z.string().datetime({ offset: true })

export const paymentPlanSchema = z.object({
  createdAt: isoDateTimeString,
  updatedAt: isoDateTimeString,
  id: z.string(),
  status: paymentPlanStatusSchema,
  startAt: isoDateTimeString,
  requestedEndAt: isoDateTimeString,
  endAt: isoDateTimeString.nullable(),
  weeklyRecurrenceInterval: z.number(),
  name: z.string(),
  requestedAmount: z.string(),
  amount: z.string().nullable(),
  requestSentAt: isoDateTimeString.nullable(),
  currency: z.string(),
})

export const paymentPlanListSchema = z.array(paymentPlanSchema)

export type PaymentPlan = z.infer<typeof paymentPlanSchema>

export type PaymentPlanRow = {
  id: string
  status: string
  createdAt: Date | string
  updatedAt: Date | string
  startAt: Date | string
  requestedEndAt: Date | string
  endAt: Date | string | null
  weeklyRecurrenceInterval: number | string
  name: string
  requestedAmount: string | number
  amount: string | number | null
  requestSentAt: Date | string | null
  currency: string
}

export const parseStatus = (value: string): PaymentPlanStatus => {
  const normalized = value.trim().toLowerCase()
  const parsed = paymentPlanStatusSchema.safeParse(normalized)
  if (!parsed.success) {
    throw new Error(`Unexpected payment plan status: ${value}`)
  }
  return parsed.data
}

export const toIsoString = (value: Date | string) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid date value encountered in payment plan record')
  }
  return date.toISOString()
}

export const toOptionalIsoString = (value: Date | string | null | undefined) => {
  if (value === null || value === undefined) {
    return null
  }
  return toIsoString(value)
}

export const parseAmount = (value: string | number | null, label: string): string | null => {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid ${label} value encountered in payment plan record`)
    }
    return value.toFixed(2)
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new Error(`Empty ${label} value encountered in payment plan record`)
  }
  return trimmed
}

export const parseRequiredAmount = (value: string | number, label: string): string => {
  const result = parseAmount(value, label)
  if (result === null) {
    throw new Error(`Missing ${label} value encountered in payment plan record`)
  }
  return result
}

export const parseNumberValue = (value: number | string, label: string): number => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid ${label} value encountered in payment plan record`)
    }
    return value
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new Error(`Empty ${label} value encountered in payment plan record`)
  }
  const numeric = Number(trimmed)
  if (Number.isNaN(numeric)) {
    throw new Error(`Invalid ${label} value encountered in payment plan record`)
  }
  return numeric
}
