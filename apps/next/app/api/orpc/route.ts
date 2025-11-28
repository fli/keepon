import { RPCHandler } from '@orpc/server/fetch'
import { appRouter } from '@keepon/orpc'

const handler = new RPCHandler(appRouter)
const prefix = '/api/orpc'

async function handle(request: Request) {
  const url = new URL(request.url)

  // Compatibility shim for mobile clients that bypass ORPC envelope.
  const rawText = await request.clone().text().catch(() => '')

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

  let parsed: Record<string, unknown> | null = null
  try {
    const json = rawText ? (JSON.parse(rawText) as unknown) : null
    parsed = isRecord(json) ? json : null
  } catch {
    parsed = null
  }

  const maybeInput =
    parsed && isRecord(parsed)
      ? parsed.input && isRecord(parsed.input)
        ? parsed.input
        : parsed
      : null

  const hasSignupFields = (value: Record<string, unknown>) =>
    'firstName' in value &&
    ('email' in value || 'signInWithAppleIdentityToken' in value)

  const isSignupShape = maybeInput ? hasSignupFields(maybeInput) : false

  const path = parsed?.path
  const isAuthSignupPath =
    (typeof path === 'string' && path === 'auth.signup') ||
    (Array.isArray(path) &&
      path.length === 2 &&
      path[0] === 'auth' &&
      path[1] === 'signup')

  if (isSignupShape && (!path || isAuthSignupPath || url.pathname.endsWith('/auth/signup'))) {
    const rest = await fetch(`${url.origin}/api/trainers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(maybeInput),
    })

    return rest
  }

  const result = await handler.handle(request, { prefix, context: { request } })

  if (result.matched && result.response) {
    return result.response
  }

  return new Response('Not Found', { status: 404 })
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
export const OPTIONS = handle
export const HEAD = handle
