import { SafeArea } from 'app/provider/safe-area'
import { KeyboardControllerProvider } from './keyboard'
import { NavigationProvider } from './navigation'
import { AuthProvider } from './auth'

export function Provider({
  children,
  initialSession = null,
}: {
  children: React.ReactNode
  initialSession?: import('@keepon/api').KeeponSession | null
}) {
  return (
    <KeyboardControllerProvider>
      <SafeArea>
        <AuthProvider initialSession={initialSession}>
          <NavigationProvider>{children}</NavigationProvider>
        </AuthProvider>
      </SafeArea>
    </KeyboardControllerProvider>
  )
}
