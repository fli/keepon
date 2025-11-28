import { os } from '@orpc/server'
import type { RouterClient } from '@orpc/server'
import { z } from 'zod'

const greetingInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'name must not be empty')
      .max(64, 'name is too long')
      .optional(),
  })
  .optional()

export const health = os.handler(async () => ({
  status: 'ok' as const,
  timestamp: new Date().toISOString(),
}))

export const greeting = os
  .input(greetingInputSchema)
  .handler(async ({ input }) => {
    const name = input?.name?.trim()
    const safeName = name && name.length > 0 ? name : 'friend'

    return {
      message: `Hello, ${safeName}!`,
      timestamp: new Date().toISOString(),
    }
  })

const getApiBase = (ctx?: { request?: Request }) => {
  if (ctx?.request) {
    const url = new URL(ctx.request.url)
    return `${url.protocol}//${url.host}`
  }

  return process.env.ORPC_API_BASE_URL ?? 'http://localhost:3001'
}

const buildBasicAuth = (token: string) => {
  if (typeof btoa === 'function') return `Basic ${btoa(token)}`
  if (typeof Buffer !== 'undefined') {
    return `Basic ${Buffer.from(token, 'utf8').toString('base64')}`
  }
  return `Basic ${token}`
}

async function apiFetch(path: string, init: RequestInit, ctx?: { request?: Request }) {
  const base = getApiBase(ctx)
  const res = await fetch(`${base}${path}`, init)
  const text = await res.text()
  let json: unknown = null
  if (text.trim().length > 0) {
    try {
      json = JSON.parse(text)
    } catch {
      json = text
    }
  }

  if (!res.ok) {
    const message =
      (json as { error?: { message?: string }; message?: string })?.error?.message ??
      (json as { message?: string })?.message ??
      res.statusText
    throw new Error(message || 'Request failed')
  }

  return json
}

const loginResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  trainerId: z.string(),
})

const signupBaseSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().optional(),
  country: z.string().trim().length(2),
  timezone: z.string().trim().min(1),
  locale: z.string().trim().min(1),
  businessName: z.string().trim().optional(),
  industry: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  brandColor: z.string().trim().optional(),
  partner: z.string().trim().optional(),
})

const signupInputSchema = z.union([
  signupBaseSchema.extend({
    email: z.string().email(),
    password: z.string().min(5),
  }),
  signupBaseSchema.extend({
    signInWithAppleIdentityToken: z.string().min(1),
    signInWithAppleNonce: z.string().min(1).optional(),
  }),
])

const numeric = z.union([z.string(), z.number()]).transform(value => {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
})

const clientSchema = z.object({
  id: z.string(),
  trainerId: z.string().optional(),
  firstName: z.string().default(''),
  lastName: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  mobileNumber: z.string().nullable().optional(),
  status: z.string().default('current'),
  company: z.string().nullable().optional(),
  profileImageURL: z.string().nullable().optional(),
})

const productSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  price: numeric,
  currency: z.string(),
  durationMinutes: z.number().int().nullable().optional(),
  totalCredits: z.number().int().nullable().optional(),
  description: z.string().nullable().optional(),
})

const saleSchema = z.object({
  id: z.string(),
})

const saleProductSchema = z.object({
  id: z.string(),
  saleId: z.string(),
  productId: z.string().nullable().optional(),
  clientId: z.string(),
  type: z.string(),
  name: z.string(),
  price: numeric,
  currency: z.string(),
  totalCredits: z.number().int().nullable().optional(),
  creditsUsed: z.number().int().nullable().optional(),
  durationMinutes: z.number().int().nullable().optional(),
  location: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  googlePlaceId: z.string().nullable().optional(),
  quantity: z.number().int().nullable().optional(),
})

const salePaymentSchema = z.object({
  id: z.string(),
  saleId: z.string(),
  clientId: z.string(),
  type: z.string(),
  amount: numeric,
  amountRefunded: numeric.nullish(),
  currency: z.string(),
  method: z.string().nullable().optional(),
  specificMethodName: z.string().nullable().optional(),
  saleCreditPackId: z.string().nullable().optional(),
  creditsUsed: z.number().int().nullable().optional(),
  paymentPlanId: z.string().nullable().optional(),
  transactionFee: numeric.nullish(),
  transactedAt: z.union([z.string(), z.date()]),
  createdAt: z.union([z.string(), z.date()]),
  updatedAt: z.union([z.string(), z.date()]),
})

