'use client'

import { Provider } from 'app/provider'
import type { KeeponSession } from '@keepon/api'

export function AppProviders({
  children,
  initialSession = null,
  enableQuery = true,
}: {
  children: React.ReactNode
  initialSession?: KeeponSession | null
  enableQuery?: boolean
}) {
  return (
    <Provider initialSession={initialSession} enableQuery={enableQuery}>
      {children}
    </Provider>
  )
}
