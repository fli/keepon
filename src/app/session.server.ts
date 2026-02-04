import { cache } from 'react'

import { cookies } from 'next/headers'
import type { KeeponSession } from '@/lib/api'

const SESSION_COOKIE = 'kpSession'

export const readSessionFromCookies = cache(async (): Promise<KeeponSession | null> => {
  const cookieResult: unknown = await cookies()
  if (
    !cookieResult ||
    typeof cookieResult !== 'object' ||
    !('get' in cookieResult) ||
    typeof (cookieResult as { get?: unknown }).get !== 'function'
  ) {
    return null
  }

  type MinimalCookieStore = { get: (name: string) => { value?: string } | undefined }
  const cookieStore = cookieResult as MinimalCookieStore
  const cookie = cookieStore.get(SESSION_COOKIE)
  const value = typeof cookie?.value === 'string' ? cookie.value : null
  if (!value) {
    return null
  }

  try {
    const decoded = decodeURIComponent(value)
    const parsed: unknown = JSON.parse(decoded)
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as Partial<KeeponSession>).token === 'string' &&
      typeof (parsed as Partial<KeeponSession>).trainerId === 'string' &&
      typeof (parsed as Partial<KeeponSession>).userId === 'string'
    ) {
      return parsed as KeeponSession
    }
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn('session.server: unable to parse session cookie', reason)
  }

  return null
})