export const appRouter = os.router({
  health: {
    ping: health,
  },
  greeting: {
    welcome: greeting,
  },
  auth: {
    login: os
      .input(
        z.union([
          z.object({
            email: z.string().email(),
            password: z.string().min(1),
          }),
          z.object({
            signInWithAppleIdentityToken: z.string().min(1),
          }),
        ])
      )
      .handler(async ({ input, context }) => {
        const apiCtx = context as { request?: Request }
        const json = await apiFetch('/api/members/login', {
          method: 'POST',
          body: JSON.stringify(input),
          headers: { 'content-type': 'application/json' },
        }, apiCtx)

        const parsed = loginResponseSchema.parse(json)
        return { token: parsed.id, userId: parsed.userId, trainerId: parsed.trainerId }
      }),
    signup: os
      .input(signupInputSchema)
      .handler(async ({ input, context }) => {
        const apiCtx = context as { request?: Request }
        const payload =
          'country' in input
            ? { ...input, country: input.country.toUpperCase() }
            : input

        // Debug: log signup payload shape to diagnose validation issues
        if (process.env.NODE_ENV !== 'production') {
          console.log('ORPC signup input', payload)
        }

        const json = await apiFetch(
          '/api/trainers',
          {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'content-type': 'application/json' },
          },
          apiCtx
        )

        const parsed = loginResponseSchema.parse(json)
        return { token: parsed.id, userId: parsed.userId, trainerId: parsed.trainerId }
      }),
    logout: os
      .input(z.object({ token: z.string().min(1) }))
      .handler(async ({ input, context }) => {
        const apiCtx = context as { request?: Request }
        await apiFetch(
          '/api/members/logout',
          {
            method: 'POST',
            headers: {
              Authorization: buildBasicAuth(input.token),
            },
          },
          apiCtx
        )

        return { ok: true as const }
      }),
  },
  clients: {
    list: os
      .input(
        z.object({
          token: z.string().min(1),
          trainerId: z.string().min(1),
          sessionId: z.string().uuid().optional(),
        })
      )
      .handler(async ({ input, context }) => {
        const apiCtx = context as { request?: Request }
        const search = input.sessionId ? `?sessionId=${encodeURIComponent(input.sessionId)}` : ''
        const json = await apiFetch(
          `/api/trainers/${input.trainerId}/clients${search}`,
          {
            headers: {
              Authorization: buildBasicAuth(input.token),
            },
          },
          apiCtx
        )

        return z.array(clientSchema).parse(json)
      }),
    create: os
      .input(
        z.object({
          token: z.string().min(1),
          trainerId: z.string().min(1),
          firstName: z.string().trim().min(1),
          lastName: z.string().trim().optional(),
          email: z.string().trim().email().optional(),
          mobileNumber: z.string().trim().optional(),
          otherNumber: z.string().trim().optional(),
          status: z.enum(['current', 'lead', 'past']).default('current'),
          company: z.string().trim().optional(),
          location: z.string().trim().optional(),
          address: z.string().trim().optional(),
          googlePlaceId: z.string().trim().optional(),
        })
      )
      .handler(async ({ input, context }) => {
        const { token, trainerId, ...body } = input
        const apiCtx = context as { request?: Request }

        const normalize = (value?: string) => {
          if (value === undefined) return undefined
          const trimmed = value.trim()
          return trimmed.length === 0 ? null : trimmed
        }

        const payload = {
          ...body,
          firstName: body.firstName.trim(),
          lastName: normalize(body.lastName),
          email: normalize(body.email),
          mobileNumber: normalize(body.mobileNumber),
          otherNumber: normalize(body.otherNumber),
          company: normalize(body.company),
          location: normalize(body.location),
          address: normalize(body.address),
          googlePlaceId: normalize(body.googlePlaceId),
          status: body.status ?? 'current',
        }

        const json = await apiFetch(
          `/api/trainers/${trainerId}/clients`,
          {
            method: 'POST',
            headers: {
              Authorization: buildBasicAuth(token),
              'content-type': 'application/json',
            },
            body: JSON.stringify(payload),
          },
          apiCtx
        )

        return clientSchema.parse(json)
      }),
  },
  products: {
    list: os
      .input(z.object({ token: z.string().min(1) }))
      .handler(async ({ input, context }) => {
        const apiCtx = context as { request?: Request }
        const json = await apiFetch(
          '/api/products',
          {
            headers: {
              Authorization: buildBasicAuth(input.token),
            },
          },
          apiCtx
        )

        return z.array(productSchema).parse(json)
      }),
  },
  sales: {
    create: os
      .input(
        z.object({
          token: z.string().min(1),
          trainerId: z.string().min(1),
          clientId: z.string().min(1),
          clientSessionId: z.string().uuid().nullable().optional(),
          dueAfter: z.string().nullable().optional(),
          note: z.string().nullable().optional(),
          paymentRequestPassOnTransactionFee: z.boolean().optional(),
        })
      )
      .handler(async ({ input, context }) => {
        const { token, trainerId: _trainerId, ...payload } = input
        const apiCtx = context as { request?: Request }
        const json = await apiFetch(
          '/api/sales',
          {
            method: 'POST',
            headers: {
              Authorization: buildBasicAuth(token),
              'content-type': 'application/json',
            },
            body: JSON.stringify(payload),
          },
          apiCtx
        )

        const parsed = saleSchema.pick({ id: true }).parse(json)
        return { id: parsed.id }
      }),
    requestPayment: os
      .input(z.object({ token: z.string().min(1), saleId: z.string().uuid() }))
      .handler(async ({ input, context }) => {
        const apiCtx = context as { request?: Request }
        await apiFetch(
          `/api/sales/${input.saleId}/paymentRequest`,
          {
            method: 'POST',
            headers: { Authorization: buildBasicAuth(input.token) },
          },
          apiCtx
        )
        return { status: 'requested' as const }
      }),
  },
  saleProducts: {
    create: os
      .input(
        z.object({
          token: z.string().min(1),
          saleId: z.string().uuid(),
          productId: z.string().optional(),
          price: z.union([z.string(), z.number()]).transform(v => v.toString()),
          currency: z.string().min(1),
          name: z.string().min(1),
          type: z.enum(['creditPack', 'item', 'service']),
          totalCredits: z.number().int().optional(),
          quantity: z.number().int().optional(),
          durationMinutes: z.number().int().optional(),
          location: z.string().nullable().optional(),
          address: z.string().nullable().optional(),
          googlePlaceId: z.string().nullable().optional(),
        })
      )
      .handler(async ({ input, context }) => {
        const { token, ...payload } = input
        const apiCtx = context as { request?: Request }
        const json = await apiFetch(
          '/api/saleProducts',
          {
            method: 'POST',
            headers: {
              Authorization: buildBasicAuth(token),
              'content-type': 'application/json',
            },
            body: JSON.stringify(payload),
          },
          apiCtx
        )

        return saleProductSchema.parse(json)
      }),
  },
  salePayments: {
    createManual: os
      .input(
        z.object({
          token: z.string().min(1),
          saleId: z.string().uuid(),
          amount: z.union([z.string(), z.number()]).transform(v => v.toString()),
          currency: z.string().min(1),
          method: z.enum(['cash', 'electronic']),
          specificMethodName: z.string().nullable().optional(),
        })
      )
      .handler(async ({ input, context }) => {
        const { token, ...payload } = input
        const apiCtx = context as { request?: Request }
        const json = await apiFetch(
          '/api/salePayments',
          {
            method: 'POST',
            headers: {
              Authorization: buildBasicAuth(token),
              'content-type': 'application/json',
            },
            body: JSON.stringify({ ...payload, type: 'manual' }),
          },
          apiCtx
        )

        return salePaymentSchema.parse(json)
      }),
  },
})

export type AppRouter = typeof appRouter
export type AppRouterClient = RouterClient<typeof appRouter>
