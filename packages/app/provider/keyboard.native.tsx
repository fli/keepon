import React from 'react'
import { KeyboardProvider } from 'react-native-keyboard-controller'

export function KeyboardControllerProvider({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <KeyboardProvider
      statusBarTranslucent
      navigationBarTranslucent
      preserveEdgeToEdge
    >
      {children}
    </KeyboardProvider>
  )
}
