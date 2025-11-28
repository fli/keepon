import { SafeArea } from 'app/provider/safe-area'
import { KeyboardControllerProvider } from './keyboard'
import { NavigationProvider } from './navigation'
import { AuthProvider } from './auth'
import { QueryProvider } from './query'

export function Provider({
  children,
  initialSession = null,
  enableQuery = true,
}: {
  children: React.ReactNode
  initialSession?: import('@keepon/api').KeeponSession | null
  enableQuery?: boolean
}) {
  return (
    <KeyboardControllerProvider>
      <SafeArea>
        <AuthProvider initialSession={initialSession}>
          <NavigationProvider>
            {enableQuery ? <QueryProvider>{children}</QueryProvider> : children}
          </NavigationProvider>
        </AuthProvider>
      </SafeArea>
    </KeyboardControllerProvider>
  )
}
