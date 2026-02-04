import { z } from 'zod'
import type { Selectable, VwLegacyPlan } from '@/lib/db'

export const isoDateTimeString = z.string().datetime({ offset: true })

export const planPaymentStatusSchema = z.enum(['paid', 'rejected', 'refunded', 'cancelled', 'paused', 'pending'])

export type PlanPaymentStatus = z.infer<typeof planPaymentStatusSchema>

export const planPaymentSchema = z.object({
  id: z.string(),
  date: isoDateTimeString,
  amount: z.number(),
  outstandingAmount: z.number(),
  status: planPaymentStatusSchema,
  planId: z.string(),
  currency: z.string(),
})

export type PlanPayment = z.infer<typeof planPaymentSchema>

export const planPauseSchema = z.object({
  id: z.string(),
  planId: z.string(),
  startDate: isoDateTimeString.optional(),
  endDate: isoDateTimeString.nullable().optional(),
  reminderDate: isoDateTimeString.nullable().optional(),
})

export type PlanPause = z.infer<typeof planPauseSchema>

export const sessionSeriesIdListSchema = z.array(z.string())

export const planFrequencyValues = [7, 14, 21, 28] as const
export type PlanFrequency = (typeof planFrequencyValues)[number]

export const planSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  amount: z.number(),
  clientId: z.string(),
  currency: z.string(),
  startDate: isoDateTimeString.optional(),
  endDate: isoDateTimeString.nullable().optional(),
  frequency: z.union([z.literal(7), z.literal(14), z.literal(21), z.literal(28)]).optional(),
  planPayments: z.array(planPaymentSchema).optional(),
  planPauses: z.array(planPauseSchema).optional(),
  nextPaymentDate: isoDateTimeString.nullable().optional(),
  lastPaymentDate: isoDateTimeString.nullable().optional(),
  sessionSeriesIds: sessionSeriesIdListSchema.optional(),
})

export type Plan = z.infer<typeof planSchema>
export type RawPlanRow = Selectable<VwLegacyPlan>

const ensureIsoDateTimeString = (value: unknown, label: string): string => {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError(`Invalid ${label}`)
    }
    return value.toISOString()
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      throw new Error(`Invalid ${label}`)
    }

    const parsed = new Date(trimmed)
    if (Number.isNaN(parsed.getTime())) {
      throw new TypeError(`Invalid ${label}`)
    }

    return parsed.toISOString()
  }

  throw new Error(`Invalid ${label}`)
}

const toOptionalIsoDateTimeString = (value: Date | string | null | undefined, label: string): string | undefined => {
  if (value === null || value === undefined) {
    return undefined
  }

  return ensureIsoDateTimeString(value, label)
}

const toNullableIsoDateTimeString = (
  value: Date | string | null | undefined,
  label: string
): string | null | undefined => {
  if (value === undefined) {
    return undefined
  }

  if (value === null) {
    return null
  }

  return ensureIsoDateTimeString(value, label)
}

const ensureNumber = (value: unknown, label: string): number => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Invalid ${label}`)
    }
    return value
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      throw new Error(`Invalid ${label}`)
    }

    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed)) {
      throw new TypeError(`Invalid ${label}`)
    }

    return parsed
  }

  throw new Error(`Invalid ${label}`)
}

const ensureString = (value: unknown, label: string): string => {
  if (typeof value === 'string') {
    return value
  }

  throw new Error(`Invalid ${label}`)
}

const ensurePlanPaymentStatus = (value: unknown, label: string): PlanPaymentStatus => {
  if (typeof value !== 'string') {
    throw new TypeError(`Invalid ${label}`)
  }

  if (!planPaymentStatusSchema.options.includes(value as PlanPaymentStatus)) {
    throw new Error(`Invalid ${label}`)
  }

  return value as PlanPaymentStatus
}

const parsePlanPayments = (value: unknown): PlanPayment[] => {
  if (value === null || value === undefined) {
    return []
  }

  if (!Array.isArray(value)) {
    throw new TypeError('Invalid plan payments payload')
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Invalid plan payment at index ${index}`)
    }

    const record = entry as Record<string, unknown>

    return planPaymentSchema.parse({
      id: ensureString(record.id, `plan payment id at index ${index}`),
      date: ensureIsoDateTimeString(record.date, `plan payment date at index ${index}`),
      amount: ensureNumber(record.amount, `plan payment amount at index ${index}`),
      outstandingAmount: ensureNumber(record.outstandingAmount, `plan payment outstanding amount at index ${index}`),
      status: ensurePlanPaymentStatus(record.status, `plan payment status at index ${index}`),
      planId: ensureString(record.planId, `plan payment plan id at index ${index}`),
      currency: ensureString(record.currency, `plan payment currency at index ${index}`),
    })
  })
}

