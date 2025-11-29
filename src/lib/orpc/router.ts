import { os } from '@orpc/server'
import type { RouterClient } from '@orpc/server'
import { z } from 'zod'

import { login, logout } from '@/server/auth'
import { createTrainerAccount, trainerSignupSchema } from '@/server/trainers'
import { listProducts } from '@/server/products'
import {
  listClientsForTrainer,
  createClientForTrainer,
} from '@/server/clients'
import {
  createSaleForTrainer,
  requestPaymentForSale,
} from '@/server/sales'
import { createSaleProductForTrainer } from '@/server/saleProducts'
import { createManualSalePaymentForTrainer } from '@/server/salePayments'
import { validateTrainerToken } from '@/app/api/_lib/accessToken'

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

const loginResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  trainerId: z.string(),
})

const signupInputSchema = trainerSignupSchema

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
  bookableOnline: z.boolean().optional(),
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

const serviceProductSchema = productSchema.extend({
  bookableOnline: z.boolean(),
  durationMinutes: z.number().int().nullable().optional(),
})

export const appRouter = os.router({
  health: {
    ping: os.handler(async () => ({
      status: 'ok' as const,
      timestamp: new Date().toISOString(),
    })),
  },
  greeting: {
    welcome: os
      .input(greetingInputSchema)
      .handler(async ({ input }) => {
        const name = input?.name?.trim()
        const safeName = name && name.length > 0 ? name : 'friend'

        return {
          message: `Hello, ${safeName}!`,
          timestamp: new Date().toISOString(),
        }
      }),
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
      .handler(async ({ input }) => {
        const parsed = loginResponseSchema.parse(await login(input))
        return { token: parsed.id, userId: parsed.userId, trainerId: parsed.trainerId }
      }),
    signup: os
      .input(signupInputSchema)
      .handler(async ({ input }) => {
        const payload =
          'country' in input
            ? { ...input, country: input.country.toUpperCase() }
            : input

        const parsed = loginResponseSchema.parse(await createTrainerAccount(payload))
        return { token: parsed.id, userId: parsed.userId, trainerId: parsed.trainerId }
      }),
    logout: os
      .input(z.object({ token: z.string().min(1) }))
      .handler(async ({ input }) => {
        await logout(input.token)

        return { ok: true as const }
      }),
  },
  clients: {
    list: os
      .input(
        z.object({
          token: z.string().min(1),
          sessionId: z.string().uuid().optional(),
        })
      )
      .handler(async ({ input }) => {
        const { trainerId } = await validateTrainerToken(input.token)
        const clients = await listClientsForTrainer(trainerId, input.sessionId)
        return z.array(clientSchema).parse(clients)
      }),
    create: os
      .input(
        z.object({
          token: z.string().min(1),
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
      .handler(async ({ input }) => {
        const { token, ...body } = input
        const { trainerId } = await validateTrainerToken(token)

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

        const client = await createClientForTrainer(trainerId, payload)

        return clientSchema.parse(client)
      }),
  },
  products: {
    list: os
      .input(z.object({ token: z.string().min(1) }))
      .handler(async ({ input }) => {
        const { trainerId } = await validateTrainerToken(input.token)
        const products = await listProducts(trainerId, {})
        return z.array(productSchema).parse(products)
      }),
  },
  services: {
    list: os
      .input(z.object({ token: z.string().min(1) }))
      .handler(async ({ input }) => {
        const { trainerId } = await validateTrainerToken(input.token)
        const products = await listProducts(trainerId, { type: 'service' })
        return z.array(serviceProductSchema).parse(products)
      }),
  },
  sales: {
    create: os
      .input(
        z.object({
          token: z.string().min(1),
          clientId: z.string().min(1),
          clientSessionId: z.string().uuid().nullable().optional(),
          dueAfter: z.string().nullable().optional(),
          note: z.string().nullable().optional(),
          paymentRequestPassOnTransactionFee: z.boolean().optional(),
        })
      )
      .handler(async ({ input }) => {
        const { token, ...payload } = input
        const { trainerId } = await validateTrainerToken(token)
        const parsed = saleSchema.pick({ id: true }).parse(
          await createSaleForTrainer(trainerId, payload)
        )
        return { id: parsed.id }
      }),
    requestPayment: os
      .input(z.object({ token: z.string().min(1), saleId: z.string().uuid() }))
      .handler(async ({ input }) => {
        const { trainerId } = await validateTrainerToken(input.token)
        await requestPaymentForSale(trainerId, input.saleId)
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
      .handler(async ({ input }) => {
        const { token, ...payload } = input
        const { trainerId } = await validateTrainerToken(token)
        const product = await createSaleProductForTrainer(trainerId, payload)
        return saleProductSchema.parse(product)
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
      .handler(async ({ input }) => {
        const { token, ...payload } = input
        const { trainerId } = await validateTrainerToken(token)
        const payment = await createManualSalePaymentForTrainer(
          trainerId,
          payload
        )
        return salePaymentSchema.parse(payment)
      }),
  },
})

export type AppRouter = typeof appRouter
export type AppRouterClient = RouterClient<typeof appRouter>
