import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { KeeponSession } from '@keepon/api'

type AuthContextValue = {
  session: KeeponSession | null
  token: string | null
  setSession: (session: KeeponSession) => Promise<void> | void
  clearSession: () => Promise<void> | void
  ready: boolean
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

type Props = {
  children: React.ReactNode
  initialSession?: KeeponSession | null
}

const STORAGE_KEY = 'keeponSession'
const SESSION_COOKIE = 'kpSession'
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 28

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const parseSession = (value: unknown): KeeponSession | null => {
  if (isRecord(value) && typeof value.token === 'string') {
    return {
      token: value.token,
      userId: typeof value.userId === 'string' ? value.userId : '',
      trainerId: typeof value.trainerId === 'string' ? value.trainerId : '',
    }
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return { token: value, userId: '', trainerId: '' }
  }

  return null
}

const readSessionFromLocalStorage = (): KeeponSession | null => {
  if (typeof window === 'undefined') return null

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (!stored) return null

    try {
      const parsed = JSON.parse(stored)
      const session = parseSession(parsed)
      if (session) return session
    } catch {
      // Fall through to raw parsing
    }

    return parseSession(stored)
  } catch (err) {
    console.warn('AuthProvider: failed to read token from localStorage', err)
    return null
  }
}

const readSessionFromCookie = (): KeeponSession | null => {
  if (typeof document === 'undefined') return null

  try {
    const target = document.cookie
      .split(';')
      .map(part => part.trim())
      .find(part => part.startsWith(`${SESSION_COOKIE}=`))

    if (!target) return null

    const raw = target.slice(SESSION_COOKIE.length + 1)
    const decoded = decodeURIComponent(raw)
    try {
      const parsed = JSON.parse(decoded)
      const session = parseSession(parsed)
      if (session) return session
    } catch {
      const session = parseSession(decoded)
      if (session) return session
    }
  } catch (err) {
    console.warn('AuthProvider: failed to read token from cookie', err)
  }

  return null
}

const persistSessionCookie = (session: KeeponSession) => {
  if (typeof document === 'undefined') return

  const secure = typeof window !== 'undefined' && window.location?.protocol === 'https:' ? '; Secure' : ''
  const encoded = encodeURIComponent(JSON.stringify(session))
  document.cookie = `${SESSION_COOKIE}=${encoded}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`
}

const clearSessionCookie = () => {
  if (typeof document === 'undefined') return
  document.cookie = `${SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
}

const persistSessionStorage = (session: KeeponSession) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch (err) {
    console.warn('AuthProvider: failed to persist token', err)
  }
}

const clearSessionStorage = () => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch (err) {
    console.warn('AuthProvider: failed to clear token', err)
  }
}

const loadStoredSession = (): KeeponSession | null => {
  const cookieSession = readSessionFromCookie()
  if (cookieSession) return cookieSession
  return readSessionFromLocalStorage()
}

export function AuthProvider({ children, initialSession = null }: Props) {
  // Keep server and first client render in sync; hydrate later if needed
  const [session, setSessionState] = useState<KeeponSession | null>(initialSession)
  const [ready, setReady] = useState<boolean>(Boolean(initialSession))

  // After hydration, read persisted session if we didn't already receive one
  useEffect(() => {
    if (session) {
      if (!ready) setReady(true)
      return
    }

    const stored = loadStoredSession()
    if (stored) {
      setSessionState(stored)
    }

    setReady(true)
  }, [session, ready])

  const setSession = useCallback(async (next: KeeponSession) => {
    setSessionState(next)
    persistSessionStorage(next)
    persistSessionCookie(next)
  }, [])

  const clearSession = useCallback(async () => {
    setSessionState(null)
    clearSessionStorage()
    clearSessionCookie()
  }, [])

  const token = session?.token ?? null

  const value = useMemo(
    () => ({ session, token, setSession, clearSession, ready }),
    [session, token, setSession, clearSession, ready]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
