import { z } from 'zod'

const numericString = z.union([z.string(), z.number()]).transform((value) => {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
})

const dateOrString = z.union([z.string(), z.date()]).transform((value) => {
  if (value instanceof Date) {
    return value
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
})

export const loginResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  trainerId: z.string(),
})

export const trainerSchema = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  defaultCurrency: z.string().nullable().optional(),
  subscriptionStatus: z.string().nullable().optional(),
})

export const clientSchema = z.object({
  id: z.string(),
  trainerId: z.string().optional(),
  firstName: z.string().default(''),
  lastName: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  mobileNumber: z.string().nullable().optional(),
  otherNumber: z.string().nullable().optional(),
  status: z.string().default('current'),
  company: z.string().nullable().optional(),
  profileImageURL: z.string().url().nullable().optional(),
})

export const productSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  price: numericString,
  currency: z.string(),
  durationMinutes: z.number().int().nullable().optional(),
  totalCredits: z.number().int().nullable().optional(),
  description: z.string().nullable().optional(),
  bookableOnline: z.boolean().optional(),
})

export const serviceProductSchema = productSchema.extend({
  bookableOnline: z.boolean(),
})

export const saleSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  clientSessionId: z.string().nullable().optional(),
  paymentRequested: z.boolean().optional(),
  paymentRequestPassOnTransactionFee: z.boolean().optional(),
  note: z.string().nullable().optional(),
  dueAt: z.string().nullable().optional(),
})

export const saleProductSchema = z.object({
  id: z.string(),
  saleId: z.string(),
  productId: z.string().nullable().optional(),
  clientId: z.string(),
  type: z.string(),
  name: z.string(),
  price: numericString,
  currency: z.string(),
  totalCredits: z.number().int().nullable().optional(),
  creditsUsed: z.number().int().nullable().optional(),
  durationMinutes: z.number().int().nullable().optional(),
  location: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  googlePlaceId: z.string().nullable().optional(),
  quantity: z.number().int().nullable().optional(),
})

export const salePaymentSchema = z.object({
  id: z.string(),
  saleId: z.string(),
  clientId: z.string(),
  type: z.string(),
  amount: numericString,
  amountRefunded: numericString.nullish(),
  currency: z.string(),
  method: z.string().nullable().optional(),
  specificMethodName: z.string().nullable().optional(),
  saleCreditPackId: z.string().nullable().optional(),
  creditsUsed: z.number().int().nullable().optional(),
  paymentPlanId: z.string().nullable().optional(),
  transactionFee: numericString.nullish(),
  transactedAt: dateOrString,
  createdAt: dateOrString,
  updatedAt: dateOrString,
})

export const clientSessionSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  sessionId: z.string(),
  price: numericString.nullish(),
  state: z.enum(['maybe', 'cancelled', 'invited', 'confirmed', 'accepted', 'declined']).optional(),
  attended: z.boolean().nullable().optional(),
  createdAt: dateOrString.optional(),
  saleId: z.string().nullable().optional(),
})

export const sessionSchema = z.object({
  id: z.string(),
  sessionSeriesId: z.string(),
  name: z.string().nullable().optional(),
  type: z.enum(['event', 'single', 'group']).nullable().optional(),
  timezone: z.string().default('UTC'),
  date: z.string(),
  length: numericString,
  clientSessions: z.array(clientSessionSchema).default([]),
  location: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  startTime: dateOrString.optional(),
  bufferMinutesBefore: z.number().int().nullable().optional(),
  bufferMinutesAfter: z.number().int().nullable().optional(),
  maximumAttendance: z.number().int().nullable().optional(),
  bookableOnline: z.boolean().optional(),
  description: z.string().nullable().optional(),
})

export const sessionSeriesSchema = z.object({
  id: z.string(),
  trainerId: z.string(),
  createdAt: dateOrString.optional(),
  sessionType: z.enum(['event', 'single', 'group']).default('single'),
  sessionName: z.string().nullable().optional(),
  sessionColor: z.string().nullable().optional(),
  avatarName: z.string().nullable().optional(),
  imageURL: z.string().url().nullable().optional(),
  sessionLength: numericString,
  timezone: z.string().default('UTC'),
  startDate: z.string().optional(),
  endDate: z.string().nullable().optional(),
  repeatsEvery: numericString.nullable().optional(),
  reminderHours: numericString.nullable().optional(),
  location: z.string().nullable().optional(),
  price: numericString.nullable().optional(),
  currency: z.string().optional(),
  sessions: z.array(sessionSchema).default([]),
})

export const stripeRequiresActionSchema = z.object({
  requiresAction: z.literal(true),
  paymentIntentClientSecret: z.string(),
})

export type LoginResponse = z.infer<typeof loginResponseSchema>
export type Trainer = z.infer<typeof trainerSchema>
export type Client = z.infer<typeof clientSchema>
export type Product = z.infer<typeof productSchema>
export type ServiceProduct = z.infer<typeof serviceProductSchema>
export type Sale = z.infer<typeof saleSchema>
export type SaleProduct = z.infer<typeof saleProductSchema>
export type SalePayment = z.infer<typeof salePaymentSchema>
export type ClientSession = z.infer<typeof clientSessionSchema>
export type Session = z.infer<typeof sessionSchema>
export type SessionSeries = z.infer<typeof sessionSeriesSchema>
