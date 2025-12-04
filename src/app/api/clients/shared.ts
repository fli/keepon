import { z } from 'zod'
import type { Selectable, VwLegacyClient } from '@/lib/db'

const isoDateTimeString = z.union([z.string(), z.date()]).transform((value) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid date-time value')
  }
  return date.toISOString()
})

const isoDateString = z.union([z.string(), z.date()]).transform((value) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid date value')
  }
  return date.toISOString().slice(0, 10)
})

const sessionPackSchema = z.object({
  id: z.string(),
  trainerId: z.string(),
  name: z.string(),
  amount: z.number(),
  sessionsTotal: z.number(),
  sessionsRemaining: z.number(),
  paymentStatus: z.enum(['requested', 'rejected', 'paid', 'refunded', 'pending']),
  paymentMethod: z.enum(['card', 'cash']),
  stripeCharge: z.string().nullable(),
  stripeRefund: z.string().nullable(),
  clientId: z.string(),
  createdAt: isoDateTimeString,
})

const paymentPlanPaymentSchema = z.object({
  id: z.string(),
  date: isoDateTimeString,
  amount: z.number(),
  outstandingAmount: z.number(),
  status: z.enum(['paid', 'rejected', 'refunded', 'cancelled', 'paused', 'pending']),
  planId: z.string(),
  currency: z.string(),
})

const paymentPlanPauseSchema = z.object({
  id: z.string(),
  planId: z.string(),
  startDate: isoDateTimeString.optional(),
  endDate: isoDateTimeString.nullable().optional(),
  reminderDate: isoDateTimeString.nullable().optional(),
})

const paymentPlanSchema = z.object({
  name: z.string(),
  status: z.string(),
  amount: z.number(),
  id: z.string(),
  clientId: z.string(),
  currency: z.string(),
  startDate: isoDateTimeString.optional(),
  endDate: isoDateTimeString.nullable().optional(),
  frequency: z.union([z.literal(7), z.literal(14), z.literal(21), z.literal(28)]).optional(),
  planPayments: z.array(paymentPlanPaymentSchema).optional(),
  planPauses: z.array(paymentPlanPauseSchema).optional(),
  nextPaymentDate: isoDateTimeString.nullable().optional(),
  lastPaymentDate: isoDateTimeString.nullable().optional(),
  sessionSeriesIds: z.array(z.string()).optional(),
})

const clientNoteSchema = z.object({
  id: z.string(),
  content: z.string(),
  classification: z.enum(['notes', 'goals', 'medication', 'currentInjuries', 'pastInjuries']),
  clientId: z.string(),
})

const geoSchema = z
  .object({
    lat: z.number(),
    lng: z.number(),
  })
  .or(
    z.object({
      lat: z.null(),
      lng: z.null(),
    })
  )
  .nullable()

export const clientSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string().nullable().optional(),
  status: z.enum(['current', 'past', 'lead']),
  trainerId: z.string(),
  memberId: z.string(),
  email: z.string().email().nullable().optional(),
  profileImageURL: z.string().nullable().optional(),
  mobileNumber: z.string().nullable().optional(),
  otherNumber: z.string().nullable().optional(),
  emergencyContactName: z.string().nullable().optional(),
  emergencyContactMobileNumber: z.string().nullable().optional(),
  stripeCustomer: z.string().nullable().optional(),
  cardLast4Digits: z.string().nullable().optional(),
  cardBrand: z.string().nullable().optional(),
  termsAccepted: z.boolean().optional(),
  sessionPacks: z.array(sessionPackSchema).optional(),
  notes: z.array(clientNoteSchema).optional(),
  birthday: isoDateString.nullable().optional(),
  plans: z.array(paymentPlanSchema).optional(),
  company: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  geo: geoSchema.optional(),
  googlePlaceId: z.string().nullable().optional(),
})

export const clientListSchema = z.array(clientSchema)

export type Client = z.infer<typeof clientSchema>

export const adaptClientRow = (row: Selectable<VwLegacyClient>) => ({
  id: row.id,
  firstName: row.firstName,
  lastName: row.lastName,
  status: row.status,
  trainerId: row.trainerId,
  memberId: row.memberId,
  email: row.email,
  profileImageURL: row.profileImageURL,
  mobileNumber: row.mobileNumber,
  otherNumber: row.otherNumber,
  emergencyContactName: row.emergencyContactName,
  emergencyContactMobileNumber: row.emergencyContactMobileNumber,
  stripeCustomer: row.stripeCustomer,
  cardLast4Digits: row.cardLast4Digits,
  cardBrand: row.cardBrand,
  termsAccepted: row.termsAccepted ?? undefined,
  sessionPacks: (row.sessionPacks ?? []) as unknown,
  notes: (row.notes ?? []) as unknown,
  birthday: row.birthday ?? null,
  plans: (row.plans ?? []) as unknown,
  company: row.company,
  location: row.location,
  address: row.address,
  geo: row.geo as unknown,
  googlePlaceId: row.googlePlaceId,
})
