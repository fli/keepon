import { useMemo, useState } from 'react'
import { Platform, Text, View, StyleSheet } from 'react-native'
import { z } from 'zod'

import { Button } from 'app/components/button'
import { KeyboardAvoidingView } from 'app/components/keyboard-avoiding-view'
import { TextField } from 'app/components/text-field'
import { useAuth } from 'app/provider/auth'
import { useRouter } from 'app/navigation'
import { createAccount } from 'app/services/api'
import { useTheme } from 'app/theme'

type Props = {
  onAlreadyHaveAccount?: () => void
}

const schema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().optional(),
  email: z.string().email('Enter a valid email'),
  password: z.string().min(5, 'Password must be at least 5 characters'),
  country: z
    .string()
    .trim()
    .length(2, 'Country must be a 2-letter code')
    .transform(value => value.toUpperCase()),
  businessName: z.string().optional(),
})

const safeLocale = () => {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale
    if (locale) return locale
  } catch {
    return 'en-US'
  }
  return 'en-US'
}

const safeTimezone = () => {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (tz) return tz
  } catch {
    return 'Etc/UTC'
  }
  return 'Etc/UTC'
}

const guessCountry = () => {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale
    const parts = locale.split('-')
    if (parts.length > 1 && parts[1]) {
      return parts[1].toUpperCase()
    }
  } catch {
    return 'US'
  }
  return 'US'
}

export function CreateAccountScreen({ onAlreadyHaveAccount }: Props) {
  const { theme } = useTheme()
  const styles = makeStyles(theme)
  const { setSession } = useAuth()
  const router = useRouter()

  const defaultLocale = useMemo(() => safeLocale(), [])
  const defaultTimezone = useMemo(() => safeTimezone(), [])
  const defaultCountry = useMemo(() => guessCountry(), [])

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [country, setCountry] = useState(defaultCountry)
  const [businessName, setBusinessName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    setError(null)

    const parsed = schema.safeParse({
      firstName,
      lastName,
      email,
      password,
      country,
      businessName,
    })

    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]
      setError(firstIssue?.message ?? 'Please check the form fields.')
      return
    }

    setLoading(true)
    try {
      const session = await createAccount({
        ...parsed.data,
        lastName: parsed.data.lastName || null,
        businessName: parsed.data.businessName || null,
        timezone: defaultTimezone,
        locale: defaultLocale,
        brandColor: '#3b82f6',
      })
      await setSession(session)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create account')
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
        <View style={styles.header}>
          <Text style={styles.title}>Create your account</Text>
          <Text style={styles.subtitle}>
            Start a 14-day free trial. No credit card required.
          </Text>
        </View>

        <View style={styles.form}>
          <TextField label="First name" value={firstName} onChangeText={setFirstName} />
          <TextField label="Last name" value={lastName} onChangeText={setLastName} />
          <TextField
            label="Business name (optional)"
            value={businessName}
            onChangeText={setBusinessName}
          />
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
          <TextField
            label="Country (ISO)"
            autoCapitalize="characters"
            value={country}
            maxLength={2}
            onChangeText={value => setCountry(value.toUpperCase())}
          />
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Timezone</Text>
            <Text style={styles.metaValue}>{defaultTimezone}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Locale</Text>
            <Text style={styles.metaValue}>{defaultLocale}</Text>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button label="Create account" onPress={() => void submit()} loading={loading} />
          <Button
            label="I already have an account"
            onPress={onAlreadyHaveAccount ?? (() => router.replace('/auth'))}
            disabled={loading}
            style={styles.secondaryButton}
          />
        </View>

        <Text style={styles.disclaimer}>
          By continuing you agree to receive important account emails from Keepon.
        </Text>
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
    header: {
      alignItems: 'center',
      gap: theme.spacing.sm,
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
    metaRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: theme.spacing.sm,
    },
    metaLabel: {
      color: theme.colors.secondaryText,
      fontWeight: '600',
    },
    metaValue: {
      color: theme.colors.text,
      fontWeight: '600',
    },
    error: {
      color: '#ef4444',
      fontWeight: '600',
    },
    secondaryButton: {
      backgroundColor: theme.colors.surface,
    },
    disclaimer: {
      color: theme.colors.secondaryText,
      textAlign: 'center',
      maxWidth: 480,
      fontSize: 12,
    },
  })
