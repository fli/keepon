import { orpcClient, getOrpcEndpoint } from '@keepon/orpc'
import { z } from 'zod'
import {
  clientSchema,
  productSchema,
  salePaymentSchema,
  saleProductSchema,
  saleSchema,
  loginResponseSchema,
  sessionSeriesSchema,
  type ClientSession,
  type Session,
  type SessionSeries,
  type Client,
  type Product,
  type SalePayment,
  type SaleProduct,
} from './schemas'

export type KeeponSession = {
  token: string
  userId: string
  trainerId: string
}

export type LoginWithPassword = { email: string; password: string }
export type LoginWithApple = { signInWithAppleIdentityToken: string }
export type LoginArgs = LoginWithPassword | LoginWithApple

export type CreateAccountBase = {
  firstName: string
  lastName?: string | null
  country: string
  timezone: string
  locale: string
  businessName?: string | null
  industry?: string | null
  phone?: string | null
  brandColor?: string | null
  partner?: string | null
}

export type CreateAccountWithPassword = CreateAccountBase & {
  email: string
  password: string
}

export type CreateAccountWithApple = CreateAccountBase & {
  signInWithAppleIdentityToken: string
  signInWithAppleNonce?: string
}

export type CreateAccountArgs = CreateAccountWithPassword | CreateAccountWithApple

export type CreateSalePayload = {
  clientId: string
  clientSessionId?: string | null
  dueAfter?: string | null
  note?: string | null
  paymentRequestPassOnTransactionFee?: boolean
}

export type CreateSaleProductPayload = {
  saleId: string
  productId?: string
  price: string
  currency: string
  name: string
  type: string
  totalCredits?: number
  quantity?: number
  durationMinutes?: number
  location?: string | null
  address?: string | null
  googlePlaceId?: string | null
}

export type CreateSalePaymentPayload = {
  saleId: string
  amount: string
  currency: string
  type: 'stripe' | 'manual' | 'creditPack' | 'subscription' | 'paymentPlan'
  method?: 'cash' | 'electronic'
  specificMethodName?: string
  saleCreditPackId?: string | null
  creditsUsed?: number | null
  paymentPlanId?: string | null
  passOnFee?: boolean | null
  stripePaymentIntentId?: string
  stripePaymentMethodId?: string
  usingMobileSdk?: boolean
  requestPayment?: boolean
  dueAfter?: string | null
}

export type SalePaymentResult =
  | { status: 'paid'; salePaymentId?: string }
  | { status: 'requires_action'; clientSecret: string }
  | { status: 'requested' }

export async function fetchSessionSeries(
  session: KeeponSession,
  opts: { createdAfter?: string } = {}
): Promise<SessionSeries[]> {
  if (!session?.token) {
    throw new Error('Session token is required to fetch session series')
  }

  const endpoint = new URL(getOrpcEndpoint('/api/sessionSeries'))
  if (opts.createdAfter) {
    endpoint.searchParams.set('createdAfter', opts.createdAfter)
  }

  const res = await fetch(endpoint.toString(), {
    headers: {
      Authorization: `Bearer ${session.token}`,
      Accept: 'application/json',
    },
  })

  if (!res.ok) {
    const message = await res.text()
    throw new Error(message || `Failed to load session series (${res.status})`)
  }

  const json: unknown = await res.json()
  return sessionSeriesSchema.array().parse(json ?? [])
}
export async function login(args: LoginArgs): Promise<KeeponSession> {
  const res = await orpcClient.auth.login(args)
  return { token: res.token, userId: res.userId, trainerId: res.trainerId }
}

export async function createAccount(args: CreateAccountArgs): Promise<KeeponSession> {
  // On React Native, manually call the ORPC HTTP endpoint with the expected envelope
  // to avoid any transport/body shape issues from the client library.
  if (isReactNative()) {
    const endpoint = getOrpcEndpoint()
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'auth.signup', input: args }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(text || `Signup failed with status ${res.status}`)
    }

    const json: unknown = await res.json()
    const parsed = loginResponseSchema.parse(json)
    return { token: parsed.id, userId: parsed.userId, trainerId: parsed.trainerId }
  }

  const signupInput: Parameters<typeof orpcClient.auth.signup>[0] = {
    ...args,
    lastName: args.lastName ?? undefined,
    businessName: args.businessName ?? undefined,
    industry: args.industry ?? undefined,
    phone: args.phone ?? undefined,
    brandColor: args.brandColor ?? undefined,
    partner: args.partner ?? undefined,
  }

  const res = await orpcClient.auth.signup(signupInput)
  return { token: res.token, userId: res.userId, trainerId: res.trainerId }
}

