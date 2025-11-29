'use client'

import React, { useState } from 'react'
import { z } from 'zod'
import {
  Screen,
  SectionList,
  Section,
  CaptionText,
  TextField,
  PrimaryButton,
  SecondaryButton,
  Card,
} from 'app/ui/native'
import { useAuth } from 'app/provider/auth'
import { useRouter } from 'app/navigation'
import { login } from 'app/services/api'

type Props = {
  onCreateAccount?: () => void
}

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
})

export function LoginScreen({ onCreateAccount }: Props) {
  const { setSession } = useAuth()
  const router = useRouter()

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
    <Screen title="Welcome back" subtitle="SwiftUI-native auth">
      <SectionList>
        <Section title="Sign in">
          <Card>
            <TextField
              label="Email"
              placeholder="you@example.com"
              value={email}
              onChangeText={setEmail}
            />
            <TextField
              label="Password"
              secureTextEntry
              placeholder="••••••••"
              value={password}
              onChangeText={setPassword}
            />
            {error ? <CaptionText color="#f87171">{error}</CaptionText> : null}
            <PrimaryButton onPress={() => void submit()} loading={loading}>
              Sign in
            </PrimaryButton>
            <SecondaryButton
              onPress={onCreateAccount ?? (() => router.push('/signup'))}
              disabled={loading}
            >
              Create account
            </SecondaryButton>
          </Card>
        </Section>
      </SectionList>
    </Screen>
  )
}
