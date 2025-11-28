import { useState } from 'react'
import { View, Text, Platform, StyleSheet } from 'react-native'
import { z } from 'zod'

import { Button } from 'app/components/button'
import { KeyboardAvoidingView } from 'app/components/keyboard-avoiding-view'
import { TextField } from 'app/components/text-field'
import { useAuth } from 'app/provider/auth'
import { login } from 'app/services/api'
import { useTheme } from 'app/theme'

type Props = {
  onCreateAccount?: () => void
}

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
})

export function LoginScreen({ onCreateAccount }: Props) {
  const { theme } = useTheme()
  const styles = makeStyles(theme)
  const { setSession } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    setError(null)
    const parsed = schema.safeParse({ email, password })
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      setError(first?.message ?? 'Please check your email and password')
      return
    }
    setLoading(true)
    try {
      const session = await login(parsed.data)
      await setSession(session)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to login')
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.container}>
        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>Sign in to manage your clients and schedule.</Text>

        <View style={styles.form}>
          <TextField
            label="Email"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextField
            label="Password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button label="Sign in" onPress={submit} loading={loading} />
          <Button
            label="Create account"
            onPress={onCreateAccount}
            disabled={loading}
            style={styles.secondaryButton}
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  )
}

const makeStyles = (theme: ReturnType<typeof useTheme>['theme']) =>
  StyleSheet.create({
    flex: { flex: 1 },
    container: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing.lg,
      backgroundColor: theme.colors.background,
      gap: theme.spacing.lg,
    },
    title: {
      fontSize: theme.typography.h1,
      fontWeight: '800',
      color: theme.colors.text,
    },
    subtitle: {
      color: theme.colors.secondaryText,
      textAlign: 'center',
    },
    form: {
      width: '100%',
      maxWidth: 520,
      gap: theme.spacing.md,
    },
    error: {
      color: '#ef4444',
      fontWeight: '600',
    },
    secondaryButton: {
      backgroundColor: theme.colors.surface,
    },
  })
