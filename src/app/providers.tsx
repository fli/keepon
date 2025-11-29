'use client'

import type { ReactNode } from 'react'
import type { KeeponSession } from '@/lib/api'

type Props = {
  children: ReactNode
  initialSession?: KeeponSession | null
  enableQuery?: boolean
}

// Web app no longer depends on React Native Web providers; keep a lightweight wrapper for future hooks.
export function AppProviders({ children }: Props) {
  return <>{children}</>
}
