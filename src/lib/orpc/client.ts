import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { AppRouterClient } from './router'

const endpoint = getOrpcEndpoint()

export const orpcClient = createORPCClient<AppRouterClient>(
  new RPCLink({
    url: endpoint,
  })
)

function resolveBaseUrl() {
  const envBase = process.env.NEXT_PUBLIC_ORPC_BASE_URL ?? process.env.ORPC_BASE_URL ?? ''

  if (envBase) {
    return envBase.replace(/\/$/, '')
  }

  if (
    typeof window !== 'undefined' &&
    typeof window.location !== 'undefined' &&
    typeof window.location.origin === 'string'
  ) {
    return window.location.origin.replace(/\/$/, '')
  }

  return 'http://localhost:3001'
}

export function getOrpcEndpoint(path = '/api/orpc') {
  const baseUrl = resolveBaseUrl()
  const normalizedPath = path.startsWith('/') ? path : `/${path}`

  if (!baseUrl) {
    return normalizedPath
  }

  return `${baseUrl}${normalizedPath}`
}
