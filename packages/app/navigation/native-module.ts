import { NativeModules, Platform } from 'react-native'

type NativeNavigationModule = {
  push: (path: string) => void
  replace: (path: string) => void
  back: () => void
  setAuthenticated: (authenticated: boolean) => void
}

const native: Partial<NativeNavigationModule> =
  Platform.OS === 'ios' ? (NativeModules.NativeNavigation as NativeNavigationModule) : {}

export const nativeNavigation = {
  push(path: string) {
    native.push?.(path)
  },
  replace(path: string) {
    native.replace?.(path)
  },
  back() {
    native.back?.()
  },
  setAuthenticated(authenticated: boolean) {
    native.setAuthenticated?.(authenticated)
  },
}
