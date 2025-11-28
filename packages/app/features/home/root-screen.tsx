'use client'

import { useState } from 'react'
import { ActivityIndicator, View, StyleSheet } from 'react-native'

import { CreateAccountScreen } from 'app/features/auth/create-account-screen'
import { LoginScreen } from 'app/features/auth/login-screen'
import { DashboardScreen } from 'app/features/dashboard/screen'
import { useAuth } from 'app/provider/auth'
import { useTheme } from 'app/theme'

type AuthMode = 'login' | 'signup'

// Gated root experience: show auth flows until a session exists, then render the app.
export function HomeScreen() {
  const { theme } = useTheme()
  const styles = makeStyles(theme)
  const { token, ready } = useAuth()
  const [mode, setMode] = useState<AuthMode>('login')

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.text} />
      </View>
    )
  }

  if (!token) {
    return mode === 'login' ? (
      <LoginScreen onCreateAccount={() => setMode('signup')} />
    ) : (
      <CreateAccountScreen onAlreadyHaveAccount={() => setMode('login')} />
    )
  }

  return <DashboardScreen />
}

const makeStyles = (theme: ReturnType<typeof useTheme>['theme']) =>
  StyleSheet.create({
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.background,
    },
  })
