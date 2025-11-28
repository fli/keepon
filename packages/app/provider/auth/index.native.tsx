import * as SecureStore from 'expo-secure-store'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { KeeponSession } from '@keepon/api'

type AuthContextValue = {
  session: KeeponSession | null
  token: string | null
  setSession: (session: KeeponSession) => Promise<void>
  clearSession: () => Promise<void>
  ready: boolean
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

type Props = { children: React.ReactNode }

const STORAGE_KEY = 'keeponSession'

export function AuthProvider({ children }: Props) {
  const [session, setSessionState] = useState<KeeponSession | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null

    SecureStore.getItemAsync(STORAGE_KEY)
      .then((value) => {
        if (value) {
          try {
            const parsed: unknown = JSON.parse(value)
            if (isRecord(parsed) && typeof parsed.token === 'string') {
              setSessionState(parsed as KeeponSession)
            } else {
              setSessionState({ token: value, userId: '', trainerId: '' })
            }
          } catch {
            setSessionState({ token: value, userId: '', trainerId: '' })
          }
        }
      })
      .catch((err) => console.warn('AuthProvider: failed to read token', err))
      .finally(() => setReady(true))
  }, [])

  const setSession = useCallback(async (next: KeeponSession) => {
    setSessionState(next)
    try {
      await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(next))
    } catch (err) {
      console.warn('AuthProvider: failed to persist token', err)
    }
  }, [])

  const clearSession = useCallback(async () => {
    setSessionState(null)
    try {
      await SecureStore.deleteItemAsync(STORAGE_KEY)
    } catch (err) {
      console.warn('AuthProvider: failed to clear token', err)
    }
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
