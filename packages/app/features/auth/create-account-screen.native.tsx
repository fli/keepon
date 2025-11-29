'use client'

import React, { useMemo, useState } from 'react'
import { z } from 'zod'
import {
  Screen,
  SectionList,
  Section,
  TextField,
  PrimaryButton,
  SecondaryButton,
  CaptionText,
  Card,
} from 'app/ui/native'
import { useAuth } from 'app/provider/auth'
import { useRouter } from 'app/navigation'
import { createAccount } from 'app/services/api'

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

type Props = {
  onAlreadyHaveAccount?: () => void
}

export function CreateAccountScreen({ onAlreadyHaveAccount }: Props) {
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
    <Screen title="Create your account" subtitle="iOS SwiftUI surface">
      <SectionList>
        <Section title="Details">
          <Card>
            <TextField label="First name" value={firstName} onChangeText={setFirstName} />
            <TextField label="Last name" value={lastName} onChangeText={setLastName} />
            <TextField
              label="Business name (optional)"
              value={businessName}
              onChangeText={setBusinessName}
            />
            <TextField
              label="Email"
              placeholder="you@example.com"
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
              value={country}
              onChangeText={value => setCountry(value.toUpperCase())}
            />
            <CaptionText>Timezone: {defaultTimezone}</CaptionText>
            <CaptionText>Locale: {defaultLocale}</CaptionText>
            {error ? <CaptionText color="#f87171">{error}</CaptionText> : null}
            <PrimaryButton onPress={() => void submit()} loading={loading}>
              Create account
            </PrimaryButton>
            <SecondaryButton
              onPress={onAlreadyHaveAccount ?? (() => router.replace('/auth'))}
              disabled={loading}
            >
              I already have an account
            </SecondaryButton>
          </Card>
        </Section>
        <Section title="Policy">
          <CaptionText>
            By continuing you agree to receive important account emails from Keepon.
          </CaptionText>
        </Section>
      </SectionList>
    </Screen>
  )
}