export async function logout(session: KeeponSession): Promise<void> {
  await orpcClient.auth.logout({ token: session.token })
}

export async function fetchClients(session: KeeponSession): Promise<Client[]> {
  const json = await orpcClient.clients.list({
    token: session.token,
    trainerId: session.trainerId,
  })
  return z.array(clientSchema).parse(json ?? [])
}

export type CreateClientPayload = {
  firstName: string
  lastName?: string | null
  email?: string | null
  mobileNumber?: string | null
  otherNumber?: string | null
  status?: 'current' | 'lead' | 'past'
  company?: string | null
  location?: string | null
  address?: string | null
  googlePlaceId?: string | null
}

export async function createClient(payload: CreateClientPayload, session: KeeponSession): Promise<Client> {
  if (!session?.token) {
    throw new Error('Session token is required to create a client')
  }

  const normalize = (value?: string | null) => {
    if (value === undefined || value === null) return undefined
    const trimmed = value.trim()
    return trimmed.length === 0 ? undefined : trimmed
  }

  const body = {
    firstName: payload.firstName.trim(),
    lastName: normalize(payload.lastName),
    email: normalize(payload.email),
    mobileNumber: normalize(payload.mobileNumber),
    otherNumber: normalize(payload.otherNumber),
    company: normalize(payload.company),
    location: normalize(payload.location),
    address: normalize(payload.address),
    googlePlaceId: normalize(payload.googlePlaceId),
    status: payload.status ?? 'current',
  }

  const json = await orpcClient.clients.create({
    token: session.token,
    trainerId: session.trainerId,
    ...body,
  })

  return clientSchema.parse(json)
}

export async function fetchProducts(session: KeeponSession): Promise<Product[]> {
  const json = await orpcClient.products.list({ token: session.token })
  return z.array(productSchema).parse(json ?? [])
}

export async function createSale(payload: CreateSalePayload, session: KeeponSession): Promise<string> {
  const json = await orpcClient.sales.create({
    token: session.token,
    trainerId: session.trainerId,
    ...payload,
  })
  const parsed = saleSchema.pick({ id: true }).parse(json)
  return parsed.id
}

export async function createSaleProduct(
  payload: CreateSaleProductPayload,
  session: KeeponSession
): Promise<SaleProduct> {
  if (!payload.saleId) {
    throw new Error('saleId is required to create a sale product')
  }

  const saleProductType = payload.type
  if (
    saleProductType !== 'service' &&
    saleProductType !== 'creditPack' &&
    saleProductType !== 'item'
  ) {
    throw new Error(`Unsupported sale product type: ${payload.type}`)
  }

  const json = await orpcClient.saleProducts.create({
    token: session.token,
    ...payload,
    type: saleProductType,
  })

  return saleProductSchema.parse(json)
}

export async function createSalePayment(
  payload: CreateSalePaymentPayload,
  session: KeeponSession
): Promise<SalePaymentResult> {
  const normalizedPayload = {
    ...payload,
    type:
      payload.type === 'manual'
        ? 'manual'
        : payload.type === 'paymentPlan'
          ? 'subscription'
          : payload.type,
  }

  if (normalizedPayload.type !== 'manual') {
    throw new Error('Only manual sale payments are supported via ORPC client')
  }

  const salePayment = await orpcClient.salePayments.createManual({
    token: session.token,
    saleId: normalizedPayload.saleId,
    amount: normalizedPayload.amount,
    currency: normalizedPayload.currency,
    method: normalizedPayload.method as 'cash' | 'electronic',
    specificMethodName: normalizedPayload.specificMethodName ?? null,
  })

  const parsed = salePaymentSchema.parse(salePayment)
  return { status: 'paid', salePaymentId: parsed.id }
}

export async function createPaymentRequest(
  saleId: string,
  session: KeeponSession
): Promise<SalePaymentResult> {
  if (!saleId) throw new Error('saleId is required to request payment')

  await orpcClient.sales.requestPayment({
    token: session.token,
    saleId,
  })

  return { status: 'requested' }
}

export function formatPrice(value: number | string): string {
  const numeric = typeof value === 'number' ? value : Number.parseFloat(value)
  if (!Number.isFinite(numeric)) return '0.00'
  return numeric.toFixed(2)
}

export type { Client, Product, SalePayment, SaleProduct }
export type { SessionSeries, Session, ClientSession }

const isReactNative = () =>
  typeof navigator !== 'undefined' && navigator.product === 'ReactNative'
