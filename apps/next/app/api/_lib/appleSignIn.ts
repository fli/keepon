import { Buffer } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import { z } from 'zod'

const getSubtleCrypto = (): SubtleCrypto => {
  const cryptoImpl = globalThis.crypto ?? webcrypto
  return cryptoImpl.subtle
}

const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys'
const JWKS_CACHE_TTL_MS = 10 * 60 * 1000

type AppleJwk = {
  kty: 'RSA'
  kid: string
  use?: string
  alg?: string
  n: string
  e: string
}

type CachedJwks = {
  keys: AppleJwk[]
  fetchedAt: number
}

const jwksSchema = z.object({
  keys: z
    .array(
      z.object({
        kid: z.string().min(1),
        kty: z.literal('RSA'),
        use: z.string().optional(),
        alg: z.string().optional(),
        n: z.string().min(1),
        e: z.string().min(1),
      })
    )
    .min(1),
})

const headerSchema = z.object({
  kid: z.string().min(1),
  alg: z.literal('RS256'),
})

const payloadSchema = z.object({
  email: z.string().email(),
  sub: z.string().min(1),
  iss: z.literal('https://appleid.apple.com'),
  aud: z.union([z.string().min(1), z.array(z.string().min(1)).nonempty()]),
  exp: z.coerce.number(),
  nonce: z.string().min(1).optional(),
})

export type AppleSignInErrorCode =
  | 'invalid_token'
  | 'invalid_signature'
  | 'audience_mismatch'
  | 'nonce_mismatch'
  | 'expired_token'
  | 'jwks_fetch_failed'

export class AppleSignInError extends Error {
  code: AppleSignInErrorCode

  constructor(message: string, code: AppleSignInErrorCode) {
    super(message)
    this.name = 'AppleSignInError'
    this.code = code
  }
}

let cachedJwks: CachedJwks | null = null

const base64UrlToUint8Array = (value: string): Uint8Array<ArrayBuffer> => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const paddingNeeded = (4 - (normalized.length % 4)) % 4
  const padded = normalized + '='.repeat(paddingNeeded)
  const buffer = Buffer.from(padded, 'base64')
  const slice = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  )
  return new Uint8Array(slice)
}

const decodeSegmentToJson = <T>(segment: string): T => {
  const bytes = base64UrlToUint8Array(segment)
  const json = Buffer.from(bytes).toString('utf8')
  return JSON.parse(json) as T
}

const importAppleKey = async (jwk: AppleJwk): Promise<CryptoKey> =>
  getSubtleCrypto().importKey(
    'jwk',
    { ...jwk, ext: true } as JsonWebKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  )

const fetchAppleJwks = async (): Promise<AppleJwk[]> => {
  if (cachedJwks && Date.now() - cachedJwks.fetchedAt < JWKS_CACHE_TTL_MS) {
    return cachedJwks.keys
  }

  const response = await fetch(APPLE_JWKS_URL, {
    headers: {
      accept: 'application/json',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new AppleSignInError(
      `Failed to fetch Apple JWKS: ${response.status}`,
      'jwks_fetch_failed'
    )
  }

  const parsed = jwksSchema.safeParse(await response.json())
  if (!parsed.success) {
    throw new AppleSignInError('Apple JWKS response was invalid', 'jwks_fetch_failed')
  }

  cachedJwks = {
    keys: parsed.data.keys,
    fetchedAt: Date.now(),
  }

  return parsed.data.keys
}

const findMatchingJwk = async (kid: string) => {
  const keys = await fetchAppleJwks()
  return keys.find(key => key.kid === kid) ?? null
}

export type VerifyAppleIdentityTokenOptions = {
  expectedAudience: string
  expectedNonce?: string
}

export type VerifiedAppleIdentity = {
  email: string
  userId: string
}

export const verifyAppleIdentityToken = async (
  token: string,
  options: VerifyAppleIdentityTokenOptions
): Promise<VerifiedAppleIdentity> => {
  const segments = token.split('.')
  if (segments.length !== 3) {
    throw new AppleSignInError('Identity token is malformed', 'invalid_token')
  }

  const [encodedHeader, encodedPayload, encodedSignature] = segments as [
    string,
    string,
    string,
  ]

  let header: z.infer<typeof headerSchema>
  try {
    header = headerSchema.parse(decodeSegmentToJson(encodedHeader))
  } catch {
    throw new AppleSignInError('Identity token header is invalid', 'invalid_token')
  }

  const jwk = await findMatchingJwk(header.kid)
  if (!jwk) {
    throw new AppleSignInError('No matching signing key found for token', 'invalid_token')
  }

  const subtle = getSubtleCrypto()
  const key = await importAppleKey(jwk)

  const data = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
  const signature = base64UrlToUint8Array(encodedSignature)

  const verified = await subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data)
  if (!verified) {
    throw new AppleSignInError('Identity token signature is invalid', 'invalid_signature')
  }

  let payload: z.infer<typeof payloadSchema>
  try {
    payload = payloadSchema.parse(decodeSegmentToJson(encodedPayload))
  } catch {
    throw new AppleSignInError('Identity token payload is invalid', 'invalid_token')
  }

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
  if (!audiences.includes(options.expectedAudience)) {
    throw new AppleSignInError('Identity token audience mismatch', 'audience_mismatch')
  }

  if (payload.exp * 1000 <= Date.now()) {
    throw new AppleSignInError('Identity token has expired', 'expired_token')
  }

  if (
    options.expectedNonce &&
    (!payload.nonce || payload.nonce !== options.expectedNonce)
  ) {
    throw new AppleSignInError('Identity token nonce mismatch', 'nonce_mismatch')
  }

  return {
    email: payload.email,
    userId: payload.sub,
  }
}