const parsePlanPauses = (value: unknown): PlanPause[] => {
  if (value === null || value === undefined) {
    return []
  }

  if (!Array.isArray(value)) {
    throw new TypeError('Invalid plan pauses payload')
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Invalid plan pause at index ${index}`)
    }

    const record = entry as Record<string, unknown>

    const pause: Partial<PlanPause> & {
      id: string
      planId: string
    } = {
      id: ensureString(record.id, `plan pause id at index ${index}`),
      planId: ensureString(record.planId, `plan pause plan id at index ${index}`),
    }

    if (record.startDate !== undefined && record.startDate !== null) {
      pause.startDate = ensureIsoDateTimeString(record.startDate, `plan pause start date at index ${index}`)
    }

    if (record.endDate !== undefined) {
      pause.endDate =
        record.endDate === null
          ? null
          : ensureIsoDateTimeString(record.endDate, `plan pause end date at index ${index}`)
    }

    if (record.reminderDate !== undefined) {
      pause.reminderDate =
        record.reminderDate === null
          ? null
          : ensureIsoDateTimeString(record.reminderDate, `plan pause reminder date at index ${index}`)
    }

    return planPauseSchema.parse(pause)
  })
}

const parseSessionSeriesIds = (value: unknown): string[] => {
  if (value === null || value === undefined) {
    return []
  }

  if (!Array.isArray(value)) {
    throw new TypeError('Invalid session series ids payload')
  }

  const normalized = value.map((entry, index) => {
    if (typeof entry === 'string') {
      return entry
    }

    if (typeof entry === 'number') {
      return entry.toString()
    }

    throw new Error(`Invalid session series id at index ${index}`)
  })

  return sessionSeriesIdListSchema.parse(normalized)
}

const parseFrequency = (value: unknown): PlanFrequency | undefined => {
  if (value === null || value === undefined) {
    return undefined
  }

  const frequency = ensureNumber(value, 'plan frequency')
  if (!planFrequencyValues.includes(frequency as PlanFrequency)) {
    throw new Error(`Invalid plan frequency: ${frequency}`)
  }

  return frequency as PlanFrequency
}

export const normalizePlanRow = (row: RawPlanRow): Plan => {
  const plan: Partial<Plan> & {
    id: string
    name: string
    status: string
    amount: number
    clientId: string
    currency: string
    planPayments: PlanPayment[]
    planPauses: PlanPause[]
    sessionSeriesIds: string[]
  } = {
    id: ensureString(row.id, 'plan id'),
    name: ensureString(row.name, 'plan name'),
    status: ensureString(row.status, 'plan status'),
    amount: ensureNumber(row.amount, 'plan amount'),
    clientId: ensureString(row.clientId, 'plan client id'),
    currency: ensureString(row.currency, 'plan currency'),
    planPayments: parsePlanPayments(row.planPayments),
    planPauses: parsePlanPauses(row.planPauses),
    sessionSeriesIds: parseSessionSeriesIds(row.sessionSeriesIds),
  }

  const startDate = toOptionalIsoDateTimeString(row.startDate, 'plan start date')
  if (startDate !== undefined) {
    plan.startDate = startDate
  }

  const endDate = toNullableIsoDateTimeString(row.endDate, 'plan end date')
  if (endDate !== undefined) {
    plan.endDate = endDate
  }

  const frequency = parseFrequency(row.frequency)
  if (frequency !== undefined) {
    plan.frequency = frequency
  }

  const nextPaymentDate = toNullableIsoDateTimeString(row.nextPaymentDate, 'plan next payment date')
  if (nextPaymentDate !== undefined) {
    plan.nextPaymentDate = nextPaymentDate
  }

  const lastPaymentDate = toNullableIsoDateTimeString(row.lastPaymentDate, 'plan last payment date')
  if (lastPaymentDate !== undefined) {
    plan.lastPaymentDate = lastPaymentDate
  }

  return planSchema.parse(plan)
}
